#!/usr/bin/env node
/**
 * Prova as funcoes da Fase 1 (CHECKOUT-010 #109).
 *
 * TUDO roda em UMA transacao terminada em ROLLBACK. Nada e gravado.
 * Isso so e verdade porque a migration NAO tem COMMIT embutido — se alguem
 * acrescentar um, este script passa a gravar em producao sem avisar.
 */
const fs = require("node:fs");
const path = require("node:path");
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

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN");

  try {
    console.log("\n=== devolver_estoque ===");

    // `custo` e NOT NULL sem default nesta tabela — omitir quebra o INSERT.
    const prod = await client.query(`
      INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria)
      VALUES ('PROVA CHECKOUT-010', 5.00, 10.00, 5, 'teste')
      RETURNING id, estoque
    `);
    const produtoId = prod.rows[0].id;

    // `customer_data` (jsonb) e `subtotal` sao NOT NULL sem default nesta
    // tabela — omitir qualquer um dos dois quebra o INSERT. E por isso que os
    // outros db-prove-*.cjs criam pedido pela RPC em vez de INSERT cru.
    const ped = await client.query(`
      INSERT INTO public.marketplace_orders
        (total, subtotal, status, payment_status, customer_name, customer_data)
      VALUES (20.00, 20.00, 'pending', 'aguardando', 'PROVA', '{}'::jsonb)
      RETURNING id
    `);
    const pedidoId = ped.rows[0].id;

    await client.query(
      `INSERT INTO public.marketplace_order_items
         (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'PROVA CHECKOUT-010', 2, 10.00)`,
      [pedidoId, produtoId],
    );

    await client.query(
      "UPDATE public.produtos SET estoque = estoque - 2 WHERE id = $1",
      [produtoId],
    );

    const devolvidas = await client.query(
      "SELECT public.devolver_estoque($1) AS unidades",
      [pedidoId],
    );
    conferir(
      "devolve o numero de unidades do pedido",
      devolvidas.rows[0].unidades === 2,
      `veio ${devolvidas.rows[0].unidades}`,
    );

    const depois = await client.query(
      "SELECT estoque FROM public.produtos WHERE id = $1",
      [produtoId],
    );
    conferir(
      "estoque volta ao valor original",
      depois.rows[0].estoque === 5,
      `veio ${depois.rows[0].estoque}`,
    );

    // Item de VARIANTE: a linha carrega product_id E variant_id, porque e assim
    // que a v23 grava. Como o debito dela e XOR, a devolucao tambem tem de ser —
    // creditar os dois infla o catalogo. Este par de asserts e a trava disso.
    const prodVar = await client.query(`
      INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria)
      VALUES ('PROVA VARIANTE', 5.00, 10.00, 7, 'teste')
      RETURNING id
    `);
    const produtoVarId = prodVar.rows[0].id;

    const variante = await client.query(
      `INSERT INTO public.product_variants (product_id, name, value, stock_increment)
       VALUES ($1, 'Tamanho', 'M', 4)
       RETURNING id`,
      [produtoVarId],
    );
    const varianteId = variante.rows[0].id;

    const pedVar = await client.query(`
      INSERT INTO public.marketplace_orders
        (total, subtotal, status, payment_status, customer_name, customer_data)
      VALUES (10.00, 10.00, 'pending', 'aguardando', 'PROVA VARIANTE', '{}'::jsonb)
      RETURNING id
    `);
    await client.query(
      `INSERT INTO public.marketplace_order_items
         (order_id, product_id, variant_id, product_name, quantity, price)
       VALUES ($1, $2, $3, 'PROVA VARIANTE', 1, 10.00)`,
      [pedVar.rows[0].id, produtoVarId, varianteId],
    );
    await client.query(
      "UPDATE public.product_variants SET stock_increment = stock_increment - 1 WHERE id = $1",
      [varianteId],
    );

    await client.query("SELECT public.devolver_estoque($1)", [
      pedVar.rows[0].id,
    ]);

    const varDepois = await client.query(
      "SELECT stock_increment FROM public.product_variants WHERE id = $1",
      [varianteId],
    );
    conferir(
      "variante volta ao estoque original",
      varDepois.rows[0].stock_increment === 4,
      `veio ${varDepois.rows[0].stock_increment}`,
    );

    const paiDepois = await client.query(
      "SELECT estoque FROM public.produtos WHERE id = $1",
      [produtoVarId],
    );
    conferir(
      "produto pai da variante NAO e creditado",
      paiDepois.rows[0].estoque === 7,
      `veio ${paiDepois.rows[0].estoque}, esperava 7 — creditar os dois infla o catalogo`,
    );

    console.log("\n=== expirar_pedidos_vencidos ===");

    // Pedido VENCIDO: deve ser expirado e devolver estoque.
    const prod2 = await client.query(`
      INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria)
      VALUES ('PROVA EXPIRACAO', 5.00, 10.00, 3, 'teste')
      RETURNING id
    `);
    const produto2 = prod2.rows[0].id;

    const vencido = await client.query(`
      INSERT INTO public.marketplace_orders
        (total, subtotal, status, payment_status, expires_at, customer_name, customer_data)
      VALUES (10.00, 10.00, 'pending', 'aguardando', now() - interval '1 minute', 'VENCIDO', '{}'::jsonb)
      RETURNING id
    `);
    await client.query(
      `INSERT INTO public.marketplace_order_items
         (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'PROVA EXPIRACAO', 1, 10.00)`,
      [vencido.rows[0].id, produto2],
    );

    // Pedido AINDA NO PRAZO: nao pode ser tocado.
    const noPrazo = await client.query(`
      INSERT INTO public.marketplace_orders
        (total, subtotal, status, payment_status, expires_at, customer_name, customer_data)
      VALUES (10.00, 10.00, 'pending', 'aguardando', now() + interval '20 minutes', 'NO PRAZO', '{}'::jsonb)
      RETURNING id
    `);

    // Pedido HISTORICO (payment_status NULL): nao pode ser tocado.
    const historico = await client.query(`
      INSERT INTO public.marketplace_orders
        (total, subtotal, status, customer_name, customer_data)
      VALUES (10.00, 10.00, 'pending', 'HISTORICO', '{}'::jsonb)
      RETURNING id
    `);

    // Pedido JA CANCELADO pelo cliente, e vencido depois. A
    // update_order_status_atomic ja devolveu o estoque no cancelamento e NAO
    // escreve payment_status, entao a linha continua 'aguardando'. Se a
    // varredura agir sobre ela, credita o estoque uma SEGUNDA vez — catalogo
    // com mais unidade do que existe. Este assert e' a trava disso.
    const prod3 = await client.query(`
      INSERT INTO public.produtos (nome, custo, preco_venda, estoque, categoria)
      VALUES ('PROVA JA CANCELADO', 5.00, 10.00, 9, 'teste')
      RETURNING id
    `);
    const produto3 = prod3.rows[0].id;

    const jaCancelado = await client.query(`
      INSERT INTO public.marketplace_orders
        (total, subtotal, status, payment_status, expires_at, customer_name, customer_data)
      VALUES (10.00, 10.00, 'cancelled', 'aguardando', now() - interval '1 minute', 'JA CANCELADO', '{}'::jsonb)
      RETURNING id
    `);
    await client.query(
      `INSERT INTO public.marketplace_order_items
         (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'PROVA JA CANCELADO', 2, 10.00)`,
      [jaCancelado.rows[0].id, produto3],
    );

    await client.query("SELECT public.expirar_pedidos_vencidos()");

    const est3 = await client.query(
      "SELECT estoque FROM public.produtos WHERE id = $1",
      [produto3],
    );
    conferir(
      "pedido ja cancelado NAO e creditado de novo",
      est3.rows[0].estoque === 9,
      `veio ${est3.rows[0].estoque}, esperava 9 — a varredura creditou em dobro`,
    );

    const est2 = await client.query(
      "SELECT estoque FROM public.produtos WHERE id = $1",
      [produto2],
    );
    conferir(
      "expiracao devolve o estoque do pedido vencido",
      est2.rows[0].estoque === 4,
      `veio ${est2.rows[0].estoque}, esperava 4 (3 + 1 devolvida)`,
    );

    const estados = await client.query(
      `SELECT id, status, payment_status FROM public.marketplace_orders
        WHERE id = ANY($1::uuid[])`,
      [[vencido.rows[0].id, noPrazo.rows[0].id, historico.rows[0].id]],
    );
    const por = (id) => estados.rows.find((r) => r.id === id);

    conferir(
      "vencido vira expirado e cancelado",
      por(vencido.rows[0].id).payment_status === "expirado" &&
        por(vencido.rows[0].id).status === "cancelled",
    );
    conferir(
      "pedido no prazo NAO e tocado",
      por(noPrazo.rows[0].id).payment_status === "aguardando" &&
        por(noPrazo.rows[0].id).status === "pending",
    );
    conferir(
      "pedido historico (payment_status NULL) NAO e tocado",
      por(historico.rows[0].id).payment_status === null &&
        por(historico.rows[0].id).status === "pending",
    );

    console.log("\n=== create_marketplace_order_v24 ===");

    const assinatura = await client.query(`
      SELECT pg_get_function_identity_arguments(p.oid) AS args
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v24'
    `);
    conferir(
      "v24 existe com os 12 argumentos da v23",
      assinatura.rowCount === 1 &&
        assinatura.rows[0].args.split(",").length === 12,
      `veio ${assinatura.rows[0]?.args ?? "(nao existe)"}`,
    );

    const corpo = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = 'create_marketplace_order_v24'
    `);
    // `?.` importa: sem ele, v24 ausente estoura TypeError e derruba o script
    // inteiro — some a contagem final e os asserts anteriores viram silêncio.
    conferir(
      "v24 carimba payment_status aguardando",
      corpo.rows[0]?.def?.includes("'aguardando'") ?? false,
    );
    conferir(
      "v24 carimba expiracao de 30 minutos",
      corpo.rows[0]?.def?.includes("interval '30 minutes'") ?? false,
    );
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
