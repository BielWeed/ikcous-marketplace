import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// 20261380: o aviso de cancelados antigos (fora_da_janela) conta so pendencia real.
// Prova ESTATICA (sem Postgres): o que muda no corpo, o que NAO pode mudar, a regra
// espelhada na do painel e todos os registros de publicacao. O comportamento contra
// um banco de verdade e tests/banco/o-aviso-de-cancelados-antigos-viva.cjs (so no CI).
const require = createRequire(import.meta.url);
const nome =
  "20261380000000_o_aviso_de_cancelados_antigos_conta_so_pendencia_real.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const definicao = (sql: string) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.get_admin_orders_cancelados_recentes\([\s\S]*?\n\$\$;/,
  )?.[0] ?? "";
const corpo = (sql: string) =>
  definicao(sql).split("AS $$")[1]?.slice(0, -3) ?? "";
const md5 = (s: string) => createHash("md5").update(s).digest("hex");
const norm = (s: string) => s.replace(/\s+/g, " ").trim();

const anterior = ler(
  "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const front = ler("src/views/admin/AdminOrdersView.tsx");

const HASH_99 = "99a9e4cb232aef020bf297ddcd1901f0";
const SIG =
  "public.get_admin_orders_cancelados_recentes(integer,integer,integer)";

// O bloco que a migration troca: a contagem. Tudo o mais tem de ser o da 99.
const INICIO = "    -- Contagem, numa passada só";
const FIM = "          FROM public.marketplace_orders o\n";
const bloco = (c: string) => {
  const i = c.indexOf(INICIO);
  const j = c.indexOf(FIM, i) + FIM.length;
  return { antes: c.slice(0, i), meio: c.slice(i, j), depois: c.slice(j) };
};

Deno.test("380: o numero do arquivo e unico e o par migration+rollback existe", () => {
  const nomes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => n.includes("20261380000000"));
  assert.deepEqual(nomes.sort(), [`rollback-manual-${nome}`, nome].sort());
});

Deno.test("380: so o bloco da contagem muda; o resto do corpo e o da 99, byte a byte", () => {
  assert.equal(md5(corpo(anterior)), HASH_99);
  const novo = bloco(corpo(sql));
  const velho = bloco(corpo(anterior));
  assert.equal(novo.antes, velho.antes, "o comeco do corpo mudou");
  assert.equal(novo.depois, velho.depois, "o fim do corpo mudou");
  assert.notEqual(novo.meio, velho.meio);
  // Cabecalho da funcao (assinatura, defaults, SECURITY DEFINER, search_path): identico ao da 99.
  assert.equal(
    definicao(sql).split("AS $$")[0],
    definicao(anterior).split("AS $$")[0],
  );
  // Os dois gates de admin continuam antes de qualquer leitura.
  const c = corpo(sql);
  assert.ok(c.indexOf("IF NOT public.is_admin() THEN") < c.indexOf("SELECT"));
  assert.ok(
    c.indexOf("IF NOT public.is_admin_atual() THEN") < c.indexOf("SELECT"),
  );
  // O retorno (data, total_count, fora_da_janela) e a projecao de colunas nao mudam.
  assert.ok(
    c.includes(`    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count,
        'fora_da_janela', v_fora_da_janela
    );`),
  );
});

Deno.test("380: a regra nova esta SO no fora_da_janela; o total de dentro da janela nao muda", () => {
  const { meio } = bloco(corpo(sql));
  const filtros = meio.split("COUNT(*) FILTER (");
  assert.equal(filtros.length, 3, "esperados dois COUNT FILTER");
  assert.ok(!filtros[1].includes("pendente"), "o total de dentro mudou");
  assert.ok(filtros[2].includes("WHERE p_dias IS NOT NULL"));
  assert.ok(
    filtros[2].includes("cancelado_em < now() - make_interval(days => p_dias)"),
  );
  assert.ok(filtros[2].includes("AND pendente"));
  // p_dias NULL = sem janela = fora 0, como antes.
  assert.ok(norm(meio).includes("WHERE p_dias IS NOT NULL AND cancelado_em <"));
});

Deno.test("380: a regra de pendencia e a MESMA dos dois baldes do painel (nao deriva do front)", () => {
  const { meio } = bloco(corpo(sql));
  // (a) dinheiro: as MESMAS tres portas de pagamento de baldeDeEstorno.
  const fn = front.match(/export function baldeDeEstorno[\s\S]*?\n\}\n/)?.[0];
  assert.ok(fn, "baldeDeEstorno sumiu do front");
  const portas = [...fn.matchAll(/paymentStatus === "([a-z_]+)"/g)]
    .map((m) => m[1])
    .sort();
  assert.deepEqual(portas, [
    "pago",
    "pago_apos_expirar",
    "recebido_na_entrega",
  ]);
  const lista = meio.match(/o\.payment_status IN \(([^)]*)\)/)?.[1] ?? "";
  assert.deepEqual(
    [...lista.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort(),
    portas,
    "as portas de pagamento do banco divergem das do painel",
  );
  // O que sobra a devolver: total - devolucao manual concluida - valor_estornado (valorDevolverAgora).
  const saldo = ler("src/lib/valor-devolver-agora.ts");
  assert.ok(
    /centavos\(total\) - centavos\(jaDevolvido\) - centavos\(jaEstornado\)/.test(
      saldo,
    ),
  );
  const m = norm(meio);
  assert.ok(
    m.includes("THEN o.total - COALESCE((SELECT sum(d.valor_reembolso)"),
  );
  assert.ok(m.includes("d.status = 'concluida' AND d.reembolso_manual"));
  assert.ok(m.includes("- COALESCE(o.valor_estornado, 0) > 0"));
  // (b) mercadoria: enviado e cancelado depois de sair, produto ainda nao voltou.
  const merc = front.match(
    /export function precisaConfirmarRetornoDoProduto[\s\S]*?\n\}\n/,
  )?.[0];
  assert.ok(merc?.includes("Boolean(pedido.cancelledAfterShipping)"));
  assert.ok(merc?.includes("!pedido.returnedToSellerAt"));
  assert.ok(
    m.includes(
      "(o.cancelled_after_shipping IS TRUE AND o.returned_to_seller_at IS NULL)",
    ),
  );
  // Uniao das duas pendencias (nao a interseccao), e dentro do COALESCE: NULL nunca esconde pendencia.
  assert.ok(m.includes("IS NULL) OR CASE WHEN o.payment_status IN"));
  assert.ok(m.includes("ELSE FALSE END, FALSE) AS pendente"));
  // Sem filtro de canal: balcao e online contam igual (o painel tambem nao filtra por canal).
  assert.ok(!/\bcanal\b/.test(meio));
  // So pedido cancelado entra (o WHERE do SELECT de contagem continua).
  assert.ok(corpo(sql).includes("WHERE o.status = 'cancelled'"));
});

Deno.test("380: uma funcao so por arquivo, rollback e cabecalho identicos aos vigentes", () => {
  assert.equal(definicao(rb), definicao(anterior));
  assert.equal(corpo(rb), corpo(anterior));
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  for (const texto of [sql, rb]) {
    assert.ok(texto.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
    assert.equal(
      require("../scripts/db-prove-rollback.cjs").avaliarFase0({
        sqlMigration: texto,
        sqlRollback: rb,
        temRollback: true,
      }).recusado,
      false,
    );
    // Nenhuma mudanca de ACL, tabela ou dado fora do corpo da funcao.
    const externo = texto
      .replace(definicao(texto), "")
      .replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      externo,
      /\b(?:GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|BEGIN;|COMMIT)\b/i,
    );
    // Sem controle de transacao de nivel superior (regra da casa).
    assert.doesNotMatch(
      texto.replace(/--[^\n]*/g, ""),
      /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im,
    );
    assert.ok(
      externo.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
      "o preflight tem de vir ANTES da funcao",
    );
    assert.ok(
      texto.includes(
        "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.cancelados1380_atributos')::jsonb",
      ),
    );
    assert.ok(texto.includes(md5(corpo(anterior))));
    assert.ok(texto.includes(md5(corpo(sql))));
  }
  // Idempotencia: o pre-voo aceita o corpo vigente OU o desta migration; o rollback so o desta.
  assert.ok(sql.includes("v_hash NOT IN (r.hash_vigente, r.hash_desta)"));
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  // O preflight cita exatamente UM par (assinatura, vigente, desta): e o que o inventario da 99 le.
  assert.ok(sql.includes(`('${SIG}', '${HASH_99}', '${md5(corpo(sql))}')`));
  assert.ok(rb.includes(`('${SIG}', '${HASH_99}', '${md5(corpo(sql))}')`));
  // Atributos e permissoes conferidos no pre-voo (nao so o corpo): service_role, anon e PUBLIC.
  for (const t of [
    "has_function_privilege('service_role', p.oid, 'EXECUTE')",
    "NOT has_function_privilege('anon', p.oid, 'EXECUTE')",
    "ARRAY['search_path=public, extensions']",
  ]) {
    assert.ok(sql.includes(t), t);
    assert.ok(rb.includes(t), t);
  }
});

Deno.test("380: o corpo novo e o MAIS NOVO da arvore e o db-apply exige todas as guardas", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .map((n) => ler(`supabase/migrations/${n}`))
    .filter((s) => definicao(s));
  assert.equal(md5(corpo(fontes.at(-1)!)), md5(corpo(sql)));
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagem = VERIFICACOES[nome];
  assert.equal(checagem?.funcao, "get_admin_orders_cancelados_recentes");
  assert.equal(avaliarChecagem(corpo(sql), checagem).situacao, "verificada");
  for (const marcador of checagem.esperado) {
    assert.equal(
      avaliarChecagem(corpo(sql).replace(marcador, ""), checagem).situacao,
      "falhou",
      marcador,
    );
  }
  // O corpo antigo (a 99) NAO passa na checagem: o marcador da regra nova falta.
  assert.equal(avaliarChecagem(corpo(anterior), checagem).situacao, "falhou");
  const {
    conferirLista,
    SUCESSORAS_DA_99,
  } = require("./banco/sucessoras-da-99.cjs");
  conferirLista();
  const registro = SUCESSORAS_DA_99.find(
    (s: { nome: string }) => s.nome === nome,
  );
  assert.equal(registro.hashVigente, md5(corpo(anterior)));
  assert.equal(registro.hashDesta, md5(corpo(sql)));
});

Deno.test("380: 8e e 9a conhecem o corpo novo (como sucessor e como corpo final)", () => {
  const novo = md5(corpo(sql));
  const e8 = ler(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    e8.includes(
      `('get_admin_orders_cancelados_recentes', '${novo}', '20261380000000')`,
    ),
  );
  // A 8e continua tratando o corpo da 99 como o `final` de 92..202.
  assert.ok(
    e8.includes(`('get_admin_orders_cancelados_recentes', '${HASH_99}')`),
  );
  const a9 = ler(
    "scripts/publicacao/consultas/9a-conferir-60-a-66-aplicado.sql",
  );
  assert.ok(a9.includes(`('get_admin_orders_cancelados_recentes', '${novo}')`));
  assert.ok(
    !a9.includes(`('get_admin_orders_cancelados_recentes', '${HASH_99}')`),
  );
});

Deno.test("380: consultas so de catalogo, quatro linhas fechadas e registros de publicacao", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas = [
    ["85a-conferir-aviso-de-cancelados-antigos-aplicado", md5(corpo(sql))],
    [
      "85b-antes-aviso-de-cancelados-antigos-base-vigente",
      md5(corpo(anterior)),
    ],
  ];
  for (const [nomeConsulta, hash] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(hash));
    // So catalogo: nenhuma tabela de pedido, cliente ou devolucao.
    assert.doesNotMatch(
      consulta.replace(/--[^\n]*/g, ""),
      /FROM public\.(?:marketplace_|devolucoes|profiles|produtos)/,
    );
    const itens = [...consulta.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    // eslint-disable-next-line security/detect-object-injection -- Nome vem da dupla fechada de consultas acima.
    const rol = ROL_FECHADO_POR_CONSULTA[nomeConsulta];
    assert.deepEqual(itens, rol);
    assert.equal(rol.length, 4);
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(nomeConsulta));
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assert.equal(estruturaDoRolFechado(linhas, rol), null);
    assert.notEqual(estruturaDoRolFechado(linhas.slice(1), rol), null);
    assert.notEqual(estruturaDoRolFechado([...linhas, linhas[0]], rol), null);
    assert.equal(
      ler(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${nomeConsulta}.sql"`,
      ).length - 1,
      2,
    );
    assert.ok(
      ler(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nomeConsulta}\n`,
      ),
    );
  }
  const entrada = JSON.parse(
    ler("scripts/frota/canais-de-backend.json"),
  ).provasDeObjetos.find((p: { versoes: string[] }) =>
    p.versoes.includes("20261380000000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/o-aviso-de-cancelados-antigos-viva.cjs",
    ),
  );
});
