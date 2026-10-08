// @ts-nocheck
// CI-BANCO: pg_cron emulado + reaplicação dos arquivos de provisionamento
// (PR 766, 04/10/2026). Sem isto, a 20260901 era PULADA INTEIRA no banco do
// ci-banco: `confirmar_pagamento` ficava no corpo da 20260810 (e sem
// `devolver_uso_cupom`), um estado que nenhuma loja tem, e a 20261195 — que
// confere o corpo vivo por hash — recusava com B1_BASELINE_DIVERGENT.
//
// Aqui fica o que se prova sem banco: o stub de cron no provisionador (por
// texto, como o guarda de auth.users em ci_banco_trava_dupla_test.ts) e o
// contrato de `aplicarComProvisionamento` com um cliente de mentira. A prova
// VIVA é a sequência do db-ci.yml contra um Postgres de verdade.
import { createRequire } from "node:module";
import {
  assert,
  assertEquals,
  assertMatch,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";

const require = createRequire(import.meta.url);
const {
  neutralizarProvisionamento,
  aplicarComProvisionamento,
  excecaoDeProvisionamento,
  EXCECOES_DE_PROVISIONAMENTO,
} = require("../scripts/ci/banco/util.cjs");

const ARQ_901 = "20260901000000_devolver_uso_de_cupom_ao_desfazer_pedido.sql";
const SQL_COM_CRON = `
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;
SELECT cron.schedule('job', '*/5 * * * *', 'SELECT 1');
`;

Deno.test("provisionar-efemero.cjs emula o pg_cron (schema, cron.job, schedule e unschedule)", () => {
  const texto = Deno.readTextFileSync(
    new URL("../scripts/ci/banco/provisionar-efemero.cjs", import.meta.url),
  );
  assertMatch(texto, /CREATE SCHEMA IF NOT EXISTS "cron"/);
  assertMatch(texto, /CREATE TABLE IF NOT EXISTS cron\.job/);
  assertMatch(texto, /jobname text UNIQUE/);
  assertMatch(
    texto,
    /FUNCTION cron\.schedule\(p_jobname text, p_schedule text, p_command text\)\s+RETURNS bigint/,
  );
  assertMatch(
    texto,
    /FUNCTION cron\.unschedule\(p_jobname text\) RETURNS boolean/,
  );
});

Deno.test("a 20260901 (que redefine confirmar_pagamento) continua na lista de provisionamento — e é por isso que tem de ser aplicada, não pulada", () => {
  assert(ARQ_901 in EXCECOES_DE_PROVISIONAMENTO);
  assert(
    excecaoDeProvisionamento(ARQ_901, 'extension "pg_cron" is not available'),
  );
  // Erro de SQL real nunca é "provisionamento".
  assert(!excecaoDeProvisionamento(ARQ_901, 'syntax error at or near "FOO"'));
  // Arquivo fora da lista nunca é provisionamento, nem com a mensagem certa.
  assert(
    !excecaoDeProvisionamento(
      "20261195000000_x.sql",
      'extension "pg_cron" is not available',
    ),
  );
});

Deno.test("neutralizarProvisionamento comenta SÓ as duas linhas de extensão", () => {
  const { texto, avisos } = neutralizarProvisionamento(SQL_COM_CRON);
  assertEquals(avisos.length, 2);
  assert(!/^\s*CREATE EXTENSION/im.test(texto), "linha de extensão sobrou");
  assertMatch(texto, /\/\* \[ci-banco\] pg_cron emulado[^\n]*\*\//);
  assertMatch(texto, /\/\* \[ci-banco\] pg_net[^\n]*\*\//);
  assertMatch(texto, /SELECT cron\.schedule\('job'/); // o resto fica
  // Sem a linha, nada muda e nenhum aviso.
  const limpo = neutralizarProvisionamento("SELECT 1;");
  assertEquals(limpo, { texto: "SELECT 1;", avisos: [] });
  // Chamar duas vezes seguidas dá o mesmo resultado (regex global sem estado).
  assertEquals(neutralizarProvisionamento(SQL_COM_CRON).avisos.length, 2);
});

Deno.test("neutralizarProvisionamento: código na MESMA linha da extensão continua executável", () => {
  const { texto } = neutralizarProvisionamento(
    "CREATE EXTENSION IF NOT EXISTS pg_cron; SELECT 1/0;\n",
  );
  // A linha some inteira com `--`; com bloco, o SELECT continua fora do comentário.
  assertEquals(
    texto,
    "/* [ci-banco] pg_cron emulado por stub (provisionar-efemero.cjs) */ SELECT 1/0;\n",
  );
});

/** Cliente de mentira: registra o que recebeu e falha conforme o roteiro. */
function clienteDeMentira({
  aceitaExtensao = false,
  temSchemaCron = true,
} = {}) {
  const recebidos = [];
  return {
    recebidos,
    async query(sql) {
      recebidos.push(sql);
      if (sql.startsWith("SET search_path") || sql === "ROLLBACK") return;
      if (sql.includes("REAL_ERROR_SQL")) {
        throw Object.assign(new Error('syntax error at or near "REAL"'), {
          code: "42601",
        });
      }
      if (
        !aceitaExtensao &&
        /CREATE EXTENSION IF NOT EXISTS pg_cron;/i.test(sql)
      ) {
        throw new Error('extension "pg_cron" is not available');
      }
      if (!temSchemaCron && /cron\.schedule\(/.test(sql)) {
        throw new Error('schema "cron" does not exist');
      }
    },
  };
}

Deno.test("aplicarComProvisionamento: nativo primeiro — arquivo que aplica de cara não é tocado", async () => {
  const c = clienteDeMentira({ aceitaExtensao: true });
  const r = await aplicarComProvisionamento(c, ARQ_901, SQL_COM_CRON);
  assertEquals(r.estado, "nativo");
  assertEquals(
    c.recebidos.filter((s) => !s.startsWith("SET")).length,
    1,
    "uma única tentativa",
  );
});

Deno.test("aplicarComProvisionamento: erro de provisionamento => reaplica com a extensão comentada e conta como emulado", async () => {
  const c = clienteDeMentira();
  const r = await aplicarComProvisionamento(c, ARQ_901, SQL_COM_CRON);
  assertEquals(r.estado, "emulado");
  assertEquals(r.avisos.length, 2);
  const ultimo = c.recebidos[c.recebidos.length - 1];
  assert(!/^\s*CREATE EXTENSION/im.test(ultimo));
  assertMatch(ultimo, /cron\.schedule\('job'/);
});

Deno.test("aplicarComProvisionamento: sem o schema cron a reaplicação ainda é erro de provisionamento => pulado (comportamento antigo, erro à vista)", async () => {
  const c = clienteDeMentira({ temSchemaCron: false });
  const r = await aplicarComProvisionamento(c, ARQ_901, SQL_COM_CRON);
  assertEquals(r.estado, "pulado");
  assertMatch(r.erro.message, /schema "cron" does not exist/);
});

Deno.test("aplicarComProvisionamento: erro de SQL REAL nunca é escondido — nem na tentativa nativa, nem na reaplicação", async () => {
  // Na reaplicação: o arquivo é de provisionamento, o nativo cai na extensão,
  // e DEPOIS a reaplicação esbarra num erro de SQL de verdade.
  const naReaplicacao = await aplicarComProvisionamento(
    clienteDeMentira(),
    ARQ_901,
    `${SQL_COM_CRON}\nREAL_ERROR_SQL;`,
  );
  assertEquals(naReaplicacao.estado, "falhou");
  assertEquals(naReaplicacao.erro.code, "42601");

  // Na tentativa nativa, em arquivo fora da lista: falha direto, sem reaplicar.
  const c = clienteDeMentira();
  const fora = await aplicarComProvisionamento(
    c,
    "20261195000000_qualquer.sql",
    `${SQL_COM_CRON}`,
  );
  assertEquals(fora.estado, "falhou");
  assertEquals(
    c.recebidos.filter((s) => !s.startsWith("SET") && s !== "ROLLBACK").length,
    1,
    "arquivo fora da lista não ganha segunda tentativa",
  );
});

Deno.test("aplicarComProvisionamento: erro de provisionamento SEM linha de extensão a neutralizar => pulado (nada a emular)", async () => {
  const c = {
    async query(sql) {
      if (sql.startsWith("SET") || sql === "ROLLBACK") return;
      throw new Error('schema "cron" does not exist');
    },
  };
  const r = await aplicarComProvisionamento(
    c,
    ARQ_901,
    "SELECT cron.schedule('a','b','c');",
  );
  assertEquals(r.estado, "pulado");
});
