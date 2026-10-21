"use strict";
// A 1360 depende das portas da 97 e sucede os corpos da 240. Desfazer antes das provas ancestrais.
const fs = require("node:fs");
const path = require("node:path");
const EX_ADMIN_DEMAIS_TABELAS = Object.freeze({
  nome: "20261360000000_ex_admin_perde_o_acesso_na_hora_nas_demais_tabelas.sql",
  noAr:
    "SELECT EXISTS(SELECT 1 FROM pg_policy WHERE polname='coupons_select_policy' AND polrelid=to_regclass('public.coupons') AND pg_get_expr(polqual,polrelid) LIKE '%rls_admin_atual%') sim",
});
async function desfazerExAdminNaTransacao(c) {
  if ((await c.query(EX_ADMIN_DEMAIS_TABELAS.noAr)).rows[0].sim) {
    const arquivo = path.join(
      __dirname,
      "../../supabase/migrations",
      "rollback-manual-" + EX_ADMIN_DEMAIS_TABELAS.nome,
    );
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- nome constante deste modulo.
    await c.query(fs.readFileSync(arquivo, "utf8"));
  }
}
module.exports = { EX_ADMIN_DEMAIS_TABELAS, desfazerExAdminNaTransacao };
