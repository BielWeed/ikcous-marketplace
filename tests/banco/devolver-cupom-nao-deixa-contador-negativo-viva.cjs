"use strict";

/**
 * PROVA VIVA: devolver o uso do cupom de um pedido morto nao deixa o
 * contador negativo, mesmo se ele JA esta em zero e a devolucao esta pendente.
 *
 * Usa a varredura REAL e devolver_uso_cupom do banco migrado.
 * So Postgres EFEMERO, pela trava de efemero.cjs e clone de rodar-isolado.cjs.
 * Fixtures e eventual mutante sao desfeitos pelo ROLLBACK de cada caso.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/devolver-cupom-nao-deixa-contador-negativo-viva.cjs
 *
 * CONTROLE VERMELHO: MUTANTE_CUPOM_SEM_PISO=1 remove so o GREATEST da
 * definicao VIVA de devolver_uso_cupom, dentro da transacao. O caso zero
 * deve falhar em "contador ficou negativo", com -1 em vez de 0.
 * Nenhuma migration versionada e alterada.
 */

const assert = require("node:assert/strict");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const CUPOM = "c1000a00-0000-4000-8000-000000000001";
const PEDIDO = "c1000a00-0000-4000-8000-000000000002";
const MUTANTE = process.env.MUTANTE_CUPOM_SEM_PISO === "1";
const CASOS = [
  { nome: "contador ja em zero continua zero ao devolver o cupom", usos: 0 },
  { nome: "controle: contador em um devolve uma vaga e fica zero", usos: 1 },
];

async function semear(c, usos) {
  await c.query(
    `INSERT INTO public.coupons
       (id, code, type, value, active, usage_count, usage_limit)
     VALUES ($1, 'PISOZERO-FICTICIO', 'fixed', 10, true, $2, 1)`,
    [CUPOM, usos],
  );
  // Pedido historico ficticio ja cancelado, sem envio, com PIX vencido ha
  // mais de 24 h: elegivel tambem na versao mais nova da varredura.
  // Insercao direta e intencional: reproduz o contador inconsistente sem
  // depender de uma compra atual criar a inconsistencia que queremos cobrir.
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, customer_name, customer_data, total, subtotal, shipping, discount,
        status, canal, payment_method, payment_status, coupon_id, coupon_code,
        coupon_usage_returned, expires_at, cancelled_after_shipping,
        gateway_payment_id, tentativas_de_pagamento)
     VALUES ($1, 'Pessoa ficticia Piso Zero', '{}'::jsonb, 90, 100, 0, 10,
             'cancelled', 'online', 'online', 'expirado', $2, 'PISOZERO-FICTICIO',
             false, now() - interval '25 hours', false, NULL, 0)`,
    [PEDIDO, CUPOM],
  );
}

async function estado(c) {
  return (
    await c.query(
      `SELECT c.usage_count, o.coupon_usage_returned
         FROM public.marketplace_orders o
         JOIN public.coupons c ON c.id = o.coupon_id
        WHERE o.id = $1 AND c.id = $2`,
      [PEDIDO, CUPOM],
    )
  ).rows[0];
}

async function removerPisoNaTransacao(c) {
  const definicao = (
    await c.query(
      "SELECT pg_get_functiondef('public.devolver_uso_cupom(uuid)'::regprocedure) AS sql",
    )
  ).rows[0].sql;
  const piso = /GREATEST\(\s*usage_count\s*-\s*1\s*,\s*0\s*\)/gi;
  assert.equal(
    (definicao.match(piso) || []).length,
    1,
    "o mutante precisa encontrar exatamente o piso zero de usage_count",
  );
  await c.query(definicao.replace(piso, "usage_count - 1"));
  const depois = (
    await c.query(
      "SELECT pg_get_functiondef('public.devolver_uso_cupom(uuid)'::regprocedure) AS sql",
    )
  ).rows[0].sql;
  assert.doesNotMatch(depois, piso, "o mutante nao removeu o piso zero");
}

async function varrer(c) {
  return (
    await c.query("SELECT public.devolver_cupons_de_pedidos_mortos() AS n")
  ).rows[0].n;
}

async function provar(c, caso) {
  await c.query("BEGIN");
  try {
    await semear(c, caso.usos);
    assert.deepEqual(
      await estado(c),
      { usage_count: caso.usos, coupon_usage_returned: false },
      "fixture precisa ter o contador solicitado e devolucao pendente",
    );
    if (MUTANTE) await removerPisoNaTransacao(c);

    assert.equal(await varrer(c), 1, "a varredura precisa alcancar o pedido");
    const depois = await estado(c);
    assert.equal(
      depois.coupon_usage_returned,
      true,
      "pedido nao foi marcado como cupom devolvido",
    );
    assert.equal(
      depois.usage_count,
      0,
      "contador ficou negativo ao devolver uso de cupom ja zerado",
    );

    assert.equal(await varrer(c), 0, "a segunda varredura devolveu novamente");
    assert.deepEqual(
      await estado(c),
      { usage_count: 0, coupon_usage_returned: true },
      "a segunda varredura mudou contador ou marca de devolucao",
    );
  } finally {
    await c.query("ROLLBACK");
  }
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  let falhas = 0;
  try {
    for (const caso of CASOS) {
      try {
        await provar(c, caso);
        console.log(`PASS: ${caso.nome}`);
      } catch (erro) {
        falhas += 1;
        console.error(`FAIL: ${caso.nome}\n${erro.stack || erro.message}`);
      }
    }
  } finally {
    await c.end();
  }
  const resumo = `${CASOS.length - falhas}/${CASOS.length} provas passaram${MUTANTE ? " (MUTANTE sem piso zero)" : ""}`;
  console.log(resumo);
  anexarAoSummary("Cupom devolvido: contador nunca negativo", resumo);
  if (falhas) falhar("REPROVADO", resumo);
}

main().catch((erro) => falhar("INDETERMINADO", erro.message));
