// @ts-nocheck
// AS CONFIGURACOES DA LOJA E OS CODIGOS DE VERIFICACAO SO DO SERVIDOR — prova offline do par
// 20261218000100 + rollback (auditoria de 12/10/2026, lote L2). O COMPORTAMENTO (anon e
// authenticated sem acesso nenhum, service_role e as funcoes do servidor seguem funcionando, no-op
// numa loja ja fechada, reaplicar e o rollback no banco) e' provado em
// tests/banco/portas-do-banco-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: lista de privilegios no lugar de REVOKE ALL deixa o MAINTAIN do PG17; as tabelas
// internas passam a ser acessadas so pelo servidor, e REVOKE so do anon deixaria a conta logada
// de fora disso; tocar no service_role para as edge
// functions de pagamento; REVOKE que so avisa (grantor diferente) passa calado sem a conferencia;
// rollback que devolve menos (ou mais) do que o medido deixa a loja num terceiro estado.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME = "20261218000100_configuracoes_e_codigos_so_do_servidor.sql";
const ler = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR)).replace(
    /\r\n/g,
    "\n",
  );
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const TABELAS = ["public.app_settings", "public.otp_verifications"];

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

Deno.test("REVOKE ALL (nunca lista) de PUBLIC, anon e authenticated nas duas tabelas, e nada mais", () => {
  const sql = limpo(migration);
  const comandos = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^(GRANT|REVOKE)\b/i.test(s));
  const esperado = [];
  for (const t of TABELAS)
    for (const p of ["PUBLIC", "anon", "authenticated"])
      esperado.push(`REVOKE ALL ON TABLE ${t} FROM ${p}`);
  assert.deepEqual(comandos, esperado);
  assert.doesNotMatch(sql, /service_role/, "service_role nao e tocado");
  assert.doesNotMatch(sql, /\b(DROP|CREATE|ALTER)\b/i);
});

Deno.test("o pre-voo recusa antes de escrever: tabela ausente, RLS desligada, service_role sem SIUD", () => {
  const i = migration.indexOf("DO $preflight_20261218000100$");
  const fim = migration.indexOf("END $preflight_20261218000100$;");
  assert.ok(i >= 0 && fim > i);
  assert.ok(fim < migration.indexOf("REVOKE ALL ON TABLE"), "pre-voo antes");
  const p = migration.slice(i, fim);
  for (const trecho of [
    "to_regclass(v_tabela) IS NULL",
    "SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(v_tabela)",
    "has_table_privilege('service_role', v_tabela, 'SELECT')",
    "has_table_privilege('service_role', v_tabela, 'INSERT')",
    "has_table_privilege('service_role', v_tabela, 'UPDATE')",
    "has_table_privilege('service_role', v_tabela, 'DELETE')",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(p.includes(trecho), trecho);
});

Deno.test("a conferencia final RECUSA se anon/authenticated alcancam por qualquer caminho ou se service_role perdeu algo", () => {
  const i = migration.indexOf("DO $conferencia_20261218000100$");
  assert.ok(i > migration.lastIndexOf("REVOKE ALL ON TABLE"));
  const c = migration.slice(i);
  for (const trecho of [
    "ARRAY['public.app_settings', 'public.otp_verifications']",
    "ARRAY['anon', 'authenticated']",
    "has_table_privilege(v_papel, v_tabela, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER,MAINTAIN')",
    "has_any_column_privilege(v_papel, v_tabela, 'SELECT,INSERT,UPDATE,REFERENCES')",
    "aclexplode(coalesce(c.relacl, acldefault('r', c.relowner)))",
    "g.grantee = 0",
    "aclexplode(a.attacl)",
    "has_table_privilege('service_role', v_tabela, 'SELECT')",
    "has_table_privilege('service_role', v_tabela, 'INSERT')",
    "has_table_privilege('service_role', v_tabela, 'UPDATE')",
    "has_table_privilege('service_role', v_tabela, 'DELETE')",
    "pg_has_role(v_papel, 'pg_read_all_data', 'MEMBER')",
    "pg_has_role(v_papel, 'pg_write_all_data', 'MEMBER')",
    "SELECT relrowsecurity FROM pg_class WHERE oid = to_regclass(v_tabela)",
  ])
    assert.ok(c.includes(trecho), trecho);
  for (const sql of [migration, rollback])
    assert.doesNotMatch(sql, /RAISE\s+(NOTICE|WARNING|INFO|LOG|DEBUG)/i);
});

Deno.test("o rollback devolve o medido na Savy (GRANT ALL a anon e authenticated), nada a PUBLIC, e avisa que nao vale para a IKCOUS", () => {
  const sql = limpo(rollback);
  const comandos = sql
    .split(";")
    .map((s) => s.trim())
    .filter((s) => /^(GRANT|REVOKE)\b/i.test(s));
  const esperado = [];
  for (const t of TABELAS)
    for (const p of ["anon", "authenticated"])
      esperado.push(`GRANT ALL ON TABLE ${t} TO ${p}`);
  assert.deepEqual(comandos, esperado);
  assert.ok(rollback.includes("NÃO SE APLICA NA IKCOUS"));
  assert.ok(rollback.includes("DO $preflight_rollback_20261218000100$"));
  assert.ok(rollback.includes("DO $conferencia_rollback_20261218000100$"));
  assert.ok(
    rollback.includes(
      "ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER', 'MAINTAIN']",
    ),
  );
});
