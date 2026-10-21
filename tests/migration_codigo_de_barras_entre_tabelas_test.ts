import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");
const nome =
  "20261347000000_o_codigo_de_barras_nao_repete_entre_produto_e_variacao.sql";
const dir = "supabase/migrations/";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const FN_PRODUTO = "produto_codigo_barras_livre_de_variacao";
const FN_VARIACAO = "variacao_codigo_barras_livre_de_produto";
const A = "74a-conferir-codigo-de-barras-entre-tabelas-aplicado";
const B = "74b-antes-codigo-de-barras-entre-tabelas-ausente";

/** O corpo exato (entre os $function$) de uma funcao da migration. */
function corpo(sql: string, fn: string): string {
  const m = sql.match(
    new RegExp(
      `CREATE OR REPLACE FUNCTION public\\.${fn}\\(\\)[\\s\\S]*?AS \\$function\\$([\\s\\S]*?)\\$function\\$;`,
    ),
  );
  assert(m, `corpo de ${fn} nao encontrado`);
  return m[1];
}
const md5 = (s: string) => createHash("md5").update(s, "utf8").digest("hex");

Deno.test("347: a migration so cria funcoes de gatilho e gatilhos novos; nada de dado, indice ou transacao", () => {
  const sql = ler(dir + nome);
  assert(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
  assertEquals(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
  // Sem os corpos entre $...$, cada comando tem de ser de uma classe permitida (nenhum INSERT/UPDATE/DELETE/
  // ALTER/DROP/CREATE INDEX no nivel de cima: a migration nao toca linha, coluna nem indice existente).
  const nivelDeCima = removerRuido(sql).replace(
    /\$(\w*)\$[\s\S]*?\$\1\$/g,
    ";",
  );
  const comandos = nivelDeCima
    .split(";")
    .map((c) => c.trim().replace(/\s+/g, " "))
    .filter(Boolean);
  const permitido =
    /^(SET LOCAL (lock_timeout|statement_timeout) = '[^']*'|DO|CREATE OR REPLACE FUNCTION public\.(produto|variacao)_codigo_barras_livre_de_(variacao|produto)\(\) RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS|REVOKE ALL ON FUNCTION public\.\w+\(\) FROM PUBLIC, anon, authenticated, service_role|COMMENT ON FUNCTION public\.\w+\(\) IS '[^']*'|CREATE OR REPLACE TRIGGER tr_(produto|variacao)_codigo_barras_livre_de_(variacao|produto) BEFORE INSERT OR UPDATE OF codigo_barras ON public\.(produtos|product_variants) FOR EACH ROW EXECUTE FUNCTION public\.\w+\(\)|NOTIFY pgrst, '[^']*')$/;
  for (const c of comandos)
    assert(permitido.test(c), `comando fora do desenho: ${c}`);
  assertEquals(
    comandos.filter((c) => c.startsWith("CREATE OR REPLACE TRIGGER")).length,
    2,
  );
  assertEquals(
    comandos.filter((c) => c.startsWith("CREATE OR REPLACE FUNCTION")).length,
    2,
  );
  assertStringIncludes(sql, `rollback-manual-${nome}`);
  // O cabecalho traz a consulta de duplicatas existentes para rodar antes de aplicar.
  assertStringIncludes(
    sql,
    "count(DISTINCT p.codigo_barras) AS codigos_nas_duas_tabelas",
  );
  assertStringIncludes(
    sql,
    "JOIN public.product_variants v ON v.codigo_barras = p.codigo_barras",
  );
});

Deno.test("347: os corpos travam por codigo, comparam a OUTRA tabela, ignoram valor que nao mudou e recusam com 23505", () => {
  const sql = ler(dir + nome);
  for (const fn of [FN_PRODUTO, FN_VARIACAO]) {
    const c = corpo(sql, fn);
    assertStringIncludes(
      c,
      "PERFORM pg_advisory_xact_lock(hashtextextended('codigo_de_barras:' || v_codigo, 0));",
    );
    assertStringIncludes(
      c,
      "IF NEW.codigo_barras IS NOT DISTINCT FROM OLD.codigo_barras THEN",
    );
    assertStringIncludes(c, "ERRCODE = '23505'");
    assertStringIncludes(c, "DETAIL = 'Key (codigo_barras)=('");
    assertStringIncludes(
      c,
      "Este código de barras já está em uso por outro produto ou variação.",
    );
    assertStringIncludes(
      c,
      "NULLIF(btrim(v_codigo, E' \\t\\r\\n'), '') IS NULL",
    );
    // A trava vem ANTES da leitura da OUTRA tabela (senao a corrida volta).
    assert(
      c.indexOf("pg_advisory_xact_lock") <
        c.indexOf(
          fn === FN_PRODUTO
            ? "FROM public.product_variants v WHERE"
            : "FROM public.produtos p WHERE",
        ),
    );
    // UPSERT identico: a MESMA linha com o MESMO codigo sai cedo (antes da trava), so' no INSERT.
    const tabela = fn === FN_PRODUTO ? "produtos" : "product_variants";
    assertStringIncludes(c, "IF TG_OP = 'INSERT' THEN");
    assertStringIncludes(
      c,
      `IF EXISTS (SELECT 1 FROM public.${tabela} x WHERE x.id = NEW.id AND x.codigo_barras = v_codigo) THEN`,
    );
    assert(
      c.indexOf("IF TG_OP = 'INSERT' THEN") <
        c.indexOf("pg_advisory_xact_lock"),
    );
    // O OLD so e lido dentro de TG_OP = 'UPDATE' (no INSERT o OLD nao existe).
    assert(c.indexOf("TG_OP = 'UPDATE'") < c.indexOf("OLD.codigo_barras"));
  }
  assertStringIncludes(
    corpo(sql, FN_PRODUTO),
    "FROM public.product_variants v WHERE v.codigo_barras = v_codigo",
  );
  assertStringIncludes(
    corpo(sql, FN_PRODUTO),
    "IF NEW.deleted_at IS NOT NULL THEN",
  );
  assertStringIncludes(
    corpo(sql, FN_VARIACAO),
    "FROM public.produtos p WHERE p.codigo_barras = v_codigo AND p.deleted_at IS NULL",
  );
});

Deno.test("347: os md5 gravados na migration, no rollback e na 74a sao os dos corpos reais", () => {
  const sql = ler(dir + nome);
  const rollback = ler(`${dir}rollback-manual-${nome}`);
  const a = ler(`scripts/publicacao/consultas/${A}.sql`);
  for (const fn of [FN_PRODUTO, FN_VARIACAO]) {
    const h = md5(corpo(sql, fn));
    assertEquals(sql.split(h).length - 1, 2, `${fn}: preflight e conferencia`);
    assertEquals(rollback.split(h).length - 1, 1, `${fn}: rollback`);
    assertEquals(a.split(h).length - 1, 1, `${fn}: 74a`);
  }
});

Deno.test("347: rollback so apaga os 4 objetos novos, com pre-voo, sem tocar dado, indice nem permissao", () => {
  const sql = ler(dir + nome);
  const rollback = ler(`${dir}rollback-manual-${nome}`);
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  for (const alvo of [
    "DROP TRIGGER IF EXISTS tr_produto_codigo_barras_livre_de_variacao ON public.produtos;",
    "DROP TRIGGER IF EXISTS tr_variacao_codigo_barras_livre_de_produto ON public.product_variants;",
    `DROP FUNCTION IF EXISTS public.${FN_PRODUTO}();`,
    `DROP FUNCTION IF EXISTS public.${FN_VARIACAO}();`,
  ])
    assertStringIncludes(rollback, alvo);
  assert(rollback.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
  const nivel = removerRuido(rollback).replace(/\$(\w*)\$[\s\S]*?\$\1\$/g, ";");
  assertEquals(
    /\b(UPDATE|DELETE|INSERT|GRANT|REVOKE|TRUNCATE|ALTER|CREATE)\b|DROP\s+(COLUMN|INDEX|TABLE|POLICY)/i.test(
      nivel,
    ),
    false,
  );
  for (const texto of [sql, rollback])
    assertEquals(detectarTransacaoExplicita(removerRuido(texto)).achados, []);
  assertEquals(
    avaliarFase0({
      sqlMigration: sql,
      sqlRollback: rollback,
      temRollback: true,
    }).recusado,
    false,
  );
});

Deno.test("347: db-apply confere os marcadores dos dois corpos, cada um uma vez", () => {
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const entrada = VERIFICACOES[nome];
  assert(Array.isArray(entrada) && entrada.length === 2);
  const sql = ler(dir + nome);
  assertEquals(
    entrada.map((e: { funcao: string }) => e.funcao),
    [FN_PRODUTO, FN_VARIACAO],
  );
  for (const e of entrada) {
    const c = corpo(sql, e.funcao);
    for (const m of e.esperado) {
      const texto = typeof m === "string" ? m : m.texto;
      assertEquals(
        c.split(texto).length - 1,
        typeof m === "string" ? 1 : m.vezes,
        `${e.funcao}: ${texto}`,
      );
    }
  }
});

Deno.test("347: registros de publicacao completos e os rois recusam linhas faltando", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA: rois,
    estruturaDoRolFechado,
    contarStatements,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p: { versoes?: string[] }) =>
    p.versoes?.includes("20261347000000"),
  );
  assertEquals(lote.length, 1);
  assertEquals(lote[0].consulta, A);
  assertEquals(lote[0].ausenciaConfirmadaPor, B);
  assertEquals(
    canais.provasDeObjetos[canais.provasDeObjetos.length - 1].consulta,
    A,
    "entrada nova vai no FIM da lista",
  );
  const workflowConferir = ler(".github/workflows/conferir-banco-da-loja.yml");
  const rpc = ler(".github/workflows/rpc-ci.yml");
  for (const consulta of [A, B]) {
    const caminho = `scripts/publicacao/consultas/${consulta}.sql`;
    const sql = ler(caminho);
    const rol = rois[consulta];
    assertEquals(contarStatements(sql), 1);
    assert(rol?.length >= 3, consulta);
    assert(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    assertStringIncludes(workflowConferir, `- ${consulta}\n`);
    assertEquals(rpc.split(`"${caminho}"`).length - 1, 2);
    const itens = [...sql.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]);
    assertEquals([...rol].sort(), itens.sort());
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assertEquals(estruturaDoRolFechado(linhas, rol), null);
    assert(estruturaDoRolFechado(linhas.slice(1), rol) !== null);
    // So catalogo: nunca le o codigo de barras de produto.
    assertEquals(
      /FROM\s+public\.(produtos|product_variants)\b/i.test(sql),
      false,
    );
  }
  assertEquals(rois[A].length, 5);
  assertEquals(rois[B].length, 3);
  assertStringIncludes(
    rpc,
    "rodar-isolado.cjs tests/banco/codigo-de-barras-entre-tabelas-viva.cjs",
  );
  assertStringIncludes(
    ler("tests/migration_a_contestacao_decide_sob_a_trava_do_pedido_test.ts"),
    '"tests/banco/codigo-de-barras-entre-tabelas-viva.cjs"',
  );
});
