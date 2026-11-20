"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261403000000 sucede o get_admin_customers_paged da 20261399993000 (soma o balcão do mesmo WhatsApp, como o CRM) e troca também o
 * get_admin_user_detail da 20261199000000. A 20261399993000 sucede o get_admin_customers_paged da 20261392000000 (UM endereço principal por cliente) e troca também o
 * crm__nunca_comprou. A 20261392000000 sucede o get_admin_customers_paged da 20261230000000 (só o desempate pelo id no ORDER BY) e a
 * 20261392100000 sucede o crm_clientes da 20261231000000 (só o corte do +55 nos dígitos da busca). O rollback da 230 e o
 * da 231 exigem o corpo DELAS: toda prova que desfaz ou mede a 230/231 isolada tem de desfazer estas PRIMEIRO, na
 * própria transação/clone (a mais nova antes). Nunca se afrouxa o pré-voo da migration anterior.
 */
const fs = require("node:fs");
const path = require("node:path");

const BUSCA_DE_CLIENTES_POSTERIOR = Object.freeze([
  // 20261412000000: as tres telas usam a mesma base, sem reembolso integral.
  Object.freeze({
    nome: "20261412000000_o_crm_ignora_reembolso_integral.sql",
    assinatura:
      "public.get_admin_customers_paged(text,text,text,integer,integer)",
    hashDesta: "bdac47c59600f44cf59ac6c74e44a55e",
  }),
  // 20261403000000: a lista de clientes e a ficha somam o balcao do mesmo WhatsApp, como o CRM (get_admin_customers_paged e get_admin_user_detail; o mesmo arquivo
  // troca as DUAS, e o rollback dela devolve as duas juntas). Sucede o corpo da 20261399993000: o rollback da 3993 recusa com este no ar.
  Object.freeze({
    nome: "20261403000000_o_total_comprado_do_cliente_e_o_mesmo_no_crm_na_lista_e_na_ficha.sql",
    assinatura:
      "public.get_admin_customers_paged(text,text,text,integer,integer)",
    hashDesta: "309bbd903420f146423c7cf0512b91b3",
  }),
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
  // A 20261403000000 sucede a 3993 na mesma funcao: sai antes (o rollback da 3993 recusa com o corpo dela no ar).
  await desfazerTotalDoClienteNaTransacao(c);
  const m = BUSCA_DE_CLIENTES_POSTERIOR.find((x) =>
    x.nome.startsWith("20261399993000_"),
  );
  const r = await c.query(
    `SELECT COALESCE((SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc
                       WHERE oid = to_regprocedure($1)) = $2, false) AS sim`,
    [m.assinatura, m.hashDesta],
  );
  if (r.rows[0]?.sim !== true) return [];
  await c.query(ler(`rollback-manual-${m.nome}`));
  return [m.nome];
}

/**
 * Desfaz SO a 20261403000000 (a mais nova: a lista de clientes e a ficha somam o balcao do mesmo WhatsApp, como o CRM), se o corpo dela estiver no ar. Para as
 * provas da 20261399993000 e da 20261392000000, que medem o corpo delas como TOPO. O rollback devolve os DOIS corpos (get_admin_customers_paged e get_admin_user_detail).
 */
async function desfazerTotalDoClienteNaTransacao(c) {
  const atual = BUSCA_DE_CLIENTES_POSTERIOR.find((x) =>
    x.nome.startsWith("20261412000000_"),
  );
  const { rows } = await c.query(
    `SELECT md5(replace(prosrc, chr(13), '')) AS hash
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [atual.assinatura],
  );
  if (rows[0]?.hash === atual.hashDesta)
    await c.query(ler(`rollback-manual-${atual.nome}`));

  const m = BUSCA_DE_CLIENTES_POSTERIOR.find((x) =>
    x.nome.startsWith("20261403000000_"),
  );
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
  desfazerTotalDoClienteNaTransacao,
  desfazerBuscaDeClientesPosteriorNaTransacao,
  desfazerListaDeEnderecoPrincipalNaTransacao,
};
