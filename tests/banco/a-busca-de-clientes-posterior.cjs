"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261392000000 sucede o get_admin_customers_paged da 20261230000000 (só o desempate pelo id no ORDER BY) e a
 * 20261392100000 sucede o crm_clientes da 20261231000000 (só o corte do +55 nos dígitos da busca). O rollback da 230 e o
 * da 231 exigem o corpo DELAS: toda prova que desfaz ou mede a 230/231 isolada tem de desfazer estas PRIMEIRO, na
 * própria transação/clone (a mais nova antes). Nunca se afrouxa o pré-voo da migration anterior.
 */
const fs = require("node:fs");
const path = require("node:path");

const BUSCA_DE_CLIENTES_POSTERIOR = Object.freeze([
  Object.freeze({
    nome: "20261392100000_a_busca_do_crm_acha_o_numero_com_mais_55.sql",
    assinatura: "public.crm_clientes(text,text,integer,integer)",
    hashDesta: "39a2a6de59041e09b6f1e466a6782dca",
  }),
  Object.freeze({
    nome: "20261392000000_a_lista_de_clientes_nao_repete_nem_esconde_ninguem_entre_as_paginas.sql",
    assinatura:
      "public.get_admin_customers_paged(text,text,text,integer,integer)",
    hashDesta: "1c71829d75e3d8f17bf7fb01019c05ec",
  }),
]);

const ler = (nome) =>
  fs.readFileSync(
    path.join(__dirname, "..", "..", "supabase", "migrations", nome),
    "utf8",
  );

/** Desfaz as duas (a mais nova antes), cada uma só se o corpo dela estiver no ar. Devolve os nomes desfeitos. */
async function desfazerBuscaDeClientesPosteriorNaTransacao(c) {
  const desfeitas = [];
  for (const m of BUSCA_DE_CLIENTES_POSTERIOR) {
    const r = await c.query(
      `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
                         WHERE oid = to_regprocedure($1)) = $2, false) AS sim`,
      [m.assinatura, m.hashDesta],
    );
    if (r.rows[0]?.sim !== true) continue;
    await c.query(ler(`rollback-manual-${m.nome}`));
    desfeitas.push(m.nome);
  }
  return desfeitas;
}

module.exports = {
  BUSCA_DE_CLIENTES_POSTERIOR,
  desfazerBuscaDeClientesPosteriorNaTransacao,
};
