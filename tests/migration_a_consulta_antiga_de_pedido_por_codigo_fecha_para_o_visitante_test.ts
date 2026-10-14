// @ts-nocheck
// A CONSULTA ANTIGA DE PEDIDO POR CODIGO FECHA PARA O VISITANTE — prova offline do par
// 20261220000000 + rollback (auditoria de 12/10/2026, lote L1, etapa 2: achado A-1). O COMPORTAMENTO
// (anon e authenticated recebem 42501 na v1, a v2 segue aberta, so a ACL da v1 muda, dados
// intactos, rollback idêntico, pre-voo, conferencia, concorrencia) e' provado em
// tests/banco/consulta-antiga-de-pedido-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: o corte e' so ACL (nada de DROP nem de corpo novo: desfazer e' um GRANT); a v2 tem de
// ficar de pe antes de a v1 fechar; REVOKE que so avisa (grantor diferente) passa calado sem a
// conferencia; reaplicar tem de ser idempotente (a ACL de depois e' aceita no pre-voo); o rollback
// nao pode abrir PUBLIC nem recriar corpo.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261220000000_a_consulta_antiga_de_pedido_por_codigo_fecha_para_o_visitante.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const comandos = (s) =>
  limpo(s)
    .split(";")
    .map((x) => x.trim())
    .filter((x) => /^(GRANT|REVOKE)\b/i.test(x));
const HASH_V1 = "277776acaf395fa864cc3e2cb0638237";

Deno.test("avaliarFase0 nao recusa o par migration+rollback", () => {
  const res = avaliarFase0({
    sqlMigration: migration,
    sqlRollback: rollback,
    temRollback: true,
  });
  assert.equal(
    res.recusado,
    false,
    `motivos: ${(res.motivos || []).join("; ")}`,
  );
});

Deno.test("nenhum arquivo do par abre ou fecha transacao de nivel superior", () => {
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(migration)).achados,
    [],
  );
  assert.deepEqual(
    detectarTransacaoExplicita(removerRuido(rollback)).achados,
    [],
  );
});

Deno.test("a migration so tem REVOKE EXECUTE da v1 de PUBLIC, anon e authenticated; nada de DROP, CREATE, ALTER nem service_role", () => {
  assert.deepEqual(comandos(migration), [
    "REVOKE EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) FROM PUBLIC",
    "REVOKE EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) FROM anon",
    "REVOKE EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) FROM authenticated",
  ]);
  const sql = limpo(migration);
  assert.doesNotMatch(
    sql,
    /\b(DROP|CREATE|ALTER|INSERT|UPDATE|DELETE|TRUNCATE)\b/i,
  );
  // service_role so aparece nas LEITURAS (pre-voo e conferencia), nunca num GRANT/REVOKE
  assert.ok(comandos(migration).every((c) => !/service_role/.test(c)));
});

Deno.test("o pre-voo vem antes do REVOKE e recusa: v1 ausente, corpo diferente, ACL fora das duas conhecidas, v2 ausente ou fechada", () => {
  const i = migration.indexOf("DO $preflight_20261220$");
  const fim = migration.indexOf("END $preflight_20261220$;");
  assert.ok(i >= 0 && fim > i);
  assert.ok(
    fim < migration.indexOf("REVOKE EXECUTE ON FUNCTION"),
    "pre-voo antes",
  );
  const p = migration.slice(i, fim);
  for (const trecho of [
    "to_regprocedure(v_v1) IS NULL",
    `'${HASH_V1}'`,
    "md5(replace(prosrc, E'\\r', ''))",
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.grantee = 0",
    "has_function_privilege('anon', v_v1, 'EXECUTE')",
    "has_function_privilege('authenticated', v_v1, 'EXECUTE')",
    "has_function_privilege('service_role', v_v1, 'EXECUTE')",
    "(NOT v_public AND v_anon AND v_auth AND v_servico)",
    "(NOT v_public AND NOT v_anon AND NOT v_auth AND v_servico)",
    "to_regprocedure(v_v2) IS NULL",
    "has_function_privilege('anon', v_v2, 'EXECUTE')",
    "has_function_privilege('authenticated', v_v2, 'EXECUTE')",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(p.includes(trecho), trecho);
});

Deno.test("a conferencia final usa aclexplode (PUBLIC) E has_function_privilege (heranca) e RECUSA se anon/authenticated alcancam, se service_role perdeu ou se a v2 nao ficou aberta", () => {
  const i = migration.indexOf("DO $conferencia_20261220$");
  assert.ok(i > migration.lastIndexOf("REVOKE EXECUTE ON FUNCTION"));
  const c = migration.slice(i);
  for (const trecho of [
    "aclexplode(coalesce(p.proacl, acldefault('f', p.proowner)))",
    "g.privilege_type = 'EXECUTE' AND g.grantee = 0",
    "has_function_privilege('anon', v_v1, 'EXECUTE')",
    "has_function_privilege('authenticated', v_v1, 'EXECUTE')",
    "NOT has_function_privilege('service_role', v_v1, 'EXECUTE')",
    "NOT has_function_privilege('anon', v_v2, 'EXECUTE')",
    "OR NOT has_function_privilege('authenticated', v_v2, 'EXECUTE')",
    "RAISE EXCEPTION",
  ])
    assert.ok(c.includes(trecho), trecho);
  for (const sql of [migration, rollback])
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
});

Deno.test("o rollback e SO GRANT EXECUTE da v1 a anon e authenticated (nada a PUBLIC, nada de DROP/CREATE), com pre-voo de corpo e conferencia", () => {
  assert.deepEqual(comandos(rollback), [
    "GRANT EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) TO anon",
    "GRANT EXECUTE ON FUNCTION public.get_orders_by_otp_v1(text, text) TO authenticated",
  ]);
  assert.doesNotMatch(limpo(rollback), /\b(DROP|CREATE|ALTER)\b/i);
  assert.ok(rollback.includes("DO $preflight_rollback_20261220$"));
  assert.ok(rollback.includes("DO $conferencia_rollback_20261220$"));
  assert.ok(rollback.includes(`'${HASH_V1}'`));
  assert.ok(rollback.includes("g.grantee = 0"), "PUBLIC continua fechado");
});

Deno.test("o cabecalho registra a ordem de desfazer e o aviso do rollback da 20261090500000", () => {
  for (const trecho of [
    "ORDEM DE DESFAZER",
    "ANTES de qualquer rollback ou",
    "20261217000000",
    "rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
    "TO PUBLIC",
    "23b",
  ])
    assert.ok(migration.includes(trecho), trecho);
});

Deno.test("o hash da v1 do pre-voo e o que a 20261217000000 deixa (e o do rollback da propria 20261217)", () => {
  const m217 = ler(
    "20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql",
  );
  assert.ok(
    m217.includes(
      `'public.get_orders_by_otp_v1(text,text)', 'b472f00d6b36002522b25bf04113a035', '${HASH_V1}'`,
    ),
  );
  const r217 = ler(
    "rollback-manual-20261217000000_o_email_da_loja_tem_teto_e_o_codigo_nao_se_queima.sql",
  );
  assert.ok(
    r217.includes(`('public.get_orders_by_otp_v1(text,text)', '${HASH_V1}')`),
  );
});

Deno.test("nenhuma migration FORA do par (e das provas) mexe no EXECUTE da v1 depois da 20261090500000 e da 20261217000000: o corte e' o unico REVOKE", () => {
  const todas = [...Deno.readDirSync(new URL("supabase/migrations/", DIR))]
    .map((e) => e.name)
    .filter((n) => n.endsWith(".sql") && !n.startsWith("_"));
  const quemMexe = [];
  for (const n of todas) {
    if (n === NOME || n === `rollback-manual-${NOME}`) continue;
    const sql = removerRuido(ler(n));
    if (
      /\b(GRANT|REVOKE)\b[^;]*\bget_orders_by_otp_v1\b/i.test(sql) ||
      /\bDROP\s+FUNCTION\b[^;]*\bget_orders_by_otp_v1\b/i.test(sql)
    )
      quemMexe.push(n);
  }
  // so a clone-grants (REVOKE de PUBLIC e o rollback dela, que da GRANT a PUBLIC)
  assert.deepEqual(quemMexe.sort(), [
    "20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
    "rollback-manual-20261090500000_a_loja_clonada_nasce_com_os_mesmos_grants.sql",
  ]);
});
