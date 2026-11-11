"use strict";

/**
 * cart_items_insert_policy: authenticated A nao insere no carrinho de B.
 * INSERT direto SEM RETURNING: a recusa precisa vir do WITH CHECK, nao
 * da policy de SELECT. Mesmo INSERT para A deve funcionar.
 *
 * So Postgres EFEMERO ja migrado, pelo rodar-isolado.cjs. Fixtures e
 * mutante terminam em ROLLBACK. product_id e variant_id sao textos sem
 * FK de catalogo: basta a conta em auth.users, como nas provas vizinhas.
 *
 * MUTANTE_R104C=carrinho-insert-sem-checagem-de-dono troca somente o
 * WITH CHECK da policy VIVA por true, dentro da transacao do clone.
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const A = "b1040c00-0000-4000-8000-000000000001";
const B = "b1040c00-0000-4000-8000-000000000002";
const ITEM = "b1040c00-0000-4000-8000-000000000010";
const IDENTIDADE = {
  uid: A,
  claims: JSON.stringify({
    sub: A,
    role: "authenticated",
    app_metadata: {},
  }),
};

async function semear() {
  for (const id of [A, B])
    await P.conexao().query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}'::jsonb)",
      [id, `${id}@carrinho.example.invalid`],
    );
}

async function mutar() {
  if (process.env.MUTANTE_R104C !== "carrinho-insert-sem-checagem-de-dono")
    return;
  const c = P.conexao();
  const antes = await c.query(
    `SELECT cmd, roles, with_check FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cart_items'
       AND policyname = 'cart_items_insert_policy'`,
  );
  assert.equal(antes.rowCount, 1, "o mutante precisa achar a policy viva");
  assert.equal(antes.rows[0].cmd, "INSERT");
  assert.notEqual(antes.rows[0].with_check, "true");
  await c.query(
    "ALTER POLICY cart_items_insert_policy ON public.cart_items WITH CHECK (true)",
  );
  const depois = await c.query(
    `SELECT with_check FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'cart_items'
       AND policyname = 'cart_items_insert_policy'`,
  );
  assert.equal(depois.rows[0].with_check, "true", "o mutante deve aplicar");
}

const SQL = `INSERT INTO public.cart_items
  (id, user_id, product_id, variant_id, quantity)
  VALUES ($1, $2, 'produto-ficticio-r104c', 'azul-m', 2)`;

const contarB = async () =>
  (
    await P.conexao().query(
      "SELECT count(*)::int AS n FROM public.cart_items WHERE user_id = $1",
      [B],
    )
  ).rows[0].n;

prova(
  "A nao insere no carrinho de B: 42501 e zero linhas; no proprio entra",
  () =>
    P.emTransacao(async () => {
      const c = P.conexao();
      await c.query("GRANT USAGE ON SCHEMA auth TO authenticated, anon");
      await semear();
      await mutar();
      assert.equal(await contarB(), 0, "B precisa comecar sem itens");
      assert.deepEqual(
        await P.como(
          "authenticated",
          "SELECT current_user AS papel, auth.uid() AS uid",
          [],
          IDENTIDADE,
        ),
        [{ papel: "authenticated", uid: A }],
      );

      // SEM RETURNING: enfraquecer so a policy de INSERT deve deixar entrar.
      const tentativa = await P.tentar(
        "authenticated",
        SQL,
        [ITEM, B],
        IDENTIDADE,
      );
      assert.equal(
        tentativa.codigo,
        "42501",
        "cart_items_insert_policy deve recusar inserir no carrinho de outra conta",
      );
      assert.match(
        tentativa.erro,
        /new row violates row-level security policy/,
      );
      // Le como dono do clone: SELECT como A esconderia qualquer linha de B.
      assert.equal(
        await contarB(),
        0,
        "a tentativa deixou item no carrinho de B",
      );

      // So user_id muda: o controle descarta falha de fixture, FK ou privilegio.
      const controle = await P.tentar(
        "authenticated",
        SQL,
        [ITEM, A],
        IDENTIDADE,
      );
      assert.equal(controle.codigo, undefined, controle.erro);
      const guardado = await c.query(
        `SELECT id, user_id, product_id, variant_id, quantity
         FROM public.cart_items WHERE user_id IN ($1, $2) ORDER BY id`,
        [A, B],
      );
      assert.deepEqual(guardado.rows, [
        {
          id: ITEM,
          user_id: A,
          product_id: "produto-ficticio-r104c",
          variant_id: "azul-m",
          quantity: 2,
        },
      ]);
      assert.equal(await contarB(), 0, "B deve continuar sem itens");
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.executar("carrinho nao aceita insercao de outra conta");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.message));
