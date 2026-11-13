"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399980000 (as listas de Produtos, Pedidos e Cancelados do painel não repetem nem escondem ninguém entre as páginas)
 * sucede, em UMA migration, o get_admin_products_paged da 20261399200000, o get_admin_orders_paged da 20261399900000 e o
 * get_admin_orders_cancelados_recentes da 20261380000000: o mesmo corpo de cada uma mais o desempate pelo id no ORDER BY.
 *
 * Os rollbacks dessas três recusam (B1_BASELINE_DIVERGENT) com o corpo novo no ar, e é o comportamento CERTO (nunca restaurar por
 * baixo de uma redefinição posterior). Então toda prova que desfaz ou mede uma delas isolada, sobre a árvore já migrada, tem de
 * desfazer ESTA primeiro, na própria transação/clone: `a-busca-de-pedidos-posterior.cjs`, `a-busca-do-painel-acha-por-palavras-posterior.cjs`
 * e `o-aviso-de-cancelados-antigos-viva.cjs` já chamam este módulo antes de tocar nas anteriores. Nunca se afrouxa o pré-voo da migration
 * anterior.
 *
 * Só nos clones efêmeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback não muda dado, assinatura nem ACL e desfaz as TRÊS de uma vez
 * (estado misto recusa sem escrever).
 */
const fs = require("node:fs");
const path = require("node:path");
const NOME =
  "20261399980000_as_listas_do_painel_nao_repetem_nem_escondem_ninguem_entre_as_paginas.sql";
// assinatura -> [corpo vigente (o da migration anterior), corpo desta migration] (md5 de replace(prosrc, E'\r', ''))
const CORPOS = Object.freeze({
  "public.get_admin_products_paged(text,text,text,text,integer,integer)": [
    "346063e900b8b7b63dfbeffe5070eedc",
    "0f153b653338f6570da399493093cfae",
  ],
  "public.get_admin_orders_paged(text,text,text,text,integer,integer,text,text)":
    ["bf08545275eaa451a65e15feceb0ed8d", "b404a8397a6490c86fb192d85fd5b6c9"],
  "public.get_admin_orders_cancelados_recentes(integer,integer,integer)": [
    "9567454f17698f3f0624cca0b06458cd",
    "80ec13f92e224b21d5308a063e88fb6e",
  ],
});
const LISTAS_DO_PAINEL = Object.freeze({ nome: NOME, corpos: CORPOS });
const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`;

/** Desfaz a 20261399980000 na transação aberta, se ALGUMA das três funções está no corpo dela; repetir é no-op. Devolve true se desfez. */
async function desfazerListasDoPainelNaTransacao(c) {
  let noAr = false;
  for (const [assinatura, [, hashDesta]] of Object.entries(CORPOS))
    if ((await c.query(hashVivo, [assinatura])).rows[0]?.h === hashDesta)
      noAr = true;
  if (!noAr) return false;
  await c.query(
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
  for (const [assinatura, [hashVigente]] of Object.entries(CORPOS)) {
    const h = (await c.query(hashVivo, [assinatura])).rows[0]?.h;
    if (h !== hashVigente)
      throw new Error(
        `a 20261399980000 nao devolveu ${assinatura} ao corpo vigente (${hashVigente}); vivo ${h}`,
      );
  }
  return true;
}

module.exports = { LISTAS_DO_PAINEL, desfazerListasDoPainelNaTransacao };
