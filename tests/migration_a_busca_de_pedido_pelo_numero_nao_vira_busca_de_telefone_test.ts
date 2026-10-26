import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

// 20261387: a busca de pedido pelo numero nao vira busca de telefone.
// Prova ESTATICA (sem Postgres): o que muda no corpo, o que NAO pode mudar, a regra
// amarrada ao numero que o front mostra e todos os registros de publicacao. O
// comportamento contra um banco de verdade e tests/banco/a-busca-de-pedido-pelo-numero-viva.cjs
// (so no CI).
const require = createRequire(import.meta.url);
const nome =
  "20261387000000_a_busca_de_pedido_pelo_numero_nao_vira_busca_de_telefone.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const definicao = (sql: string) =>
  sql.match(
    /CREATE OR REPLACE FUNCTION public\.get_admin_orders_paged\([\s\S]*?\n\$\$;/,
  )?.[0] ?? "";
const corpo = (sql: string) =>
  definicao(sql).split("AS $$")[1]?.slice(0, -3) ?? "";
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const anterior = ler(
  "supabase/migrations/20261199000000_portas_do_painel_exigem_admin_atual.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

const HASH_99 = "5861dbbe0e9c007a4196f5308c17d763";
const SIG =
  "public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)";

// As QUATRO edicoes do corpo, escritas por extenso: tirando-as, o corpo tem de voltar ao da 99.
const E1_DECLARE = "    v_parece_telefone BOOLEAN;\n";
const E2_CALCULO =
  / {4}-- A busca so e' de TELEFONE[\s\S]*?v_parece_telefone := [^\n]*\n/;
const E3_COMENTARIO =
  / {12}--\n {12}-- E SO' QUANDO A BUSCA PARECE TELEFONE[\s\S]*?no comeco\.\n/g;
const E4_ORDER_BY =
  / {8}-- O pedido que o NUMERO digitado nomeia vem primeiro[\s\S]*? {12}END,\n {12}o\.created_at DESC\n/;

Deno.test("387: o numero do arquivo e unico e o par migration+rollback existe", () => {
  const nomes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => n.includes("20261387000000"));
  assert.deepEqual(nomes.sort(), [`rollback-manual-${nome}`, nome].sort());
});

Deno.test("387: so as quatro edicoes mudam o corpo; tirando-as, e o da 99 byte a byte", () => {
  assert.equal(md5(corpo(anterior)), HASH_99);
  const c = corpo(sql);
  assert.notEqual(c, corpo(anterior));
  assert.ok(c.includes(E1_DECLARE));
  assert.ok(E2_CALCULO.test(c));
  assert.equal((c.match(E3_COMENTARIO) ?? []).length, 2, "um por bloco");
  assert.ok(E4_ORDER_BY.test(c));
  const volta = c
    .replace(E1_DECLARE, "")
    .replace(E2_CALCULO, "")
    .replace(E3_COMENTARIO, "")
    .replace(E4_ORDER_BY, "        ORDER BY o.created_at DESC\n")
    .replaceAll("v_parece_telefone AND length(", "length(");
  assert.equal(volta, corpo(anterior), "ha mudanca fora das quatro edicoes");
  // Cabecalho da funcao (assinatura, defaults, SECURITY DEFINER, search_path): identico ao da 99.
  assert.equal(
    definicao(sql).split("AS $$")[0],
    definicao(anterior).split("AS $$")[0],
  );
  // Os dois gates de admin continuam antes de qualquer leitura.
  assert.ok(c.indexOf("IF NOT public.is_admin() THEN") < c.indexOf("SELECT"));
  assert.ok(
    c.indexOf("IF NOT public.is_admin_atual() THEN") < c.indexOf("SELECT"),
  );
  // O retorno e a projecao de colunas nao mudam.
  assert.ok(
    c.includes(`    RETURN jsonb_build_object(
        'data', v_data,
        'total_count', v_total_count
    );`),
  );
});

Deno.test("387: a regra do telefone vale nos DOIS blocos e mantem o limiar de 4 digitos", () => {
  const c = corpo(sql);
  // Contagem e pagina com o MESMO texto: senao total_count e a lista divergem.
  assert.equal(
    c.split("v_parece_telefone AND length(v_search_digitos) >= 4").length - 1,
    2,
  );
  assert.equal(c.split("length(v_search_digitos)").length - 1, 2);
  // A regra: so digito e os enfeites de um telefone; nada de letra.
  assert.ok(
    c.includes("v_parece_telefone := v_clean_search ~ '^[+]?[0-9() .-]+$';"),
  );
  const re = /^[+]?[0-9() .-]+$/;
  for (const parece of [
    "34988887777",
    "(34) 98888-7777",
    "+55 34 98888-7777",
    "34.98888.7777",
    "7777",
  ])
    assert.ok(re.test(parece), parece);
  for (const naoParece of [
    "3884BE",
    "3884be",
    "Maria 3884",
    "12345abc",
    "#3884",
    "",
    "34;9",
  ])
    assert.ok(!re.test(naoParece), naoParece);
  // O telefone continua comparado so por digito, dos dois lados, nos dois blocos.
  assert.equal(
    c.split("coalesce(o.customer_phone, o.customer_data->>'whatsapp', '')")
      .length - 1,
    2,
  );
  assert.equal(c.split("'[^0-9]', '', 'g'").length - 1, 3);
});

Deno.test("387: o pedido do numero vem primeiro e o numero e o MESMO que o front mostra", () => {
  const c = corpo(sql);
  assert.ok(
    c.includes("AND upper(right(o.id::TEXT, 6)) = upper(v_clean_search)"),
  );
  // So a pagina ganha a chave de ordem; a ordem seguinte e a de sempre.
  assert.equal(c.split("ORDER BY").length - 1, 1);
  assert.ok(c.indexOf("ELSE 1") < c.indexOf("o.created_at DESC"));
  // O numero que o painel mostra: os 6 ultimos caracteres do id, em maiusculas (numeroDoPedido).
  const front = ler("src/lib/numero-do-pedido.ts");
  assert.ok(front.includes('(id ?? "").slice(-6).toUpperCase()'));
});

Deno.test("387: uma funcao so por arquivo, rollback e cabecalho identicos aos vigentes", () => {
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
        "(to_jsonb(p) - 'prosrc') = current_setting('ikcous.pedidos1387_atributos')::jsonb",
      ),
    );
    assert.ok(texto.includes(md5(corpo(anterior))));
    assert.ok(texto.includes(md5(corpo(sql))));
    // O lock_timeout/statement_timeout da casa: nenhum apply fica esperando uma trava para sempre.
    assert.ok(texto.includes("SET LOCAL lock_timeout = '5s';"));
  }
  // Idempotencia: o pre-voo aceita o corpo vigente OU o desta migration; o rollback so o desta.
  assert.ok(sql.includes("v_hash NOT IN (r.hash_vigente, r.hash_desta)"));
  assert.ok(rb.includes("v_hash IS DISTINCT FROM r.hash_desta"));
  // O preflight cita exatamente UM par (assinatura, vigente, desta): e o que o inventario da 99 le.
  assert.ok(sql.includes(`('${SIG}', '${HASH_99}', '${md5(corpo(sql))}')`));
  assert.ok(rb.includes(`('${SIG}', '${HASH_99}', '${md5(corpo(sql))}')`));
  // Atributos e permissoes conferidos no pre-voo (nao so o corpo): service_role, anon, PUBLIC e sobrecarga.
  for (const t of [
    "has_function_privilege('service_role', p.oid, 'EXECUTE')",
    "has_function_privilege('authenticated', p.oid, 'EXECUTE')",
    "NOT has_function_privilege('anon', p.oid, 'EXECUTE')",
    "ARRAY['search_path=public, extensions']",
    "q.proname = 'get_admin_orders_paged') = 1",
  ]) {
    assert.ok(sql.includes(t), t);
    assert.ok(rb.includes(t), t);
  }
});

Deno.test("387: o corpo novo e o MAIS NOVO da arvore e o db-apply exige todas as guardas", () => {
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
  assert.equal(checagem?.funcao, "get_admin_orders_paged");
  assert.equal(avaliarChecagem(corpo(sql), checagem).situacao, "verificada");
  for (const marcador of checagem.esperado) {
    assert.equal(
      avaliarChecagem(
        corpo(sql).replace(marcador.texto ?? marcador, ""),
        checagem,
      ).situacao,
      "falhou",
      marcador.texto ?? marcador,
    );
  }
  // O corpo antigo (a 99) NAO passa na checagem: os marcadores da regra nova faltam.
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

Deno.test("387: 8e e 9a conhecem o corpo novo (como sucessor e como corpo final)", () => {
  const novo = md5(corpo(sql));
  const e8 = ler(
    "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
  );
  assert.ok(
    e8.includes(`('get_admin_orders_paged', '${novo}', '20261387000000')`),
  );
  // A 8e continua tratando o corpo da 99 como o `final` de 92..202.
  assert.ok(e8.includes(`('get_admin_orders_paged', '${HASH_99}')`));
  const a9 = ler(
    "scripts/publicacao/consultas/9a-conferir-60-a-66-aplicado.sql",
  );
  assert.ok(a9.includes(`('get_admin_orders_paged', '${novo}')`));
  assert.ok(!a9.includes(`('get_admin_orders_paged', '${HASH_99}')`));
});

Deno.test("387: consultas so de catalogo, quatro linhas fechadas e registros de publicacao", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas = [
    ["92a-conferir-a-busca-de-pedido-pelo-numero-aplicado", md5(corpo(sql))],
    [
      "92b-antes-a-busca-de-pedido-pelo-numero-base-vigente",
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
    p.versoes.includes("20261387000000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/a-busca-de-pedido-pelo-numero-viva.cjs",
    ),
  );
});
