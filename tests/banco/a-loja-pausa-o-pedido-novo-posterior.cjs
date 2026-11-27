"use strict";
// Definicao unica da 20261600000000 (a loja pausa o pedido novo) para as provas que desfazem as migrations POSTERIORES antes de medir uma
// anterior:
//   - PAUSA_DE_VENDAS ({ nome, noAr }): a entrada no FIM de POSTERIORES_A_97 (admin-atual-viva.cjs e pagamentos-rpc-viva.cjs). O gatilho
//     a_loja_aceita_pedido_novo e a leitura situacao_das_vendas_da_loja chamam is_admin_atual(): sem esta entrada o rollback da 97 recusa
//     (B1_BASELINE_DIVERGENT). O rollback-manual (comum) dela tira os 2 gatilhos e as 5 funcoes e DEIXA a tabela pausa_de_vendas.
//   - desfazerAPausaDeVendas(c): para as provas da 20261590000000 (a coluna assinatura_da_loja.pausa_em) e da 20261399998000 (a porta do
//     cartao). O destrutivo da 1590 recusa apagar pausa_em enquanto alguma funcao cita a coluna (PAUSA_EM_USO), e a 1600 le pausa_em: sem
//     desfazer esta antes, aquelas provas ficam vermelhas por um estado que nao e' delas.
//
// Roda o rollback COMUM desta (tira gatilhos e funcoes; a tabela pausa_de_vendas fica, vazia no clone) numa transacao so. O rollback tem
// pre-voo proprio e recusa estado desconhecido: isto nao afrouxa nada. So no Postgres EFEMERO (quem chama ja passou pela trava de
// efemero.cjs) e so no clone do rodar-isolado.cjs: o COMMIT fica no clone, que some no fim. No-op quando a 1600 nao esta no ar.
// A SUCESSORA 20261630000000 (a loja ja suspensa tambem pausa) troca o corpo da marca: sai ANTES, na mesma transacao (senao o pre-voo do
// rollback daqui recusa a marca com o corpo dela). Definicao em a-loja-ja-suspensa-tambem-pausa-posterior.cjs.

/* eslint-disable security/detect-non-literal-fs-filename -- caminhos fixos das migrations versionadas, sem entrada externa. */
const fs = require("node:fs");
const path = require("node:path");
const {
  desfazerASuspensaAntigaNaTransacao,
} = require("./a-loja-ja-suspensa-tambem-pausa-posterior.cjs");

const NOME = "20261600000000_a_loja_pausa_o_pedido_novo.sql";
const PASTA = path.resolve(__dirname, "..", "..", "supabase", "migrations");
const ler = (arq) =>
  fs.readFileSync(path.join(PASTA, arq), "utf8").replace(/\r\n/g, "\n");

/** A 1600 esta no ar se alguma das funcoes dela existe. */
const NO_AR = `SELECT EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace
    AND proname IN ('data_da_pausa_de_vendas', 'marcar_suspensa_desde', 'motivo_da_loja_nao_aceitar_pedido',
                    'a_loja_aceita_pedido_novo', 'situacao_das_vendas_da_loja')) AS sim`;

async function desfazerAPausaDeVendas(c) {
  if (!(await c.query(NO_AR)).rows[0].sim) return false;
  await c.query("BEGIN");
  try {
    await desfazerASuspensaAntigaNaTransacao(c);
    await c.query(ler(`rollback-manual-${NOME}`));
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
  return true;
}

const PAUSA_DE_VENDAS = Object.freeze({ nome: NOME, noAr: NO_AR });

module.exports = { desfazerAPausaDeVendas, PAUSA_DE_VENDAS };
