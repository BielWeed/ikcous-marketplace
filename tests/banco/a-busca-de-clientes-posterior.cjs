"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399993000 sucede o get_admin_customers_paged da 20261392000000 (UM endereço principal por cliente) e troca também o
 * crm__nunca_comprou. A 20261392000000 sucede o get_admin_customers_paged da 20261230000000 (só o desempate pelo id no ORDER BY) e a
 * 20261392100000 sucede o crm_clientes da 20261231000000 (só o corte do +55 nos dígitos da busca). O rollback da 230 e o
 * da 231 exigem o corpo DELAS: toda prova que desfaz ou mede a 230/231 isolada tem de desfazer estas PRIMEIRO, na
 * própria transação/clone (a mais nova antes). Nunca se afrouxa o pré-voo da migration anterior.
 */
const fs = require("node:fs");
const path = require("node:path");

const BUSCA_DE_CLIENTES_POSTERIOR = Object.freeze([
  // 20261399993000: a lista de clientes toma UM endereco principal por cliente (get_admin_customers_paged; o mesmo arquivo troca tambem o
  // crm__nunca_comprou, que o rollback dela devolve junto). Sucede o corpo da 20261392000000: o rollback da 392 recusa com este no ar.
  Object.freeze({
    nome: "20261399993000_o_crm_e_a_lista_de_clientes_nao_contam_a_mesma_pessoa_duas_vezes.sql",
    assinatura:
      "public.get_admin_customers_paged(text,text,text,integer,integer)",
    hashDesta: "35212d373895b2a9ede613198fc4c794",
  }),
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

/**
 * Desfaz SO a 20261399993000 (a mais nova: a lista toma UM endereco principal por cliente, e o crm__nunca_comprou deixa de repetir a pessoa), se o corpo dela estiver no ar. Para
 * a prova da 20261392000000, que mede o corpo da 392 como TOPO: a 392 e a 3921 ficam. O rollback da 3993 devolve os DOIS corpos (get_admin_customers_paged e crm__nunca_comprou).
 */
async function desfazerListaDeEnderecoPrincipalNaTransacao(c) {
  const m = BUSCA_DE_CLIENTES_POSTERIOR[0];
  const r = await c.query(
    `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
                       WHERE oid = to_regprocedure($1)) = $2, false) AS sim`,
    [m.assinatura, m.hashDesta],
  );
  if (r.rows[0]?.sim !== true) return [];
  await c.query(ler(`rollback-manual-${m.nome}`));
  return [m.nome];
}

module.exports = {
  BUSCA_DE_CLIENTES_POSTERIOR,
  desfazerBuscaDeClientesPosteriorNaTransacao,
  desfazerListaDeEnderecoPrincipalNaTransacao,
};
