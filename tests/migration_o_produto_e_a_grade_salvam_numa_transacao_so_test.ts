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
const nome = "20261352000000_o_produto_e_a_grade_salvam_numa_transacao_so.sql";
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(
    /\r/g,
    "",
  );
const dir = "supabase/migrations/";

Deno.test("352: produto e grade usam uma transação, admin atual e ordem global das travas", () => {
  const sql = ler(dir + nome);
  assertStringIncludes(
    sql,
    "CREATE OR REPLACE FUNCTION public.salvar_produto_com_grade(",
  );
  assertStringIncludes(sql, "IF NOT public.is_admin() THEN");
  assertStringIncludes(sql, "IF NOT public.is_admin_atual() THEN");
  assertStringIncludes(sql, "SECURITY DEFINER");
  assertStringIncludes(sql, "SET search_path TO 'public'");
  const variantes = sql.indexOf("WHERE product_id = p_produto_id");
  const produto = sql.indexOf("SELECT ultima_atualizacao INTO v_atualizado_em");
  const conferir = sql.indexOf("ERRCODE = 'PRD01'");
  const gravar = sql.indexOf("UPDATE public.produtos SET");
  assert(
    variantes > 0 &&
      variantes < produto &&
      produto < conferir &&
      conferir < gravar,
  );
  assertStringIncludes(
    sql.slice(variantes, produto),
    "ORDER BY id FOR NO KEY UPDATE",
  );
  assertStringIncludes(
    sql,
    "v_atualizado_em IS DISTINCT FROM p_base_atualizado_em",
  );
  assertStringIncludes(sql, "WHEN foreign_key_violation THEN");
  assertStringIncludes(sql, "IF v_item ? 'stock_increment' THEN");
  assertEquals(/INSERT[\s\S]*ON CONFLICT/i.test(removerRuido(sql)), false);
  const rollback = ler(`${dir}rollback-manual-${nome}`);
  assertStringIncludes(
    rollback,
    "DROP FUNCTION IF EXISTS public.salvar_produto_com_grade(uuid, timestamptz, jsonb, jsonb, uuid[])",
  );
  for (const texto of [sql, rollback]) {
    assert(texto.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
    assertEquals(detectarTransacaoExplicita(removerRuido(texto)).achados, []);
  }
  assertEquals(
    avaliarFase0({
      sqlMigration: sql,
      sqlRollback: rollback,
      temRollback: true,
    }).recusado,
    false,
  );
});

Deno.test("352: RPC registrada nos inventários e consultas de rol fechado", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA: rois,
    estruturaDoRolFechado,
    contarStatements,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const a = "84a-conferir-produto-com-grade-aplicado";
  const b = "84b-antes-produto-com-grade-ausente";
  const lote = canais.provasDeObjetos.filter((p: { versoes?: string[] }) =>
    p.versoes?.includes("20261352000000"),
  );
  assertEquals(lote.length, 1);
  assertEquals(lote[0].consulta, a);
  assertEquals(lote[0].ausenciaConfirmadaPor, b);
  for (const consulta of [a, b]) {
    const caminho = `scripts/publicacao/consultas/${consulta}.sql`;
    const sql = ler(caminho);
    const rol = rois[consulta];
    assertEquals(contarStatements(sql), 1);
    assert(rol?.length >= 4);
    assert(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    assertStringIncludes(
      ler(".github/workflows/conferir-banco-da-loja.yml"),
      `- ${consulta}\n`,
    );
    assertEquals(
      ler(".github/workflows/rpc-ci.yml").split(`"${caminho}"`).length - 1,
      2,
    );
    assertEquals(
      [...rol].sort(),
      [...sql.matchAll(/SELECT '([^']+)'/g)].map((m) => m[1]).sort(),
    );
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assertEquals(estruturaDoRolFechado(linhas, rol), null);
    assert(estruturaDoRolFechado(linhas.slice(1), rol) !== null);
  }
  assertStringIncludes(
    ler(".github/workflows/rpc-ci.yml"),
    "rodar-isolado.cjs tests/banco/salvar-produto-com-grade-viva.cjs",
  );
  assertStringIncludes(ler("scripts/db-apply.cjs"), nome);
  assertStringIncludes(
    ler("tests/banco/portas-do-visitante-permitidas.json"),
    "salvar_produto_com_grade",
  );
  assertStringIncludes(
    ler("src/types/database.types.ts"),
    "salvar_produto_com_grade:",
  );
});
