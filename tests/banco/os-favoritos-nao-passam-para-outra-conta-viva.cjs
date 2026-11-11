"use strict";

/**
 * favorites_all_policy: USING esconde linhas alheias; WITH CHECK impede
 * criar/transferir favoritos para outra conta. Postgres EFEMERO migrado,
 * papel authenticated de verdade; cada prova termina em ROLLBACK.
 *
 * Mutantes somente no clone: ALTER POLICY favorites_all_policy ON
 * public.favorites USING (true); ou WITH CHECK (true), separadamente.
 * Apagar so WITH CHECK nao e' mutante valido: PostgreSQL herda o USING.
 *
 * CI_BANCO_EFEMERO=1 e DATABASE_URL local, como em rpc-ci.yml:
 * node tests/banco/rodar-isolado.cjs tests/banco/os-favoritos-nao-passam-para-outra-conta-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const A = "b100a200-0000-4000-8000-000000000001";
const B = "b100a200-0000-4000-8000-000000000002";
const FA = "b100a200-0000-4000-8000-000000000011";
const FB = "b100a200-0000-4000-8000-000000000012";
const NOVO = "b100a200-0000-4000-8000-000000000013";

async function semear() {
  const c = P.conexao();
  for (const id of [A, B])
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}'::jsonb)",
      [id, `${id}@favoritos.example.invalid`],
    );
  await c.query(
    `INSERT INTO public.favorites (id, user_id, product_id, created_at)
     VALUES ($1, $2, 'produto-alfa-ficticio', '2026-01-02T03:04:05Z'),
            ($3, $4, 'produto-beta-ficticio', '2026-02-03T04:05:06Z')`,
    [FA, A, FB, B],
  );
}

const comoA = (sql, params = []) =>
  P.como("authenticated", sql, params, { uid: A });
const guardado = async (id) =>
  (
    await P.conexao().query("SELECT * FROM public.favorites WHERE id = $1", [
      id,
    ])
  ).rows;
const caso = (nome, corpo) =>
  prova(nome, () =>
    P.emTransacao(async () => {
      await semear();
      await corpo();
    }),
  );

caso("A le so os seus favoritos; B segue lendo o proprio", async () => {
  assert.deepEqual(
    await comoA(
      "SELECT id, user_id, product_id FROM public.favorites ORDER BY id",
    ),
    [{ id: FA, user_id: A, product_id: "produto-alfa-ficticio" }],
  );
  assert.deepEqual(
    await comoA("SELECT * FROM public.favorites WHERE id = $1", [FB]),
    [],
  );
  assert.deepEqual(
    await P.como(
      "authenticated",
      "SELECT id, user_id, product_id FROM public.favorites ORDER BY id",
      [],
      { uid: B },
    ),
    [{ id: FB, user_id: B, product_id: "produto-beta-ficticio" }],
  );
});

caso("A nao atualiza B (zero linhas), mas atualiza o proprio", async () => {
  const antesB = await guardado(FB);
  assert.deepEqual(
    await comoA(
      "UPDATE public.favorites SET product_id = 'produto-invadido' WHERE id = $1 RETURNING id",
      [FB],
    ),
    [],
  );
  assert.deepEqual(
    await guardado(FB),
    antesB,
    "B deve ficar integralmente intacto",
  );
  assert.deepEqual(
    await comoA(
      "UPDATE public.favorites SET product_id = 'produto-alfa-editado' WHERE id = $1 RETURNING id, user_id, product_id",
      [FA],
    ),
    [{ id: FA, user_id: A, product_id: "produto-alfa-editado" }],
  );
  assert.equal((await guardado(FA))[0].product_id, "produto-alfa-editado");
});

caso("A nao apaga B (zero linhas), mas apaga o proprio", async () => {
  const antesB = await guardado(FB);
  assert.deepEqual(
    await comoA("DELETE FROM public.favorites WHERE id = $1 RETURNING id", [
      FB,
    ]),
    [],
  );
  assert.deepEqual(
    await guardado(FB),
    antesB,
    "B deve ficar integralmente intacto",
  );
  assert.deepEqual(
    await comoA("DELETE FROM public.favorites WHERE id = $1 RETURNING id", [
      FA,
    ]),
    [{ id: FA }],
  );
  assert.deepEqual(await guardado(FA), []);
});

caso(
  "A nao insere em nome de B (42501); inserir em nome de A funciona",
  async () => {
    const antesB = await guardado(FB);
    const sql =
      "INSERT INTO public.favorites (id, user_id, product_id) VALUES ($1, $2, 'produto-novo-ficticio')";
    // SEM RETURNING: a recusa precisa vir da escrita, nao da policy de leitura.
    const tentativa = await P.tentar("authenticated", sql, [NOVO, B], {
      uid: A,
    });
    assert.equal(
      tentativa.codigo,
      "42501",
      "WITH CHECK deve recusar autora alheia",
    );
    assert.deepEqual(
      await guardado(NOVO),
      [],
      "a tentativa nao deve deixar linha",
    );
    assert.deepEqual(await guardado(FB), antesB);
    await comoA(sql, [NOVO, A]);
    const novo = await guardado(NOVO);
    assert.equal(novo.length, 1);
    assert.equal(novo[0].user_id, A);
    assert.equal(novo[0].product_id, "produto-novo-ficticio");
  },
);

caso(
  "A nao transfere favorito proprio para B (42501); A para A funciona",
  async () => {
    const antesA = await guardado(FA);
    const antesB = await guardado(FB);
    const sql = "UPDATE public.favorites SET user_id = $2 WHERE id = $1";
    const tentativa = await P.tentar("authenticated", sql, [FA, B], { uid: A });
    assert.equal(
      tentativa.codigo,
      "42501",
      "WITH CHECK deve recusar a transferencia",
    );
    assert.deepEqual(
      await guardado(FA),
      antesA,
      "o favorito precisa continuar com A",
    );
    assert.deepEqual(await guardado(FB), antesB, "o favorito de B nao muda");
    assert.deepEqual(await comoA(`${sql} RETURNING id, user_id`, [FA, A]), [
      { id: FA, user_id: A },
    ]);
    assert.deepEqual(await guardado(FA), antesA);
  },
);

async function main() {
  await P.conectar();
  try {
    await P.executar("favoritos isolados entre contas");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.message));
