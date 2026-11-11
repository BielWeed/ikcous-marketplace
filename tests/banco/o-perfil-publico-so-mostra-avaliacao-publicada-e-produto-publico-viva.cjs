"use strict";

/**
 * Prova VIVA do perfil publico do autor (migration 20261130000000, ultima que define as duas funcoes;
 * a 20261219 so mexe na policy de public_profiles): `perfil_publico_avaliacoes(p_autor)` e
 * `perfil_publico_perguntas(p_autor)`, SECURITY DEFINER, executaveis por anon e authenticated, que a tela do
 * autor (aberta por visitante SEM login) usa no lugar de ler `reviews`/`questions` direto.
 *
 * O que elas prometem e esta prova segura (tudo dado de cliente, por isso a prova importa):
 *  - so a avaliacao PUBLICADA do autor volta (pendente nunca; o CHECK de status so admite 'publicada' e
 *    'pendente', e esta prova confere que 'rejeitada'/'oculta' continuam recusadas pelo CHECK: se um dia o
 *    CHECK as admitir, o caso falha e manda cobri-las aqui);
 *  - avaliacao de produto inativo ou apagado (soft delete) NAO some: volta com product_id, produto_nome e
 *    produto_imagem_url NULL (a condicao do produto vive no ON do LEFT JOIN, nunca no WHERE) e o uuid do
 *    produto nao publico nao sai em lugar nenhum do resultado;
 *  - o resultado nao tem user_id (conjunto exato de colunas) e so traz o autor pedido;
 *  - perguntas: mesma regra de produto (NULL, a linha fica), respostas num jsonb array com so
 *    {id, answer, created_at} (sem o user_id de quem respondeu), '[]' sem resposta. (A ordem ASC do jsonb_agg nao
 *    e' observavel: o banco so admite UMA resposta por pergunta, idx_answers_question_id_unique.)
 * Cada caso roda como anon E como authenticated.
 *
 * Somente o clone Postgres descartavel de rodar-isolado.cjs, nunca banco de loja. Cada caso e' uma transacao
 * desfeita (fixtures e mutante voltam no ROLLBACK).
 *
 * MUTANTES (`MUTANTE_R109B=<nome>`): troca de texto UNICA no corpo vivo (pg_get_functiondef), dentro da
 * transacao desfeita; nome desconhecido da ERRO. Cada um tem de deixar vermelho o caso certo.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres:postgres@localhost:55500/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-perfil-publico-so-mostra-avaliacao-publicada-e-produto-publico-viva.cjs
 */

/* eslint-disable security/detect-object-injection --
 * Os indices vem de listas fechadas deste arquivo (nomes de mutante validados contra MUTANTES e ids de fixture
 * que o proprio teste semeia), nunca de entrada de rede. */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova } = P;

const FA = "public.perfil_publico_avaliacoes(uuid)";
const FP = "public.perfil_publico_perguntas(uuid)";

// ---------------------------------------------------------------------------
// MUTANTES: [funcao, [[trecho que existe 1 vez no corpo vivo, troca], ...]]
// ---------------------------------------------------------------------------
const PRODUTO_ON = " AND p.ativo = true AND p.deleted_at IS NULL";
const PRODUTO_NO_WHERE = "p.ativo = true AND p.deleted_at IS NULL AND ";
const MUTANTES = {
  "sem-filtro-de-status-publicada": [FA, [["r.status = 'publicada' AND ", ""]]],
  "produto-no-where-em-vez-do-on": [
    FA,
    [
      [PRODUTO_ON, ""],
      ["WHERE r.status", `WHERE ${PRODUTO_NO_WHERE}r.status`],
    ],
  ],
  "sem-filtro-de-produto-ativo": [FA, [[" AND p.ativo = true", ""]]],
  "sem-filtro-de-produto-apagado": [FA, [[" AND p.deleted_at IS NULL", ""]]],
  "avaliacoes-sem-filtro-de-autor": [FA, [[" AND r.user_id = p_autor", ""]]],
  "perguntas-sem-filtro-de-produto-ativo": [FP, [[" AND p.ativo = true", ""]]],
  "perguntas-sem-filtro-de-produto-apagado": [
    FP,
    [[" AND p.deleted_at IS NULL", ""]],
  ],
  "perguntas-produto-no-where-em-vez-do-on": [
    FP,
    [
      [PRODUTO_ON, ""],
      ["WHERE q.user_id", `WHERE ${PRODUTO_NO_WHERE}q.user_id`],
    ],
  ],
  "perguntas-sem-filtro-de-autor": [
    FP,
    [["WHERE q.user_id = p_autor", "WHERE true"]],
  ],
};
const MUTANTE = process.env.MUTANTE_R109B;
if (MUTANTE !== undefined && MUTANTE !== "" && !(MUTANTE in MUTANTES))
  throw new Error(
    `MUTANTE_R109B desconhecido: ${MUTANTE} (validos: ${Object.keys(MUTANTES).join(", ")})`,
  );

/** Aplica o mutante pedido (se houver) no corpo VIVO, por troca de texto unica, e confere que o banco o instalou. */
async function mutar() {
  if (!MUTANTE) return;
  const c = P.conexao();
  const [fn, trocas] = MUTANTES[MUTANTE];
  const def = async () =>
    (await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [fn]))
      .rows[0].d;
  const antes = await def();
  let novo = antes;
  for (const [de, para] of trocas) {
    assert.equal(
      novo.split(de).length - 1,
      1,
      `mutante ${MUTANTE}: o trecho "${de}" deve aparecer 1 vez em ${fn}`,
    );
    novo = novo.replace(de, () => para);
  }
  assert.notEqual(novo, antes, `mutante ${MUTANTE}: nada mudou`);
  await c.query(novo);
  assert.equal(
    await def(),
    novo,
    `mutante ${MUTANTE}: o banco nao instalou exatamente o mutante`,
  );
  console.log(`MUTANTE aplicado: ${MUTANTE}`);
}

// ---------------------------------------------------------------------------
// FIXTURES (dados inventados)
// ---------------------------------------------------------------------------
const id = (n) => `b109b000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const U = {
  A: id(1), // autor do caso "so a publicada"
  B: id(2), // autor do caso "produto nao publico"
  C: id(3), // outro autor (nao pode vazar para A/B)
  VISITANTE: id(4), // a sessao logada que olha o perfil dos outros
  RESPONDEDOR: id(5), // quem responde as perguntas (answers.user_id)
  VAZIO: id(6), // autor sem nada
};
const PROD = {
  ATIVO: id(10),
  ATIVO2: id(11),
  INATIVO: id(12),
  APAGADO: id(13),
};
const R = {
  A_PUBLICADA: id(20),
  A_PENDENTE: id(21),
  B_OK: id(22),
  B_INATIVO: id(23),
  B_APAGADO: id(24),
  A_PENDENTE_INATIVO: id(25),
  C_PUBLICADA: id(26),
};
const Q = {
  B_ATIVO: id(30),
  B_INATIVO: id(31),
  B_APAGADO: id(32),
  C_ATIVO: id(33),
  B_SEM_RESPOSTA: id(34),
};
const AN = { UNICA: id(40) };

const NOME_ATIVO = "Camiseta Ficticia Ativa";
const IMG_ATIVO = "https://fixture.invalid/ativa.png";
const COLUNAS_AVALIACOES = [
  "id",
  "product_id",
  "rating",
  "comment",
  "created_at",
  "helpful",
  "verified",
  "merchant_reply",
  "merchant_reply_at",
  "produto_nome",
  "produto_imagem_url",
];
const COLUNAS_PERGUNTAS = [
  "id",
  "product_id",
  "question",
  "created_at",
  "produto_nome",
  "produto_imagem_url",
  "answers",
];

async function semear() {
  const c = P.conexao();
  for (const [rotulo, uid] of Object.entries(U)) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}'::jsonb)",
      [uid, `${rotulo.toLowerCase()}@r109b.fixture.invalid`],
    );
    await c.query(
      "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa ficticia', 'customer')",
      [uid],
    );
  }
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, imagem_url, deleted_at) VALUES
       ($1, $5, 100, 10, true, 40, $6, NULL),
       ($2, 'Camiseta Ficticia Ativa Dois', 100, 10, true, 40, 'https://fixture.invalid/ativa2.png', NULL),
       ($3, 'Camiseta Ficticia Inativa', 100, 10, false, 40, 'https://fixture.invalid/inativa.png', NULL),
       ($4, 'Camiseta Ficticia Apagada', 100, 10, true, 40, 'https://fixture.invalid/apagada.png', now())`,
    [
      PROD.ATIVO,
      PROD.ATIVO2,
      PROD.INATIVO,
      PROD.APAGADO,
      NOME_ATIVO,
      IMG_ATIVO,
    ],
  );
  // avaliacoes: created_at explicito (a sessao direta grava como veio)
  await c.query(
    `INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status, helpful, merchant_reply, created_at) VALUES
       ($1, $8, $12, 5, 'Gostei muito', 'publicada', 3, 'Obrigada pela avaliacao', '2030-01-05T10:00:00Z'),
       ($2, $9, $12, 1, 'Ainda nao aprovada', 'pendente', 0, NULL, '2030-01-06T10:00:00Z'),
       ($3, $8, $13, 4, 'Produto ativo do autor B', 'publicada', 0, NULL, '2030-01-07T10:00:00Z'),
       ($4, $10, $13, 3, 'Produto inativo do autor B', 'publicada', 0, NULL, '2030-01-08T10:00:00Z'),
       ($5, $11, $13, 2, 'Produto apagado do autor B', 'publicada', 0, NULL, '2030-01-09T10:00:00Z'),
       ($6, $10, $12, 1, 'Pendente de produto inativo do autor A', 'pendente', 0, NULL, '2030-01-10T10:00:00Z'),
       ($7, $8, $14, 5, 'Avaliacao de outro autor', 'publicada', 0, NULL, '2030-01-11T10:00:00Z')`,
    [
      R.A_PUBLICADA,
      R.A_PENDENTE,
      R.B_OK,
      R.B_INATIVO,
      R.B_APAGADO,
      R.A_PENDENTE_INATIVO,
      R.C_PUBLICADA,
      PROD.ATIVO,
      PROD.ATIVO2,
      PROD.INATIVO,
      PROD.APAGADO,
      U.A,
      U.B,
      U.C,
    ],
  );
  await c.query(
    `INSERT INTO public.questions (id, product_id, user_id, question, created_at) VALUES
       ($1, $5, $8, 'Tem no tamanho M?', '2030-02-01T10:00:00Z'),
       ($2, $6, $8, 'Quando volta ao estoque?', '2030-02-02T10:00:00Z'),
       ($3, $7, $8, 'Ainda existe?', '2030-02-03T10:00:00Z'),
       ($4, $5, $9, 'Pergunta de outro autor', '2030-02-04T10:00:00Z'),
       ($10, $11, $8, 'Vem em outra cor?', '2030-02-05T10:00:00Z')`,
    [
      Q.B_ATIVO,
      Q.B_INATIVO,
      Q.B_APAGADO,
      Q.C_ATIVO,
      PROD.ATIVO,
      PROD.INATIVO,
      PROD.APAGADO,
      U.B,
      U.C,
      Q.B_SEM_RESPOSTA,
      PROD.ATIVO2,
    ],
  );
  // uma resposta na pergunta do produto ativo (o banco so admite UMA por pergunta: idx_answers_question_id_unique)
  await c.query(
    `INSERT INTO public.answers (id, question_id, user_id, answer, created_at)
       VALUES ($1, $2, $3, 'Resposta da loja ficticia', '2030-02-01T11:00:00Z')`,
    [AN.UNICA, Q.B_ATIVO, U.RESPONDEDOR],
  );
}

const IDENTIDADE_LOGADA = {
  uid: U.VISITANTE,
  claims: JSON.stringify({
    sub: U.VISITANTE,
    role: "authenticated",
    app_metadata: { role: "customer" },
  }),
};
/** anon (visitante sem login) e authenticated (logado, mas NAO o autor): as duas portas da tela publica. */
const PAPEIS = [
  ["anon", {}],
  ["authenticated", IDENTIDADE_LOGADA],
];

async function chamar(papel, identidade, fn, autor) {
  const r = await P.tentar(
    papel,
    `SELECT * FROM ${fn.replace("(uuid)", "")}($1::uuid)`,
    [autor],
    identidade,
  );
  assert.equal(r.erro, undefined, `${papel} chamando ${fn}: ${r.erro}`);
  return r.linhas;
}
const ids = (linhas) => linhas.map((l) => l.id).sort();
const porId = (linhas) => Object.fromEntries(linhas.map((l) => [l.id, l]));
/** Os `esperados` que NAO estao em `linhas` (cada guarda de "a linha nao some" cai aqui, sem depender de linha alheia). */
const faltam = (linhas, esperados) =>
  esperados.filter((e) => !linhas.some((l) => l.id === e));
const emCaso = (corpo) =>
  P.emTransacao(async () => {
    await semear();
    await corpo();
  }, mutar);

// ---------------------------------------------------------------------------
// AVALIACOES
// ---------------------------------------------------------------------------

prova(
  "PREMISSA: o CHECK de status so admite publicada e pendente (rejeitada/oculta sao recusadas) e as fixtures entraram",
  () =>
    emCaso(async () => {
      for (const valor of ["rejeitada", "oculta"]) {
        const r = await P.tentar(
          null,
          `INSERT INTO public.reviews (product_id, user_id, rating, comment, status)
             VALUES ($1, $2, 3, 'x', $3)`,
          [PROD.ATIVO, U.A, valor],
          {},
        );
        assert.equal(
          r.codigo,
          "23514",
          `o CHECK de status passou a admitir '${valor}': cubra esse valor nesta prova (${r.erro})`,
        );
      }
      const n = (
        await P.conexao().query(
          "SELECT count(*)::int AS n FROM public.reviews WHERE id = ANY($1::uuid[])",
          [Object.values(R)],
        )
      ).rows[0].n;
      assert.equal(n, Object.keys(R).length, "fixtures de avaliacao");
    }),
);

prova(
  "avaliacoes: so a PUBLICADA do autor volta (a pendente nao), como anon e como authenticated",
  () =>
    emCaso(async () => {
      for (const [papel, identidade] of PAPEIS) {
        const linhas = await chamar(papel, identidade, FA, U.A);
        assert.deepEqual(
          faltam(linhas, [R.A_PUBLICADA]),
          [],
          `${papel}: a publicada do autor nao voltou`,
        );
        assert.deepEqual(
          ids(linhas).filter((i) =>
            [R.A_PENDENTE, R.A_PENDENTE_INATIVO].includes(i),
          ),
          [],
          `${papel}: so a publicada volta (a pendente do autor nao pode aparecer)`,
        );
      }
    }),
);

prova(
  "avaliacoes: so o autor pedido (avaliacao publicada de outro autor nao vem), autor sem nada e NULL voltam vazios",
  () =>
    emCaso(async () => {
      for (const [papel, identidade] of PAPEIS) {
        const a = await chamar(papel, identidade, FA, U.A);
        assert.ok(
          !ids(a).includes(R.C_PUBLICADA),
          `${papel}: avaliacao de OUTRO autor vazou`,
        );
        assert.deepEqual(
          await chamar(papel, identidade, FA, U.VAZIO),
          [],
          `${papel}: autor sem avaliacao`,
        );
        assert.deepEqual(
          await chamar(papel, identidade, FA, null),
          [],
          `${papel}: autor NULL`,
        );
      }
    }),
);

prova(
  "avaliacoes: controle - publicada de produto ativo traz id, nome e imagem do produto e o conteudo da avaliacao",
  () =>
    emCaso(async () => {
      for (const [papel, identidade] of PAPEIS) {
        const l = porId(await chamar(papel, identidade, FA, U.A))[
          R.A_PUBLICADA
        ];
        assert.ok(l, `${papel}: a publicada do produto ativo nao voltou`);
        assert.equal(l.product_id, PROD.ATIVO, `${papel}: controle product_id`);
        assert.equal(l.produto_nome, NOME_ATIVO, `${papel}: controle nome`);
        assert.equal(
          l.produto_imagem_url,
          IMG_ATIVO,
          `${papel}: controle imagem`,
        );
        assert.equal(l.rating, 5);
        assert.equal(l.comment, "Gostei muito");
        assert.equal(l.helpful, 3);
        assert.equal(l.merchant_reply, "Obrigada pela avaliacao");
      }
    }),
);

prova(
  "avaliacoes: produto inativo ou apagado NAO faz a avaliacao sumir (a linha fica) e o produto volta NULL, sem o uuid dele no resultado",
  () =>
    emCaso(async () => {
      for (const [papel, identidade] of PAPEIS) {
        const linhas = await chamar(papel, identidade, FA, U.B);
        // as 3 publicadas do autor B: produto ativo, inativo e apagado
        assert.deepEqual(
          faltam(linhas, [R.B_OK, R.B_INATIVO, R.B_APAGADO]),
          [],
          `${papel}: a linha nao pode sumir quando o produto sai da vitrine`,
        );
        const m = porId(linhas);
        for (const [rotulo, rid, quando] of [
          ["inativo", R.B_INATIVO, "Produto inativo do autor B"],
          ["apagado", R.B_APAGADO, "Produto apagado do autor B"],
        ]) {
          const l = m[rid];
          assert.equal(
            l.product_id,
            null,
            `${papel}: produto ${rotulo} vazou o product_id`,
          );
          assert.equal(
            l.produto_nome,
            null,
            `${papel}: produto ${rotulo} vazou o nome`,
          );
          assert.equal(
            l.produto_imagem_url,
            null,
            `${papel}: produto ${rotulo} vazou a imagem`,
          );
          assert.equal(
            l.comment,
            quando,
            `${papel}: a avaliacao perdeu o texto`,
          );
        }
        const texto = JSON.stringify(linhas);
        for (const uuid of [PROD.INATIVO, PROD.APAGADO])
          assert.ok(
            !texto.includes(uuid),
            `${papel}: o uuid do produto nao publico ${uuid} saiu no resultado`,
          );
        // controle no mesmo resultado: o produto ativo segue completo
        assert.equal(m[R.B_OK].product_id, PROD.ATIVO);
        assert.equal(m[R.B_OK].produto_nome, NOME_ATIVO);
      }
    }),
);

prova("avaliacoes: o conjunto de colunas e' exato e NAO inclui user_id", () =>
  emCaso(async () => {
    for (const [papel, identidade] of PAPEIS) {
      const linhas = await chamar(papel, identidade, FA, U.A);
      assert.ok(linhas.length >= 1, `${papel}: sem linha para conferir`);
      for (const l of linhas) {
        assert.deepEqual(
          Object.keys(l),
          COLUNAS_AVALIACOES,
          `${papel}: colunas de perfil_publico_avaliacoes`,
        );
        assert.ok(!("user_id" in l), `${papel}: user_id no resultado`);
      }
    }
  }),
);

// ---------------------------------------------------------------------------
// PERGUNTAS
// ---------------------------------------------------------------------------

prova(
  "perguntas: so o autor pedido volta (pergunta de outro autor nao), autor sem nada e NULL voltam vazios",
  () =>
    emCaso(async () => {
      for (const [papel, identidade] of PAPEIS) {
        assert.ok(
          !ids(await chamar(papel, identidade, FP, U.B)).includes(Q.C_ATIVO),
          `${papel}: pergunta de OUTRO autor vazou`,
        );
        assert.deepEqual(
          await chamar(papel, identidade, FP, U.VAZIO),
          [],
          `${papel}: autor sem pergunta`,
        );
        assert.deepEqual(
          await chamar(papel, identidade, FP, null),
          [],
          `${papel}: autor NULL`,
        );
      }
    }),
);

prova(
  "perguntas: controle - produto ativo traz id, nome e imagem; produto inativo ou apagado volta NULL (a pergunta fica) sem o uuid dele",
  () =>
    emCaso(async () => {
      for (const [papel, identidade] of PAPEIS) {
        const linhas = await chamar(papel, identidade, FP, U.B);
        const m = porId(linhas);
        assert.deepEqual(
          faltam(linhas, [Q.B_ATIVO, Q.B_INATIVO, Q.B_APAGADO]),
          [],
          `${papel}: a pergunta nao pode sumir quando o produto sai da vitrine`,
        );
        const ok = m[Q.B_ATIVO];
        assert.equal(
          ok.product_id,
          PROD.ATIVO,
          `${papel}: controle product_id`,
        );
        assert.equal(ok.produto_nome, NOME_ATIVO, `${papel}: controle nome`);
        assert.equal(
          ok.produto_imagem_url,
          IMG_ATIVO,
          `${papel}: controle imagem`,
        );
        assert.equal(ok.question, "Tem no tamanho M?");
        for (const [rotulo, qid, texto] of [
          ["inativo", Q.B_INATIVO, "Quando volta ao estoque?"],
          ["apagado", Q.B_APAGADO, "Ainda existe?"],
        ]) {
          const l = m[qid];
          assert.equal(
            l.product_id,
            null,
            `${papel}: produto ${rotulo} vazou o product_id`,
          );
          assert.equal(
            l.produto_nome,
            null,
            `${papel}: produto ${rotulo} vazou o nome`,
          );
          assert.equal(
            l.produto_imagem_url,
            null,
            `${papel}: produto ${rotulo} vazou a imagem`,
          );
          assert.equal(
            l.question,
            texto,
            `${papel}: a pergunta perdeu o texto`,
          );
        }
        const bruto = JSON.stringify(linhas);
        for (const uuid of [PROD.INATIVO, PROD.APAGADO])
          assert.ok(
            !bruto.includes(uuid),
            `${papel}: o uuid do produto nao publico ${uuid} saiu no resultado`,
          );
      }
    }),
);

prova(
  "perguntas: respostas num jsonb array com so {id, answer, created_at} (sem user_id), e '[]' sem resposta; colunas exatas sem user_id",
  () =>
    emCaso(async () => {
      for (const [papel, identidade] of PAPEIS) {
        const linhas = await chamar(papel, identidade, FP, U.B);
        const m = porId(linhas);
        for (const l of linhas)
          assert.deepEqual(
            Object.keys(l),
            COLUNAS_PERGUNTAS,
            `${papel}: colunas de perfil_publico_perguntas`,
          );
        assert.ok(
          !("user_id" in m[Q.B_ATIVO]),
          `${papel}: user_id no resultado`,
        );
        const respostas = m[Q.B_ATIVO].answers;
        assert.ok(Array.isArray(respostas), `${papel}: answers e' array json`);
        assert.deepEqual(
          respostas.map((r) => r.id),
          [AN.UNICA],
          `${papel}: a resposta da pergunta nao voltou`,
        );
        assert.deepEqual(
          respostas.map((r) => r.answer),
          ["Resposta da loja ficticia"],
        );
        for (const r of respostas) {
          assert.deepEqual(
            Object.keys(r).sort(),
            ["answer", "created_at", "id"],
            `${papel}: o jsonb da resposta so leva id, answer e created_at (nada de user_id de quem respondeu)`,
          );
        }
        assert.ok(
          !JSON.stringify(linhas).includes(U.RESPONDEDOR),
          `${papel}: o uuid de quem respondeu saiu no resultado`,
        );
        assert.deepEqual(
          m[Q.B_SEM_RESPOSTA].answers,
          [],
          `${papel}: pergunta sem resposta devolve '[]'`,
        );
      }
    }),
);

async function main() {
  await P.conectar();
  try {
    await P.executar("perfil publico: avaliacao publicada e produto publico");
  } finally {
    await P.conexao().end();
  }
}
main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
