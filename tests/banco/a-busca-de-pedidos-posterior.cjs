"use strict";

/**
 * A 20261399900000 (a busca de Pedidos acha o telefone colado com o +55) redefine get_admin_orders_paged em cima do corpo da
 * 20261387000000: o mesmo corpo mais o corte do 55 dos digitos da busca.
 *
 * Toda prova viva que mede a 20261387000000 (ou a 8e, que trata get_admin_orders_paged como funcao da 99 com sucessoras) sobre a
 * arvore ja migrada tem de desfazer ANTES esta: o rollback-manual da 20261387000000 recusa (B1_BASELINE_DIVERGENT) com um corpo
 * posterior no ar, e o modelo da 8e dessas provas conta SO as sucessoras que ele conhece. E' o comportamento CERTO (nunca restaurar
 * por baixo de uma redefinicao posterior).
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho e' montado de literais deste arquivo (a migration do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const NOME =
  "20261399900000_a_busca_de_pedidos_acha_o_telefone_colado_com_o_55.sql";
const HASH_DESTA = "bf08545275eaa451a65e15feceb0ed8d";
const HASH_DA_387 = "f06b1bc03cf7bcf1fbb9d7b2f7ff4fe6";
const ASSINATURA =
  "public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)";

const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure('${ASSINATURA}')`;

const BUSCA_DE_PEDIDOS = Object.freeze({ nome: NOME, hashDesta: HASH_DESTA });

/** Desfaz a 20261399900000 na transacao aberta, se no ar; repetir e' no-op. Devolve true se desfez. */
async function desfazerBuscaDePedidosNaTransacao(cliente) {
  // A 20261399980000 (as listas do painel desempatam por id) sucede esta no MESMO get_admin_orders_paged: sai PRIMEIRO (so se no ar).
  await require("./as-listas-do-painel-posterior.cjs").desfazerListasDoPainelNaTransacao(
    cliente,
  );
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
    HASH_DA_387,
    "a 20261399900000 nao restaurou get_admin_orders_paged ao corpo da 20261387000000; revise as sucessoras",
  );
  return true;
}

module.exports = { BUSCA_DE_PEDIDOS, desfazerBuscaDePedidosNaTransacao };
