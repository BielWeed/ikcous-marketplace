// @ts-nocheck
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assert,
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const { avaliarFase0 } = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261020000000_lojista_registra_pagamento_recebido.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../rollback-manual-${NOME}`;
const DB_APPLY_PATH = `${DIR}../scripts/db-apply.cjs`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);
const dbApply = Deno.readTextFileSync(DB_APPLY_PATH);

// `avaliarFase0` avalia o PAR de uma vez — assinatura conferida no codigo real
// (scripts/db-prove-rollback.cjs:308) e no arquivo-molde
// (tests/migration_vitrine_sabe_que_produto_mudou_test.ts:99). Ela recebe UM
// OBJETO NOMEADO e devolve `{ recusado, motivos }` — nao `{ recusas }`, e nao
// aceita a string solta. Alem de BEGIN/COMMIT escondido, ela ja recusa
// `CREATE FUNCTION` sem `OR REPLACE` nos DOIS arquivos, entao nao existe teste
// separado para isso: seria assercao mais fraca que a que ja esta aqui.
Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("a migration cria as duas colunas e a tabela de historico", () => {
  assertStringIncludes(
    migration,
    "ADD COLUMN IF NOT EXISTS pagamento_recebido_em timestamptz",
  );
  assertStringIncludes(
    migration,
    "ADD COLUMN IF NOT EXISTS pagamento_recebido_por uuid",
  );
  assertStringIncludes(
    migration,
    "CREATE TABLE IF NOT EXISTS public.marketplace_order_payment_history",
  );
});

Deno.test("a RPC nasce com guarda de admin e GRANT so para authenticated", () => {
  assertStringIncludes(
    migration,
    "CREATE OR REPLACE FUNCTION public.registrar_pagamento_recebido",
  );
  assertStringIncludes(migration, "SECURITY DEFINER");
  assertStringIncludes(migration, "IF NOT public.is_admin() THEN");
  assertStringIncludes(
    migration,
    "GRANT EXECUTE ON FUNCTION public.registrar_pagamento_recebido(uuid, boolean) TO authenticated",
  );
});

Deno.test("a RPC recusa pedido cancelado, pedido do site, e nao inventa status", () => {
  assertStringIncludes(migration, "IF v_status = 'cancelled' THEN");
  assertStringIncludes(migration, "IF v_payment_method = 'online' THEN");
  assertStringIncludes(migration, "'recebido_na_entrega'");
});

Deno.test("o rollback derruba TUDO que a migration cria", () => {
  assertStringIncludes(
    rollback,
    "DROP FUNCTION IF EXISTS public.registrar_pagamento_recebido(uuid, boolean)",
  );
  assertStringIncludes(
    rollback,
    "DROP TABLE IF EXISTS public.marketplace_order_payment_history",
  );
});

Deno.test("a entrada em VERIFICACOES existe e nomeia a funcao", () => {
  assertStringIncludes(dbApply, `"${NOME}"`);
  const i = dbApply.indexOf(`"${NOME}"`);
  assert(i > -1);
  const trecho = dbApply.slice(i, i + 1200);
  assertStringIncludes(trecho, "registrar_pagamento_recebido");
});
