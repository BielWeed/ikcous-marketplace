import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome =
  "20261395200000_a_conclusao_da_devolucao_tranca_na_mesma_ordem_da_compra.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const DELIM = "$$";
const FN = "admin_devolucao_concluir";
const V = "20261395200000";
const definicao = (sql: string) => {
  const ini = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${FN}(`);
  if (ini < 0) return "";
  const ab = sql.indexOf(DELIM, ini);
  const fim = sql.indexOf(DELIM, ab + DELIM.length);
  return sql.slice(ini, fim + DELIM.length);
};
const corpo = (sql: string) => {
  const d = definicao(sql);
  const ab = d.indexOf(DELIM);
  return d.slice(ab + DELIM.length, d.length - DELIM.length);
};
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const H_ANTES = "ea651d52157521c0fe7ffccc948b4b1a";
const H_DEPOIS = "a152c8dcd7cf6d1e05e5aff128d6c45e";

const inverso = (c: string) => {
  const ini = c.indexOf("  -- >>> ordem global das travas (20261395200000)");
  const fimMarca = "  -- <<< ordem global das travas (20261395200000)\n\n";
  const fim = c.indexOf(fimMarca) + fimMarca.length;
  assert.ok(ini > 0 && fim > ini);
  const semBloco = c.slice(0, ini) + c.slice(fim);
  const decl =
    "  -- 20261395200000: ids a trancar de uma vez, na ordem global (bloco abaixo).\n" +
    "  v_trava_variantes uuid[];\n  v_trava_produtos uuid[];\n";
  assert.equal(semBloco.split(decl).length - 1, 1);
  return semBloco.replace(decl, "");
};

const anterior = ler(
  "supabase/migrations/20261343000000_o_reembolso_manual_respeita_a_reserva.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);

Deno.test("395200: o corpo anterior e' o da 20261343000000; esta migration so acrescenta a troca declarada; o rollback devolve o corpo byte a byte", () => {
  assert.equal(md5(corpo(anterior)), H_ANTES);
  assert.equal(md5(corpo(sql)), H_DEPOIS);
  assert.equal(md5(corpo(rb)), H_ANTES);
  assert.equal(corpo(rb), corpo(anterior));
  assert.equal(definicao(rb), definicao(anterior));
  // O cabecalho (assinatura, SECURITY DEFINER, search_path, retorno) e' o mesmo.
  assert.equal(
    definicao(sql).split(DELIM)[0],
    definicao(anterior).split(DELIM)[0],
  );
  // Desfeita a troca (inverso escrito a parte), sobra o corpo anterior, byte a byte.
  assert.equal(inverso(corpo(sql)), corpo(anterior));
  assert.equal(sql.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
  assert.equal(rb.match(/CREATE OR REPLACE FUNCTION/g)?.length, 1);
});

Deno.test("395200: a troca declarada esta onde deve e o resto do corpo (portas, dinheiro, estoque, retorno) nao mudou", () => {
  const c = corpo(sql);
  const iBloco = c.indexOf("  -- >>> ordem global das travas (20261395200000)");
  const iFimBloco = c.indexOf(
    "  -- <<< ordem global das travas (20261395200000)",
  );
  const iLaco = c.indexOf("FOR v_item IN SELECT * FROM jsonb_array_elements");
  const iPagamento = c.indexOf(
    "Este pedido não tem pagamento registrado para devolver.",
  );
  // O bloco fica depois das checagens do pedido e ANTES do laco que credita.
  assert.ok(
    iPagamento > 0 &&
      iPagamento < iBloco &&
      iBloco < iFimBloco &&
      iFimBloco < iLaco,
  );
  const bloco = c.slice(iBloco, iFimBloco);
  // Variacoes por id, depois produtos por id, cada grupo num SELECT ... ORDER BY id FOR NO KEY UPDATE; so quando pode haver credito.
  assert.ok(
    bloco.indexOf("FROM public.product_variants v") <
      bloco.indexOf("FROM public.produtos p"),
  );
  assert.equal(
    bloco.split("ORDER BY v.id\n         FOR NO KEY UPDATE;").length - 1,
    1,
  );
  assert.equal(
    bloco.split("ORDER BY p.id\n         FOR NO KEY UPDATE;").length - 1,
    1,
  );
  assert.ok(bloco.includes("IF v_o.stock_returned_at IS NULL THEN"));
  assert.ok(bloco.includes("di.reestocado_em IS NULL"));
  // O bloco so TRANCA: nenhum UPDATE, INSERT ou DELETE dentro dele.
  // (`FOR NO KEY UPDATE` e' a trava, nao uma escrita: sai da conta antes de procurar UPDATE/INSERT/DELETE.)
  assert.doesNotMatch(
    bloco.replace(/--[^\n]*/g, "").replace(/FOR NO KEY UPDATE/g, ""),
    /\b(?:UPDATE|INSERT|DELETE)\b/,
  );
  // O dinheiro e o estoque (laco, reembolso, retorno) ficam como estavam.
  assert.ok(
    c.includes(
      "UPDATE public.product_variants SET stock_increment = stock_increment + v_di.quantidade",
    ),
  );
  assert.ok(
    c.includes(
      "v_valor := LEAST(round(v_d.valor_itens + v_d.valor_frete_ida, 2), v_disponivel);",
    ),
  );
  assert.ok(
    c.includes(
      "INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)",
    ),
  );
  assert.equal(
    corpo(sql).split(">>> ordem global das travas (20261395200000)").length - 1,
    1,
  );
});

Deno.test("395200: sem BEGIN/COMMIT, pre-voo antes do CREATE, hashes e fotografia dos atributos amarrados; nada de ACL, tabela ou dado; tudo em LF", () => {
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
    const externo = texto
      .replace(definicao(texto), "")
      .replace(/--[^\n]*/g, "");
    assert.doesNotMatch(
      externo,
      /\b(?:BEGIN;|COMMIT|GRANT|REVOKE|INSERT|UPDATE|DELETE|DROP|TRUNCATE|ALTER)\b/i,
    );
    assert.ok(
      externo.indexOf("B1_BASELINE_DIVERGENT") <
        texto.indexOf("CREATE OR REPLACE FUNCTION"),
    );
    assert.ok(texto.includes("p.proname = 'admin_devolucao_concluir') <> 1"));
    assert.ok(texto.includes("AND p.prosecdef"));
    assert.ok(texto.includes("AND p.provolatile = 'v'"));
    assert.ok(texto.includes("AND p.pronargs = 5"));
    assert.ok(texto.includes("AND p.prokind = 'f'"));
    assert.ok(
      texto.includes("AND p.proconfig = ARRAY['search_path=public']::text[]"),
    );
    // A ACL: authenticated e service_role sim; anon e PUBLIC nao.
    assert.ok(
      texto.includes("has_function_privilege('anon', v_oid, 'EXECUTE')"),
    );
    assert.ok(
      texto.includes(
        "NOT has_function_privilege('authenticated', v_oid, 'EXECUTE')",
      ),
    );
    assert.ok(
      texto.includes(
        "NOT has_function_privilege('service_role', v_oid, 'EXECUTE')",
      ),
    );
    assert.ok(texto.includes("g.privilege_type = 'EXECUTE' AND g.grantee = 0"));
  }
  assert.ok(sql.includes(H_ANTES) && sql.includes(H_DEPOIS));
  // O pre-voo aceita o corpo vigente OU o desta migration (reaplicar e' no-op); o rollback so aceita o desta.
  assert.ok(sql.includes("v_hash NOT IN (v_vigente, v_desta)"));
  assert.ok(sql.includes(`', '${H_ANTES}', '${H_DEPOIS}')`));
  assert.ok(rb.includes(`IF v_hash IS DISTINCT FROM '${H_DEPOIS}' THEN`));
  assert.ok(
    sql.includes("current_setting('ikcous.concl395_atributos')::jsonb"),
  );
  assert.ok(
    rb.includes("current_setting('ikcous.concl395_rb_atributos')::jsonb"),
  );
  assert.ok(
    sql.includes("a troca desta migration não aparece exatamente uma vez"),
  );
  assert.ok(sql.includes("SET LOCAL lock_timeout = '5s';"));
  assert.ok(!sql.includes("\r"));
  assert.ok(!rb.includes("\r"));
  const bruto = Deno.readTextFileSync(
    new URL(`../supabase/migrations/${nome}`, import.meta.url),
  );
  assert.ok(!bruto.includes("\r"), "a migration em disco tem CR");
});

Deno.test("395200: a vigente e' a ultima redefinicao de admin_devolucao_concluir da arvore; db-apply exige as guardas", () => {
  const fontes = [...Deno.readDirSync(dir)]
    .map((e) => e.name)
    .filter((n) => /^\d{14}_.*\.sql$/.test(n))
    .sort()
    .filter((n) => definicao(ler(`supabase/migrations/${n}`)));
  assert.equal(
    fontes.at(-1),
    nome,
    "outra migration redefine admin_devolucao_concluir depois desta",
  );
  assert.equal(
    fontes.at(-2),
    "20261343000000_o_reembolso_manual_respeita_a_reserva.sql",
  );
  const { VERIFICACOES, avaliarChecagem } = require("../scripts/db-apply.cjs");
  // eslint-disable-next-line security/detect-object-injection -- Nome literal desta migration, nunca entrada externa.
  const checagens = VERIFICACOES[nome];
  assert.equal(checagens?.length, 1);
  assert.equal(checagens[0].funcao, FN);
  assert.equal(
    avaliarChecagem(corpo(sql), checagens[0]).situacao,
    "verificada",
  );
  // Sem a troca (o corpo anterior) a verificacao falha; cada marcador tira a verificacao do ar quando some.
  assert.equal(
    avaliarChecagem(corpo(anterior), checagens[0]).situacao,
    "falhou",
  );
  for (const m of checagens[0].esperado as Array<{ texto: string }>)
    assert.equal(
      avaliarChecagem(corpo(sql).replace(m.texto, "XX"), checagens[0]).situacao,
      "falhou",
      `o marcador "${m.texto.slice(0, 40)}" nao pega a regressao`,
    );
});

Deno.test("395200: as consultas 110a/110b sao so de catalogo, quatro linhas fechadas, registradas, e as consultas antigas aceitam o corpo novo", async () => {
  for (const f of [
    "43a-conferir-reembolso-em-duvida-aplicado",
    "67a-conferir-reembolso-manual-reserva-aplicado",
    "8e-conferir-92-a-202-aplicado",
  ]) {
    const q = ler(`scripts/publicacao/consultas/${f}.sql`);
    assert.ok(
      q.includes(H_DEPOIS),
      `${f} nao aceita o corpo novo como sucessor`,
    );
  }
  assert.ok(
    ler(
      "scripts/publicacao/consultas/8e-conferir-92-a-202-aplicado.sql",
    ).includes(`('${FN}', '${H_DEPOIS}', '${V}')`),
  );
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const A =
    "110a-conferir-a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-aplicado";
  const B =
    "110b-antes-a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-base-vigente";
  for (const [nomeConsulta, hash] of [
    [A, H_DEPOIS],
    [B, H_ANTES],
  ]) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(`'${hash}'`));
    // So catalogo: nenhuma tabela de dado e' lida e a RPC nao e' chamada.
    assert.doesNotMatch(
      consulta,
      /FROM public\.(?:marketplace_|produtos|profiles|coupons|store_config|devolucoes|devolucao_itens|product_variants)/,
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
  ).provasDeObjetos.find((p: { versoes: string[] }) => p.versoes.includes(V));
  assert.equal(entrada.consulta, A);
  assert.equal(entrada.ausenciaConfirmadaPor, B);
  assert.deepEqual(entrada.versoes, [V]);
  for (const campo of [
    "backfillLedger",
    "nuncaAplicar",
    "soNosRefs",
    "conferenciasAntesDoApply",
  ])
    assert.equal(
      Object.entries(entrada).find(([chave]) => chave === campo)?.[1],
      undefined,
      campo,
    );
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-viva.cjs",
    ),
  );
  assert.ok(
    ler("tests/banco/LEIA-ME.md").includes(
      "a-conclusao-da-devolucao-tranca-na-mesma-ordem-da-compra-viva.cjs",
    ),
  );
});
