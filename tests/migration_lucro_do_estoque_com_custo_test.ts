// @ts-nocheck
/* eslint-disable security/detect-object-injection -- Nomes de migration/consulta constantes desta prova, nunca entrada externa. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);

const ler = (p) =>
  Deno.readTextFileSync(new URL(`../${p}`, import.meta.url)).replace(/\r/g, "");
const NOME = "20261251000000_o_lucro_do_estoque_usa_o_preco_da_variante.sql";
const BASE = "20261250000000_o_faturamento_potencial_conta_todo_o_estoque.sql";
const anterior = ler(`supabase/migrations/${BASE}`);
const fn = (s) => {
  const i = s.indexOf("CREATE OR REPLACE FUNCTION public.get_admin_analytics_v2(");
  assert.ok(i >= 0, "definicao do analytics ausente");
  return s.slice(i, s.indexOf("$$;", i) + 3);
};
const corpo = (s) => fn(s).slice(fn(s).indexOf("AS $$") + 5, -3);
const hash = (s, tipo = "md5") => createHash(tipo).update(s).digest("hex");
let migration;
try {
  migration = ler(`supabase/migrations/${NOME}`);
} catch (e) {
  if (!(e instanceof Deno.errors.NotFound)) throw e;
  migration = anterior;
}
const VIGENTE = hash(corpo(anterior));
const DESTA = hash(corpo(migration));

Deno.test("lucro do estoque — receita com custo usa o MESMO faturamento efetivo por variante", () => {
  assert.match(fn(migration), /SUM\(faturamento\) FILTER \(WHERE custo IS NOT NULL\)/);
  assert.match(fn(migration), /COALESCE\(SUM\(custo \* estoque\), 0\)/);
  assert.match(fn(migration), /COALESCE\(pv.price_override, p.preco_venda\)/);
  assert.match(fn(migration), /SUM\(faturamento\) FILTER \(WHERE custo IS NULL\)/);
  assert.match(fn(migration), /COUNT\(\*\) FILTER \(WHERE custo IS NULL AND estoque > 0\)/);
  assert.match(fn(migration), /'revenueWithoutCost', inv_revenue_without_cost/);
  assert.match(fn(migration), /'productsWithoutCost', inv_products_without_cost/);
  assert.match(fn(migration), /COUNT\(\*\) FILTER \(WHERE custo IS NOT NULL AND estoque > 0\)/);
  assert.match(fn(migration), /'productsWithCost', inv_products_with_cost/);
});

Deno.test("lucro do estoque — apenas inventario muda; historico, assinatura e ACL preservados", () => {
  const devolvido = fn(migration)
    .replace("    inv_revenue_without_cost numeric;\n    inv_products_without_cost bigint;\n    inv_products_with_cost bigint;\n", "")
    .replace("SUM(faturamento) FILTER (WHERE custo IS NOT NULL)", "SUM(preco_venda * estoque) FILTER (WHERE custo IS NOT NULL)")
    .replace(",\n        COALESCE(SUM(faturamento) FILTER (WHERE custo IS NULL), 0),\n        COUNT(*) FILTER (WHERE custo IS NULL AND estoque > 0),\n        COUNT(*) FILTER (WHERE custo IS NOT NULL AND estoque > 0)", "")
    .replace(", inv_revenue_without_cost, inv_products_without_cost, inv_products_with_cost", "")
    .replace(",\n            'revenueWithoutCost', inv_revenue_without_cost,\n            'productsWithoutCost', inv_products_without_cost,\n            'productsWithCost', inv_products_with_cost", "");
  assert.equal(devolvido, fn(anterior), "fora os agregados do inventario, corpo deve ser identico");
  const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
  assert.equal(fn(rollback), fn(anterior));
  assert.equal(VIGENTE, "5746d8a1df216ca4a5569901c45a2a07");
  assert.notEqual(DESTA, VIGENTE);
  for (const s of [migration, rollback]) {
    assert.ok(s.indexOf("DO $preflight$") < s.indexOf("CREATE OR REPLACE FUNCTION"));
    for (const trecho of [
      VIGENTE, DESTA, "B1_BASELINE_DIVERGENT",
      "SET LOCAL lock_timeout = '5s';", "SET LOCAL statement_timeout = '30s';",
      "p.prosecdef", "ARRAY['search_path=public']::text[]",
      "has_function_privilege('anon'", "NOT has_function_privilege('authenticated'",
    ]) assert.ok(s.includes(trecho), trecho);
    assert.doesNotMatch(s, /^\s*(?:BEGIN|COMMIT|ROLLBACK)\s*;/m);
  }
  assert.ok(migration.includes(`v_hash IS DISTINCT FROM '${DESTA}'`));
  assert.ok(rollback.includes(`v_hash IS DISTINCT FROM '${VIGENTE}'`));
});

Deno.test("lucro do estoque — novo corpo e rollback sao aceitos pelos portoes ancestrais exatos", () => {
  for (const nome of [
    "8e-conferir-92-a-202-aplicado", "35a-conferir-lucro-so-com-custo-aplicado",
    "45a-conferir-custo-do-dia-aplicado", "48a-conferir-lucro-com-desconto-aplicado",
    "53a-conferir-faturamento-potencial-aplicado",
  ]) {
    const s = ler(`scripts/publicacao/consultas/${nome}.sql`);
    assert.ok(s.includes(`'${VIGENTE}'`), nome);
    assert.ok(s.includes(`'${DESTA}'`), nome);
  }
  const s = ler("scripts/publicacao/consultas/17a-conferir-estoque-do-painel-aplicado.sql");
  for (const b of [corpo(migration), corpo(migration).replace(/\n/g, "\r\n")])
    assert.ok(s.includes(hash(b, "sha256")));
});

Deno.test("lucro do estoque — consultas oficiais so catalogo, hashes reais, rol fechado e marcadores exatos", () => {
  const CONF = require("../scripts/publicacao/conferir-banco.cjs");
  const DB = require("../scripts/db-apply.cjs");
  const PROVA = require("../scripts/db-prove-rollback.cjs");
  const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
  assert.equal(PROVA.avaliarFase0({sqlMigration:migration,sqlRollback:rollback,temRollback:true}).recusado,false);
  const [checagem] = DB.VERIFICACOES[NOME];
  assert.equal(checagem.funcao,"get_admin_analytics_v2");
  for (const marcador of checagem.esperado)
    assert.equal(DB.conferirMarcador(fn(migration),marcador).ok,true,marcador.texto);
  assert.ok(checagem.esperado.some((m) => !DB.conferirMarcador(fn(anterior),m).ok));
  for (const [consulta,h] of [
    ["54a-conferir-lucro-do-estoque-aplicado",DESTA],
    ["54b-antes-lucro-do-estoque-base-vigente",VIGENTE],
  ]) {
    const sql = ler(`scripts/publicacao/consultas/${consulta}.sql`);
    assert.equal(CONF.contarStatements(sql),1);
    assert.ok(sql.includes(`'${h}'`));
    assert.doesNotMatch(sql, /public\.(?:produtos|product_variants|marketplace_orders)\b/);
    const rol = CONF.ROL_FECHADO_POR_CONSULTA[consulta];
    assert.equal(rol.length,4);
    for (const item of rol) assert.ok(sql.includes(`'${item}'`), item);
  }
});

Deno.test("lucro do estoque — lote 54 e provas chegam a ferramenta oficial e ao CI", () => {
  for (const f of [
    "scripts/frota/canais-de-backend.json", "scripts/frota/publicar-release.mjs",
    "scripts/publicacao/conferir-banco.cjs", ".github/workflows/conferir-banco-da-loja.yml",
  ]) {
    const s = ler(f);
    assert.ok(s.includes("54a-conferir-lucro-do-estoque-aplicado"), f);
    assert.ok(s.includes("54b-antes-lucro-do-estoque-base-vigente"), f);
  }
  assert.ok(ler("scripts/db-apply.cjs").includes(NOME));
  assert.ok(ler("tests/banco/sucessoras-da-99.cjs").includes(NOME));
  assert.ok(ler(".github/workflows/rpc-ci.yml").includes(
    "node tests/banco/rodar-isolado.cjs tests/banco/lucro-do-estoque-viva.cjs",
  ));
  assert.ok(ler("tests/banco/faturamento-potencial-viva.cjs").includes(
    "desfazerLucroDoEstoqueNaTransacao",
  ));
  assert.ok(ler("tests/banco/faturamento-potencial-posterior.cjs").includes(
    "desfazerLucroDoEstoqueNaTransacao",
  ));
  assert.ok(ler("tests/banco/estoque-do-painel-portao-viva.cjs").includes(NOME));
  assert.ok(ler("tests/banco/portao-8e-aceita-sucessoras-viva.cjs").includes(NOME));
});
