#!/usr/bin/env node
/**
 * Prova que o teste de checkout está medindo o que promete.
 *
 * Um teste que passa antes e depois da correção não prova nada. Este script
 * reinstala a definição ANTIGA de create_marketplace_order_v22 (a do arquivo
 * de rollback) dentro de uma transação, roda os dois cenários que eram bug e
 * confirma que eles FALHAM. Depois dá ROLLBACK — a função corrigida continua
 * intacta no banco, e nada mais é tocado.
 *
 * USO:  node scripts/db-prove-regression.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
const ARQUIVO_ROLLBACK = path.join(
  PROJECT_ROOT,
  "rollback-20260729-desfaz-as-duas-migrations.sql",
);

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

/** Extrai só a definição antiga de create_marketplace_order_v22 do rollback. */
function definicaoAntiga() {
  const sql = fs.readFileSync(ARQUIVO_ROLLBACK, "utf8");
  const inicio = sql.indexOf("CREATE OR REPLACE FUNCTION public.create_marketplace_order_v22");
  if (inicio < 0) throw new Error("Definição antiga não encontrada no arquivo de rollback.");
  const marcadorFim = sql.indexOf("-- upsert_store_config", inicio);
  return sql.slice(inicio, marcadorFim > 0 ? marcadorFim : undefined).trim();
}

async function rodarCenario(client, { userId, freeShippingMin, produtoId, quantidade, totalEnviado, usarFuncaoAntiga }) {
  try {
    await client.query("BEGIN");

    if (usarFuncaoAntiga) {
      await client.query(definicaoAntiga());
    }

    await client.query("UPDATE public.store_config SET free_shipping_min = $1 WHERE id = 1", [
      freeShippingMin,
    ]);
    await client.query("SELECT set_config('request.jwt.claims', $1, true)", [
      userId ? JSON.stringify({ sub: userId, role: "authenticated" }) : "",
    ]);

    await client.query(
      `SELECT public.create_marketplace_order_v22(
         $1::jsonb, $2::numeric, $3::numeric, 'whatsapp', NULL, NULL,
         'Prova de Regressao', '5534999999999', 'ROLLBACK - teste', NULL)`,
      [JSON.stringify([{ product_id: produtoId, variant_id: null, quantity: quantidade }]), totalEnviado, 0],
    );

    await client.query("ROLLBACK");
    return { aceito: true, mensagem: "pedido aceito" };
  } catch (erro) {
    await client.query("ROLLBACK").catch(() => {});
    return { aceito: false, mensagem: erro.message };
  }
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const { rows: cfg } = await client.query(
    "SELECT free_shipping_min, shipping_fee FROM public.store_config WHERE id = 1",
  );
  const frete = Number(cfg[0].shipping_fee);
  const minOriginal = Number(cfg[0].free_shipping_min);

  const { rows: prod } = await client.query(
    `SELECT id, nome, preco_venda, estoque FROM public.produtos
      WHERE ativo = true AND deleted_at IS NULL
        AND COALESCE(frete_gratis, false) = false AND estoque >= 2
      ORDER BY preco_venda DESC LIMIT 1`,
  );
  const produto = prod[0];
  const subtotal = Number(produto.preco_venda) * 2;

  const casos = [
    {
      titulo: "Convidado acima do mínimo",
      freeShippingMin: Math.max(1, subtotal - 1),
      totalEnviado: subtotal + frete,
    },
    {
      titulo: "Regra de frete grátis desligada (min = 0)",
      freeShippingMin: 0,
      totalEnviado: subtotal + frete,
    },
  ];

  console.log(`Carrinho de convidado: 2 un de "${produto.nome}" = R$ ${subtotal.toFixed(2)} + frete R$ ${frete.toFixed(2)}\n`);

  let problemas = 0;
  for (const caso of casos) {
    const antes = await rodarCenario(client, {
      ...caso, userId: null, produtoId: produto.id, quantidade: 2, usarFuncaoAntiga: true,
    });
    const depois = await rodarCenario(client, {
      ...caso, userId: null, produtoId: produto.id, quantidade: 2, usarFuncaoAntiga: false,
    });

    // O esperado: a função ANTIGA recusa, a ATUAL aceita.
    const provaOk = antes.aceito === false && depois.aceito === true;
    if (!provaOk) problemas++;

    console.log(caso.titulo);
    console.log(`   função ANTIGA -> ${antes.aceito ? "aceitou" : "RECUSOU"}: ${antes.mensagem.slice(0, 80)}`);
    console.log(`   função ATUAL  -> ${depois.aceito ? "ACEITOU" : "recusou"}: ${depois.mensagem.slice(0, 80)}`);
    console.log(`   ${provaOk ? "PROVA OK — o bug existia e foi corrigido" : "INCONCLUSIVO"}\n`);
  }

  const { rows: fim } = await client.query(
    "SELECT free_shipping_min FROM public.store_config WHERE id = 1",
  );
  const { rows: def } = await client.query(
    `SELECT pg_get_functiondef(p.oid) AS d FROM pg_proc p
       JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname='public' AND p.proname='create_marketplace_order_v22' LIMIT 1`,
  );
  console.log("Estado final do banco:");
  console.log(`   free_shipping_min: R$ ${Number(fim[0].free_shipping_min).toFixed(2)} (original R$ ${minOriginal.toFixed(2)})`);
  console.log(`   função no ar ainda é a corrigida? ${def[0].d.includes("NULLIF(v_store_config.free_shipping_min, 0)") ? "SIM" : "NÃO — ATENÇÃO"}`);

  await client.end();
  process.exit(problemas === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});
