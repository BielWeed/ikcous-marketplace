"use strict";

/**
 * `vw_reviews_public` (20261110000000_o_visitante_le_avaliacoes_e_perguntas_pela_vitrine.sql:121-136): a vitrine das avaliacoes
 * para o visitante sem login e para qualquer cliente. Nenhum CREATE VIEW posterior mexeu nela.
 *
 * O que protege: a MODERACAO. A view roda com o poder do dono (sem security_invoker) e passa por cima da RLS de `reviews`
 * (reviews_select_policy), entao o `WHERE r.status = 'publicada'` e' a UNICA guarda desse caminho. Sem ele, o texto de uma cliente
 * que o lojista ainda nao aprovou (ofensa, spam, difamacao) e a resposta da loja a ele ficariam publicos em toda loja. E a lista de
 * colunas e' a outra metade: com `user_id` na view, qualquer visitante ligaria cada avaliacao a uma conta; com `status`, veria o
 * que esta em moderacao. Ate hoje os testes de banco so liam a view para conferir author_name/author_avatar_url
 * (portas-do-banco-viva.cjs) e o teto do nome; nenhum semeava avaliacao pendente nem conferia as colunas.
 *
 * Cenarios (cada um e' uma prova). Duas avaliacoes do MESMO produto: a da autora B, 'publicada'; a da autora C, 'pendente', com
 * comentario e resposta da loja. A leitora A (cliente, nao autora, nao admin) e' a pessoa de fora:
 *  1. como ANON: a view devolve so a publicada (por lista, por id e por contagem), com o nome real da autora, e nenhuma coluna
 *     carrega o texto ou a resposta da pendente;
 *  2. como AUTHENTICATED nao autora (A) e como a PROPRIA autora da pendente (C): o mesmo. A vitrine e' publica: nem a dona ve a
 *     avaliacao em moderacao por ela;
 *  3. as colunas sao EXATAMENTE as esperadas, nesta ordem, por information_schema.columns e pela linha devolvida: sem user_id e
 *     sem status;
 *  4. a view e' so de leitura para anon e authenticated (sem INSERT, UPDATE, DELETE, TRUNCATE nem TRIGGER);
 *  5. controle: a pendente EXISTE na tabela (o dono do clone conta as duas) e, depois de publicada, a view passa a mostra-la:
 *     o que a escondia era o filtro, nao a fixture nem uma view quebrada.
 *
 * So Postgres EFEMERO (rodar-isolado.cjs). Fixtures e mutantes ficam numa transacao sempre desfeita. O mutante recria a view VIVA
 * a partir de pg_get_viewdef (confere que o trecho trocado aparece 1 vez) e confirma que a sabotagem pegou.
 *
 * MUTANTE_R134D (nome desconhecido = ERRO):
 *   view-sem-o-where              tira `WHERE r.status = 'publicada'`                          -> vermelho no 1 e no 2 (o 5 segue verde)
 *   filtro-publicada-ou-pendente  troca o filtro por status IN ('publicada','pendente')        -> vermelho no 1 e no 2 (o 5 segue verde)
 *   view-com-user-id              acrescenta `r.user_id` as colunas                            -> vermelho no 3
 *   view-com-status               acrescenta `r.status` as colunas                             -> vermelho no 3
 *   view-aberta-a-escrita         GRANT UPDATE na view a authenticated                         -> vermelho no 4
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/a-vitrine-so-mostra-avaliacao-publicada-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const U_LEITORA = "b134d000-0000-4000-8000-0000000001a1"; // A: nao autora
const U_AUTORA_PUB = "b134d000-0000-4000-8000-0000000001b2"; // B
const U_AUTORA_PEND = "b134d000-0000-4000-8000-0000000001c3"; // C
const PRODUTO = "b134d000-0000-4000-8000-0000000001d1";
const R_PUB = "b134d000-0000-4000-8000-0000000001e1";
const R_PEND = "b134d000-0000-4000-8000-0000000001e2";
const TEXTO_PUB = "Texto publicado fixture";
const TEXTO_PEND = "Texto em moderacao fixture nao aprovado";
const RESPOSTA_PEND = "Resposta da loja a pendente fixture";
const NOME_PUB = "Autora Publicada Ficticia";

const COLUNAS = [
  "id",
  "product_id",
  "rating",
  "comment",
  "created_at",
  "helpful",
  "verified",
  "merchant_reply",
  "merchant_reply_at",
  "author_name",
  "author_avatar_url",
];
const FILTRO_VIVO = "WHERE (r.status = 'publicada'::text)";
const MUTANTES_CONHECIDOS = [
  "view-sem-o-where",
  "filtro-publicada-ou-pendente",
  "view-com-user-id",
  "view-com-status",
  "view-aberta-a-escrita",
];
const MUTANTE = process.env.MUTANTE_R134D;

const identidade = (uid) => ({
  uid,
  claims: JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: { role: "customer" },
  }),
});
const QUEM = new Map([
  ["anon", ["anon", {}]],
  ["leitora", ["authenticated", identidade(U_LEITORA)]],
  ["autoraPendente", ["authenticated", identidade(U_AUTORA_PEND)]],
]);

const q = async (sql, params = []) =>
  (await P.conexao().query(sql, params)).rows;

async function semear() {
  const c = P.conexao();
  await c.query("GRANT USAGE ON SCHEMA auth TO anon, authenticated");
  await c.query("GRANT USAGE ON SCHEMA extensions TO anon, authenticated");
  for (const id of [U_LEITORA, U_AUTORA_PUB, U_AUTORA_PEND]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $2, '{}'::jsonb)",
      [id, `${id}@vitrine-de-avaliacoes.fixture.invalid`],
    );
  }
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Leitora Ficticia', 'customer'), ($2, $4, 'customer'), ($3, 'Autora Pendente Ficticia', 'customer')`,
    [U_LEITORA, U_AUTORA_PUB, U_AUTORA_PEND, NOME_PUB],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
     VALUES ($1, 'Produto Vitrine Ficticio', 100, 10, true, 40)`,
    [PRODUTO],
  );
  // Semeado pela conexao dona (role 'none'): o gatilho que limpa a resposta da loja so age em papel de cliente.
  await c.query(
    `INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status, merchant_reply, merchant_reply_at) VALUES
       ($1, $3, $4, 5, $6, 'publicada', NULL, NULL),
       ($2, $3, $5, 1, $7, 'pendente', $8, now())`,
    [
      R_PUB,
      R_PEND,
      PRODUTO,
      U_AUTORA_PUB,
      U_AUTORA_PEND,
      TEXTO_PUB,
      TEXTO_PEND,
      RESPOSTA_PEND,
    ],
  );
  const semeada = await q(
    "SELECT id, status, comment, merchant_reply FROM public.reviews WHERE product_id = $1 ORDER BY id",
    [PRODUTO],
  );
  assert.deepEqual(
    semeada.map((l) => [l.id, l.status, l.comment, l.merchant_reply]),
    [
      [R_PUB, "publicada", TEXTO_PUB, null],
      [R_PEND, "pendente", TEXTO_PEND, RESPOSTA_PEND],
    ],
    "fixtures: a pendente tem de existir com comentario e resposta da loja",
  );
}

const viewdef = async () =>
  (
    await q("SELECT pg_get_viewdef('public.vw_reviews_public'::regclass) AS d")
  )[0].d
    .trim()
    .replace(/;$/, "");
const umaVez = (texto, trecho) => texto.split(trecho).length - 1;

/** Sabota a view VIVA dentro da transacao desfeita; confere que o trecho existe 1 vez e que a sabotagem pegou. */
async function mutar() {
  if (!MUTANTE) return;
  const c = P.conexao();
  const recriar = async (de, para) => {
    const def = await viewdef();
    assert.equal(
      umaVez(def, de),
      1,
      `o trecho ${JSON.stringify(de)} devia aparecer 1 vez na view viva`,
    );
    await c.query(
      `CREATE OR REPLACE VIEW public.vw_reviews_public AS ${def.replace(de, para)}`,
    );
  };
  if (MUTANTE === "view-sem-o-where") {
    await recriar(FILTRO_VIVO, "");
    assert.equal(
      umaVez(await viewdef(), "publicada"),
      0,
      "o mutante devia tirar o filtro",
    );
  } else if (MUTANTE === "filtro-publicada-ou-pendente") {
    await recriar(
      FILTRO_VIVO,
      "WHERE (r.status = ANY (ARRAY['publicada'::text, 'pendente'::text]))",
    );
    assert.equal(
      umaVez(await viewdef(), "'pendente'"),
      1,
      "o mutante devia aceitar a pendente",
    );
  } else if (MUTANTE === "view-com-user-id") {
    await recriar(
      "pp.avatar_url AS author_avatar_url",
      "pp.avatar_url AS author_avatar_url,\n    r.user_id",
    );
    assert.equal(
      (
        await q(
          "SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name = 'vw_reviews_public' AND column_name = 'user_id'",
        )
      )[0].n,
      1,
      "o mutante devia expor a coluna",
    );
  } else if (MUTANTE === "view-com-status") {
    await recriar(
      "pp.avatar_url AS author_avatar_url",
      "pp.avatar_url AS author_avatar_url,\n    r.status",
    );
  } else if (MUTANTE === "view-aberta-a-escrita") {
    await c.query("GRANT UPDATE ON public.vw_reviews_public TO authenticated");
    assert.equal(
      (
        await q(
          "SELECT has_any_column_privilege('authenticated', 'public.vw_reviews_public', 'UPDATE') AS u",
        )
      )[0].u,
      true,
      "o mutante devia abrir o UPDATE",
    );
  }
}

const cenario = (fn) =>
  P.emTransacao(async () => {
    await semear();
    await mutar();
    await fn();
  });

/** Le a view como `quem` (so o erro nao e' esperado aqui: a vitrine tem de responder). */
async function lerComo(quem, sql, params = []) {
  const [papel, id] = QUEM.get(quem);
  const t = await P.tentar(papel, sql, params, id);
  assert.equal(t.erro, undefined, `${quem} devia ler a vitrine: ${t.erro}`);
  return t.linhas;
}

async function vitrineSoTemAPublicada(quem) {
  const lista = await lerComo(
    quem,
    "SELECT id FROM public.vw_reviews_public WHERE product_id = $1 ORDER BY id",
    [PRODUTO],
  );
  assert.deepEqual(
    lista.map((l) => l.id),
    [R_PUB],
    `${quem}: a vitrine devia ter SO a avaliacao publicada`,
  );
  // por id: a pendente nao aparece nem sabendo o id dela
  assert.deepEqual(
    await lerComo(
      quem,
      "SELECT id FROM public.vw_reviews_public WHERE id = $1",
      [R_PEND],
    ),
    [],
    `${quem} achou a pendente por id`,
  );
  // por contagem: nem agregada
  const [{ n }] = await lerComo(
    quem,
    "SELECT count(*)::int AS n FROM public.vw_reviews_public WHERE product_id = $1",
    [PRODUTO],
  );
  assert.equal(n, 1, `${quem}: a contagem da vitrine devia ser 1`);
  // o texto e a resposta da pendente nao saem em coluna nenhuma
  const tudo = JSON.stringify(
    await lerComo(
      quem,
      "SELECT * FROM public.vw_reviews_public WHERE product_id = $1",
      [PRODUTO],
    ),
  );
  for (const segredo of [
    TEXTO_PEND,
    RESPOSTA_PEND,
    U_AUTORA_PEND,
    "Autora Pendente",
  ])
    assert.ok(
      !tudo.includes(segredo),
      `${quem}: a vitrine vazou ${JSON.stringify(segredo)}`,
    );
  // e a publicada sai inteira, com o nome real da autora
  const [pub] = await lerComo(
    quem,
    "SELECT comment, rating, author_name FROM public.vw_reviews_public WHERE id = $1",
    [R_PUB],
  );
  assert.deepEqual(pub, {
    comment: TEXTO_PUB,
    rating: 5,
    author_name: NOME_PUB,
  });
}

prova(
  "1. o visitante sem login so ve a avaliacao publicada (por lista, por id e por contagem), sem o texto nem a resposta da pendente",
  () => cenario(() => vitrineSoTemAPublicada("anon")),
);

prova(
  "2. a cliente logada (nao autora) e a propria autora da pendente veem na vitrine so a publicada",
  () =>
    cenario(async () => {
      await vitrineSoTemAPublicada("leitora");
      await vitrineSoTemAPublicada("autoraPendente");
    }),
);

prova(
  "3. as colunas da vitrine sao exatamente as esperadas: sem user_id e sem status",
  () =>
    cenario(async () => {
      const catalogo = (
        await q(
          "SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'vw_reviews_public' ORDER BY ordinal_position",
        )
      ).map((l) => l.column_name);
      assert.deepEqual(
        catalogo,
        COLUNAS,
        "colunas da view (information_schema)",
      );
      for (const quem of ["anon", "leitora"]) {
        const [linha] = await lerComo(
          quem,
          "SELECT * FROM public.vw_reviews_public WHERE id = $1",
          [R_PUB],
        );
        assert.deepEqual(
          Object.keys(linha),
          COLUNAS,
          `${quem}: colunas da linha devolvida`,
        );
        assert.ok(
          !("user_id" in linha) && !("status" in linha),
          `${quem}: user_id ou status na vitrine`,
        );
      }
    }),
);

prova("4. a vitrine e' so de leitura para anon e authenticated", () =>
  cenario(async () => {
    for (const papel of ["anon", "authenticated"]) {
      const [priv] = await q(
        `SELECT has_table_privilege($1, 'public.vw_reviews_public', 'SELECT') AS le,
                  has_any_column_privilege($1, 'public.vw_reviews_public', 'INSERT') AS insere,
                  has_any_column_privilege($1, 'public.vw_reviews_public', 'UPDATE') AS atualiza,
                  has_table_privilege($1, 'public.vw_reviews_public', 'DELETE') AS apaga,
                  has_table_privilege($1, 'public.vw_reviews_public', 'TRUNCATE') AS trunca,
                  has_table_privilege($1, 'public.vw_reviews_public', 'TRIGGER') AS gatilho`,
        [papel],
      );
      assert.deepEqual(
        priv,
        {
          le: true,
          insere: false,
          atualiza: false,
          apaga: false,
          trunca: false,
          gatilho: false,
        },
        `${papel}: privilegios da vitrine`,
      );
    }
  }),
);

prova(
  "5. controle: a pendente existe na tabela e, publicada, a vitrine passa a mostra-la (o que a escondia era o filtro)",
  () =>
    cenario(async () => {
      assert.equal(
        (
          await q(
            "SELECT count(*)::int AS n FROM public.reviews WHERE product_id = $1",
            [PRODUTO],
          )
        )[0].n,
        2,
      );
      await P.conexao().query(
        "UPDATE public.reviews SET status = 'publicada' WHERE id = $1",
        [R_PEND],
      );
      const lista = await lerComo(
        "anon",
        "SELECT id FROM public.vw_reviews_public WHERE product_id = $1 ORDER BY id",
        [PRODUTO],
      );
      assert.deepEqual(lista.map((l) => l.id).sort(), [R_PUB, R_PEND].sort());
    }),
);

async function main() {
  if (MUTANTE && !MUTANTES_CONHECIDOS.includes(MUTANTE))
    P.falhar(
      "ERRO",
      `MUTANTE_R134D desconhecido: ${MUTANTE} (validos: ${MUTANTES_CONHECIDOS.join(", ")})`,
    );
  await P.conectar();
  try {
    await P.executar("a vitrine so mostra avaliacao publicada");
  } finally {
    await P.conexao().end();
  }
}

main().catch((erro) => P.falhar("FALHOU", erro.message));
