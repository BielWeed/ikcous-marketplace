"use strict";

/**
 * A migration 20261244000000 (a loja escolhe como entrega na cidade e em quantos dias; 15/10/2026) REDEFINE TRÊS
 * corpos de migrations anteriores: create_marketplace_order_v23 (o que a 20261229000000 deixou), create_marketplace_order_v24
 * (o que a 20261236000000 deixou) e upsert_store_config (o que a 20261239000000 deixou), e refaz v_store_config com duas
 * colunas no fim.
 *
 * Toda prova viva que mede UMA dessas três migrations ISOLADA (o hash do corpo dela, o rollback dela, reaplicá-la) tem de
 * desfazer ANTES esta — ela é a mais nova, e o pré-voo de cada rollback mais velho recusa (B1_BASELINE_DIVERGENT) com o
 * corpo dela no ar. É o comportamento CERTO (nunca restaurar por baixo de uma redefinição posterior); este módulo é a
 * entrada única para essas provas, no formato { nome, noAr } que as outras listas de "posteriores" já usam (o mesmo molde de
 * desfazer-recebimento-posterior.cjs e reembolso-em-duvida-posterior.cjs).
 *
 * Desfaz nos DOIS degraus: o rollback COMUM (três corpos, a trigger e a view; as colunas ficam) e o DESTRUTIVO (apaga as
 * duas colunas), para que a prova antecessora veja o esquema EXATO de antes desta migration (a view pública, por exemplo,
 * é comparada com as colunas da tabela). Num clone recém-migrado nenhuma loja está em "Só retiro" nem com prazo diferente
 * de 1 (o padrão), então nenhum dos dois recusa.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * O caminho é montado de literais deste arquivo (a migration do repositório). */

const fs = require("node:fs");
const path = require("node:path");

const NOME = "20261244000000_a_loja_escolhe_como_entrega_na_cidade.sql";
// O corpo de upsert_store_config que esta migration deixa (o md5 do pré-voo e do pós-voo dela): "no ar" = o corpo vivo é
// exatamente esse. As três funções caem e sobem juntas (um rollback só), então uma sonda basta.
const HASH_UPSERT_DESTA = "391e8e1064400df5aea579f3472b203c";

const ENTREGA_NA_CIDADE = Object.freeze({
  nome: NOME,
  noAr: `SELECT COALESCE((SELECT md5(replace(prosrc, E'\\r', '')) FROM pg_proc
                           WHERE oid = to_regprocedure('public.upsert_store_config(jsonb)')) = '${HASH_UPSERT_DESTA}', false) AS sim`,
});

/** Desfaz a 20261244000000 no clone/na transação aberta do cliente, se ela estiver no ar. Devolve true se desfez. */
async function desfazerEntregaNaCidadeNaTransacao(cliente) {
  // A sucessora dos corpos de v23/v24 (20261350000000: trava o preço e espera a mesma chave) cai ANTES: o pré-voo do
  // rollback da 244 recusa com o corpo novo no ar. Ver a-compra-online-trava-posterior.cjs.
  await require("./a-compra-online-trava-posterior.cjs").desfazerCompraOnlineTravaNaTransacao(
    cliente,
  );
  await require("./estilo-card-frete-posterior.cjs").desfazerEstiloCardFreteNaTransacao(
    cliente,
  );
  const r = await cliente.query(ENTREGA_NA_CIDADE.noAr);
  if (!r.rows[0] || r.rows[0].sim !== true) return false;
  const sql = fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "supabase",
      "migrations",
      `rollback-manual-${NOME}`,
    ),
    "utf8",
  );
  await cliente.query(sql);
  await cliente.query(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "supabase",
        "migrations",
        `rollback-manual-destrutivo-${NOME}`,
      ),
      "utf8",
    ),
  );
  return true;
}

module.exports = { ENTREGA_NA_CIDADE, desfazerEntregaNaCidadeNaTransacao };
