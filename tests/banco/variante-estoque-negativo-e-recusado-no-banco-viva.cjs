"use strict";

/**
 * Prova VIVA: salvar_produto_com_grade vigente (20261395100000) recusa estoque
 * negativo na variante existente e na nova, sem salvar o produto pela metade.
 * Mutante MUTANTE_R104H=variante-sem-check-de-estoque remove só a constraint
 * no clone efêmero; a asserção do 23514 precisa ficar vermelha.
 */
const assert = require("node:assert/strict");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const ADMIN = "7e104008-0000-4000-8000-0000000000a1";
const PRODUTO = "7e104008-0000-4000-8000-000000000001";
const VARIANTE = "7e104008-0000-4000-8000-000000000011";
const APAGAR = "7e104008-0000-4000-8000-000000000012";
const FN =
  "public.salvar_produto_com_grade(uuid,timestamptz,jsonb,jsonb,uuid[])";
const SQL_RPC =
  "SELECT public.salvar_produto_com_grade($1::uuid, $2::timestamptz, $3::jsonb, $4::jsonb, $5::uuid[]) AS r";

const item = (id, valor, estoque) => ({
  ...(id ? { id } : {}),
  name: "Tamanho",
  value: valor,
  sku: null,
  codigo_barras: null,
  price_override: null,
  active: true,
  image_url: null,
  stock_increment: estoque,
});

async function foto(c) {
  return (
    await c.query(
      `SELECT to_jsonb(p) AS produto,
              (SELECT jsonb_agg(to_jsonb(v) ORDER BY v.id)
                 FROM public.product_variants v WHERE v.product_id = p.id) AS variantes
         FROM public.produtos p WHERE p.id = $1`,
      [PRODUTO],
    )
  ).rows[0];
}

async function versao(c) {
  return (
    await c.query(
      "SELECT ultima_atualizacao::text AS v FROM public.produtos WHERE id = $1",
      [PRODUTO],
    )
  ).rows[0].v;
}

const rpc = (c, base, nome, variantes, apagar = []) =>
  c.query(SQL_RPC, [
    PRODUTO,
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
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'admin-r104h-estoque@example.test', $2::jsonb)",
      [ADMIN, JSON.stringify({ role: "admin" })],
    );
    await adm.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin prova estoque', 'admin')",
      [ADMIN],
    );
    await adm.query(
      "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis) VALUES ($1, 'Produto antes', 100, 20, true, 40, false)",
      [PRODUTO],
    );
    for (const [id, valor] of [
      [VARIANTE, "P"],
      [APAGAR, "M"],
    ]) {
      await adm.query(
        "INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active) VALUES ($1, $2, 'Tamanho', $3, 5, true)",
        [id, PRODUTO, valor],
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

    if (process.env.MUTANTE_R104H === "variante-sem-check-de-estoque") {
      await adm.query(
        "ALTER TABLE public.product_variants DROP CONSTRAINT check_stock_increment_positivo",
      );
    }

    for (const [nome, variantes] of [
      ["existente", [item(VARIANTE, "P alterado", -1)]],
      [
        "nova",
        [item(VARIANTE, "P alterado", 3), item(null, "Nova negativa", -1)],
      ],
    ]) {
      const antes = await foto(adm);
      const base = await versao(adm);
      let erro;
      try {
        await rpc(painel, base, "Nome que não pode persistir", variantes, [
          APAGAR,
        ]);
      } catch (e) {
        erro = e;
      }
      assert.equal(
        erro?.code,
        "23514",
        `GUARDA estoque ${nome}: -1 deve ser recusado com 23514`,
      );
      assert.equal(erro.constraint, "check_stock_increment_positivo");
      assert.deepEqual(
        await foto(adm),
        antes,
        `a recusa da variante ${nome} reverte nome, versão, atualização e exclusão das variantes`,
      );
      console.log(
        `ok - variante ${nome}: 23514 e salvamento inteiro revertido`,
      );
    }

    await rpc(painel, await versao(adm), "Controle zero salvo", [
      item(VARIANTE, "P zero", 0),
      item(null, "Nova zero", 0),
    ]);
    const depois = await foto(adm);
    assert.equal(depois.produto.nome, "Controle zero salvo");
    const zeros = depois.variantes.filter((v) =>
      ["P zero", "Nova zero"].includes(v.value),
    );
    assert.equal(zeros.length, 2);
    assert.ok(zeros.every((v) => v.stock_increment === 0));
    console.log(
      "ok - controle: estoque 0 salvo na variante existente e na nova",
    );
    console.log("3/3 provas passaram.");
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
