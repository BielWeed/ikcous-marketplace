"use strict";
// A 1360 depende das portas da 97 e sucede os corpos da 240. Desfazer antes das provas ancestrais. A 20261399400000 sucede a 1360 em reply_review_atomic.
const fs = require("node:fs");
const path = require("node:path");
const {
  desfazerAvisoDaAvaliacaoNaTransacao,
} = require("./a-cliente-e-avisada-avaliacao-posterior.cjs");
const EX_ADMIN_DEMAIS_TABELAS = Object.freeze({
  nome: "20261360000000_ex_admin_perde_o_acesso_na_hora_nas_demais_tabelas.sql",
  noAr: "SELECT EXISTS(SELECT 1 FROM pg_policy WHERE polname='coupons_select_policy' AND polrelid=to_regclass('public.coupons') AND pg_get_expr(polqual,polrelid) LIKE '%rls_admin_atual%') sim",
});
async function desfazerExAdminNaTransacao(c) {
  // A 20261399400000 sucede os corpos de reply_review_atomic desta migration: sai ANTES, ou o pre-voo do rollback da 1360 recusa.
  await desfazerAvisoDaAvaliacaoNaTransacao(c);
  if ((await c.query(EX_ADMIN_DEMAIS_TABELAS.noAr)).rows[0].sim) {
    const arquivo = path.join(
      __dirname,
      "../../supabase/migrations",
      `rollback-manual-${EX_ADMIN_DEMAIS_TABELAS.nome}`,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- nome constante deste modulo.
    await c.query(fs.readFileSync(arquivo, "utf8"));
  }
}
module.exports = { EX_ADMIN_DEMAIS_TABELAS, desfazerExAdminNaTransacao };
