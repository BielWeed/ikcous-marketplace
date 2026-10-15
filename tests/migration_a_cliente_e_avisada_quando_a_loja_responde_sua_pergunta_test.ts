// @ts-nocheck
// A CLIENTE É AVISADA QUANDO A LOJA RESPONDE A PERGUNTA DELA — prova OFFLINE do par 20261240000000 + rollback
// (as duas sobrecargas de answer_question_atomic). O COMPORTAMENTO é provado em
// tests/banco/pergunta-respondida-avisa-viva.cjs (Postgres efêmero); aqui fica o que se prova só lendo o texto.
//
// Riscos: o rollback manual desfazia a trava nova EM SILÊNCIO se alguém tivesse trocado o corpo depois da migration
// (sem pré-voo) e podia terminar sem conferir que os corpos voltaram (sem conferência final); o corpo das duas
// funções tem de continuar o de hash conhecido (a migration e o rollback só ganham texto fora do corpo); o runbook
// tem de mandar desfazer o front ANTES do banco; sem BEGIN/COMMIT de nível superior (AGENTS.md).
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { removerRuido } = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME =
  "20261240000000_a_cliente_e_avisada_quando_a_loja_responde_sua_pergunta.sql";
const ler = (caminho) =>
  Deno.readTextFileSync(new URL(caminho, DIR)).replace(/\r\n/g, "\n");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const runbook = ler("docs/runbooks/producao-unica-fonte.md").replace(
  /\s+/g,
  " ",
);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");
const md5 = (s) => createHash("md5").update(s).digest("hex");

// Escritos por extenso: o teste nunca os lê do arquivo que está provando.
const F2 = "public.answer_question_atomic(uuid,text)";
const F3 = "public.answer_question_atomic(uuid,text,uuid)";
const ANTES = {
  [F2]: "8cf000b6c9ed27f482906752469f08ff",
  [F3]: "ad99d54575ac95445103ea5b78e4a1e8",
};
const DEPOIS = {
  [F2]: "1268df6cb364dfb46b5c535e007bb2d0",
  [F3]: "b62a4186ff8d58955973f53d6c0f302b",
};

/** Os dois corpos (entre `$function$`) do arquivo, na ordem: 2 argumentos e 3 argumentos. */
function corpos(sql) {
  const partes = sql.split("$function$");
  assert.equal(partes.length, 5, "duas funcoes, quatro marcas $function$");
  return [partes[1], partes[3]];
}

Deno.test("os corpos das duas funcoes seguem os de hash conhecido: a migration (depois) e o rollback (antes); so texto FORA do corpo mudou", () => {
  const [m2, m3] = corpos(migration);
  assert.equal(md5(m2), DEPOIS[F2]);
  assert.equal(md5(m3), DEPOIS[F3]);
  const [r2, r3] = corpos(rollback);
  assert.equal(md5(r2), ANTES[F2]);
  assert.equal(md5(r3), ANTES[F3]);
});

Deno.test("o rollback tem PRE-VOO antes da troca: exatamente 2 assinaturas e corpo vivo = o desta migration OU o de antes (idempotente); qualquer outro recusa", () => {
  const iPre = rollback.indexOf("DO $preflight_rollback_20261240$");
  const iCria = rollback.indexOf("\nCREATE OR REPLACE FUNCTION");
  assert.ok(iPre >= 0, "o rollback tem pre-voo");
  assert.ok(iPre < iCria, "o pre-voo vem ANTES do primeiro CREATE OR REPLACE");
  const pre = rollback.slice(iPre, iCria).replace(/\s+/g, " ");
  assert.ok(pre.includes("END $preflight_rollback_20261240$;"));
  for (const trecho of [
    "p.proname = 'answer_question_atomic') <> 2",
    `('${F2}', '${DEPOIS[F2]}', '${ANTES[F2]}')`,
    `('${F3}', '${DEPOIS[F3]}', '${ANTES[F3]}')`,
    "md5(replace(p.prosrc, E'\\r', ''))",
    "to_regprocedure(r.assinatura)",
    "v_hash IS NULL OR v_hash NOT IN (r.hash_desta, r.hash_antes)",
    "RAISE EXCEPTION 'B1_BASELINE_DIVERGENT:",
  ])
    assert.ok(pre.includes(trecho), trecho);
});

Deno.test("o rollback tem CONFERENCIA FINAL depois da troca: exatamente 2 assinaturas e os dois corpos de volta ao md5 de antes", () => {
  const iUltimaFuncao = rollback.lastIndexOf("$function$;");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261240$");
  assert.ok(iConf >= 0, "o rollback tem conferencia final");
  assert.ok(iConf > iUltimaFuncao, "a conferencia vem DEPOIS dos dois CREATE");
  const conf = rollback.slice(iConf).replace(/\s+/g, " ");
  assert.ok(conf.includes("END $conferencia_rollback_20261240$;"));
  for (const trecho of [
    "p.proname = 'answer_question_atomic') <> 2",
    `('${F2}', '${ANTES[F2]}')`,
    `('${F3}', '${ANTES[F3]}')`,
    "md5(replace(p.prosrc, E'\\r', ''))",
    "v_hash IS DISTINCT FROM r.hash_antes",
    "RAISE EXCEPTION 'conferencia rollback 20261240:",
  ])
    assert.ok(conf.includes(trecho), trecho);
  // a conferencia nao aceita o corpo desta migration como valido
  assert.ok(!conf.includes(DEPOIS[F2]) && !conf.includes(DEPOIS[F3]));
});

Deno.test("o rollback e a migration seguem sem BEGIN/COMMIT de nivel superior e o rollback nunca mexe em ACL", () => {
  for (const [nome, sql] of [
    ["migration", migration],
    ["rollback", rollback],
  ]) {
    const semCorpos = limpo(
      sql
        .split("$function$")
        .filter((_, i) => i % 2 === 0)
        .join(" "),
    );
    assert.doesNotMatch(semCorpos, /\b(BEGIN|COMMIT)\s*;/i, nome);
  }
  const semCorpos = limpo(
    rollback
      .split("$function$")
      .filter((_, i) => i % 2 === 0)
      .join(" "),
  );
  assert.doesNotMatch(semCorpos, /\b(GRANT|REVOKE)\b/i);
});

Deno.test("o comentario da conferencia final da migration nao promete ACL/atributos: o bloco so compara hash", () => {
  const iConf = migration.indexOf("DO $posvoo_20261240$");
  assert.ok(iConf > 0);
  const comentario = migration.slice(
    migration.lastIndexOf("-- CONFERÊNCIA FINAL"),
    iConf,
  );
  assert.ok(comentario.includes("só compara o HASH"));
  assert.ok(!comentario.includes("seguem os de antes"));
  const bloco = migration.slice(iConf);
  assert.ok(bloco.includes("md5(replace(p.prosrc, E'\\r', ''))"));
  assert.ok(!/proacl|aclexplode|has_function_privilege|prosecdef/.test(bloco));
});

Deno.test("o runbook manda desfazer o FRONT antes do banco e descreve o pre-voo do rollback", () => {
  for (const trecho of [
    "**Este rollback tem pre-voo e conferencia final proprios**",
    "**Desfazer o banco EXIGE desfazer o FRONT junto, e o front vai PRIMEIRO.**",
    "AdminQAView.tsx",
    "Avisa a cliente no app",
    "e isso volta a ser FALSO",
    "(1) publicar de novo o front de ANTES desta release",
    "(2) so entao rodar o rollback do banco, loja por loja. Nunca o contrario.",
  ])
    assert.ok(runbook.includes(trecho), trecho);
  assert.ok(!runbook.includes("NAO tem pre-voo proprio"));
});
