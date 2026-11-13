"use strict";

/**
 * A 20261399997000 (o pedido guarda quem vai receber) redefine DUAS funcoes, cada uma em cima do corpo que a 20261397000000 (o desconto do
 * cupom e' arredondado ao centavo) deixou, acrescentando UMA chave (recipient_name) a copia do endereco salvo para dentro do pedido (o
 * bloco 6-bis):
 *   - create_marketplace_order_v23: o corpo da 20261397000000;
 *   - create_marketplace_order_v24: o corpo da 20261397000000.
 *
 * Ela e' a mais nova da cadeia: o pre-voo do rollback da 20261397000000 (e, por tras, o das anteriores) recusa (B1_BASELINE_DIVERGENT) com o
 * corpo dela no ar, e e' o comportamento CERTO (nunca restaurar por baixo de uma redefinicao posterior). Por isso toda prova viva que mede
 * uma migration anterior ISOLADA (o hash do corpo, o rollback, reaplicar) tem de devolver ANTES as funcoes ao corpo de antes desta.
 * o-desconto-do-cupom-posterior.cjs chama este modulo PRIMEIRO, entao a cadeia de provas historicas (229/236/244, 350, 384, 394, 394200 e 397)
 * nao precisa saber dele.
 *
 * O corpo de antes e' reinstalado funcao por funcao, por CREATE OR REPLACE do texto da migration anterior (lido do arquivo), e SO nas
 * funcoes cujo corpo vivo for o desta migration. Repetir e' no-op.
 *
 * So nos clones efemeros: o chamador decide BEGIN/COMMIT/ROLLBACK; nao muda dado, assinatura nem ACL.
 */

/* eslint-disable security/detect-non-literal-fs-filename --
 * Os caminhos sao montados de literais deste arquivo (as migrations do repositorio). */

const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const PASTA = path.join(__dirname, "..", "..", "supabase", "migrations");
const NOME = "20261399997000_o_pedido_guarda_quem_vai_receber.sql";
const ANTERIOR =
  "20261397000000_o_desconto_do_cupom_e_arredondado_ao_centavo.sql";

const ASSINATURA_PEDIDO =
  "(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)";
const FUNCOES = Object.freeze([
  {
    nome: "create_marketplace_order_v23",
    assinatura: `public.create_marketplace_order_v23${ASSINATURA_PEDIDO}`,
    delim: "$function$",
    anterior: ANTERIOR,
    hashAntes: "54b591dc09d67f1abbc9ab3ba5f62f5e",
    hashDesta: "a20220f6946409590654938f96b12a27",
  },
  {
    nome: "create_marketplace_order_v24",
    assinatura: `public.create_marketplace_order_v24${ASSINATURA_PEDIDO}`,
    delim: "$function$",
    anterior: ANTERIOR,
    hashAntes: "541a210e52ea22fe67e35f2bdd9ef444",
    hashDesta: "3e711f7cc9c94894a21024b34d0ed3b4",
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

const QUEM_VAI_RECEBER = Object.freeze({
  nome: NOME,
  funcoes: FUNCOES,
  definicaoDe,
  /** "No ar" = ao menos UMA das duas funcoes tem o corpo desta migration. */
  noAr: `SELECT EXISTS (
    SELECT 1 FROM (VALUES
      ('${FUNCOES[0].assinatura}', '${FUNCOES[0].hashDesta}'),
      ('${FUNCOES[1].assinatura}', '${FUNCOES[1].hashDesta}')
    ) v(assinatura, hash)
    WHERE (SELECT md5(replace(prosrc, chr(13), '')) FROM pg_proc WHERE oid = to_regprocedure(v.assinatura)) = v.hash
  ) AS sim`,
});

/**
 * Devolve cada funcao ao corpo de antes desta migration, na transacao aberta, SE o corpo vivo dela for o desta. Repetir e' no-op.
 * Devolve quantas funcoes voltaram.
 */
async function desfazerQuemVaiReceberNaTransacao(cliente) {
  let desfeitas = 0;
  for (const f of FUNCOES) {
    if ((await hashDe(cliente, f)) !== f.hashDesta) continue;
    await cliente.query(definicaoDe(f));
    assert.equal(
      await hashDe(cliente, f),
      f.hashAntes,
      `reinstalar o corpo de ${f.anterior} nao devolveu ${f.nome} ao corpo de antes da 20261399997000; revise as sucessoras`,
    );
    desfeitas += 1;
  }
  return desfeitas;
}

module.exports = { QUEM_VAI_RECEBER, desfazerQuemVaiReceberNaTransacao };
