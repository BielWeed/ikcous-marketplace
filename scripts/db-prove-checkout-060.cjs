#!/usr/bin/env node
/**
 * Prova a `confirmar_pagamento` da Fase 3 (CHECKOUT-060).
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado.
 * Isso so e verdade porque a migration NAO tem COMMIT embutido — se alguem
 * acrescentar um, este script passa a gravar em producao sem avisar.
 *
 * Cada caso deste script e uma linha da tabela de decisao do brief da Task 2
 * (regerado em 07/08/2026, apos a revisao que achou dois defeitos reais no
 * SQL do plano). Duas regras vieram da revisao e valem para TODOS os casos:
 *
 * 1. TODO pedido montado leva item de verdade em marketplace_order_items
 *    (product_id, quantity > 0) — inclusive os casos cuja asserção e
 *    "estoque intacto". Na primeira versao, criarPedido() nao inseria item
 *    nenhum: devolver_estoque devolvia 0 e as asserções de "estoque
 *    intacto" passavam MESMO com o mecanismo invertido (a revisao mutou o
 *    ramo do estorno para creditar estoque e a prova continuou verde).
 * 2. CADA caso monta o proprio pedido — nao reaproveita o pedido de um caso
 *    anterior. `gateway_payment_id` e UNICO (indice parcial da
 *    20260807000000), entao cada caso usa um valor diferente. Na primeira
 *    versao, os casos 2, 6 e 7 dependiam do estado deixado pelos anteriores
 *    no MESMO pedido: mudar um mudava o significado dos outros em silencio.
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

/**
 * Monta um pedido com item de verdade. `quantity` e a quantidade reservada
 * no item — TODO pedido leva item, mesmo os casos que so provam "estoque
 * intacto" (ver cabecalho do arquivo, regra 1).
 */
async function criarPedido(
  client,
  { nome, paymentStatus, status, gatewayPaymentId, produtoId, quantity },
) {
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
  const pedidoId = r.rows[0].id;
  await client.query(
    `INSERT INTO public.marketplace_order_items
       (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, $3, $4, 10.00)`,
    [pedidoId, produtoId, nome, quantity],
  );
  return pedidoId;
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
      produtoId: produto1,
      quantity: 2,
    });

    const r1 = await confirmar(client, pedido1, "MP1", "pago");
    conferir("aguardando + pago -> 'pago'", r1 === "pago", `veio ${r1}`);

    const estado1 = await estadoPedido(client, pedido1);
    conferir("paid_at carimbado na confirmacao", estado1.paid_at !== null);
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
    const produto3 = await criarProduto(client, "PROVA CONFIRMAR EXPIRADO", 8);
    const pedido3 = await criarPedido(client, {
      nome: "PROVA EXPIRADO",
      paymentStatus: "expirado",
      status: "cancelled",
      gatewayPaymentId: "MP2",
      produtoId: produto3,
      quantity: 1,
    });

    const r3 = await confirmar(client, pedido3, "MP2", "pago");
    conferir(
      "expirado + pago -> 'pago_apos_expirar'",
      r3 === "pago_apos_expirar",
      `veio ${r3}`,
    );

    const estado3 = await estadoPedido(client, pedido3);
    conferir(
      "status continua 'cancelled' (nao desfaz o cancelamento)",
      estado3.status === "cancelled",
    );
    conferir(
      "estoque inalterado (a varredura ja devolveu)",
      (await estoqueDe(client, produto3)) === 8,
    );

    // --- caso 4: 'aguardando' com 3 unidades reservadas + recusado ---------
    const produto4 = await criarProduto(client, "PROVA CONFIRMAR RECUSADO", 2);
    const pedido4 = await criarPedido(client, {
      nome: "PROVA RECUSADO",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP3",
      produtoId: produto4,
      quantity: 3,
    });

    const r4 = await confirmar(client, pedido4, "MP3", "recusado");
    conferir("aguardando + recusado -> 'recusado'", r4 === "recusado", `veio ${r4}`);

    conferir(
      "estoque devolvido (+3) ao recusar",
      (await estoqueDe(client, produto4)) === 5,
    );
    const estado4 = await estadoPedido(client, pedido4);
    conferir("status vira 'cancelled' ao recusar", estado4.status === "cancelled");

    // --- caso 5: pedido ja 'recusado' + recusado de novo -> 'ignorado' -----
    // A prova de que devolver_estoque (nao idempotente) NAO e chamada de novo.
    const r5 = await confirmar(client, pedido4, "MP3", "recusado");
    conferir("recusado de novo -> 'ignorado'", r5 === "ignorado", `veio ${r5}`);
    conferir(
      "estoque NAO e creditado uma segunda vez",
      (await estoqueDe(client, produto4)) === 5,
    );

    // --- caso 6: 'pago' com 3 unidades + estornado -> 'estornado' ----------
    // A partir de 'pago' a mercadoria pode ja ter saido: estornar NAO mexe
    // em estoque.
    const produto6 = await criarProduto(client, "PROVA ESTORNO DE PAGO", 4);
    const pedido6 = await criarPedido(client, {
      nome: "PROVA ESTORNO DE PAGO",
      paymentStatus: "pago",
      status: "processing",
      gatewayPaymentId: "MP4",
      produtoId: produto6,
      quantity: 3,
    });

    const r6 = await confirmar(client, pedido6, "MP4", "estornado");
    conferir("pago + estornado -> 'estornado'", r6 === "estornado", `veio ${r6}`);
    conferir(
      "estorno a partir de 'pago' nao mexe em estoque (pode ter saido)",
      (await estoqueDe(client, produto6)) === 4,
    );

    // --- caso 7: 'aguardando' com 3 unidades + estornado -> 'estornado' ----
    // O achado 2 da revisao de 07/08/2026: a partir de 'aguardando' NADA
    // saiu, entao estornar tem que DEVOLVER o estoque e CANCELAR o pedido —
    // senao a reserva fica presa para sempre (expirar_pedidos_vencidos so
    // varre 'aguardando', e o pedido deixou de estar 'aguardando').
    const produto7 = await criarProduto(client, "PROVA ESTORNO DE AGUARDANDO", 1);
    const pedido7 = await criarPedido(client, {
      nome: "PROVA ESTORNO DE AGUARDANDO",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP5",
      produtoId: produto7,
      quantity: 3,
    });

    const r7 = await confirmar(client, pedido7, "MP5", "estornado");
    conferir(
      "aguardando + estornado -> 'estornado'",
      r7 === "estornado",
      `veio ${r7}`,
    );
    conferir(
      "estoque devolvido (+3) ao estornar a partir de 'aguardando'",
      (await estoqueDe(client, produto7)) === 4,
    );
    const estado7 = await estadoPedido(client, pedido7);
    conferir(
      "status vira 'cancelled' ao estornar a partir de 'aguardando'",
      estado7.status === "cancelled",
    );

    // --- caso 8: mesmo pedido, estornado de novo -> 'ja_estornado' ---------
    const r8 = await confirmar(client, pedido7, "MP5", "estornado");
    conferir("estornado de novo -> 'ja_estornado'", r8 === "ja_estornado", `veio ${r8}`);
    conferir(
      "estoque NAO e creditado uma segunda vez no reestorno",
      (await estoqueDe(client, produto7)) === 4,
    );

    // --- caso 9: 'aguardando' + payment_id que nao bate -> 'divergente' ----
    const produto9 = await criarProduto(client, "PROVA DIVERGENTE", 5);
    const pedido9 = await criarPedido(client, {
      nome: "PROVA DIVERGENTE",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP6",
      produtoId: produto9,
      quantity: 1,
    });

    const antesDivergente = await estadoPedido(client, pedido9);
    const r9 = await confirmar(client, pedido9, "OUTRO", "pago");
    conferir("payment_id divergente -> 'divergente'", r9 === "divergente", `veio ${r9}`);
    const depoisDivergente = await estadoPedido(client, pedido9);
    conferir(
      "payment_status inalterado quando o payment_id diverge",
      depoisDivergente.payment_status === antesDivergente.payment_status,
    );

    // --- caso 10: 'aguardando' SEM gateway_payment_id + p_payment_id NULL --
    // O achado 1 da revisao: IS DISTINCT FROM sozinho trata NULL/NULL como
    // igual, e essa e' a combinacao NORMAL de todo pedido entre o checkout e
    // a criacao da cobranca. Sem as duas clausulas extras, isto virava
    // 'pago' com paid_at carimbado e nenhum pagamento de verdade.
    const produto10 = await criarProduto(client, "PROVA NULL/NULL", 5);
    const pedido10 = await criarPedido(client, {
      nome: "PROVA NULL/NULL",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: null,
      produtoId: produto10,
      quantity: 1,
    });

    const r10 = await confirmar(client, pedido10, null, "pago");
    conferir(
      "aguardando sem gateway_payment_id + payment_id NULL -> 'divergente' (nao 'pago')",
      r10 === "divergente",
      `veio ${r10}`,
    );
    const estado10 = await estadoPedido(client, pedido10);
    conferir(
      "payment_status/paid_at inalterados no par NULL/NULL",
      estado10.payment_status === "aguardando" && estado10.paid_at === null,
    );

    // --- caso 11: 'aguardando' com gateway_payment_id + p_payment_id NULL --
    const produto11 = await criarProduto(client, "PROVA PAYMENT_ID NULL", 5);
    const pedido11 = await criarPedido(client, {
      nome: "PROVA PAYMENT_ID NULL",
      paymentStatus: "aguardando",
      status: "pending",
      gatewayPaymentId: "MP7",
      produtoId: produto11,
      quantity: 1,
    });

    const r11 = await confirmar(client, pedido11, null, "pago");
    conferir(
      "gateway_payment_id preenchido + payment_id NULL -> 'divergente'",
      r11 === "divergente",
      `veio ${r11}`,
    );

    // --- caso 12: pedido inexistente -> 'inexistente' ----------------------
    const r12 = await confirmar(client, crypto.randomUUID(), "X", "pago");
    conferir("id inexistente -> 'inexistente'", r12 === "inexistente", `veio ${r12}`);
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
