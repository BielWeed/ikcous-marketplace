#!/usr/bin/env node
/**
 * Valida a migration 20260729000002 (frete por cotação, v23) SEM aplicá-la.
 *
 * Tudo roda dentro de uma transação que termina em ROLLBACK: a migration é
 * aplicada, exercitada e desfeita. Serve para pegar erro de sintaxe e de lógica
 * antes de tocar no banco de verdade. Nenhum pedido é criado, nenhum estoque muda.
 *
 * USO:  node scripts/db-test-migration-v23.cjs
 */

const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");

const PROJECT_ROOT = path.resolve(__dirname, "..");
// Passo 0 (PR #320) arquivou as migrations pre-baseline em _arquivadas/:
// a 20260729000002 e' anterior a baseline 20260806 e agora mora la'.
// Resolve da raiz primeiro (dia em que ela voltar, se voltar), senao do
// arquivo — o leitor nao quebra por causa do andar onde o .sql vive.
const { resolverCaminhoMigration } = require("./ler-migration");
const NOME_DA_MIGRATION = "20260729000002_shipping_quote_validation_v23.sql";
const MIGRATION = resolverCaminhoMigration(NOME_DA_MIGRATION);
if (!MIGRATION) {
  console.error(
    `${NOME_DA_MIGRATION}: nao encontrada nem na raiz nem em _arquivadas/`,
  );
  process.exit(1);
}

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

let passou = 0;
let falhou = 0;
function conferir(descricao, obtido, esperado) {
  const ok = JSON.stringify(obtido) === JSON.stringify(esperado);
  if (ok) passou++;
  else falhou++;
  console.log(
    `  ${ok ? "ok    " : "FALHOU"}  ${descricao}${ok ? "" : `  (obtido: ${JSON.stringify(obtido)}, esperado: ${JSON.stringify(esperado)})`}`,
  );
}

async function main() {
  const client = new Client({
    connectionString: lerDatabaseUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  await client.query("BEGIN");

  try {
    console.log("Aplicando a migration dentro da transação...");
    await client.query(fs.readFileSync(MIGRATION, "utf8"));
    console.log("Migration aplicou sem erro de sintaxe.\n");

    // ---------------------------------------------------------------- is_local_cep
    console.log("is_local_cep (espelho SQL da regra da edge function):");
    const local = async (origem, destino, faixa) =>
      (
        await client.query("SELECT public.is_local_cep($1,$2,$3) AS r", [
          origem,
          destino,
          faixa,
        ])
      ).rows[0].r;

    conferir(
      "sem faixa: mesmos 5 dígitos",
      await local("38500-000", "38500-120", null),
      true,
    );
    conferir(
      "sem faixa: dígitos diferentes",
      await local("38500-000", "38400-000", null),
      false,
    );
    conferir(
      "formato do placeholder, dentro",
      await local("38500-000", "38500-123", "38500-000, 38500-999"),
      true,
    );
    conferir(
      "formato do placeholder, fora",
      await local("38500-000", "38501-000", "38500-000, 38500-999"),
      false,
    );
    conferir(
      "faixa explícita, dentro",
      await local("38500-000", "38502000", "38500000-38505000"),
      true,
    );
    conferir(
      "faixa explícita, fora",
      await local("38500-000", "38506000", "38500000-38505000"),
      false,
    );
    conferir(
      "lista de prefixos, casa",
      await local("38500-000", "38400-123", "38500, 38400"),
      true,
    );
    conferir(
      "lista de prefixos, não casa",
      await local("38500-000", "38200-123", "38500, 38400"),
      false,
    );
    conferir(
      "faixa invertida pelo lojista",
      await local("38500-000", "38500-500", "38500-999, 38500-000"),
      true,
    );

    // -------------------------------------------------------------- checkout v23
    const { rows: cfg } = await client.query(
      "SELECT free_shipping_min, shipping_fee, local_delivery_fee, origin_cep, local_cep_range FROM public.store_config WHERE id = 1",
    );
    const frete = Number(cfg[0].shipping_fee);
    const { rows: prod } = await client.query(
      `SELECT id, nome, preco_venda FROM public.produtos
        WHERE ativo = true AND deleted_at IS NULL
          AND COALESCE(frete_gratis,false) = false AND estoque >= 2
        ORDER BY preco_venda DESC LIMIT 1`,
    );
    const produto = prod[0];
    const subtotal = Number(produto.preco_venda) * 2;
    const itens = JSON.stringify([
      { product_id: produto.id, variant_id: null, quantity: 2 },
    ]);

    const pedido = async ({ optionId, cep, total, min }) => {
      await client.query("SAVEPOINT sp");
      try {
        await client.query(
          "UPDATE public.store_config SET free_shipping_min = $1 WHERE id = 1",
          [min ?? 999999],
        );
        await client.query("SELECT set_config('request.jwt.claims', '', true)");
        await client.query(
          `SELECT public.create_marketplace_order_v23($1::jsonb,$2::numeric,0,'whatsapp',NULL,NULL,
             'Teste v23','5534999999999','ROLLBACK',NULL,$3::text,$4::text)`,
          [itens, total, cep, optionId],
        );
        await client.query("ROLLBACK TO SAVEPOINT sp");
        return "aceito";
      } catch (e) {
        await client.query("ROLLBACK TO SAVEPOINT sp");
        return e.message;
      }
    };

    console.log(
      `\ncreate_marketplace_order_v23 (carrinho R$ ${subtotal.toFixed(2)}, taxa padrão R$ ${frete.toFixed(2)}):`,
    );

    conferir(
      "flat-fee-standard usa a taxa da loja (não depende do cache)",
      await pedido({
        optionId: "flat-fee-standard",
        cep: "01310-100",
        total: subtotal + frete,
      }),
      "aceito",
    );
    conferir(
      "sem opção escolhida cai na taxa padrão",
      await pedido({ optionId: null, cep: null, total: subtotal + frete }),
      "aceito",
    );
    conferir(
      "compatibilidade: v22 continua funcionando",
      await (async () => {
        await client.query("SAVEPOINT sp2");
        try {
          await client.query(
            "UPDATE public.store_config SET free_shipping_min = 999999 WHERE id = 1",
          );
          await client.query(
            "SELECT set_config('request.jwt.claims', '', true)",
          );
          await client.query(
            `SELECT public.create_marketplace_order_v22($1::jsonb,$2::numeric,0,'whatsapp',NULL,NULL,
               'Teste v22','5534999999999','ROLLBACK',NULL)`,
            [itens, subtotal + frete],
          );
          await client.query("ROLLBACK TO SAVEPOINT sp2");
          return "aceito";
        } catch (e) {
          await client.query("ROLLBACK TO SAVEPOINT sp2");
          return e.message;
        }
      })(),
      "aceito",
    );

    const inventada = await pedido({
      optionId: "sedex-falsificado",
      cep: "01310-100",
      total: subtotal,
    });
    conferir(
      "opção inventada pelo cliente é recusada",
      /cotação de frete expirou/i.test(inventada),
      true,
    );

    const localForaDaFaixa = await pedido({
      optionId: "local-delivery",
      cep: "99999-999",
      total: subtotal + Number(cfg[0].local_delivery_fee || 0),
    });
    conferir(
      "entrega local fora da faixa de CEP é recusada",
      /Entrega local não disponível/i.test(localForaDaFaixa),
      true,
    );
  } catch (erro) {
    console.error("\nERRO durante o teste:", erro.message);
    falhou++;
  } finally {
    await client.query("ROLLBACK");
    const { rows } = await client.query(
      `SELECT COUNT(*)::int AS n FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
        WHERE n.nspname='public' AND p.proname IN ('create_marketplace_order_v23','is_local_cep')`,
    );
    console.log(
      `\nApós o ROLLBACK, funções novas no banco: ${rows[0].n} (esperado 0 — nada foi aplicado).`,
    );
    await client.end();
  }

  console.log(`\n${passou} passaram, ${falhou} falharam.`);
  process.exit(falhou === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error("Erro:", e.message);
  process.exit(1);
});
