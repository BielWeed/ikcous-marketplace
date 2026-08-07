#!/usr/bin/env node
/**
 * Prova a `confirmar_pagamento` da Fase 3 (CHECKOUT-060).
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado.
 * Isso so e verdade porque a migration NAO tem COMMIT embutido — se alguem
 * acrescentar um, este script passa a gravar em producao sem avisar.
 *
 * Cada caso deste script e uma linha da tabela de decisao do brief da Task 2.
 * `gateway_payment_id` e UNICO (indice parcial da 20260807000000), entao um
 * mesmo valor ('MP1', por exemplo) so pode viver em UM pedido por vez — os
 * casos que reaproveitam o mesmo `gateway_payment_id` reaproveitam o MESMO
 * pedido, na ordem da tabela, em vez de criar um pedido novo.
 */
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { Client } = require("pg");

const RAIZ = path.resolve(__dirname, "..");

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(RAIZ, arquivo);
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    if (!fs.existsSync(caminho)) continue;
    // eslint-disable-next-line security/detect-non-literal-fs-filename
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

let passou = 0;
let falhou = 0;

function conferir(nome, condicao, detalhe) {
  if (condicao) {
    passou++;
    console.log(`  ok   ${nome}`);
  } else {
    falhou++;
    console.error(`  FALHA ${nome}${detalhe ? ` — ${detalhe}` : ""}`);
  }
}

async function criarProduto(client, nome, estoque) {
  // `custo` e NOT NULL sem default nesta tabela — omitir quebra o INSERT.
  const r = await client.query(
    `INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria)
     VALUES ($1, 5.00, 10.00, $2, 'teste')
     RETURNING id`,
    [nome, estoque],
  );
  return r.rows[0].id;
}

async function criarPedido(client, { nome, paymentStatus, status, gatewayPaymentId }) {
  // `customer_data` (jsonb) e `subtotal` sao NOT NULL sem default nesta
  // tabela — omitir qualquer um dos dois quebra o INSERT.
  const r = await client.query(
    `INSERT INTO public.marketplace_orders
       (total, subtotal, status, payment_status, gateway_payment_id,
        customer_name, customer_data)
     VALUES (10.00, 10.00, $1, $2, $3, $4, '{}'::jsonb)
     RETURNING id`,
    [status, paymentStatus, gatewayPaymentId, nome],
  );
  return r.rows[0].id;
}

async function estadoPedido(client, pedidoId) {
  const r = await client.query(
    `SELECT payment_status, status, paid_at
       FROM public.marketplace_orders
      WHERE id = $1`,
    [pedidoId],
  );
  return r.rows[0];
}

async function estoqueDe(client, produtoId) {
  const r = await client.query(
    "SELECT estoque FROM public.produtos WHERE id = $1",
    [produtoId],
  );
  return r.rows[0].estoque;
}

async function confirmar(client, pedidoId, paymentId, status) {
  const r = await client.query(
    "SELECT public.confirmar_pagamento($1, $2, $3) AS resultado",
    [pedidoId, paymentId, status],
  );
  return r.rows[0].resultado;
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN");

  try {
    console.log("\n=== confirmar_pagamento ===");

    // --- caso 1: 'aguardando' + ('MP1','pago') -> 'pago' -------------------
    const produto1 = await criarProduto(client, "PROVA CONFIRMAR PAGO", 5);
    const pedido1 = await criarPedido(client, {
      nome: "PROVA PAGO",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP1",
    });

    const r1 = await confirmar(client, pedido1, "MP1", "pago");
    conferir("aguardando + pago -> 'pago'", r1 === "pago", `veio ${r1}`);

    const estado1 = await estadoPedido(client, pedido1);
    conferir(
      "paid_at carimbado na confirmacao",
      estado1.paid_at !== null,
    );
    const paidAtOriginal = estado1.paid_at;

    conferir(
      "estoque intacto ao confirmar pagamento",
      (await estoqueDe(client, produto1)) === 5,
    );

    // --- caso 2: mesmo pedido, 'pago' de novo -> 'ja_pago' (idempotencia) --
    const r2 = await confirmar(client, pedido1, "MP1", "pago");
    conferir("segunda confirmacao -> 'ja_pago'", r2 === "ja_pago", `veio ${r2}`);

    const estado2 = await estadoPedido(client, pedido1);
    conferir(
      "paid_at inalterado na segunda confirmacao",
      estado2.paid_at.getTime() === paidAtOriginal.getTime(),
    );

    // --- caso 3: 'expirado' + ('MP2','pago') -> 'pago_apos_expirar' --------
    // A varredura ja ganhou a corrida (ver linhas 87-95 da 20260807000000):
    // estoque JA voltou, status JA e 'cancelled'. A funcao so pode marcar e
    // chamar uma pessoa — nunca mexer em estoque ou desfazer o cancelamento.
    const produto2 = await criarProduto(client, "PROVA CONFIRMAR EXPIRADO", 8);
    const pedido2 = await criarPedido(client, {
      nome: "PROVA EXPIRADO",
      paymentStatus: "expirado",
      status: "cancelled",
      gatewayPaymentId: "MP2",
    });

    const r3 = await confirmar(client, pedido2, "MP2", "pago");
    conferir(
      "expirado + pago -> 'pago_apos_expirar'",
      r3 === "pago_apos_expirar",
      `veio ${r3}`,
    );

    const estado3 = await estadoPedido(client, pedido2);
    conferir(
      "status continua 'cancelled' (nao desfaz o cancelamento)",
      estado3.status === "cancelled",
    );
    conferir(
      "estoque inalterado (a varredura ja devolveu)",
      (await estoqueDe(client, produto2)) === 8,
    );

    // --- caso 4: 'aguardando' com 3 unidades reservadas + recusado ---------
    const produto3 = await criarProduto(client, "PROVA CONFIRMAR RECUSADO", 2);
    const pedido3 = await criarPedido(client, {
      nome: "PROVA RECUSADO",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP3",
    });
    await client.query(
      `INSERT INTO public.marketplace_order_items
         (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'PROVA CONFIRMAR RECUSADO', 3, 10.00)`,
      [pedido3, produto3],
    );

    const r4 = await confirmar(client, pedido3, "MP3", "recusado");
    conferir("aguardando + recusado -> 'recusado'", r4 === "recusado", `veio ${r4}`);

    conferir(
      "estoque devolvido (+3) ao recusar",
      (await estoqueDe(client, produto3)) === 5,
    );
    const estado4 = await estadoPedido(client, pedido3);
    conferir(
      "status vira 'cancelled' ao recusar",
      estado4.status === "cancelled",
    );

    // --- caso 5: pedido ja 'recusado' + recusado de novo -> 'ignorado' -----
    // A prova de que devolver_estoque (nao idempotente) NAO e chamada de novo.
    const r5 = await confirmar(client, pedido3, "MP3", "recusado");
    conferir("recusado de novo -> 'ignorado'", r5 === "ignorado", `veio ${r5}`);
    conferir(
      "estoque NAO e creditado uma segunda vez",
      (await estoqueDe(client, produto3)) === 5,
    );

    // --- caso 6: pedido 'pago' + estornado -> 'estornado' -------------------
    const r6 = await confirmar(client, pedido1, "MP1", "estornado");
    conferir("pago + estornado -> 'estornado'", r6 === "estornado", `veio ${r6}`);
    conferir(
      "estorno nao mexe em estoque",
      (await estoqueDe(client, produto1)) === 5,
    );

    // --- caso 7: gateway_payment_id nao bate -> 'divergente' ---------------
    const antesDivergente = await estadoPedido(client, pedido1);
    const r7 = await confirmar(client, pedido1, "OUTRO", "pago");
    conferir("payment_id divergente -> 'divergente'", r7 === "divergente", `veio ${r7}`);
    const depoisDivergente = await estadoPedido(client, pedido1);
    conferir(
      "payment_status inalterado quando o payment_id diverge",
      depoisDivergente.payment_status === antesDivergente.payment_status,
    );

    // --- caso 8: pedido inexistente -> 'inexistente' ------------------------
    const r8 = await confirmar(client, crypto.randomUUID(), "X", "pago");
    conferir("id inexistente -> 'inexistente'", r8 === "inexistente", `veio ${r8}`);
  } finally {
    await client.query("ROLLBACK");
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
