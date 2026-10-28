"use strict";

/**
 * A 20261397000000 (o desconto do cupom de porcentagem e' arredondado ao centavo) redefine TRES funcoes, cada uma em cima do corpo que a
 * migration anterior dela deixou, trocando UMA linha (a conta do desconto percentual ganha o round(..., 2)):
 *   - create_marketplace_order_v23: o corpo da 20261394200000;
 *   - create_marketplace_order_v24: o corpo da 20261394000000;
 *   - validate_coupon_secure_v2:    o corpo da 20261208000000.
 *
 * Toda prova viva que mede uma dessas migrations (ou as anteriores a elas) ISOLADA (o hash do corpo, o rollback, reaplicar a migration)
 * tem de devolver ANTES as funcoes ao corpo de antes desta: ela e' a mais nova, e o pre-voo do rollback de cada anterior recusa
 * (B1_BASELINE_DIVERGENT) com o corpo dela no ar. E' o comportamento CERTO (nunca restaurar por baixo de uma redefinicao posterior).
 * a-v23-recusa-o-pagamento-pelo-app-posterior.cjs chama este modulo primeiro, entao a cadeia de provas historicas (229/236/244, 350, 384, 394 e
 * 394200) nao precisa saber dele; as provas da validacao (203/208) o chamam direto.
 *
 * DIFERENTE dos outros "posterior": aqui o corpo de antes e' reinstalado funcao por funcao, por CREATE OR REPLACE do texto da migration
 * anterior (lido do arquivo), e SO nas funcoes cujo corpo vivo for o desta migration. Motivo: as provas dos frameworks de uma funcao so
 * (prova-de-troca-de-corpo.cjs) deixam a v23 num corpo e a v24/validate em outro; o rollback-manual desta migration exige as tres no corpo
 * dela (e e' provado de ponta a ponta em o-desconto-do-cupom-e-arredondado-ao-centavo-viva.cjs). Repetir e' no-op.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos sao montados de literais deste arquivo (as migrations do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PASTA = path.join(__dirname, "..", "..", "supabase", "migrations");
const NOME = "20261397000000_o_desconto_do_cupom_e_arredondado_ao_centavo.sql";

const ASSINATURA_PEDIDO =
  "(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";
const FUNCOES = Object.freeze([
  {
    nome: "create_marketplace_order_v23",
    assinatura: `public.create_marketplace_order_v23${ASSINATURA_PEDIDO}`,
    delim: "$function$",
    anterior: "20261394200000_a_v23_recusa_o_pagamento_pelo_app.sql",
    hashAntes: "86a30fe3502bbafd1a507ce03189bc2d",
    hashDesta: "54b591dc09d67f1abbc9ab3ba5f62f5e",
  },
  {
    nome: "create_marketplace_order_v24",
    assinatura: `public.create_marketplace_order_v24${ASSINATURA_PEDIDO}`,
    delim: "$function$",
    anterior: "20261394000000_o_pedido_de_visitante_na_entrega_tem_freio.sql",
    hashAntes: "36c80a107f3ed16853c1c5b2b0cbc911",
    hashDesta: "541a210e52ea22fe67e35f2bdd9ef444",
  },
  {
    nome: "validate_coupon_secure_v2",
    assinatura: "public.validate_coupon_secure_v2(text,numeric)",
    delim: "$$",
    anterior: "20261208000000_o_checkout_mostra_os_cupons_da_cliente.sql",
    hashAntes: "24b35a0fbca43b1f47c7aa940af761af",
    hashDesta: "61b90bb7f7c9729abeb94b5596914eb4",
  },
]);

/** O CREATE OR REPLACE inteiro (do cabecalho ao fechamento) da funcao, como a migration anterior o deixa. */
function definicaoDe(f) {
  const t = fs.readFileSync(path.join(PASTA, f.anterior), "utf8");
  const ini = t.indexOf(`CREATE OR REPLACE FUNCTION public.${f.nome}(`);
  assert.ok(ini >= 0, `${f.anterior}: sem ${f.nome}`);
  const fecha = t.indexOf(`\n${f.delim};`, ini);
  assert.ok(fecha > ini, `${f.anterior}: sem o fechamento de ${f.nome}`);
  return t.slice(ini, fecha + 1 + f.delim.length + 1);
}

const hashDe = async (c, f) =>
  (
    await c.query(
      "SELECT md5(replace(prosrc, chr(13), '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [f.assinatura],
    )
  ).rows[0]?.h;

const DESCONTO_DO_CUPOM = Object.freeze({
  nome: NOME,
  funcoes: FUNCOES,
  definicaoDe,
  /** "No ar" = ao menos UMA das tres funcoes tem o corpo desta migration. */
  noAr: `SELECT EXISTS (
    SELECT 1 FROM (VALUES
      ('${FUNCOES[0].assinatura}', '${FUNCOES[0].hashDesta}'),
      ('${FUNCOES[1].assinatura}', '${FUNCOES[1].hashDesta}'),
      ('${FUNCOES[2].assinatura}', '${FUNCOES[2].hashDesta}')
    ) v(assinatura, hash)
    WHERE (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure(v.assinatura)) = v.hash
  ) AS sim`,
});

/**
 * Devolve cada funcao ao corpo de antes desta migration, na transacao aberta, SE o corpo vivo dela for o desta. Repetir e' no-op.
 * Devolve quantas funcoes voltaram.
 */
async function desfazerODescontoDoCupomNaTransacao(cliente) {
  let desfeitas = 0;
  for (const f of FUNCOES) {
    if ((await hashDe(cliente, f)) !== f.hashDesta) continue;
    await cliente.query(definicaoDe(f));
    assert.equal(
      await hashDe(cliente, f),
      f.hashAntes,
      `reinstalar o corpo de ${f.anterior} nao devolveu ${f.nome} ao corpo de antes da 20261397000000; revise as sucessoras`,
    );
    desfeitas += 1;
  }
  return desfeitas;
}

module.exports = { DESCONTO_DO_CUPOM, desfazerODescontoDoCupomNaTransacao };
