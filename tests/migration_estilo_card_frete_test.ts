import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
const require = createRequire(import.meta.url);
const nome = "20261310000000_estilo_do_card_de_frete.sql";
const dir = new URL("../supabase/migrations/", import.meta.url);
function ler(n: string) {
  try {
    return Deno.readTextFileSync(new URL(n, dir)).replace(/\r/g, "");
  } catch (e) {
    if (e instanceof Deno.errors.NotFound) return "";
    throw e;
  }
}
const assinatura =
  "CREATE OR REPLACE FUNCTION public.upsert_store_config(config_json jsonb)";
function definicao(sql: string) {
  const i = sql.indexOf(assinatura);
  assert(i >= 0, "upsert_store_config precisa existir");
  return sql.slice(i, sql.indexOf("$$;", i) + 3);
}
const hash = (sql: string) =>
  createHash("md5")
    .update(definicao(sql).split("AS $$")[1].split("$$;")[0])
    .digest("hex");
Deno.test("20261310: coluna restrita, default completo e view pública com campo no fim", () => {
  const sql = ler(nome);
  assertStringIncludes(
    sql,
    "ADD COLUMN IF NOT EXISTS free_shipping_card_style text NOT NULL DEFAULT 'completo'",
  );
  assertStringIncludes(
    sql,
    "CHECK (free_shipping_card_style IN ('completo','compacto'))",
  );
  assertStringIncludes(
    sql,
    "local_delivery_days,\n    free_shipping_card_style\n   FROM store_config",
  );
});
Deno.test("20261310: recarrega o schema do PostgREST depois de criar o campo", () => {
  assert(ler(nome).trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
});
Deno.test("20261310: só acrescenta o campo aos três lugares do upsert vigente", () => {
  const sql = definicao(ler(nome));
  const anterior = definicao(
    ler("20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql"),
  );
  const semCampo = sql
    .replace(", free_shipping_card_style\n  )", "\n  )")
    .replace(
      ",\n    COALESCE(config_json->>'free_shipping_card_style', 'completo')\n  )",
      "\n  )",
    )
    .replace(
      "    free_shipping_card_style = CASE WHEN config_json ? 'free_shipping_card_style'\n      THEN config_json->>'free_shipping_card_style'\n      ELSE store_config.free_shipping_card_style END,\n",
      "",
    );
  assertEquals(semCampo, anterior);
});
Deno.test("20261310: rollback guarda hash novo e restaura corpo anterior byte a byte sem apagar a escolha", () => {
  const rollback = ler(`rollback-manual-${nome}`);
  const anterior = ler(
    "20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql",
  );
  assertEquals(definicao(rollback), definicao(anterior));
  assertStringIncludes(
    rollback,
    `v_hash IS DISTINCT FROM '${hash(ler(nome))}'`,
  );
  assertStringIncludes(rollback, "B1_BASELINE_DIVERGENT");
  assertEquals(/DROP (TABLE|COLUMN|VIEW|FUNCTION)/i.test(rollback), false);
});
Deno.test("20261310: publicação exige as duas consultas com rol fechado e registro próprio", async () => {
  const {
    ROL_FECHADO_POR_CONSULTA,
    estruturaDoRolFechado,
    contarStatements,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import(
    "../scripts/frota/publicar-release.mjs"
  );
  const rel = (p: string) =>
    Deno.readTextFileSync(new URL(`../${p}`, import.meta.url)).replace(
      /\r/g,
      "",
    );
  const A = "60a-conferir-estilo-card-frete-aplicado";
  const B = "60b-antes-estilo-card-frete-base-vigente";
  const canais = JSON.parse(rel("scripts/frota/canais-de-backend.json"));
  const lotes = canais.provasDeObjetos.filter((p: { versoes: string[] }) =>
    p.versoes.includes("20261310000000"),
  );
  assertEquals(lotes.length, 1);
  assertEquals(lotes[0].consulta, A);
  assertEquals(lotes[0].ausenciaConfirmadaPor, B);
  assert(new Map(Object.entries(VERIFICACOES)).has(nome));
  for (const consulta of [A, B]) {
    const sql = rel(`scripts/publicacao/consultas/${consulta}.sql`);
    assertEquals(contarStatements(sql), 1);
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(
      consulta,
    ) as string[];
    assertEquals(rol.length, 5);
    assert(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    assertStringIncludes(
      rel(".github/workflows/conferir-banco-da-loja.yml"),
      `- ${consulta}`,
    );
    assertEquals(
      rel(".github/workflows/rpc-ci.yml").split(
        `"scripts/publicacao/consultas/${consulta}.sql"`,
      ).length - 1,
      2,
    );
    for (const item of rol) assertStringIncludes(sql, `'${item}'`);
    const linhas = rol.map((item: string) => ({
      item,
      esperado: "sim",
      vivo: "sim",
      ok: true,
    }));
    assertEquals(estruturaDoRolFechado(linhas, rol), null);
    assert(estruturaDoRolFechado(linhas.slice(1), rol) !== null);
  }
});
Deno.test("20261310: migration e rollback passam fase zero e cadastram o sucessor da 99", () => {
  const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");
  const fase = avaliarFase0({
    sqlMigration: ler(nome),
    sqlRollback: ler(`rollback-manual-${nome}`),
    temRollback: true,
  });
  assertEquals(fase.recusado, false, JSON.stringify(fase.motivos));
  const { conferirLista } = require("./banco/sucessoras-da-99.cjs");
  conferirLista();
});
