"use strict";

// PG17 EFEMERO migrado, clone exclusivo de rodar-isolado.cjs; nunca banco de loja.
// favorites_user_id_product_id_key protege o par, nao o produto sozinho.
// MUTANTE_R106M=favorito-sem-unico remove so essa UNIQUE dentro do ROLLBACK.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
const A = "b106a000-0000-4000-8000-000000000001";
const B = "b106a000-0000-4000-8000-000000000002";
const FA = "b106a000-0000-4000-8000-000000000011";
const REPETIDO = "b106a000-0000-4000-8000-000000000012";
const FB = "b106a000-0000-4000-8000-000000000013";
const PRODUTO = "produto-ficticio-r106m";
const RESTRICAO = "favorites_user_id_product_id_key";
const INSERIR =
  "INSERT INTO public.favorites (id, user_id, product_id) VALUES ($1, $2, $3) RETURNING id, user_id, product_id";

async function semear() {
  for (const id of [A, B])
    await P.conexao().query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}'::jsonb)",
      [id, `${id}@favorito-r106m.example.invalid`],
    );
}

async function mutar() {
  if (process.env.MUTANTE_R106M !== "favorito-sem-unico") return;
  await P.conexao().query(
    "ALTER TABLE public.favorites DROP CONSTRAINT favorites_user_id_product_id_key",
  );
  const depois = await P.conexao().query(
    "SELECT conname FROM pg_constraint WHERE conrelid = 'public.favorites'::regclass AND conname = $1",
    [RESTRICAO],
  );
  assert.equal(depois.rows.length, 0, "o mutante nao removeu a UNIQUE");
  console.log("MUTANTE aplicado: favorito-sem-unico");
}

const inserir = (id, uid) =>
  P.como("authenticated", INSERIR, [id, uid, PRODUTO], { uid });
const guardados = async (uid) =>
  (
    await P.conexao().query(
      "SELECT id, user_id, product_id FROM public.favorites WHERE user_id = $1 AND product_id = $2 ORDER BY id",
      [uid, PRODUTO],
    )
  ).rows;
const caso = (nome, corpo) =>
  prova(nome, () =>
    P.emTransacao(async () => {
      await semear();
      await mutar();
      await corpo();
    }),
  );

caso(
  "mesmo par com outro id recusa com 23505 e deixa um favorito",
  async () => {
    const esperado = [{ id: FA, user_id: A, product_id: PRODUTO }];
    assert.deepEqual(await inserir(FA, A), esperado);
    const repeticao = await P.tentar(
      "authenticated",
      INSERIR,
      [REPETIDO, A, PRODUTO],
      { uid: A },
    );
    const depois = await guardados(A);
    assert.equal(
      repeticao.codigo,
      "23505",
      `a UNIQUE deve recusar o segundo favorito; linhas do par: ${depois.length}`,
    );
    assert.equal(repeticao.restricao, RESTRICAO);
    assert.equal(depois.length, 1, "a recusa nao pode deixar uma duplicata");
    assert.deepEqual(
      depois,
      esperado,
      "o favorito original deve ficar intacto",
    );
  },
);

caso("outra conta pode favoritar o mesmo produto", async () => {
  assert.deepEqual(await inserir(FA, A), [
    { id: FA, user_id: A, product_id: PRODUTO },
  ]);
  assert.deepEqual(await inserir(FB, B), [
    { id: FB, user_id: B, product_id: PRODUTO },
  ]);
  assert.deepEqual(await guardados(A), [
    { id: FA, user_id: A, product_id: PRODUTO },
  ]);
  assert.deepEqual(await guardados(B), [
    { id: FB, user_id: B, product_id: PRODUTO },
  ]);
});

caso(
  "upsert do app ignora o par repetido sem falhar nem duplicar",
  async () => {
    // FavoritesContext: onConflict: "user_id,product_id", ignoreDuplicates: true.
    // O payload do app nao manda id; o banco fornece o valor padrao.
    const sql =
      "INSERT INTO public.favorites (user_id, product_id) VALUES ($1, $2) ON CONFLICT (user_id, product_id) DO NOTHING RETURNING id, user_id, product_id";
    const primeiro = await P.tentar("authenticated", sql, [A, PRODUTO], {
      uid: A,
    });
    assert.equal(primeiro.codigo, undefined, primeiro.erro);
    assert.equal(primeiro.linhas.length, 1);
    assert.ok(primeiro.linhas[0].id);
    assert.equal(primeiro.linhas[0].user_id, A);
    assert.equal(primeiro.linhas[0].product_id, PRODUTO);
    for (let i = 0; i < 2; i++) {
      const repeticao = await P.tentar("authenticated", sql, [A, PRODUTO], {
        uid: A,
      });
      assert.equal(repeticao.codigo, undefined, repeticao.erro);
      assert.deepEqual(repeticao.linhas, [], "DO NOTHING nao cria outra linha");
      assert.deepEqual(await guardados(A), primeiro.linhas);
    }
  },
);

async function main() {
  await P.conectar();
  try {
    await P.executar("favorito repetido na mesma conta e recusado no banco");
  } finally {
    await P.conexao().end();
  }
}
main().catch((erro) => P.falhar("FALHOU", erro.stack || erro.message));
