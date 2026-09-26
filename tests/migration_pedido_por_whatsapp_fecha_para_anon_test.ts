// @ts-nocheck
// O PEDIDO POR WHATSAPP FECHA PARA ANON — prova offline do par
// 20261181000000 + rollback (achado LGPD, alto — auditoria de 26/09/2026).
//
// O DEFEITO QUE ESTE TESTE FIXA: sem esta migration,
// `get_orders_by_whatsapp_v3` continua executável por `anon` (via `PUBLIC`)
// sem OTP e sem limite de tentativa, devolvendo `customer_data` cru — CPF
// incluso desde a 20261172000000. Cada asserção abaixo está amarrada a essa
// ameaça: sabotar qualquer uma reabre o furo, ou reabre a exposição do CPF
// dentro de `get_orders_by_otp_v1`.
import { createRequire } from "node:module";
import { fromFileUrl } from "https://deno.land/std@0.177.0/path/mod.ts";
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = fromFileUrl(new URL(".", import.meta.url));
const NOME = "20261181000000_pedido_por_whatsapp_fecha_para_anon.sql";
const MIGRATION_PATH = `${DIR}../supabase/migrations/${NOME}`;
const ROLLBACK_PATH = `${DIR}../supabase/migrations/rollback-manual-${NOME}`;

const migration = Deno.readTextFileSync(MIGRATION_PATH);
const rollback = Deno.readTextFileSync(ROLLBACK_PATH);

const norm = (s) => s.replace(/\s+/g, " ").trim();
const migrationN = norm(migration);
const rollbackN = norm(rollback);

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const r = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assertEquals(r.recusado, false, `motivos: ${(r.motivos || []).join("; ")}`);
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior (regra da casa)", () => {
  const transMigration = detectarTransacaoExplicita(removerRuido(migration));
  const transRollback = detectarTransacaoExplicita(removerRuido(rollback));
  assertEquals(
    transMigration.achados,
    [],
    `migration contém controle de transação: ${transMigration.achados.join("/")}`,
  );
  assertEquals(
    transRollback.achados,
    [],
    `rollback contém controle de transação: ${transRollback.achados.join("/")}`,
  );
});

Deno.test("get_orders_by_whatsapp_v3 perde EXECUTE de PUBLIC, anon e authenticated", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "REVOKE EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v3(text,text,text) FROM PUBLIC, anon, authenticated;",
    ),
  );
});

Deno.test("get_orders_by_otp_v1 e recriada com a MESMA assinatura e os mesmos atributos (SECURITY DEFINER + search_path)", () => {
  assertStringIncludes(
    migrationN,
    norm(
      'CREATE OR REPLACE FUNCTION public.get_orders_by_otp_v1("p_email" "text", "p_otp" "text") RETURNS "jsonb"',
    ),
  );
  assertStringIncludes(
    migrationN,
    norm("LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'"),
  );
});

Deno.test("customer_data sai da RPC sem cpf no nivel raiz e sem cpf dentro de address (quando address e objeto)", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "WHEN jsonb_typeof(o.customer_data -> 'address') = 'object' THEN (o.customer_data - 'cpf') || jsonb_build_object('address', (o.customer_data -> 'address') - 'cpf') ELSE o.customer_data - 'cpf' END",
    ),
  );
});

Deno.test("o resto do corpo de get_orders_by_otp_v1 continua verbatim: limite de tentativas, payment_status, items e address (JOIN em user_addresses)", () => {
  assertStringIncludes(
    migrationN,
    norm("v_max_tentativas CONSTANT integer := 5;"),
  );
  assertStringIncludes(migrationN, norm("'payment_status', o.payment_status,"));
  assertStringIncludes(
    migrationN,
    norm(
      "'address', ( SELECT to_jsonb(addr.*) FROM public.user_addresses addr WHERE addr.id = o.address_id )",
    ),
  );
});

Deno.test("nao ha GRANT/REVOKE novo para get_orders_by_otp_v1 nesta migration (so o corpo muda)", () => {
  const semLiteral = removerRuido(migration);
  const semGrantOtp = !/(GRANT|REVOKE)[^;]*get_orders_by_otp_v1/i.test(
    semLiteral,
  );
  assertEquals(
    semGrantOtp,
    true,
    "esta migration não deve tocar no ACL de get_orders_by_otp_v1 — só no corpo",
  );
});

Deno.test("rollback: get_orders_by_whatsapp_v3 recebe GRANT EXECUTE de volta a PUBLIC", () => {
  assertStringIncludes(
    rollbackN,
    norm(
      "GRANT EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v3(text,text,text) TO PUBLIC;",
    ),
  );
});

Deno.test("rollback: get_orders_by_otp_v1 volta a devolver customer_data cru (sem a CASE de strip do cpf)", () => {
  assertStringIncludes(migrationN, "'customer_data', (");
  // O rollback tem a mesma assinatura, mas a chave 'customer_data' volta a
  // apontar direto para a coluna -- sem CASE, sem jsonb_typeof, sem o
  // operador `- 'cpf'` (a busca literal por " - 'cpf'" garante que nenhuma
  // sobra da versão nova ficou no rollback).
  assertStringIncludes(rollbackN, norm("'customer_data', o.customer_data,"));
  const semLiteralRollback = removerRuido(rollback);
  assertEquals(
    semLiteralRollback.includes("- 'cpf'"),
    false,
    "o rollback não deve conter nenhum strip de cpf — ele restaura o corpo cru da 20260950000000",
  );
});
