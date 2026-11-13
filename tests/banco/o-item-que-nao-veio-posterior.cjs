"use strict";
/* eslint-disable security/detect-non-literal-fs-filename -- Caminho literal de migration do repositório. */
/**
 * A 20261399992000 (o item que a lojista marcou "Não veio" pode ser devolvido de novo) sucede, em UMA migration, a
 * devolucao_elegibilidade e a devolucao_detalhe da 20261199000000 e a solicitar_devolucao da 20261175000000: o mesmo corpo de cada
 * uma mais a conta de `condicao = 'ausente'` (o item que não veio não conta como já devolvido; o detalhe ganha o aviso).
 *
 * O rollback da 99 (e o da 175) recusa (B1_BASELINE_DIVERGENT) com o corpo novo no ar, e é o comportamento CERTO (nunca restaurar por
 * baixo de uma redefinição posterior). Então a prova que mede a 8e sobre o estado da 99 tem de desfazer ESTA primeiro, na própria
 * transação/clone: `portao-8e-aceita-sucessoras-viva.cjs` chama este módulo no início de `noEstado`. Nunca se afrouxa o pré-voo da
 * migration anterior.
 *
 * Só nos clones efêmeros: o chamador decide BEGIN/COMMIT/ROLLBACK; o rollback não muda dado, assinatura nem ACL e desfaz as TRÊS de uma
 * vez (estado misto recusa sem escrever).
 */
const fs = require("node:fs");
const path = require("node:path");
const NOME =
  "20261399992000_o_item_que_nao_veio_pode_ser_devolvido_de_novo.sql";
// assinatura -> [corpo vigente (o da migration anterior), corpo desta migration] (md5 de replace(prosrc, E'\r', ''))
const CORPOS = Object.freeze({
  "public.devolucao_elegibilidade(uuid)": [
    "0bdb635f4f04e8edb894b70da58282e7",
    "bedd211bba45261dfbf962241ca3c9dd",
  ],
  "public.solicitar_devolucao(uuid,jsonb,text,text,text,text,text[])": [
    "a12d11acdcc07992f4a5f527106a1cf8",
    "52e5c30c06f9767a97e98f3a393b8496",
  ],
  "public.devolucao_detalhe(uuid)": [
    "6897a45df3e5d29256f85611ea3ca91f",
    "a439e320641d553e3a21883c6606c6f2",
  ],
});
const O_ITEM_QUE_NAO_VEIO = Object.freeze({ nome: NOME, corpos: CORPOS });
const hashVivo = `SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)`;

/** Desfaz a 20261399992000 na transação aberta, se ALGUMA das três funções está no corpo dela; repetir é no-op. Devolve true se desfez. */
async function desfazerOItemQueNaoVeioNaTransacao(c) {
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
        `a 20261399992000 nao devolveu ${assinatura} ao corpo vigente (${hashVigente}); vivo ${h}`,
      );
  }
  return true;
}

module.exports = { O_ITEM_QUE_NAO_VEIO, desfazerOItemQueNaoVeioNaTransacao };
