"use strict";

/**
 * questions_insert_policy (migration 20261036000000): a conta A nao publica uma pergunta assinada pela conta B.
 * Ate hoje nenhum teste de banco inseria com user_id alheio: `a-pergunta-nasce-com-a-data-de-agora-viva.cjs` usa o mesmo uid no JWT
 * e no user_id, e `tests/front/pergunta-nasce-com-o-autor.test.ts` so le a migration como texto.
 *
 * Cenarios (cada um e' uma prova, para o vermelho do mutante cair no nome certo):
 *  0. so existe UMA politica de INSERT em questions (politicas permissivas se somam por OR: uma segunda abriria o que esta fecha);
 *  1. authenticated uid=A, user_id=B: recusado (42501, row-level security) e ZERO linha gravada;
 *  2. controle: mesmo INSERT, mesma sessao, so user_id muda para A: entra 1 linha, user_id=A (descarta falha de fixture/FK/grant);
 *  3. anon (sem sessao): recusado pela RLS, nada gravado;
 *  4. authenticated uid=A com user_id NULL: nao grava.
 *
 * INSERT SEM RETURNING: a recusa tem de vir do WITH CHECK da politica de escrita, nao da de leitura (questions_select_policy e' true).
 *
 * So Postgres EFEMERO (rodar-isolado.cjs). Fixtures e mutantes ficam numa transacao sempre desfeita.
 *
 * MUTANTE_R109A (nome desconhecido = ERRO):
 *   politica-sem-checagem-do-autor  ALTER POLICY ... WITH CHECK ((SELECT auth.uid()) IS NOT NULL)  (o baseline antigo) -> vermelho no 1
 *   politica-aceita-anon            soma uma politica permissiva de INSERT para anon                                   -> vermelho no 3
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-pergunta-so-nasce-em-nome-da-propria-conta-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const A = "b109a000-0000-4000-8000-0000000000a1";
const B = "b109a000-0000-4000-8000-0000000000b2";
const PRODUTO = "b109a000-0000-4000-8000-0000000000f1";
const MUTANTES_CONHECIDOS = [
  "politica-sem-checagem-do-autor",
  "politica-aceita-anon",
];
const MUTANTE = process.env.MUTANTE_R109A;

const IDENTIDADE_A = {
  uid: A,
  claims: JSON.stringify({ sub: A, role: "authenticated", app_metadata: {} }),
};
const SEM_SESSAO = { uid: "", claims: "" };

async function semear() {
  const c = P.conexao();
  for (const id of [A, B]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}'::jsonb)",
      [id, `${id}@pergunta.fixture.invalid`],
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
}

const politicas = async () =>
  (
    await P.conexao().query(
      `SELECT policyname, cmd, roles::text AS roles, with_check
         FROM pg_policies WHERE schemaname = 'public' AND tablename = 'questions'
          AND cmd IN ('INSERT', 'ALL') ORDER BY policyname`,
    )
  ).rows;

/** Sabota a politica VIVA dentro da transacao desfeita; confirma que o trecho existe 1 vez e que a sabotagem pegou. */
async function mutar() {
  if (!MUTANTE) return;
  const c = P.conexao();
  const antes = await politicas();
  assert.equal(
    antes.length,
    1,
    "o mutante precisa achar UMA politica de INSERT",
  );
  assert.equal(antes[0].policyname, "questions_insert_policy");
  if (MUTANTE === "politica-sem-checagem-do-autor") {
    assert.equal(
      antes[0].with_check.split("user_id = ").length - 1,
      1,
      "a checagem do autor devia aparecer 1 vez na politica viva",
    );
    await c.query(
      "ALTER POLICY questions_insert_policy ON public.questions WITH CHECK ((SELECT auth.uid()) IS NOT NULL)",
    );
    const depois = await politicas();
    assert.ok(
      !depois[0].with_check.includes("user_id"),
      "o mutante devia tirar a checagem do autor",
    );
  } else if (MUTANTE === "politica-aceita-anon") {
    // Politicas permissivas somam por OR: esta so abre o anon, sem tocar na do authenticated.
    await c.query(
      "CREATE POLICY questions_mutante_anon ON public.questions FOR INSERT TO anon WITH CHECK (true)",
    );
    assert.equal(
      (await politicas()).length,
      2,
      "o mutante devia somar a politica",
    );
  }
}

const SQL =
  "INSERT INTO public.questions (product_id, user_id, question) VALUES ($1::uuid, $2::uuid, $3)";
const gravadas = async () =>
  (
    await P.conexao().query(
      "SELECT product_id, user_id, question FROM public.questions WHERE product_id = $1 ORDER BY question",
      [PRODUTO],
    )
  ).rows;

/** Monta o clone (fixtures + mutante), garante que parte do vazio e roda o cenario. */
const cenario = (fn) =>
  P.emTransacao(async () => {
    await semear();
    await mutar();
    assert.deepEqual(
      await gravadas(),
      [],
      "o produto devia comecar sem perguntas",
    );
    await fn();
  });

prova(
  "so existe UMA politica de INSERT em questions, para authenticated, com a checagem do autor",
  () =>
    cenario(async () => {
      const lista = await politicas();
      const nomes = lista.map((p) => `${p.policyname} (${p.cmd})`);
      assert.equal(
        lista.length,
        1,
        `politicas permissivas de escrita se somam por OR: ${JSON.stringify(nomes)}`,
      );
      assert.equal(lista[0].policyname, "questions_insert_policy");
      assert.equal(lista[0].cmd, "INSERT");
      assert.equal(lista[0].roles, "{authenticated}");
      assert.match(lista[0].with_check, /user_id = \( SELECT auth\.uid\(\)/);
    }),
);

prova("1. A nao publica pergunta em nome de B: 42501 e zero linhas", () =>
  cenario(async () => {
    const t = await P.tentar(
      "authenticated",
      SQL,
      [PRODUTO, B, "pergunta forjada"],
      IDENTIDADE_A,
    );
    assert.equal(
      t.codigo,
      "42501",
      `a escrita em nome alheio devia ser recusada pela RLS (veio: ${t.erro ?? "gravou"})`,
    );
    assert.match(t.erro, /new row violates row-level security policy/);
    // le pela conexao dona do clone, que nao passa por politica nenhuma: nada escapa da conferencia
    assert.deepEqual(
      await gravadas(),
      [],
      "a tentativa deixou pergunta gravada em nome de B",
    );
  }),
);

prova(
  "2. controle: o mesmo INSERT com user_id=A entra, 1 linha assinada por A",
  () =>
    cenario(async () => {
      // Antes do controle, a tentativa em nome de B tem de ter falhado: o controle so vale se a sessao e' a mesma.
      const recusada = await P.tentar(
        "authenticated",
        SQL,
        [PRODUTO, B, "pergunta forjada"],
        IDENTIDADE_A,
      );
      assert.equal(recusada.codigo, "42501");
      const ok = await P.tentar(
        "authenticated",
        SQL,
        [PRODUTO, A, "pergunta propria"],
        IDENTIDADE_A,
      );
      assert.equal(ok.codigo, undefined, ok.erro);
      assert.deepEqual(await gravadas(), [
        { product_id: PRODUTO, user_id: A, question: "pergunta propria" },
      ]);
    }),
);

prova(
  "3. anon (sem sessao) nao publica pergunta: recusado pela RLS e nada gravado",
  () =>
    cenario(async () => {
      for (const dono of [A, B]) {
        const t = await P.tentar(
          "anon",
          SQL,
          [PRODUTO, dono, `pergunta do anonimo em nome de ${dono.slice(-2)}`],
          SEM_SESSAO,
        );
        assert.equal(
          t.codigo,
          "42501",
          `anon devia ser recusado (veio: ${t.erro ?? "gravou"})`,
        );
        assert.match(t.erro, /row-level security/);
      }
      assert.deepEqual(
        await gravadas(),
        [],
        "o anonimo deixou pergunta gravada",
      );
    }),
);

prova("4. A com user_id NULL: nao grava", () =>
  cenario(async () => {
    const t = await P.tentar(
      "authenticated",
      SQL,
      [PRODUTO, null, "pergunta sem autor"],
      IDENTIDADE_A,
    );
    assert.ok(t.erro, "user_id NULL nao pode gravar");
    // A RLS roda antes do NOT NULL: `user_id = uid` vira NULL e a politica recusa (42501). Sem a checagem do autor, o NOT NULL
    // (23502) segura do mesmo jeito: o que se prova aqui e' que nada fica gravado, nos dois casos.
    assert.ok(
      ["42501", "23502"].includes(t.codigo),
      `codigo inesperado: ${t.codigo}`,
    );
    assert.deepEqual(
      await gravadas(),
      [],
      "a pergunta sem autor ficou gravada",
    );
  }),
);

async function main() {
  if (MUTANTE && !MUTANTES_CONHECIDOS.includes(MUTANTE))
    P.falhar(
      "ERRO",
      `MUTANTE_R109A desconhecido: ${MUTANTE} (validos: ${MUTANTES_CONHECIDOS.join(", ")})`,
    );
  await P.conectar();
  try {
    await P.executar("pergunta so nasce em nome da propria conta");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.message));
