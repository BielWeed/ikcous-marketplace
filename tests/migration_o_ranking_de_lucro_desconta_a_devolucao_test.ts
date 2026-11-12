// O RANKING DE LUCRO DESCONTA A DEVOLUCAO E O ESTORNO: prova offline do par 20261399970000 + rollback (lote 135). O COMPORTAMENTO (devolucao, vale, troca, perda,
// cortesia, cupom, grafico diario, JSON igual ao da 251, mutantes, rollback, conexao sem BEGIN e consultas 135a/135b) e' provado em
// tests/banco/o-ranking-de-lucro-desconta-a-devolucao-viva.cjs, que so roda no Postgres efemero do CI. Aqui fica o que se prova so lendo o texto.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const nome = "20261399970000_o_ranking_de_lucro_desconta_a_devolucao.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const definicao = (sql: string) => {
  const ini = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(",
  );
  if (ini < 0) return "";
  const fecho = "\n$$;";
  return sql.slice(ini, sql.indexOf(fecho, ini) + fecho.length);
};
const corpo = (sql: string) =>
  definicao(sql).split("AS $$")[1]?.slice(0, -3) ?? "";
const md5 = (s: string) => createHash("md5").update(s).digest("hex");

const anterior = ler(
  "supabase/migrations/20261251000000_o_lucro_do_estoque_usa_o_preco_da_variante.sql",
);
const sql = ler(`supabase/migrations/${nome}`);
const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
const H = {
  antes: "060c9ab5b1505dc375b41e4436e9d3a8",
  depois: "0ea0841208f326971e4f92241929e088",
};

Deno.test("3997: os hashes das duas pontas batem com os corpos escritos; o rollback devolve o corpo da 251 byte a byte", () => {
  assert.equal(md5(corpo(anterior)), H.antes);
  assert.equal(md5(corpo(sql)), H.depois);
  assert.equal(definicao(rb), definicao(anterior));
  for (const texto of [sql, rb]) {
    assert.ok(
      texto.includes(
        `('public.get_admin_analytics_v2(integer)', '${H.antes}', '${H.depois}')`,
      ),
      "o pre-voo nao cita (assinatura, vigente, desta)",
    );
    assert.ok(
      texto.includes("AS esperado(assinatura, hash_vigente, hash_desta)"),
    );
    assert.ok(texto.includes("SET LOCAL lock_timeout = '5s';"));
    // Sem controle de transacao: o aplicador fornece a transacao inteira (AGENTS.md).
    assert.doesNotMatch(texto, /^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im);
    // Nenhum grant novo e nenhum objeto novo.
    assert.doesNotMatch(
      texto,
      /^\s*(GRANT|REVOKE|CREATE (TABLE|INDEX|POLICY|TRIGGER|SCHEMA))\b/im,
    );
    assert.ok(texto.includes("NOTIFY pgrst, 'reload schema';"));
  }
});

Deno.test("3997: a funcao fica SECURITY DEFINER com search_path fixo, as duas guardas de admin e a regra (b) da devolucao", () => {
  const def = definicao(sql);
  assert.match(
    def,
    /RETURNS json\n LANGUAGE plpgsql\n SECURITY DEFINER\n SET search_path TO 'public'/,
  );
  assert.equal(def.split("IF NOT public.is_admin() THEN").length - 1, 1);
  assert.equal(def.split("IF NOT public.is_admin_atual() THEN").length - 1, 1);
  // devolvida = concluida com reembolso ou vale (troca NAO conta), nas quatro leituras (item e rateio, ranking e grafico).
  assert.equal(
    def.split("resolucao_final IN ('reembolso', 'vale')").length - 1,
    4,
  );
  assert.ok(!def.includes("'troca'"), "a troca nao pode contar como devolvida");
  assert.equal(def.split("AND rf.status = 'concluido'").length - 1, 2);
  // O estorno LIGADO a devolucao nao e cortesia: sai do residual (senao desconta duas vezes).
  assert.equal(def.split("dv_lig.refund_id = rf.id").length - 1, 2);
  // Devolvido pelo painel do MP (a linha ligada falhou/foi recusada, ou "ja devolvi por fora"): a linha 'sistema' concluida, sem contestacao,
  // criada depois da conclusao da devolucao, limitada ao que ela devolveu, abate do residual — nos dois blocos, nunca "sempre o valor_reembolso".
  for (const trecho of [
    "AND sp.solicitado_por = 'sistema'",
    "AND sp.status = 'concluido'",
    "AND sp.mp_chargeback_id IS NULL",
    "AND sp.created_at >= g.desde",
    "SELECT LEAST(g.valor, COALESCE((",
    "WHERE g.valor IS NOT NULL",
    "(dvp.refund_id IS NULL AND dvp.reembolso_manual)",
    "OR rlp.status IN ('falhou', 'recusado')",
  ]) {
    assert.equal(def.split(trecho).length - 1, 2, trecho);
  }
  // Os dois lugares trocam a conta; o resto do corpo e' o da 251.
  assert.equal(
    def.split("- dev.perdidas * COALESCE(oic.custo, p.custo)").length - 1,
    2,
  );
  assert.equal(
    def.split("SUM(oi.quantity - dev.devolvidas)::int").length - 1,
    1,
  );
  assert.ok(
    def.includes(
      "COALESCE(SUM(oi.quantity * COALESCE(oic.custo, p.custo, 0)), 0) AS cost_sold",
    ),
  );
});

Deno.test("3997: consultas 135a/135b so de catalogo, quatro linhas fechadas, hashes certos e registros de publicacao", async () => {
  const { contarStatements, ROL_FECHADO_POR_CONSULTA, estruturaDoRolFechado } =
    require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const consultas: Array<[string, string]> = [
    [
      "135a-conferir-o-ranking-de-lucro-desconta-a-devolucao-aplicado",
      H.depois,
    ],
    [
      "135b-antes-o-ranking-de-lucro-desconta-a-devolucao-base-vigente",
      H.antes,
    ],
  ];
  for (const [nomeConsulta, hash] of consultas) {
    const consulta = ler(`scripts/publicacao/consultas/${nomeConsulta}.sql`);
    assert.equal(contarStatements(consulta), 1);
    assert.ok(consulta.includes(hash));
    // Catalogo apenas: nenhuma le pedido, devolucao, estorno nem chama a funcao.
    assert.doesNotMatch(
      consulta,
      /FROM public\.(?:marketplace_orders|devolucoes|devolucao_itens|order_refunds)/,
    );
    assert.doesNotMatch(consulta, /get_admin_analytics_v2\(\d/);
    const itens = [...consulta.matchAll(/SELECT '([^']+)',/g)].map((m) => m[1]);
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
    p.versoes.includes("20261399970000"),
  );
  assert.equal(entrada.consulta, consultas[0][0]);
  assert.equal(entrada.ausenciaConfirmadaPor, consultas[1][0]);
  assert.ok(
    ler(".github/workflows/rpc-ci.yml").includes(
      "rodar-isolado.cjs tests/banco/o-ranking-de-lucro-desconta-a-devolucao-viva.cjs",
    ),
  );
});

Deno.test("3997: a migration esta na cadeia das sucessoras e a prova das anteriores desfaz esta primeiro", () => {
  const { SUCESSORAS_DA_99 } = require("./banco/sucessoras-da-99.cjs");
  const dela = SUCESSORAS_DA_99.filter(
    (s: { nome: string }) => s.nome === nome,
  );
  assert.equal(dela.length, 1);
  assert.equal(dela[0].hashVigente, H.antes);
  assert.equal(dela[0].hashDesta, H.depois);
  assert.ok(
    ler("tests/banco/lucro-do-estoque-posterior.cjs").includes(
      "desfazerRankingDeLucroNaTransacao",
    ),
  );
  assert.ok(
    ler("tests/banco/o-ranking-de-lucro-posterior.cjs").includes(
      "rollback-manual-${RANKING_DE_LUCRO.nome}",
    ),
  );
});
