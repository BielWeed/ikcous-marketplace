"use strict";
// Definicao unica da 20261600000000 (a loja pausa o pedido novo) para as provas que desfazem as migrations POSTERIORES antes de medir uma
// anterior. Hoje: as provas da 20261590000000 (a coluna assinatura_da_loja.pausa_em) e da 20261399998000 (a porta do cartao). O destrutivo da
// 1590 recusa apagar pausa_em enquanto alguma funcao cita a coluna (PAUSA_EM_USO), e a 1600 le pausa_em (data_da_pausa_de_vendas e o motivo):
// sem desfazer esta antes, aquelas provas ficam vermelhas por um estado que nao e' delas.
//
// Roda o rollback COMUM desta (tira gatilhos e funcoes; a tabela pausa_de_vendas fica, vazia no clone) numa transacao so. O rollback tem
// pre-voo proprio e recusa estado desconhecido: isto nao afrouxa nada. So no Postgres EFEMERO (quem chama ja passou pela trava de
// efemero.cjs) e so no clone do rodar-isolado.cjs: o COMMIT fica no clone, que some no fim. No-op quando a 1600 nao esta no ar.

/* eslint-disable security/detect-non-literal-fs-filename -- caminhos fixos das migrations versionadas, sem entrada externa. */
const fs = require("node:fs");
const path = require("node:path");

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
    await c.query(ler(`rollback-manual-${NOME}`));
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  }
  return true;
}

module.exports = { desfazerAPausaDeVendas, A_PAUSA_DE_VENDAS: NOME };
