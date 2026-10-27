// @ts-nocheck
// O TEXTO DA AVALIACAO TEM TETO NO BANCO — prova offline do par 20261396200000 + rollback (cacada de 27/10/2026, achado 5).
// O COMPORTAMENTO (1000 entra, 1001 e 1 milhao sao recusados para todos; a avaliacao antiga acima do teto nao e' tocada mas seu UPDATE
// falha ate encurtar; mutantes; reaplicar; rollback; pre-voo; consultas 114a/114b) e' provado em
// tests/banco/o-texto-da-avaliacao-tem-teto-no-banco-viva.cjs. Aqui fica o que se prova so lendo o texto.
//
// Riscos: a migration so CRIA uma restricao NOT VALID (nenhum dado lido ou escrito, nenhum VALIDATE); o teto tem de ser o da tela
// (ReviewForm maxLength 1000) para nada legitimo ser recusado; o app grava o texto so por useReviews.addReview.
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const {
  avaliarFase0,
  detectarTransacaoExplicita,
  removerRuido,
} = require("../scripts/db-prove-rollback.cjs");

const DIR = new URL("../", import.meta.url);
const NOME = "20261396200000_o_texto_da_avaliacao_tem_teto_no_banco.sql";
const A = "114a-conferir-o-texto-da-avaliacao-tem-teto-no-banco-aplicado";
const B = "114b-antes-o-texto-da-avaliacao-tem-teto-no-banco-ausente";
const CK = "reviews_comment_ate_1000_caracteres";
const lerBruto = (n) =>
  Deno.readTextFileSync(new URL(`supabase/migrations/${n}`, DIR));
const ler = (n) => lerBruto(n).replace(/\r\n/g, "\n");
const lerRepo = (rel) =>
  Deno.readTextFileSync(new URL(rel, DIR)).replace(/\r\n/g, "\n");
const migration = ler(NOME);
const rollback = ler(`rollback-manual-${NOME}`);
const limpo = (s) => removerRuido(s).replace(/\s+/g, " ");

Deno.test("1396200: avaliarFase0 nao recusa o par; sem BEGIN/COMMIT; LF; lock_timeout antes do pre-voo", () => {
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
  for (const sql of [migration, rollback]) {
    assert.deepEqual(detectarTransacaoExplicita(removerRuido(sql)).achados, []);
    const iLock = sql.indexOf("SET LOCAL lock_timeout = '5s';");
    assert.ok(iLock >= 0 && iLock < sql.indexOf("DO $preflight"));
  }
  for (const n of [NOME, `rollback-manual-${NOME}`])
    assert.ok(!lerBruto(n).includes("\r"), n);
});

Deno.test("1396200: a migration so CRIA uma restricao NOT VALID — sem DROP, DML, GRANT/REVOKE, funcao, gatilho nem VALIDATE", () => {
  // sem os comentarios de linha, mas COM o corpo dos blocos DO (o ALTER mora dentro de um)
  const codigo = migration
    .split("\n")
    .filter((l) => !l.trim().startsWith("--"))
    .join("\n")
    .replace(/\s+/g, " ");
  assert.doesNotMatch(codigo, /\bDROP\b/i);
  assert.doesNotMatch(
    codigo,
    /\b(INSERT|UPDATE|DELETE|TRUNCATE)\b(?!\s*(ON|TO|OR)\b)/i,
  );
  assert.doesNotMatch(codigo, /\b(GRANT|REVOKE)\b/i);
  assert.doesNotMatch(codigo, /\bVALIDATE\b/i);
  assert.doesNotMatch(codigo, /\bCREATE\b/i);
  assert.equal((codigo.match(/\bALTER TABLE\b/g) ?? []).length, 1);
  assert.ok(
    codigo.includes(
      `ALTER TABLE public.reviews ADD CONSTRAINT ${CK} CHECK (char_length(comment) <= 1000) NOT VALID;`,
    ),
  );
  // so cria se ainda nao existe (reaplicar e' no-op)
  assert.ok(
    migration.includes(
      `c.conname = '${CK}') THEN\n    ALTER TABLE public.reviews`,
    ),
  );
});

Deno.test("1396200: o pre-voo aceita so a restricao como desenhada (NOT VALID ou validada); a conferencia final exige a mesma regra", () => {
  const iPre = migration.indexOf("DO $preflight_20261396200000$");
  const iCria = migration.indexOf("DO $teto_da_avaliacao_20261396200000$");
  const iConf = migration.indexOf("DO $conferencia_20261396200000$");
  assert.ok(iPre >= 0 && iPre < iCria && iCria < iConf);
  const pre = migration.slice(iPre, iCria);
  const conf = migration.slice(iConf);
  assert.ok(pre.includes("B1_BASELINE_DIVERGENT"));
  assert.ok(
    pre.includes(
      "'CHECK ((char_length(comment) <= 1000)) NOT VALID',\n                             'CHECK ((char_length(comment) <= 1000))'",
    ),
  );
  assert.ok(conf.includes("conferencia 20261396200000"));
  assert.ok(
    conf.includes("'CHECK ((char_length(comment) <= 1000)) NOT VALID'"),
  );
  assert.ok(conf.includes("'CHECK ((char_length(comment) <= 1000))'"));
  // o cabecalho avisa do risco da linha antiga e traz a consulta de medicao
  assert.ok(migration.includes("qualquer UPDATE dessa linha"));
  assert.ok(
    migration.includes(
      "FROM public.reviews WHERE char_length(comment) > 1000;",
    ),
  );
});

Deno.test("1396200: o teto do banco e' o da tela e o app grava o texto so por useReviews.addReview", () => {
  const form = lerRepo("src/components/ui/custom/ReviewForm.tsx");
  assert.ok(
    /maxLength=\{1000\}/.test(form),
    "a tela mudou o limite do texto: revise o CHECK (o banco nao pode recusar o que a tela aceita)",
  );
  const hook = lerRepo("src/hooks/useReviews.ts");
  assert.ok(/\.insert\(/.test(hook));
  // nenhum outro ponto do app reescreve reviews.comment
  for (const rel of [
    "src/hooks/useReviews.ts",
    "src/components/admin/AdminReviewsView.tsx",
  ]) {
    let src = "";
    try {
      src = lerRepo(rel);
    } catch {
      continue;
    }
    assert.doesNotMatch(
      src,
      /\.update\(\{[^}]*\bcomment\s*:/,
      `${rel} passou a editar reviews.comment: revise o CHECK`,
    );
  }
});

Deno.test("1396200: o rollback tira so a restricao NOVA, com pre-voo antes de apagar, e a conferencia final", () => {
  assert.ok(
    rollback.includes(
      `ALTER TABLE public.reviews DROP CONSTRAINT IF EXISTS ${CK};`,
    ),
  );
  assert.equal((limpo(rollback).match(/\bDROP\b/g) ?? []).length, 1);
  assert.doesNotMatch(
    limpo(rollback),
    /\b(INSERT|UPDATE|DELETE|TRUNCATE|GRANT|REVOKE|CREATE)\b(?!\s*(ON|TO)\b)/i,
  );
  const iPre = rollback.indexOf("DO $preflight_rollback_20261396200000$");
  const iApaga = rollback.indexOf("\nALTER TABLE public.reviews DROP");
  const iConf = rollback.indexOf("DO $conferencia_rollback_20261396200000$");
  assert.ok(iPre >= 0 && iPre < iApaga && iApaga < iConf);
  assert.ok(rollback.slice(iPre, iApaga).includes("B1_BASELINE_DIVERGENT"));
});

Deno.test("1396200: publicacao — lote unico (114a/114b), rol fechado de 3 linhas, consultas so de catalogo, workflows, release e prova viva; sem entrada no db-apply (nao ha funcao)", () => {
  const canais = JSON.parse(lerRepo("scripts/frota/canais-de-backend.json"));
  const lote = canais.provasDeObjetos.filter((p) =>
    p.versoes.includes("20261396200000"),
  );
  assert.equal(lote.length, 1);
  assert.deepEqual(lote[0].versoes, ["20261396200000"]);
  assert.equal(lote[0].consulta, A);
  assert.equal(lote[0].ausenciaConfirmadaPor, B);
  for (const campo of ["backfillLedger", "nuncaAplicar", "soNosRefs"])
    assert.ok(!(campo in lote[0]), campo);
  const {
    ROL_FECHADO_POR_CONSULTA,
  } = require("../scripts/publicacao/conferir-banco.cjs");
  for (const nome of [A, B]) {
    const sql = lerRepo(`scripts/publicacao/consultas/${nome}.sql`);
    assert.doesNotMatch(
      limpo(sql),
      /\b(INSERT|UPDATE|DELETE|DROP|ALTER|CREATE|TRUNCATE|GRANT|REVOKE|COPY|CALL|LOCK)\b/i,
    );
    assert.doesNotMatch(
      limpo(sql),
      /\bFROM\s+public\.reviews\b/i,
      "nao le avaliacao de cliente",
    );
    const rol = new Map(Object.entries(ROL_FECHADO_POR_CONSULTA)).get(nome);
    assert.equal(rol.length, 3, nome);
    for (const item of rol) assert.ok(sql.includes(`'${item}'`), item);
    assert.ok(
      lerRepo("scripts/frota/publicar-release.mjs").includes(`"${nome}"`),
    );
    assert.ok(
      lerRepo(".github/workflows/conferir-banco-da-loja.yml").includes(
        `- ${nome}\n`,
      ),
    );
    assert.equal(
      lerRepo(".github/workflows/rpc-ci.yml").split(`consultas/${nome}.sql`)
        .length - 1,
      2,
    );
  }
  assert.ok(
    lerRepo(".github/workflows/rpc-ci.yml").includes(
      "run: node tests/banco/rodar-isolado.cjs tests/banco/o-texto-da-avaliacao-tem-teto-no-banco-viva.cjs",
    ),
  );
  assert.ok(
    lerRepo("tests/banco/LEIA-ME.md").includes(
      "o-texto-da-avaliacao-tem-teto-no-banco-viva.cjs",
    ),
  );
  const { VERIFICACOES } = require("../scripts/db-apply.cjs");
  assert.equal(new Map(Object.entries(VERIFICACOES)).get(NOME), undefined);
});
