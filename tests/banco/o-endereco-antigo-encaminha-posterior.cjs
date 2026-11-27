"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos literais de migration do repositório. */
/**
 * A 20261570 (o endereço antigo encaminha para o novo) cria public.frota_enderecos_que_encaminham com uma chave estrangeira para
 * public.frota_lojas(id). O rollback da 20261141 (DROP TABLE public.frota_lojas, sem CASCADE) RECUSA com ela no ar — o comportamento
 * certo, que não se afrouxa aqui. Toda prova viva que desfaz a caderneta inteira (ou que mede a base de antes desta migration) tem de
 * desfazer ANTES esta: o rollback COMUM (as portas saem) e o DESTRUTIVO confirmado (a tabela e a função do gatilho saem). Só roda se a migration estiver no ar; roda
 * na transação do chamador (que decide se comita).
 */
const fs = require("node:fs");
const path = require("node:path");
const ENDERECO_ANTIGO = Object.freeze({
  nome: "20261570000000_o_endereco_antigo_encaminha_para_o_novo.sql",
  // "No ar" = a tabela existe (o destrutivo a tira; depois dele não há o que desfazer).
  noAr: "SELECT to_regclass('public.frota_enderecos_que_encaminham') IS NOT NULL AS sim",
});
const ler = (n) =>
  fs.readFileSync(
    path.join(__dirname, "..", "..", "supabase", "migrations", n),
    "utf8",
  );
async function desfazerEnderecoAntigoNaTransacao(c) {
  if ((await c.query(ENDERECO_ANTIGO.noAr)).rows[0]?.sim !== true) return false;
  // O comum primeiro (tira as portas; o destrutivo recusa com elas no ar), depois o destrutivo.
  await c.query(ler(`rollback-manual-${ENDERECO_ANTIGO.nome}`));
  await c.query(
    "SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = 'APAGAR'",
  );
  // A tabela pode ter endereço gravado por quem chama: a prova decide apagar (o banco é um clone efêmero).
  await c.query("SET LOCAL ikcous.apagar_caderneta = 'sim'");
  await c.query(ler(`rollback-manual-destrutivo-${ENDERECO_ANTIGO.nome}`));
  await c.query("SET LOCAL ikcous.apagar_caderneta = ''");
  await c.query("SET LOCAL app.confirmo_apagar_enderecos_que_encaminham = ''");
  return true;
}
/** Desfaz a 20261570 numa transação própria, COMITADA (para as provas que rodam num clone exclusivo e medem a base de antes dela). */
async function desfazerEnderecoAntigoNoClone(c) {
  await c.query("BEGIN");
  try {
    const desfez = await desfazerEnderecoAntigoNaTransacao(c);
    await c.query("COMMIT");
    return desfez;
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  }
}
module.exports = {
  ENDERECO_ANTIGO,
  desfazerEnderecoAntigoNaTransacao,
  desfazerEnderecoAntigoNoClone,
};
