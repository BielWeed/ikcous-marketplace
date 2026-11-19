"use strict";

const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const PRODUTO = "20600000-0000-4000-8000-000000000001";
const VARIACAO = "20600000-0000-4000-8000-000000000002";
const OUTRA = "20600000-0000-4000-8000-000000000003";
const MIGRATION = "20261406000000_o_pedido_guarda_o_nome_antigo_da_opcao.sql";
const ler = (nome) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- Apenas migrations versionadas, de nomes fixos.
  readFileSync(path.join(__dirname, "../../supabase/migrations", nome), "utf8");

async function item(c, variante = VARIACAO) {
  const {
    rows: [pedido],
  } = await c.query(
    `INSERT INTO public.marketplace_orders (customer_name, customer_data, total, subtotal)
     VALUES ('Compra fictícia', '{}', 50, 50) RETURNING id`,
  );
  const {
    rows: [linha],
  } = await c.query(
    `INSERT INTO public.marketplace_order_items
       (order_id, product_id, variant_id, product_name, quantity, price)
     VALUES ($1, $2, $3, 'Camiseta', 1, 50) RETURNING id`,
    [pedido.id, PRODUTO, variante],
  );
  return linha.id;
}

async function conferirPortao(c, nome, positivo) {
  const { rows } = await c.query(
    ler(`../../scripts/publicacao/consultas/${nome}.sql`),
  );
  assert.equal(rows.length, 4);
  assert.equal(
    rows.every((r) => r.ok === true),
    positivo,
    JSON.stringify(rows),
  );
}

async function provas(c) {
  const { rows: corpos } = await c.query(
    `SELECT oid, prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace
       AND proname <> 'guardar_rotulo_da_opcao_no_pedido' ORDER BY oid`,
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo)
     VALUES ($1, 'Camiseta', 50, 100, true)`,
    [PRODUTO],
  );
  await c.query(
    `INSERT INTO public.product_variants (id, product_id, name, value)
     VALUES ($1, $3, 'Cor / Tamanho', 'Azul / M'), ($2, $3, 'Cor', 'Verde')`,
    [VARIACAO, OUTRA, PRODUTO],
  );
  const conferir = async (id, nome, valor) => {
    const {
      rows: [linha],
    } = await c.query(
      "SELECT to_jsonb(i) AS item FROM public.marketplace_order_items i WHERE id = $1",
      [id],
    );
    assert.deepEqual(
      [
        linha.item.variacao_nome_na_compra ?? null,
        linha.item.variacao_valor_na_compra ?? null,
      ],
      [nome, valor],
    );
  };
  const renomear = (nome, valor) =>
    c.query(
      "UPDATE public.product_variants SET name = $1, value = $2 WHERE id = $3",
      [nome, valor, VARIACAO],
    );

  const antiga = await item(c);
  const naoRelacionada = await item(c, OUTRA);
  await c.query(
    "UPDATE public.product_variants SET stock_increment = 10, price_override = 55 WHERE id = $1",
    [VARIACAO],
  );
  await conferir(antiga, null, null);
  // A RPC da grade manda nome/valor mesmo numa edição só de estoque.
  await c.query(
    "UPDATE public.product_variants SET name = name, value = value, stock_increment = 11 WHERE id = $1",
    [VARIACAO],
  );
  await conferir(antiga, null, null);
  await renomear("Cor / Tamanho", "Marinho / M");
  await conferir(antiga, "Cor / Tamanho", "Azul / M");
  await conferir(naoRelacionada, null, null);
  console.log(
    "[2060] estoque/preço não gravam; primeira troca guarda os campos crus",
  );

  await conferirPortao(
    c,
    "162a-conferir-o-pedido-guarda-o-nome-antigo-da-opcao-aplicado",
    true,
  );
  await conferirPortao(
    c,
    "162b-antes-o-pedido-guarda-o-nome-antigo-da-opcao-base-vigente",
    false,
  );
  console.log(
    "[2060] conferência de catálogo confirma colunas, função interna e gatilho",
  );

  await c.query(ler(MIGRATION));
  await c.query(ler(MIGRATION));
  const entreTrocas = await item(c);
  await conferir(entreTrocas, null, null);
  await renomear("Tom / Tamanho", "Marinho / M");
  await conferir(antiga, "Cor / Tamanho", "Azul / M");
  await conferir(entreTrocas, "Cor / Tamanho", "Marinho / M");
  console.log(
    "[2060] reaplicar 2x não perde o histórico; segunda troca só grava a compra nova",
  );

  const semRetrato = await item(c);
  await c.query(
    `ALTER TABLE public.marketplace_order_items ADD CONSTRAINT falha_prova
       CHECK (variacao_nome_na_compra IS NULL) NOT VALID`,
  );
  const avisos = [];
  c.on("notice", (aviso) => avisos.push(aviso));
  await renomear("Cor Nova", "Roxo / M");
  assert.ok(
    avisos.some(
      ({ message }) => message.includes(VARIACAO) && message.includes("23514"),
    ),
  );
  assert.ok(
    avisos.every(
      ({ message }) =>
        !message.includes("Marinho") && !message.includes("Roxo"),
    ),
  );
  const {
    rows: [atual],
  } = await c.query(
    "SELECT name, value FROM public.product_variants WHERE id = $1",
    [VARIACAO],
  );
  assert.deepEqual(atual, { name: "Cor Nova", value: "Roxo / M" });
  await conferir(semRetrato, null, null);
  await c.query(
    "ALTER TABLE public.marketplace_order_items DROP CONSTRAINT falha_prova",
  );
  console.log(
    "[2060] falha simulada no item não aborta a edição e não vaza valores no aviso",
  );

  await c.query(ler(`rollback-manual-${MIGRATION}`));
  await c.query(ler(`rollback-manual-${MIGRATION}`));
  await renomear("Cor", "Vinho / M");
  await conferir(semRetrato, null, null);
  await conferir(antiga, "Cor / Tamanho", "Azul / M");
  const { rows: restaurados } = await c.query(
    "SELECT oid, prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace ORDER BY oid",
  );
  assert.deepEqual(restaurados, corpos);
  await conferirPortao(
    c,
    "162a-conferir-o-pedido-guarda-o-nome-antigo-da-opcao-aplicado",
    false,
  );
  await conferirPortao(
    c,
    "162b-antes-o-pedido-guarda-o-nome-antigo-da-opcao-base-vigente",
    true,
  );
  console.log(
    "[2060] rollback 2x remove só gatilho/função e preserva os retratos gravados",
  );
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    await c.query("BEGIN");
    await provas(c);
  } finally {
    await c.query("ROLLBACK");
    await c.end();
  }
}

main().catch((erro) => {
  console.error(erro);
  process.exitCode = 1;
});
