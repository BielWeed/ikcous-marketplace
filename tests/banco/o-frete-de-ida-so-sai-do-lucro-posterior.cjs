"use strict";

/**
 * A 20261662000000 (o frete de ida so sai do lucro do ranking quando foi devolvido) redefine UM corpo: get_admin_analytics_v2 (em cima
 * do da 20261659000000). Nenhum objeto novo, nenhuma tabela.
 *
 * Toda prova viva que mede a 20261659000000 (ou as antecessoras dela no analytics: 3995, 3994, ...) ISOLADA tem de desfazer ANTES esta:
 * o pre-voo do rollback da 1659 recusa o corpo desta ("sucessora no ar? nao desfaca por baixo dela"), e o comportamento medido seria o
 * desta. Quem chama este modulo primeiro: a-peca-de-produto-excluido-posterior.cjs (e, por ele, a cadeia do lucro e a do estoque) e a
 * prova viva da 1659 no comeco.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback devolve o corpo da 1659 byte a byte e nao apaga nenhuma
 * linha.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (o rollback do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME =
  "20261662000000_o_frete_de_ida_so_sai_do_lucro_quando_foi_devolvido.sql";
const HASH_ANALYTICS_DESTA = "b6cb9b487fdc4b603ce9313b46184897";
const HASH_ANALYTICS_1659 = "1624212a7096b6f49a80370b30191a15";
const ANALYTICS = "public.get_admin_analytics_v2(integer)";

const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${ANALYTICS}')`;

// Formato { nome, noAr } das listas POSTERIORES_A_97: "no ar" = o corpo vivo do analytics e' o desta.
const FRETE_SO_QUANDO_DEVOLVIDO = Object.freeze({
  nome: NOME,
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure('${ANALYTICS}'))
           = '${HASH_ANALYTICS_DESTA}', false) AS sim`,
});

/** Desfaz a 20261662000000 na conexao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerFreteDeIdaNaTransacao(cliente) {
  const r = await cliente.query(FRETE_SO_QUANDO_DEVOLVIDO.noAr);
  if (r.rows[0]?.sim !== true) return false;
  await cliente.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-${NOME}`,
      ),
      "utf8",
    ),
  );
  assert.equal(
    (await cliente.query(hashVivo)).rows[0]?.h,
    HASH_ANALYTICS_1659,
    `a 20261662000000 nao restaurou ${ANALYTICS} ao corpo da 20261659000000; revise as sucessoras`,
  );
  return true;
}

module.exports = {
  FRETE_SO_QUANDO_DEVOLVIDO,
  HASH_ANALYTICS_DESTA,
  HASH_ANALYTICS_1659,
  desfazerFreteDeIdaNaTransacao,
};
