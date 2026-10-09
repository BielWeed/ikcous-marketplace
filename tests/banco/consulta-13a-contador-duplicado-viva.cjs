"use strict";

/**
 * Prova VIVA da consulta 13a (scripts/publicacao/consultas/13a-contador-duplicado-do-cupom-so-leitura.sql),
 * a medicao so de leitura que o dono usou para decidir apagar `coupons.used_count`, num
 * Postgres EFEMERO local (nada de rede, nada de loja).
 *
 * O DEFEITO QUE ESTA PROVA FECHA (achado do revisor Codex, 09/10/2026): o item 8 da 13a
 * ("dependentes da coluna, fora o default") excluia TODO `pg_attrdef`. Uma coluna GERADA
 * de public.coupons cuja expressao cita used_count guarda a dependencia em pg_attrdef
 * (o pg_attrdef da coluna GERADA, nao o da used_count): a 13a a escondia e dizia "0
 * dependentes". A exclusao certa e SO o default da PROPRIA coluna (o pg_attrdef cujo
 * adnum e o da used_count).
 *
 * CASOS (cada um dentro de uma transacao que termina em ROLLBACK, no banco clonado do
 * rodar-isolado; a coluna used_count e garantida antes, porque o banco do CI ja tem a
 * migration 20261207000000 aplicada e portanto NAO a tem):
 *  BASE       so a coluna, tudo zero: item 8 = 0 (o default da propria coluna NAO conta).
 *  GERADA     `x integer GENERATED ALWAYS AS (used_count + 1) STORED`: item 8 = 1.
 *  VISAO      uma visao que cita a coluna: item 8 >= 1 e item 12 = 1.
 *  INDICE     um indice sobre a coluna: item 8 >= 1.
 *  MUTANTE    a condicao ANTIGA (`d.classid <> 'pg_attrdef'::regclass`) devolve 0 no caso
 *             GERADA: com ela esta prova fica VERMELHA (o defeito que o achado descreveu).
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres:...@localhost:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/consulta-13a-contador-duplicado-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O unico arquivo lido e a consulta 13a deste repositorio, por nome fixo. */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { falhar, lerDatabaseUrlEfemera } = require("./efemero.cjs");

const CONSULTA = path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "publicacao",
  "consultas",
  "13a-contador-duplicado-do-cupom-so-leitura.sql",
);
const SQL_13A = fs.readFileSync(CONSULTA, "utf8");
const EXCLUSAO_CERTA =
  "AND NOT (d.classid = 'pg_attrdef'::regclass AND EXISTS (SELECT 1 FROM pg_attrdef ad\n          WHERE ad.oid = d.objid AND ad.adrelid = d.refobjid AND ad.adnum = d.refobjsubid))";
const EXCLUSAO_ANTIGA = "AND d.classid <> 'pg_attrdef'::regclass";

let resultados = 0;
const ok = (msg) => {
  resultados += 1;
  console.log(`  ok ${resultados}. ${msg}`);
};

async function comTransacao(c, fn) {
  await c.query("BEGIN");
  try {
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}
async function medir(c, sql = SQL_13A) {
  const r = await c.query(sql);
  return Object.fromEntries(r.rows.map((l) => [l.item, l.valor]));
}
const USED_COUNT_EXISTE = `SELECT 1 FROM pg_attribute WHERE attrelid = 'public.coupons'::regclass
  AND attname = 'used_count' AND attnum > 0 AND NOT attisdropped`;

async function main() {
  assert.ok(
    SQL_13A.includes(EXCLUSAO_CERTA),
    "a 13a tem de excluir SO o default da propria coluna",
  );
  assert.ok(
    !SQL_13A.includes(EXCLUSAO_ANTIGA),
    "a 13a nao pode mais excluir todo pg_attrdef",
  );
  ok("o texto da 13a tem a exclusao certa e nao a antiga");

  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    // O banco do CI ja tem a 20261207000000 (sem a coluna): recria como o baseline.
    await c.query(
      "ALTER TABLE public.coupons ADD COLUMN IF NOT EXISTS used_count integer DEFAULT 0",
    );
    assert.equal((await c.query(USED_COUNT_EXISTE)).rowCount, 1);

    await comTransacao(c, async () => {
      const m = await medir(c);
      assert.equal(m.coluna_existe, "1");
      assert.equal(m.dependentes_da_coluna_fora_o_default, "0");
      assert.equal(m.used_count_diferente_de_zero, "0");
    });
    ok("BASE: so a coluna e o default dela: 0 dependentes (o default da propria used_count nao conta)");

    await comTransacao(c, async () => {
      await c.query(
        "ALTER TABLE public.coupons ADD COLUMN x integer GENERATED ALWAYS AS (used_count + 1) STORED",
      );
      const m = await medir(c);
      assert.equal(
        m.dependentes_da_coluna_fora_o_default,
        "1",
        `coluna gerada que cita used_count tem de contar como dependente, e deu ${m.dependentes_da_coluna_fora_o_default}`,
      );
    });
    ok("GERADA: coluna gerada que cita used_count -> dependentes = 1");

    await comTransacao(c, async () => {
      await c.query(
        "CREATE VIEW public.vw_prova_13a AS SELECT id, used_count FROM public.coupons",
      );
      const m = await medir(c);
      assert.ok(Number(m.dependentes_da_coluna_fora_o_default) >= 1);
      assert.equal(m.visoes_que_citam, "1");
    });
    ok("VISAO: visao que cita a coluna -> dependentes >= 1 e visoes_que_citam = 1");

    await comTransacao(c, async () => {
      await c.query("CREATE INDEX ix_prova_13a ON public.coupons (used_count)");
      const m = await medir(c);
      assert.ok(Number(m.dependentes_da_coluna_fora_o_default) >= 1);
    });
    ok("INDICE: indice sobre a coluna -> dependentes >= 1");

    // MUTANTE: a condicao antiga, de volta, deixa a coluna gerada invisivel.
    const antiga = SQL_13A.replace(EXCLUSAO_CERTA, EXCLUSAO_ANTIGA);
    assert.notEqual(antiga, SQL_13A, "o mutante tem de ter mudado o texto");
    await comTransacao(c, async () => {
      await c.query(
        "ALTER TABLE public.coupons ADD COLUMN x integer GENERATED ALWAYS AS (used_count + 1) STORED",
      );
      const m = await medir(c, antiga);
      assert.equal(
        m.dependentes_da_coluna_fora_o_default,
        "0",
        "o mutante (exclui todo pg_attrdef) tem de reproduzir o defeito: 0 dependentes com a coluna gerada",
      );
      // ...e com isso a asserção do caso GERADA ficaria vermelha:
      assert.throws(
        () =>
          assert.equal(
            m.dependentes_da_coluna_fora_o_default,
            "1",
            "coluna gerada escondida",
          ),
        assert.AssertionError,
      );
    });
    ok("MUTANTE: voltar a excluir todo pg_attrdef esconde a coluna gerada (a prova GERADA ficaria VERMELHA)");
  } finally {
    await c.end().catch(() => {});
  }
  console.log(`\n[13a] ${resultados} verificacoes ok.`);
}

main().catch((e) => falhar("FALHOU", e.stack || e.message));
