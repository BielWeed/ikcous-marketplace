"use strict";

/**
 * A 20261395000000 (a busca de devolucao acha o numero do pedido) redefine admin_devolucoes_listar em cima do corpo da
 * 20261199000000: o mesmo corpo mais UM ramo no filtro da busca.
 *
 * Toda prova viva que mede a 20261199000000 (ou a 8e, que trata admin_devolucoes_listar como funcao da 99 com sucessoras)
 * ISOLADA tem de desfazer ANTES esta: o rollback-manual da 99 recusa (B1_BASELINE_DIVERGENT) com um corpo posterior no ar, e
 * o modelo da 8e dessas provas conta SO as sucessoras da 99 que ele conhece. E' o comportamento CERTO (nunca restaurar por
 * baixo de uma redefinicao posterior).
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (a migration do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261395000000_a_busca_de_devolucao_acha_o_numero_do_pedido.sql";
const HASH_DESTA = "989a6c6151eb35efc7c834c6cce20f01";
const HASH_DA_199 = "5a632e0a239104598dcdc4eb323c09b1";
const ASSINATURA = "public.admin_devolucoes_listar(text,text,integer,integer)";

const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${ASSINATURA}')`;

const BUSCA_DE_DEVOLUCAO = Object.freeze({ nome: NOME, hashDesta: HASH_DESTA });

/** Desfaz a 20261395000000 na transacao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerBuscaDeDevolucaoNaTransacao(cliente) {
  const r = await cliente.query(hashVivo);
  if (r.rows[0]?.h !== HASH_DESTA) return false;
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
    HASH_DA_199,
    "a 20261395000000 nao restaurou admin_devolucoes_listar ao corpo da 20261199000000; revise as sucessoras",
  );
  return true;
}

module.exports = { BUSCA_DE_DEVOLUCAO, desfazerBuscaDeDevolucaoNaTransacao };
