// @ts-nocheck
// O PEDIDO POR WHATSAPP FECHA PARA ANON — prova offline do par
// 20261181000000 + rollback (achado LGPD, alto — auditoria de 26/09/2026).
//
// O DEFEITO QUE ESTE TESTE FIXA: sem esta migration,
// `get_orders_by_whatsapp_v3` continua executável por `anon` e por
// `authenticated` — grant PRÓPRIO de cada papel no ACL, sobrevivente ao
// `REVOKE ... FROM PUBLIC;` que a 20261090500000 já tinha feito para esta
// função — sem OTP e sem limite de tentativa, devolvendo `customer_data`
// cru — CPF incluso desde a 20261172000000. Cada asserção abaixo está
// amarrada a essa ameaça: sabotar qualquer uma reabre o furo, ou reabre a
// exposição do CPF dentro de `get_orders_by_otp_v1`.
//
// RODADA 2 (revisão de risco): três achados corrigidos aqui.
//   1. (medium) O rollback da RODADA 1 devolvia `GRANT ... TO PUBLIC` — a
//      versão CORRIGIDA devolve `TO anon, authenticated`, o que o catálogo
//      de produção pré-81 de fato tinha (PUBLIC já não tinha entrada
//      nenhuma, revogada pela 20261090500000).
//   4. (low) `customer_data` ESCALAR não tem chave para `jsonb - text`
//      tirar — a CASE ganhou um primeiro WHEN que devolve o valor cru
//      nesse caso, em vez de explodir "cannot delete from scalar".
//   5. (melhoria) `address` que sobra só `{"cpf":"..."}"` vira JSON `null`
//      (não `{}"`), para o mapper do front cair no endereço do JOIN.
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

Deno.test("get_orders_by_whatsapp_v3 perde EXECUTE de PUBLIC, anon e authenticated (defesa em profundidade: anon/authenticated tinham grant PROPRIO, sobrevivente ao REVOKE de PUBLIC da 20261090500000)", () => {
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

Deno.test("achado 4 (RODADA 2): customer_data ESCALAR sai intocado, sem tentar tirar cpf dele (evita 'cannot delete from scalar')", () => {
  assertStringIncludes(
    migrationN,
    norm("WHEN jsonb_typeof(o.customer_data) <> 'object' THEN o.customer_data"),
  );
});

Deno.test("customer_data sai da RPC sem cpf no nivel raiz e sem cpf dentro de address (quando address e objeto)", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "WHEN jsonb_typeof(o.customer_data -> 'address') = 'object' THEN (o.customer_data - 'cpf') || jsonb_build_object( 'address',",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm("ELSE (o.customer_data -> 'address') - 'cpf' END )"),
  );
});

Deno.test("achado 5 (RODADA 2): address que sobra só {} depois do strip vira JSON null, nao {} (o mapper do front cai no endereco do JOIN)", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "WHEN ((o.customer_data -> 'address') - 'cpf') = '{}'::jsonb THEN NULL",
    ),
  );
});

Deno.test("achado 3 (RODADA 2): bloco DO de blindagem confere anon/authenticated fechados em v3 (e em qualquer get_orders_by_whatsapp%), PUBLIC fechado, e otp_v1 continua aberto para anon", () => {
  assertStringIncludes(
    migrationN,
    norm(
      "IF has_function_privilege('anon', 'public.get_orders_by_whatsapp_v3(text,text,text)', 'EXECUTE') OR has_function_privilege('authenticated', 'public.get_orders_by_whatsapp_v3(text,text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'blindagem 181: anon ou authenticated ainda alcancam EXECUTE de get_orders_by_whatsapp_v3';",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm("AND p.proname LIKE 'get_orders_by_whatsapp%'"),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "FROM aclexplode(coalesce(r.proacl, acldefault('f', r.proowner))) g WHERE g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    ),
  );
  assertStringIncludes(
    migrationN,
    norm(
      "IF NOT has_function_privilege('anon', 'public.get_orders_by_otp_v1(text,text)', 'EXECUTE') THEN RAISE EXCEPTION 'blindagem 181: get_orders_by_otp_v1 perdeu EXECUTE de anon -- o convidado por OTP nao pode ficar sem rota';",
    ),
  );
});

Deno.test("a blindagem nao imprime dado de pedido -- so nomeia papel/funcao no RAISE EXCEPTION", () => {
  // As quatro mensagens de RAISE EXCEPTION do bloco de blindagem, e mais
  // nenhuma delas referencia coluna de pedido (customer_data, cpf, endereco).
  const doBlockStart = migration.indexOf("DO $$\nDECLARE\n    r RECORD;");
  const doBlockEnd = migration.indexOf("END $$;", doBlockStart);
  const doBlock = migration.slice(doBlockStart, doBlockEnd);
  assertEquals(
    doBlockStart !== -1 && doBlockEnd !== -1,
    true,
    "bloco de blindagem nao encontrado",
  );
  assertEquals(
    /customer_data|\bcpf\b/i.test(doBlock),
    false,
    "a blindagem nao pode citar customer_data/cpf -- so papel e assinatura de funcao",
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

Deno.test("achado 1 (RODADA 2, medium): rollback devolve GRANT EXECUTE a anon e authenticated -- NUNCA a PUBLIC (o catalogo pre-81 nao tinha PUBLIC nesta funcao)", () => {
  assertStringIncludes(
    rollbackN,
    norm(
      "GRANT EXECUTE ON FUNCTION public.get_orders_by_whatsapp_v3(text,text,text) TO anon, authenticated;",
    ),
  );
  const semLiteralRollback = removerRuido(rollback);
  assertEquals(
    /GRANT[^;]*get_orders_by_whatsapp_v3[^;]*TO\s+PUBLIC/i.test(
      semLiteralRollback,
    ),
    false,
    "o rollback nao pode devolver o grant a PUBLIC -- isso reabriria por um caminho que o catalogo de producao nunca teve",
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

Deno.test("achado 2 (RODADA 2, low): o ALVO de scripts/db-prove-grants-convergem.cjs para v3 fecha os tres papeis", () => {
  // Lido como TEXTO, nunca via require() -- este .cjs chama main() sem
  // guarda de `require.main === module` (é um CLI, não um módulo), e
  // importar de verdade tentaria abrir conexão de banco dentro do teste.
  const scriptPath = `${DIR}../scripts/db-prove-grants-convergem.cjs`;
  const script = norm(Deno.readTextFileSync(scriptPath));
  assertStringIncludes(
    script,
    norm(
      '"get_orders_by_whatsapp_v3(text,text,text)": { PUBLIC: false, anon: false, authenticated: false, },',
    ),
  );
});
