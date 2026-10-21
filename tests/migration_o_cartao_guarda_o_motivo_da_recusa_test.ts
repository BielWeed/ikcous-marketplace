import { createRequire } from "node:module";
// @ts-nocheck
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
const { avaliarFase0 } = createRequire(import.meta.url)(
  "../scripts/db-prove-rollback.cjs",
);
const nome = "20261260000000_o_cartao_guarda_o_motivo_da_recusa.sql";
function ler(prefixo = "") {
  try {
    return Deno.readTextFileSync(
      new URL(`../supabase/migrations/${prefixo}${nome}`, import.meta.url),
    ).replace(/\r\n/g, "\n");
  } catch {
    return "";
  }
}
Deno.test("D4 migration: tabela aditiva privada com identidade da tentativa, sem RPC pública", () => {
  const sql = ler();
  assertStringIncludes(
    sql,
    "CREATE TABLE public.tentativas_cartao_diagnostico",
  );
  assertStringIncludes(sql, "UNIQUE (mp_order_id, mp_payment_id)");
  assertStringIncludes(sql, "ENABLE ROW LEVEL SECURITY");
  assertStringIncludes(
    sql,
    "REVOKE ALL ON TABLE public.tentativas_cartao_diagnostico FROM PUBLIC, anon, authenticated",
  );
  assertStringIncludes(
    sql,
    "GRANT SELECT, INSERT, UPDATE ON TABLE public.tentativas_cartao_diagnostico TO service_role",
  );
  assert(!/CREATE\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|POLICY)/i.test(sql));
  assert(!/\b(?:token|cpf|email|telefone|payer|card_number)\b/i.test(sql));
  assertStringIncludes(sql, "B1_BASELINE_DIVERGENT");
});
Deno.test("D4 migration: par aceito pela fase zero, rollback remove somente a tabela nova e recusa apagar histórico", () => {
  const migration = ler();
  const rollback = ler("rollback-manual-");
  assert(
    migration.length > 0 && rollback.length > 0,
    "par de migration e rollback existe",
  );
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, JSON.stringify(r));
  assertStringIncludes(
    rollback,
    "DROP TABLE public.tentativas_cartao_diagnostico;",
  );
  assertStringIncludes(
    rollback,
    "EXISTS (SELECT 1 FROM public.tentativas_cartao_diagnostico)",
  );
  assert(!/\bCASCADE\b/i.test(rollback));
});
