"use strict";

/**
 * reviews_insert_policy: a sessao A nao pode criar uma avaliacao em nome
 * de B. INSERT SEM RETURNING para nao confundir a policy de escrita com
 * a de leitura. A avaliacao e' valida nas demais guardas: pendente,
 * verified=false, nota 4, texto curto, reviews habilitadas, produto ativo.
 *
 * Mutante somente no clone: em reviews_insert_policy trocar APENAS
 * (SELECT auth.uid()) = user_id por true; preservar todas as outras regras.
 *
 * CI_BANCO_EFEMERO=1 e DATABASE_URL local, como em rpc-ci.yml:
 * node tests/banco/rodar-isolado.cjs tests/banco/a-avaliacao-so-nasce-em-nome-da-propria-conta-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const A = "b100a300-0000-4000-8000-000000000001";
const B = "b100a300-0000-4000-8000-000000000002";
const PRODUTO = "b100a300-0000-4000-8000-000000000010";
const AVALIACAO = "b100a300-0000-4000-8000-000000000011";

async function semear() {
  const c = P.conexao();
  for (const id of [A, B]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}'::jsonb)",
      [id, `${id}@avaliacao.example.invalid`],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa Ficticia', 'customer')",
      [id],
    );
  }
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Produto Ficticio', 100, 10, true, 40)",
    [PRODUTO],
  );
  // Ausencia da configuracao tambem habilita pela COALESCE da policy.
  // Se existir, nao deixar um enable_reviews=false esconder o negativo.
  await c.query(
    "UPDATE public.store_config SET enable_reviews = true WHERE id = 1",
  );
}

const SQL = `INSERT INTO public.reviews
  (id, product_id, user_id, rating, comment, verified, status)
  VALUES ($1, $2, $3, 4, 'Produto ficticio chegou bem', false, 'pendente')`;
const guardadas = async () =>
  (
    await P.conexao().query(
      `SELECT id, product_id, user_id, rating, comment, verified, status
         FROM public.reviews WHERE product_id = $1 ORDER BY id`,
      [PRODUTO],
    )
  ).rows;

prova(
  "A nao cria avaliacao em nome de B: 42501, nenhuma linha; A para A funciona",
  () =>
    P.emTransacao(async () => {
      await semear();
      const tentativa = await P.tentar(
        "authenticated",
        SQL,
        [AVALIACAO, PRODUTO, B],
        { uid: A },
      );
      assert.equal(
        tentativa.codigo,
        "42501",
        "a escrita em nome alheio deve ser recusada pela RLS",
      );
      assert.deepEqual(
        await guardadas(),
        [],
        "a tentativa nao pode criar avaliacao, nem sob outra autoria",
      );

      // Mesmo INSERT, mesma sessao, mesmo ID: so user_id muda de B para A.
      // O sucesso prova que nota, produto, status e configuracao eram validos.
      const controle = await P.tentar(
        "authenticated",
        SQL,
        [AVALIACAO, PRODUTO, A],
        { uid: A },
      );
      assert.equal(controle.codigo, undefined, controle.erro);
      assert.deepEqual(await guardadas(), [
        {
          id: AVALIACAO,
          product_id: PRODUTO,
          user_id: A,
          rating: 4,
          comment: "Produto ficticio chegou bem",
          verified: false,
          status: "pendente",
        },
      ]);
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.executar("avaliacao em nome da propria conta");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.message));
