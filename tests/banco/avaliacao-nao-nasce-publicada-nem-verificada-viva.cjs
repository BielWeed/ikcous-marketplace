"use strict";

// Somente o clone descartavel de rodar-isolado.cjs. Nenhum SQL de producao muda.
// INSERT SEM RETURNING: mede a escrita, nao a policy de SELECT.
// MUTANTE_R100 remove uma unica guarda viva; cada prova desfaz tudo no ROLLBACK.
const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;
// "g" nao e hexadecimal: r102-g usa b1020000 nos UUIDs e r102g no email.
const CLIENTE = "b1020000-0000-4000-8000-000000000001";
const PRODUTO = "b1020000-0000-4000-8000-000000000010";
const AVALIACAO = "b1020000-0000-4000-8000-000000000011";
const OUTRA = "b1020000-0000-4000-8000-000000000012";
const SQL = `INSERT INTO public.reviews
  (id, product_id, user_id, rating, comment, verified, status)
  VALUES ($1, $2, $3, $4, 'Produto ficticio chegou bem', $5, $6)`;

async function semear() {
  const c = P.conexao();
  await c.query(
    "INSERT INTO auth.users (id,email,raw_app_meta_data) VALUES ($1,$2,'{}'::jsonb)",
    [CLIENTE, "cliente@r102g.fixture.invalid"],
  );
  await c.query(
    "INSERT INTO public.profiles (id,full_name,role) VALUES ($1,'Pessoa ficticia','customer')",
    [CLIENTE],
  );
  await c.query(
    "INSERT INTO public.produtos (id,nome,preco_venda,estoque,ativo,custo) VALUES ($1,'Produto ficticio',100,10,true,40)",
    [PRODUTO],
  );
  // Cria a linha se faltar: o fallback true da policy nao pode mascarar o caso false.
  await c.query(`INSERT INTO public.store_config (id,enable_reviews) VALUES (1,true)
    ON CONFLICT (id) DO UPDATE SET enable_reviews = true`);
}

async function lerPolicy() {
  const r = await P.conexao().query(`SELECT polcmd, polqual,
    pg_get_expr(polwithcheck,polrelid) AS wc FROM pg_policy
    WHERE polrelid = 'public.reviews'::regclass AND polname = 'reviews_insert_policy'`);
  assert.equal(r.rowCount, 1, "a policy viva deve ser unica");
  assert.equal(r.rows[0].polcmd, "a", "o alvo deve ser a policy de INSERT");
  assert.equal(r.rows[0].polqual, null);
  return r.rows[0].wc;
}

async function mutarPolicy(nome, trecho) {
  if (process.env.MUTANTE_R100 !== nome) return;
  const original = await lerPolicy();
  assert.equal(
    original.split(trecho).length - 1,
    1,
    `mutante ${nome}: alvo deve ocorrer uma vez`,
  );
  const alterada = original.replace(trecho, "");
  assert.notEqual(alterada, original, "sabotagem nao aplicada");
  await P.conexao().query(
    `ALTER POLICY reviews_insert_policy ON public.reviews WITH CHECK (${alterada})`,
  );
  assert.equal(
    await lerPolicy(),
    alterada,
    "o banco nao instalou exatamente o mutante",
  );
  console.log(`MUTANTE aplicado: ${nome}`);
}

async function mutarNota() {
  const nome = "avaliacao-aceita-nota-fora-da-faixa";
  if (process.env.MUTANTE_R100 !== nome) return;
  const c = P.conexao();
  const contar = async () =>
    (
      await c.query(`SELECT conname FROM pg_constraint
      WHERE conrelid = 'public.reviews'::regclass AND conname = 'reviews_rating_check'`)
    ).rowCount;
  assert.equal(await contar(), 1, "a constraint alvo deve existir uma vez");
  await c.query(
    "ALTER TABLE public.reviews DROP CONSTRAINT reviews_rating_check",
  );
  assert.equal(await contar(), 0, "o banco nao removeu a constraint alvo");
  console.log(`MUTANTE aplicado: ${nome}`);
}

const inserir = ({
  id = AVALIACAO,
  rating = 4,
  verified = false,
  status = "pendente",
} = {}) =>
  P.tentar(
    "authenticated",
    SQL,
    [id, PRODUTO, CLIENTE, rating, verified, status],
    { uid: CLIENTE },
  );

const guardadas = async () =>
  (
    await P.conexao().query(
      `SELECT id, user_id, rating, verified, status FROM public.reviews
      WHERE product_id = $1 ORDER BY id`,
      [PRODUTO],
    )
  ).rows;

async function recusada(dados, codigo, mensagem) {
  const r = await inserir(dados);
  assert.equal(r.codigo, codigo, mensagem);
  if (codigo === "23514") assert.equal(r.restricao, "reviews_rating_check");
  assert.deepEqual(
    await guardadas(),
    [],
    "a tentativa recusada criou uma avaliacao",
  );
}

async function aceita(dados = {}, anteriores = []) {
  const r = await inserir(dados);
  assert.equal(r.codigo, undefined, r.erro);
  assert.deepEqual(await guardadas(), [
    ...anteriores,
    {
      id: dados.id ?? AVALIACAO,
      user_id: CLIENTE,
      rating: dados.rating ?? 4,
      verified: false,
      status: "pendente",
    },
  ]);
}

prova("cliente nao publica na criacao: 42501 sem linha; pendente aceita", () =>
  P.emTransacao(async () => {
    await semear();
    await mutarPolicy(
      "avaliacao-nasce-publicada",
      " AND (status = 'pendente'::text)",
    );
    await recusada(
      { status: "publicada" },
      "42501",
      "status publicada foi aceito na criacao",
    );
    await aceita();
  }),
);

prova("cliente nao se verifica: 42501 sem linha; verified false aceita", () =>
  P.emTransacao(async () => {
    await semear();
    await mutarPolicy("avaliacao-nasce-verificada", " AND (verified = false)");
    await recusada(
      { verified: true },
      "42501",
      "verified true foi aceito na criacao",
    );
    await aceita();
  }),
);

prova("recurso desligado recusa 42501 sem linha; ligado aceita", () =>
  P.emTransacao(async () => {
    await semear();
    await mutarPolicy(
      "avaliacao-ignora-recurso-desligado",
      " AND COALESCE(( SELECT sc.enable_reviews\n   FROM store_config sc\n  WHERE (sc.id = 1)), true)",
    );
    const c = P.conexao();
    const desligar = await c.query(
      "UPDATE public.store_config SET enable_reviews = false WHERE id = 1 RETURNING enable_reviews",
    );
    assert.deepEqual(desligar.rows, [{ enable_reviews: false }]);
    await recusada({}, "42501", "recurso desligado aceitou avaliacao");
    await c.query(
      "UPDATE public.store_config SET enable_reviews = true WHERE id = 1",
    );
    await aceita();
  }),
);

prova("notas 0 e 6 recusam 23514 sem linha; extremos 1 e 5 aceitam", () =>
  P.emTransacao(async () => {
    await semear();
    await mutarNota();
    await recusada(
      { rating: 0 },
      "23514",
      "nota 0 foi aceita fora da faixa 1 a 5",
    );
    await recusada(
      { rating: 6 },
      "23514",
      "nota 6 foi aceita fora da faixa 1 a 5",
    );
    await aceita({ rating: 1 });
    await aceita({ id: OUTRA, rating: 5 }, [
      {
        id: AVALIACAO,
        user_id: CLIENTE,
        rating: 1,
        verified: false,
        status: "pendente",
      },
    ]);
  }),
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar(
      "avaliacao nasce pendente, sem selo, com recurso ligado e nota de 1 a 5",
    );
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
