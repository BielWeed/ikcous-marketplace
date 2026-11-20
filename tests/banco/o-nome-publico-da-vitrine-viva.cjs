"use strict";

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const MIGRATION = "20261408000000_o_nome_de_quem_avalia_aparece_abreviado.sql";
const AUTORA = "f1408000-0000-4000-8000-000000000001";
const PRODUTO = "f1408000-0000-4000-8000-000000000002";
const PUBLICADA = "f1408000-0000-4000-8000-000000000003";
const PENDENTE = "f1408000-0000-4000-8000-000000000004";

const q = async (sql, args) => (await P.conexao().query(sql, args)).rows;
const catalogoDasViews = () =>
  q(`SELECT c.oid, c.relowner, c.relacl::text, c.reloptions::text,
            a.attnum, a.attname, a.atttypid, a.atttypmod, a.attcollation
       FROM pg_class c JOIN pg_attribute a ON a.attrelid = c.oid
      WHERE c.oid IN ('public.vw_reviews_public'::regclass, 'public.vw_questions_public'::regclass)
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY c.oid, a.attnum`);

const definicoesDasViews = () =>
  q(`SELECT pg_get_viewdef('public.vw_reviews_public'::regclass) AS reviews,
            pg_get_viewdef('public.vw_questions_public'::regclass) AS questions`);

const nomesNaVitrine = () =>
  P.como(
    "anon",
    `SELECT author_name, author_avatar_url FROM public.vw_reviews_public WHERE id IN ($1, $2)
     UNION ALL
     SELECT author_name, author_avatar_url FROM public.vw_questions_public WHERE product_id = $3`,
    [PUBLICADA, PENDENTE, PRODUTO],
  );

async function semear() {
  await q(
    "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}'::jsonb)",
    [AUTORA, "autora@nome-publico.fixture.invalid"],
  );
  await q(
    "INSERT INTO public.profiles (id, full_name, avatar_url, role) VALUES ($1, 'Ana de Souza', 'https://fixture.invalid/avatar.png', 'customer')",
    [AUTORA],
  );
  await q(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo) VALUES ($1, 'Produto fixture', 10, 5, true)",
    [PRODUTO],
  );
  await q(
    `INSERT INTO public.reviews (id, product_id, user_id, rating, status)
     VALUES ($1, $3, $4, 5, 'publicada'), ($2, $3, $4, 1, 'pendente')`,
    [PUBLICADA, PENDENTE, PRODUTO, AUTORA],
  );
  await q(
    "INSERT INTO public.questions (product_id, user_id, question) VALUES ($1, $2, 'Tem em azul?')",
    [PRODUTO, AUTORA],
  );
}

prova("12 nomes seguem a mesma matriz do formulário", () =>
  P.emTransacao(async () => {
    const casos = [
      [null, "Cliente"],
      ["", "Cliente"],
      [" \t ", "Cliente"],
      ["Madonna", "Madonna"],
      ["Ana de Souza", "Ana S."],
      ["Maria Alves dE DA Do DAS Dos E", "Maria A."],
      ["João   das   Neves", "João N."],
      ["Ana-Maria Souza-Lima", "Ana-Maria S."],
      ["Érica álvares", "Érica Á."],
      [`Érica a${String.fromCodePoint(0x0301)}lvares`, "Érica Á."],
      ["Ana de", "Ana"],
      ["Maria ßauer", "Maria S."],
    ];
    const linhas = await q(
      `SELECT public.nome_publico_de(nome) AS nome
         FROM unnest($1::text[]) WITH ORDINALITY AS t(nome, ordem)
         ORDER BY ordem`,
      [casos.map(([original]) => original)],
    );
    assert.deepEqual(
      linhas.map(({ nome }) => nome),
      casos.map(([, esperado]) => esperado),
    );
    const [funcao] = await q(
      `SELECT provolatile, prosecdef, proconfig
         FROM pg_proc WHERE oid = 'public.nome_publico_de(text)'::regprocedure`,
    );
    assert.deepEqual(funcao, {
      provolatile: "i",
      prosecdef: false,
      proconfig: ["search_path=pg_catalog"],
    });
  }),
);

prova(
  "abrevia conteúdo antigo e novo; preserva foto, moderação, contrato e nome cadastrado; rollback restaura o corpo",
  () =>
    P.emTransacao(async () => {
      const migration = P.lerMigration(MIGRATION);
      const rollback = P.lerMigration(`rollback-manual-${MIGRATION}`);
      const anterior = await catalogoDasViews();

      await q(rollback);
      const corpoAnterior = await definicoesDasViews();
      assert.deepEqual(
        await P.consulta("165b-antes-o-nome-publico-da-vitrine-base-vigente"),
        [],
      );
      await semear();
      const testarVitrine = async (nome) => {
        const linhas = await nomesNaVitrine();
        assert.deepEqual(
          linhas,
          Array.from({ length: 2 }, () => ({
            author_name: nome,
            author_avatar_url: "https://fixture.invalid/avatar.png",
          })),
        );
      };
      await testarVitrine("Ana de Souza");

      await q(migration);
      assert.deepEqual(await catalogoDasViews(), anterior);
      assert.deepEqual(
        await P.consulta("165a-conferir-o-nome-publico-da-vitrine-aplicado"),
        [],
      );
      await testarVitrine("Ana S.");
      assert.deepEqual(
        await q(
          "SELECT full_name, nome_publico FROM public.public_profiles WHERE id = $1",
          [AUTORA],
        ),
        [{ full_name: "Ana de Souza", nome_publico: "Ana S." }],
      );
      await q(
        "UPDATE public.profiles SET full_name = 'Érica Álvares' WHERE id = $1",
        [AUTORA],
      );
      await testarVitrine("Érica Á.");

      await q(rollback);
      assert.deepEqual(await definicoesDasViews(), corpoAnterior);
      assert.deepEqual(
        await P.consulta("165b-antes-o-nome-publico-da-vitrine-base-vigente"),
        [],
      );
      assert.deepEqual(await catalogoDasViews(), anterior);
      assert.deepEqual(
        await q("SELECT to_regprocedure('public.nome_publico_de(text)') AS f"),
        [{ f: null }],
      );
      await testarVitrine("Érica Álvares");
    }),
);

prova(
  "pré-voo para se uma view estiver diferente e não deixa objeto novo",
  () =>
    P.emTransacao(async () => {
      await q(P.lerMigration(`rollback-manual-${MIGRATION}`));
      await q(
        "ALTER VIEW public.vw_questions_public SET (security_invoker = true)",
      );
      await P.recusa(P.lerMigration(MIGRATION), /B1_BASELINE_DIVERGENT/);
      assert.deepEqual(
        await q("SELECT to_regprocedure('public.nome_publico_de(text)') AS f"),
        [{ f: null }],
      );
      const [{ existe }] = await q(`SELECT EXISTS (
      SELECT 1 FROM pg_attribute WHERE attrelid = 'public.public_profiles'::regclass
        AND attname = 'nome_publico' AND NOT attisdropped
    ) AS existe`);
      assert.equal(existe, false);
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.executar("o nome público da vitrine");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.message));
