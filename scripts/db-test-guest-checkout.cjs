#!/usr/bin/env node
/**
 * Testa a regra de frete de create_marketplace_order_v22 SEM criar pedido.
 *
 * Cada cenário roda dentro de uma transação que termina em ROLLBACK. Nada é
 * persistido: nenhum pedido é criado, nenhum estoque é decrementado, nenhuma
 * configuração da loja fica alterada. Mesmo assim a função exercitada é a real,
 * com os preços e o estoque reais do banco.
 *
 * O que cada cenário verifica:
 *   1. Convidado abaixo do mínimo  -> paga frete. Sempre funcionou.
 *   2. Convidado acima do mínimo   -> paga frete. ERA O BUG: o banco zerava o
 *      frete sem olhar autenticação e recusava o pedido por divergência.
 *   3. Logado acima do mínimo      -> frete grátis, como a tela promete.
 *   4. Regra desligada (min = 0)   -> todo mundo paga frete. ERA O SEGUNDO BUG:
 *      o banco lia 0 como "grátis para todos" e derrubava 100% dos checkouts.
 *
 * USO:  node scripts/db-test-guest-checkout.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");

function lerDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  for (const arquivo of [".env.local", ".env"]) {
    const caminho = path.join(PROJECT_ROOT, arquivo);
    if (!fs.existsSync(caminho)) continue;
    const linha = fs
      .readFileSync(caminho, "utf8")
      .split(/\r?\n/)
      .find((l) => l.startsWith("DATABASE_URL="));
    if (linha) return linha.slice("DATABASE_URL=".length).replace(/^"|"$/g, "");
  }
  throw new Error("DATABASE_URL não encontrada.");
}

/**
 * Roda um cenário dentro de transação e SEMPRE desfaz.
 * @returns {Promise<{ok: boolean, mensagem: string, detalhe?: string}>}
 */
async function cenario(client, { titulo, userId, freeShippingMin, produto, quantidade, totalEnviado }) {
  try {
    await client.query("BEGIN");

    // Ajuste da regra só dentro da transação — some no ROLLBACK.
    await client.query("UPDATE public.store_config SET free_shipping_min = $1 WHERE id = 1", [
      freeShippingMin,
    ]);

    // auth.uid() lê request.jwt.claims. Sem claim => convidado.
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "",
    ]);

    const itens = JSON.stringify([
      { product_id: produto.id, variant_id: null, quantity: quantidade },
    ]);

    await client.query(
      `SELECT public.create_marketplace_order_v22(
         $1::jsonb, $2::numeric, $3::numeric, 'whatsapp', NULL, NULL,
         'Teste Automatizado', '5534999999999', 'ROLLBACK - teste', NULL)`,
      [itens, totalEnviado, 0],
    );

    await client.query("ROLLBACK");
    return { ok: true, mensagem: "pedido aceito" };
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => {});
    return { ok: false, mensagem: erro.message, detalhe: erro.detail };
  }
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: cfgRows } = await client.query(
    "SELECT free_shipping_min, shipping_fee FROM public.store_config WHERE id = 1",
  );
  const frete = Number(cfgRows[0].shipping_fee);

  // Produto real, ativo, com estoque e SEM frete grátis próprio
  // (senão o frete zeraria por outro caminho e o teste não provaria nada).
  const { rows: prodRows } = await client.query(
    `SELECT id, nome, preco_venda, estoque FROM public.produtos
      WHERE ativo = true AND deleted_at IS NULL
        AND COALESCE(frete_gratis, false) = false
        AND estoque >= 2
      ORDER BY preco_venda DESC LIMIT 1`,
  );
  if (prodRows.length === 0) {
    console.error("Nenhum produto ativo, com estoque >= 2 e sem frete grátis próprio.");
    await client.end();
    process.exit(1);
  }
  const produto = prodRows[0];
  const preco = Number(produto.preco_venda);
  const subtotal = preco * 2;

  const { rows: userRows } = await client.query(
    "SELECT id FROM auth.users ORDER BY created_at LIMIT 1",
  );
  const userId = userRows[0]?.id ?? null;

  console.log(`Produto de teste : ${produto.nome} (R$ ${preco.toFixed(2)}, estoque ${produto.estoque})`);
  console.log(`Carrinho         : 2 un = R$ ${subtotal.toFixed(2)}`);
  console.log(`Taxa de entrega  : R$ ${frete.toFixed(2)}`);
  console.log(`free_shipping_min real da loja: R$ ${Number(cfgRows[0].free_shipping_min).toFixed(2)}`);
  console.log(`Usuário para o caso logado: ${userId ? `${userId.slice(0, 8)}…` : "nenhum encontrado"}\n`);

  const cenarios = [
    {
      titulo: "1. Convidado, carrinho ABAIXO do mínimo -> paga frete",
      userId: null,
      freeShippingMin: subtotal + 100,
      totalEnviado: subtotal + frete,
      esperado: true,
    },
    {
      titulo: "2. Convidado, carrinho ACIMA do mínimo -> paga frete  [ERA O BUG]",
      userId: null,
      freeShippingMin: Math.max(1, subtotal - 1),
      totalEnviado: subtotal + frete,
      esperado: true,
    },
    {
      titulo: "3. Logado, carrinho ACIMA do mínimo -> frete grátis",
      userId,
      freeShippingMin: Math.max(1, subtotal - 1),
      totalEnviado: subtotal,
      esperado: true,
    },
    {
      titulo: "4. Regra desligada (min = 0) -> todo mundo paga frete  [ERA O BUG]",
      userId: null,
      freeShippingMin: 0,
      totalEnviado: subtotal + frete,
      esperado: true,
    },
  ];

  let falhas = 0;
  for (const c of cenarios) {
    if (c.userId === null && c.titulo.startsWith("3.")) {
      console.log(`${c.titulo}\n   PULADO (nenhum usuário no banco)\n`);
      continue;
    }
    const r = await cenario(client, { ...c, produto, quantidade: 2 });
    const passou = r.ok === c.esperado;
    if (!passou) falhas++;
    console.log(c.titulo);
    console.log(`   total enviado: R$ ${c.totalEnviado.toFixed(2)} | min: R$ ${Number(c.freeShippingMin).toFixed(2)}`);
    console.log(`   ${passou ? "PASSOU" : "FALHOU"} -> ${r.mensagem}`);
    if (r.detalhe) console.log(`   detalhe: ${r.detalhe}`);
    console.log("");
  }

  // Confirma que o ROLLBACK realmente preservou tudo.
  const { rows: depois } = await client.query(
    "SELECT free_shipping_min FROM public.store_config WHERE id = 1",
  );
  const { rows: est } = await client.query(
    "SELECT estoque FROM public.produtos WHERE id = $1",
    [produto.id],
  );
  console.log("Estado após os testes (deve estar idêntico ao inicial):");
  console.log(`   free_shipping_min: R$ ${Number(depois[0].free_shipping_min).toFixed(2)} (era R$ ${Number(cfgRows[0].free_shipping_min).toFixed(2)})`);
  console.log(`   estoque do produto: ${est[0].estoque} (era ${produto.estoque})`);

  await client.end();
  console.log(falhas === 0 ? "\nTodos os cenários passaram." : `\n${falhas} cenário(s) falharam.`);
  process.exit(falhas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});
