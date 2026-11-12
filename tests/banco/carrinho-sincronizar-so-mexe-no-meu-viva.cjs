"use strict";

/**
 * PROVA VIVA: sync_cart_atomic substitui o carrinho da conta autenticada,
 * nunca o de outra conta, mesmo sendo SECURITY DEFINER (ignora a RLS).
 *
 * Usa a funcao REAL do banco migrado, nao uma copia da migration.
 * So Postgres EFEMERO, pela mesma trava e pelo mesmo clone do rpc-ci.yml.
 * Cada caso desfaz fixtures e eventual mutante com ROLLBACK.
 *
 * USO (depois de provisionar.cjs + aplicar-migrations.cjs):
 *   node tests/banco/rodar-isolado.cjs tests/banco/carrinho-sincronizar-so-mexe-no-meu-viva.cjs
 *
 * CONTROLE VERMELHO: MUTANTE_CARRINHO_SEM_FILTRO=1 no ambiente executa os
 * mesmos casos, mas remove so WHERE user_id = v_user_id da definicao VIVA
 * dentro da transacao. Ambos devem falhar em "o carrinho de B mudou".
 * Nenhum arquivo de producao e alterado.
 */

const assert = require("node:assert/strict");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const U_A = "b1000a00-0000-4000-8000-000000000001";
const U_B = "b1000a00-0000-4000-8000-000000000002";
const MUTANTE = process.env.MUTANTE_CARRINHO_SEM_FILTRO === "1";

const CASOS = [
  {
    nome: "A esvazia seu carrinho e preserva todas as linhas de B",
    itens: [],
    esperado: [],
  },
  {
    nome: "A troca os itens do seu carrinho e preserva todas as linhas de B",
    itens: [
      {
        product_id: "camiseta-fixture",
        variant_id: "azul-m",
        quantity: 4,
        variant_names: "Azul / M",
        updated_at: "2026-10-11T12:00:00.000Z",
      },
      {
        product_id: "caneca-fixture",
        variant_id: "",
        quantity: 2,
        variant_names: null,
        updated_at: "2026-10-11T13:00:00.000Z",
      },
    ],
    esperado: [
      {
        product_id: "camiseta-fixture",
        variant_id: "azul-m",
        quantity: 4,
        variant_names: "Azul / M",
        updated_at: new Date("2026-10-11T12:00:00.000Z"),
      },
      {
        product_id: "caneca-fixture",
        variant_id: "",
        quantity: 2,
        variant_names: null,
        updated_at: new Date("2026-10-11T13:00:00.000Z"),
      },
    ],
  },
];

async function semear(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'conta-a@carrinho.teste', '{}'::jsonb),
            ($2, 'conta-b@carrinho.teste', '{}'::jsonb)`,
    [U_A, U_B],
  );
  // Ha produtos/variantes compartilhados entre as contas, com quantidades
  // diferentes. B tem mais de uma variante do mesmo produto e um sem variante.
  await c.query(
    `INSERT INTO public.cart_items
       (user_id, product_id, variant_id, quantity, variant_names, created_at, updated_at)
     VALUES
       ($1, 'produto-antigo-a', '', 1, NULL, '2026-10-01T00:00:00Z', '2026-10-02T00:00:00Z'),
       ($1, 'camiseta-fixture', 'azul-m', 2, 'Azul / M', '2026-10-01T00:00:00Z', '2026-10-03T00:00:00Z'),
       ($2, 'camiseta-fixture', 'azul-m', 7, 'Azul / M', '2026-10-01T00:00:00Z', '2026-10-04T00:00:00Z'),
       ($2, 'camiseta-fixture', 'verde-g', 3, 'Verde / G', '2026-10-02T00:00:00Z', '2026-10-05T00:00:00Z'),
       ($2, 'caneca-fixture', '', 5, NULL, '2026-10-03T00:00:00Z', '2026-10-06T00:00:00Z')`,
    [U_A, U_B],
  );
}

async function retratoDeB(c) {
  // Le como dono do banco, nao como A: a RLS esconderia as linhas alheias.
  // Compara TODAS as colunas, inclusive id e datas, nao so a quantidade.
  return (
    await c.query(
      `SELECT to_jsonb(item) AS item FROM public.cart_items item
       WHERE user_id = $1 ORDER BY id`,
      [U_B],
    )
  ).rows;
}

async function sincronizarComoA(c, itens) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [U_A]);
  await c.query("SELECT set_config('request.jwt.claims', $1, true)", [
    JSON.stringify({ sub: U_A, role: "authenticated", app_metadata: {} }),
  ]);
  await c.query("SET LOCAL ROLE authenticated");
  const identidade = (
    await c.query("SELECT current_user AS papel, auth.uid() AS uid")
  ).rows[0];
  assert.deepEqual(identidade, { papel: "authenticated", uid: U_A });
  await c.query("SELECT public.sync_cart_atomic($1::jsonb)", [
    JSON.stringify(itens),
  ]);
  await c.query("RESET ROLE");
}

async function removerFiltroNaTransacao(c) {
  const definicao = (
    await c.query(
      "SELECT pg_get_functiondef('public.sync_cart_atomic(jsonb)'::regprocedure) AS sql",
    )
  ).rows[0].sql;
  const filtro = /DELETE FROM public\.cart_items\s+WHERE user_id = v_user_id;/g;
  assert.equal(
    (definicao.match(filtro) || []).length,
    1,
    "o mutante precisa encontrar exatamente o DELETE com filtro do dono",
  );
  await c.query(definicao.replace(filtro, "DELETE FROM public.cart_items;"));
}

async function provar(c, caso) {
  await c.query("BEGIN");
  try {
    await semear(c);
    const antesB = await retratoDeB(c);
    assert.equal(antesB.length, 3, "fixture B precisa ter tres linhas");
    const antesA = await c.query(
      "SELECT id FROM public.cart_items WHERE user_id = $1",
      [U_A],
    );
    assert.equal(antesA.rowCount, 2, "fixture A precisa comecar preenchida");

    if (MUTANTE) await removerFiltroNaTransacao(c);
    await sincronizarComoA(c, caso.itens);

    const depoisA = await c.query(
      `SELECT product_id, variant_id, quantity, variant_names, updated_at
       FROM public.cart_items WHERE user_id = $1 ORDER BY product_id, variant_id`,
      [U_A],
    );
    assert.deepEqual(
      depoisA.rows,
      caso.esperado,
      "A nao ficou exatamente com o carrinho sincronizado",
    );
    assert.deepEqual(
      await retratoDeB(c),
      antesB,
      "o carrinho de B mudou ao sincronizar como A",
    );
  } finally {
    await c.query("ROLLBACK");
  }
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  // auth.uid() do provisionar le app.rpc.user_id; o GRANT so permite conferir a identidade
  // como authenticated neste clone descartavel.
  await c.query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
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
  const resumo = `${CASOS.length - falhas}/${CASOS.length} provas passaram${MUTANTE ? " (MUTANTE sem filtro)" : ""}`;
  console.log(resumo);
  anexarAoSummary("Carrinho: sincronizar so mexe no meu", resumo);
  if (falhas) falhar("REPROVADO", resumo);
}

main().catch((erro) => falhar("INDETERMINADO", erro.message));
