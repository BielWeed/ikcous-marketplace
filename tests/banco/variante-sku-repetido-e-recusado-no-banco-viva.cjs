"use strict";

/**
 * Prova VIVA: a RPC vigente (20261395100000) não deixa o produto B tomar
 * o SKU da variante de A, nem salvar nome, exclusões e variantes pela metade.
 * Mutante MUTANTE_R104H=variante-sem-sku-unico remove só a UNIQUE no clone;
 * a asserção do 23505 precisa ficar vermelha. Dois SKUs NULL seguem válidos.
 */
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const ADMIN = "7e104009-0000-4000-8000-0000000000a1";
const A = "7e104009-0000-4000-8000-000000000001";
const B = "7e104009-0000-4000-8000-000000000002";
const DONA = "7e104009-0000-4000-8000-000000000011";
const ALTERAR = "7e104009-0000-4000-8000-000000000012";
const APAGAR = "7e104009-0000-4000-8000-000000000013";
const SKU = "SKU-R104H-DONA";
const FN =
  "public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])";
const SQL_RPC =
  "SELECT public.salvar_produto_com_grade($1::uuid, $2::timestamptz, $3::jsonb, $4::jsonb, $5::uuid[]) AS r";

const item = (id, valor, sku = null) => ({
  ...(id ? { id } : {}),
  name: "Tamanho",
  value: valor,
  sku,
  codigo_barras: null,
  price_override: null,
  active: true,
  image_url: null,
  stock_increment: 3,
});

async function foto(c) {
  return (
    await c.query(
      `SELECT to_jsonb(p) AS produto,
              (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id)
                 FROM public.product_variants v WHERE v.product_id = p.id) AS variantes
         FROM public.produtos p WHERE p.id = ANY($1::uuid[]) ORDER BY p.id`,
      [[A, B]],
    )
  ).rows;
}

async function versao(c) {
  return (
    await c.query(
      "SELECT ultima_atualizacao::text AS v FROM public.produtos WHERE id = $1",
      [B],
    )
  ).rows[0].v;
}

const rpc = (c, base, nome, variantes, apagar = []) =>
  c.query(SQL_RPC, [
    B,
    base,
    JSON.stringify({ nome }),
    JSON.stringify(variantes),
    apagar,
  ]);

async function main() {
  const adm = new Client({ connectionString: lerDatabaseUrlEfemera() });
  const painel = new Client({ connectionString: lerDatabaseUrlEfemera() });
  try {
    await adm.connect();
    await painel.connect();
    const corpo = await adm.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    );
    assert.equal(
      corpo.rows[0]?.h,
      "10fc8c0f1e305666b39e5f1f383815e2",
      "a prova deve chamar o corpo vigente da 20261395100000, sem voltar à 352",
    );
    await adm.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'admin-r104h-sku@example.test', $2::jsonb)",
      [ADMIN, JSON.stringify({ role: "admin" })],
    );
    await adm.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin prova SKU', 'admin')",
      [ADMIN],
    );
    for (const [id, nome] of [
      [A, "Produto A"],
      [B, "Produto B"],
    ]) {
      await adm.query(
        "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, $2, 100, 20, true, 40, false)",
        [id, nome],
      );
    }
    for (const [id, produto, valor, sku] of [
      [DONA, A, "Dona", SKU],
      [ALTERAR, B, "Original", "SKU-R104H-B"],
      [APAGAR, B, "Preservada", "SKU-R104H-APAGAR"],
    ]) {
      await adm.query(
        "INSERT INTO public.product_variants (id, product_id, name, value, sku, stock_increment, active) VALUES ($1, $2, 'Tamanho', $3, $4, 5, true)",
        [id, produto, valor, sku],
      );
    }
    await painel.query(
      "SELECT set_config('app.rpc.user_id', $1, false), set_config('request.jwt.claims', $2, false)",
      [
        ADMIN,
        JSON.stringify({
          role: "authenticated",
          app_metadata: { role: "admin" },
        }),
      ],
    );
    await painel.query("SET ROLE authenticated");

    if (process.env.MUTANTE_R104H === "variante-sem-sku-unico") {
      await adm.query(
        "ALTER TABLE public.product_variants DROP CONSTRAINT product_variants_sku_key",
      );
    }

    const antes = await foto(adm);
    let erro;
    try {
      await rpc(
        painel,
        await versao(adm),
        "Produto B que não pode persistir",
        [
          item(ALTERAR, "Alteração antes da colisão", "SKU-R104H-B"),
          item(null, "Inserção antes da colisão"),
          item(null, "Tentativa de tomar SKU", SKU),
        ],
        [APAGAR],
      );
    } catch (e) {
      erro = e;
    }
    assert.equal(
      erro?.code,
      "23505",
      "GUARDA SKU: a variante de B com o SKU da dona de A deve ser recusada com 23505",
    );
    assert.equal(erro.constraint, "product_variants_sku_key");
    assert.deepEqual(
      await foto(adm),
      antes,
      "a recusa reverte nome, versão, exclusão, atualização e inserção de B; A segue intacto",
    );
    const dona = await adm.query(
      "SELECT id, product_id FROM public.product_variants WHERE sku = $1",
      [SKU],
    );
    assert.deepEqual(dona.rows, [{ id: DONA, product_id: A }]);
    console.log(
      "ok - SKU repetido: 23505, dona preservada e salvamento inteiro revertido",
    );

    await rpc(painel, await versao(adm), "Controle NULL salvo", [
      item(null, "NULL 1"),
      item(null, "NULL 2"),
    ]);
    const controle = await adm.query(
      "SELECT value, sku, stock_increment FROM public.product_variants WHERE product_id = $1 AND value IN ('NULL 1', 'NULL 2') ORDER BY value",
      [B],
    );
    assert.deepEqual(controle.rows, [
      { value: "NULL 1", sku: null, stock_increment: 3 },
      { value: "NULL 2", sku: null, stock_increment: 3 },
    ]);
    const nome = await adm.query(
      "SELECT nome FROM public.produtos WHERE id = $1",
      [B],
    );
    assert.equal(nome.rows[0].nome, "Controle NULL salvo");
    console.log("ok - controle: duas variantes com SKU NULL salvas juntas");
    console.log("2/2 provas passaram.");
  } finally {
    await painel.end().catch(() => {});
    await adm.end().catch(() => {});
  }
}

main().catch((e) =>
  falhar(
    e.code === "ERR_ASSERTION" ? "FALHOU" : "INDETERMINADO",
    e.stack || e.message,
  ),
);
