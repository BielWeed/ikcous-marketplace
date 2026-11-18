"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261404000000 (a "Observação da inspeção" da devolução é só da loja) sucede, em UMA migration, a devolucao_detalhe da 20261399992000 (o mesmo
 * corpo mais a troca que tira a chave observacao_inspecao de quem não é admin atual) e tira o SELECT da tabela public.devolucoes de authenticated
 * (grant por coluna, todas menos a observação).
 *
 * O rollback da 3992 (e o da 99) recusa (B1_BASELINE_DIVERGENT) com o corpo novo no ar, e é o comportamento CERTO (nunca restaurar por baixo de uma
 * redefinição posterior). Então a prova que mede a 3992 ou a 99 sobre o estado delas tem de desfazer ESTA primeiro, na própria transação/clone:
 * `portao-8e-aceita-sucessoras-viva.cjs` chama este módulo no início de `noEstado`, antes de o-item-que-nao-veio-posterior.cjs. Nunca se afrouxa o
 * pré-voo da migration anterior.
 *
 * Só nos clones efêmeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback não muda dado e devolve o corpo e o GRANT de tabela inteira de antes.
 */
const fs = require("node:fs");
const path = require("node:path");
const NOME = "20261404000000_a_observacao_da_inspecao_so_a_loja_ve.sql";
const ASSINATURA = "public.devolucao_detalhe(uuid)";
// [corpo vigente (o da 20261399992000), corpo desta migration] (md5 de replace(prosrc, E'\r', ''))
const CORPOS = Object.freeze([
  "a439e320641d553e3a21883c6606c6f2",
  "b4eb7a928f8a6ff04c34e93f4f56188c",
]);
const A_OBSERVACAO_DA_INSPECAO = Object.freeze({
  nome: NOME,
  assinatura: ASSINATURA,
  corpos: CORPOS,
});
const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`;

/** Desfaz a 20261404000000 na transação aberta, se o corpo dela está no ar; repetir é no-op. Devolve true se desfez. */
async function desfazerAObservacaoDaInspecaoNaTransacao(c) {
  const [hashVigente, hashDesta] = CORPOS;
  if ((await c.query(hashVivo, [ASSINATURA])).rows[0]?.h !== hashDesta)
    return false;
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
  const h = (await c.query(hashVivo, [ASSINATURA])).rows[0]?.h;
  if (h !== hashVigente)
    throw new Error(
      `a 20261404000000 nao devolveu ${ASSINATURA} ao corpo vigente (${hashVigente}); vivo ${h}`,
    );
  return true;
}

module.exports = {
  A_OBSERVACAO_DA_INSPECAO,
  desfazerAObservacaoDaInspecaoNaTransacao,
};
