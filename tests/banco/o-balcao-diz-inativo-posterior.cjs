"use strict";
// A 20261393100000 (o balcao diz "inativo" para a variacao desligada) e' POSTERIOR a 20261381000000 em
// public.buscar_por_codigo_barras(text): troca so o corpo dessa funcao. O rollback da 20261381000000 RECUSA
// (B1_BASELINE_DIVERGENT) enquanto o corpo no ar nao e' o dela, e esse comportamento e' o certo e nao e' afrouxado aqui.
// Toda prova viva que desfaz a 20261381000000 dentro da transacao tem de desfazer ANTES esta migration. O
// rollback-manual dela devolve o corpo da 20261381000000 byte a byte (nenhum dado muda) e recusa estado desconhecido,
// entao so roda se a migration estiver no ar. Entrada no formato { nome, noAr } das outras listas de "posteriores".
const fs = require("node:fs");
const path = require("node:path");
const BALCAO_DIZ_INATIVO = Object.freeze({
  nome: "20261393100000_o_balcao_diz_inativo_para_a_variacao_desligada.sql",
  // "No ar" = o corpo vivo e' o desta migration (md5 do texto, sem CR), nao so "tem a palavra": mede o que importa.
  noAr: "SELECT COALESCE((SELECT md5(replace(prosrc, E'\\r', '')) = '3e2276ae97a7f2aef487e55d259ba7a3' FROM pg_proc WHERE oid = to_regprocedure('public.buscar_por_codigo_barras(text)')), false) sim",
});
async function desfazerBalcaoDizInativoNaTransacao(c) {
  if ((await c.query(BALCAO_DIZ_INATIVO.noAr)).rows[0].sim) {
    const arquivo = path.join(
      __dirname,
      "../../supabase/migrations",
      `rollback-manual-${BALCAO_DIZ_INATIVO.nome}`,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- nome constante deste modulo.
    await c.query(fs.readFileSync(arquivo, "utf8"));
  }
}
module.exports = { BALCAO_DIZ_INATIVO, desfazerBalcaoDizInativoNaTransacao };
