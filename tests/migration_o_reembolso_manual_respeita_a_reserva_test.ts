import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");

const nome = "20261343000000_o_reembolso_manual_respeita_a_reserva.sql";

Deno.test("343: publicacao registrada com rois fechados e prova viva bloqueante", async () => {
  const { ROL_FECHADO_POR_CONSULTA, contarStatements, estruturaDoRolFechado } = require("../scripts/publicacao/conferir-banco.cjs");
  const { CONSULTAS_DE_ROL_FECHADO } = await import("../scripts/frota/publicar-release.mjs");
  const canais = JSON.parse(ler("scripts/frota/canais-de-backend.json"));
  const entrada = canais.provasDeObjetos.filter((p: {versoes?:string[]})=>p.versoes?.includes("20261343000000"));
  assert.equal(entrada.length,1);
  for(const consulta of [entrada[0].consulta,entrada[0].ausenciaConfirmadaPor]) {
    const sql = ler(`scripts/publicacao/consultas/${consulta}.sql`);
    // eslint-disable-next-line security/detect-object-injection -- consulta vem da entrada unica de configuracao versionada acima.
    const rol = ROL_FECHADO_POR_CONSULTA[consulta];
    assert.equal(contarStatements(sql),1);
    assert.equal(rol.length,4);
    assert.ok(CONSULTAS_DE_ROL_FECHADO.has(consulta));
    assert.ok(ler(".github/workflows/conferir-banco-da-loja.yml").includes(`- ${consulta}\n`));
    assert.equal(ler(".github/workflows/rpc-ci.yml").split(`"scripts/publicacao/consultas/${consulta}.sql"`).length-1,2);
    const linhas = rol.map((item:string)=>({item,esperado:"sim",vivo:"sim",ok:true}));
    assert.equal(estruturaDoRolFechado(linhas,rol),null);
    assert.notEqual(estruturaDoRolFechado(linhas.slice(1),rol),null);
  }
  assert.ok(ler(".github/workflows/rpc-ci.yml").includes("rodar-isolado.cjs tests/banco/reembolso-manual-reserva-viva.cjs"));
});
const ler = (rel: string) =>
  Deno.readTextFileSync(new URL(`../${rel}`, import.meta.url)).replace(/\r/g, "");

Deno.test("343: rollback exato, pre-voo por hash, ACL intocada, sem transacao propria", () => {
  const sql = ler(`supabase/migrations/${nome}`);
  const rb = ler(`supabase/migrations/rollback-manual-${nome}`);
  const antigo = ler("supabase/migrations/20261241000000_o_reembolso_em_duvida_prende_o_saldo.sql");
  const corpo = (s: string) => s.match(/CREATE OR REPLACE FUNCTION public\.admin_devolucao_concluir\([\s\S]*?AS \$\$([\s\S]*?)\$\$;/)?.[1];
  assert.equal(corpo(rb), corpo(antigo));
  assert.equal(createHash("md5").update(corpo(sql) ?? "").digest("hex"), "ea651d52157521c0fe7ffccc948b4b1a");
  assert.ok(sql.includes("ebb901efff59a53082836a13e053cd1a"));
  assert.ok(rb.includes("ea651d52157521c0fe7ffccc948b4b1a"));
  assert.ok(!/\b(GRANT|REVOKE|DROP|ALTER)\b/.test(sql.replace(/--[^\n]*/g, "")));
  assert.equal(avaliarFase0({sqlMigration:sql,sqlRollback:rb,temRollback:true}).recusado,false);
  assert.ok(sql.trimEnd().endsWith("NOTIFY pgrst, 'reload schema';"));
});

Deno.test("343: o reembolso manual usa o mesmo saldo reservado que o reembolso pelo app", () => {
  const migration = ler(`supabase/migrations/${nome}`);
  assert.equal(
    migration.split("v_disponivel := public.pedido__saldo_a_estornar(v_o.id);").length - 1,
    1,
  );
  assert.ok(
    migration.indexOf("v_disponivel := public.pedido__saldo_a_estornar(v_o.id);") <
      migration.indexOf("IF v_pago_pelo_app THEN"),
  );
  assert.ok(!migration.includes("SELECT v_o.total - COALESCE(v_o.valor_estornado, 0)"));
});
