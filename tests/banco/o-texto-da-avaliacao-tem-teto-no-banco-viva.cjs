"use strict";

/**
 * PROVA VIVA da migration 20261396200000_o_texto_da_avaliacao_tem_teto_no_banco.sql (lote 234, item C) contra o Postgres EFEMERO
 * (clone do rodar-isolado.cjs: a arvore migrada). Nunca banco de loja. Esqueleto: tests/banco/prova-de-objeto-novo.cjs.
 *
 * O defeito: `reviews.comment` e' `text` sem teto; a tela limita a 1000, a API direta nao. O conserto: um CHECK
 * `reviews_comment_ate_1000_caracteres` (`char_length(comment) <= 1000`), criado NOT VALID (nao reprova as linhas antigas).
 *
 *  ANTES       controle: sem o CHECK 1001 caracteres e 1 milhao entram (o defeito).
 *  DEPOIS      1000 caracteres entram (letras, acentos, emojis), nulo e vazio entram; 1001 e 1 milhao sao recusados (23514, pela
 *              restricao certa), tambem para administrador, service_role e sessao direta; varias linhas com uma acima do teto nao
 *              gravam nenhuma; moderar e responder uma avaliacao legitima seguem funcionando.
 *  LEGADA      avaliacao antiga com mais de 1000 caracteres: o apply nao a toca (hash), a leitura e o DELETE seguem, mas QUALQUER
 *              UPDATE da linha passa a falhar ate o texto ser encurtado (e' o preco do NOT VALID, medido aqui); o rollback devolve
 *              o UPDATE; o VALIDATE so passa depois que a linha antiga some.
 *  SO NOVO     o apply cria so a restricao: nenhuma funcao, tabela, politica, gatilho ou outra restricao muda.
 *  MUTANTES    o mesmo roteiro sobre restricoes sabotadas (teto de 1001/999/5000, bytes, exige texto, sem a regra) FICA VERMELHO
 *              na expectativa certa.
 *  MIGRATION   reaplicar (2x) e CRLF = mesmo estado; rollback sem tocar dado, 2x no-op, ida e volta igual; o pre-voo recusa SEM
 *              escrever; a conferencia final recusa cada estrago; o pre-voo do rollback recusa o que nao e' dele; consultas 114a/114b.
 *  ATOMICIDADE conexao SEM BEGIN: a conferencia sabotada derruba o arquivo inteiro; gravacao em voo faz a migration FALHAR LIMPA
 *              no lock_timeout (nao trava a loja) e depois aplica.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-texto-da-avaliacao-tem-teto-no-banco-viva.cjs
 */

const P = require("./prova-de-objeto-novo.cjs");
const { assert, prova, sha256, emCRLF } = P;
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME = "20261396200000_o_texto_da_avaliacao_tem_teto_no_banco.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK = P.lerMigration(`rollback-manual-${NOME}`);
const A114 = "114a-conferir-o-texto-da-avaliacao-tem-teto-no-banco-aplicado";
const B114 = "114b-antes-o-texto-da-avaliacao-tem-teto-no-banco-ausente";
const CK = "reviews_comment_ate_1000_caracteres";
const NOVOS = { funcoes: [], gatilhos: [], restricoes: [CK] };
const DEF_NOT_VALID = "CHECK ((char_length(comment) <= 1000)) NOT VALID";
const DEF_VALIDA = "CHECK ((char_length(comment) <= 1000))";

const U = {
  autor1: "b1396200-0000-4000-8000-0000000000a1",
  autor2: "b1396200-0000-4000-8000-0000000000a2",
  admin: "b1396200-0000-4000-8000-0000000000ad",
};
const PROD = "b1396200-0000-4000-8000-0000000000f1";
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});

const depois = () => P.conexao().query(MIGRATION);
const antes = () => P.conexao().query(ROLLBACK);

async function semear() {
  const c = P.conexao();
  for (const id of Object.values(U))
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@396200.teste', '{}'::jsonb)",
      [id],
    );
  await c.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Autora Um', 'customer'), ($2, 'Autora Dois', 'customer'), ($3, 'Admin 396200', 'admin')`,
    [U.autor1, U.autor2, U.admin],
  );
  await c.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1',
    [U.admin],
  );
  await c.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Camiseta 396200', 100, 10, true, 40)",
    [PROD],
  );
}

const SQL_AVALIAR = `INSERT INTO public.reviews (product_id, user_id, rating, comment, status)
  VALUES ($1::uuid, $2::uuid, 4, $3, 'pendente') RETURNING id, char_length(comment) AS n`;
const avaliar = (papel, uid, texto, claims = "") =>
  P.tentar(papel, SQL_AVALIAR, [PROD, uid, texto], { uid, claims });
const contagem = async (marca) =>
  (
    await P.conexao().query(
      "SELECT count(*)::int AS n FROM public.reviews WHERE comment LIKE $1",
      [`${marca}%`],
    )
  ).rows[0].n;

const entrou = (r, n) => Boolean(r.linhas) && r.linhas[0].n === n;
const recusada = (r) => !r.linhas && r.codigo === "23514" && r.restricao === CK;

/** O roteiro inteiro; cada chave vale `true` quando o comportamento e' o desta migration. */
async function roteiro() {
  const r = {};
  const a1000 = await avaliar("authenticated", U.autor1, "a".repeat(1000));
  r.ok1000 = entrou(a1000, 1000);
  r.okAcento = entrou(
    await avaliar("authenticated", U.autor1, "ã".repeat(1000)),
    1000,
  );
  r.okEmoji = entrou(
    await avaliar("authenticated", U.autor1, "😀".repeat(1000)),
    1000,
  );
  r.okNulo = Boolean(
    (await avaliar("authenticated", U.autor1, null)).linhas?.length,
  );
  r.okVazio = entrou(await avaliar("authenticated", U.autor1, ""), 0);
  r.okCurto = entrou(
    await avaliar("authenticated", U.autor1, "chegou certinho"),
    15,
  );
  r.recusa1001 = recusada(
    await avaliar("authenticated", U.autor1, "b".repeat(1001)),
  );
  r.recusaGrande = recusada(
    await avaliar("authenticated", U.autor1, "c".repeat(1_000_000)),
  );
  const varias = await P.tentar(
    "authenticated",
    `INSERT INTO public.reviews (product_id, user_id, rating, comment, status) VALUES
       ($1::uuid, $2::uuid, 5, 'lote-ok', 'pendente'), ($1::uuid, $2::uuid, 5, $3, 'pendente')`,
    [PROD, U.autor1, `lote-${"d".repeat(996)}`], // 5 + 996 = 1001 caracteres: exatamente 1 acima do teto
    { uid: U.autor1 },
  );
  r.recusaMultilinha = recusada(varias) && (await contagem("lote-")) === 0;
  r.recusaAdmin = recusada(
    await avaliar("authenticated", U.admin, "e".repeat(1001), JWT_ADMIN),
  );
  // No Supabase o service_role tem BYPASSRLS; o papel do efemero nao tem. A transacao desfaz o ALTER ROLE.
  await P.conexao().query("ALTER ROLE service_role BYPASSRLS");
  r.recusaServico = recusada(
    await avaliar("service_role", U.autor1, "f".repeat(1001)),
  );
  r.recusaDireto = recusada(await avaliar(null, U.autor1, "g".repeat(1001)));
  // a avaliacao legitima segue podendo ser moderada, respondida e ter o texto editado dentro do teto
  const legitima = a1000.linhas?.[0]?.id;
  r.moderarSegue = Boolean(
    (
      await P.tentar(
        "authenticated",
        "UPDATE public.reviews SET status = 'publicada' WHERE id = $1::uuid RETURNING id",
        [legitima],
        { uid: U.admin, claims: JWT_ADMIN },
      )
    ).linhas?.length,
  );
  r.respostaSegue = Boolean(
    (
      await P.tentar(
        "authenticated",
        "SELECT public.reply_review_atomic($1::uuid, $2::text)",
        [legitima, "Obrigada pela avaliacao!"],
        { uid: U.admin, claims: JWT_ADMIN },
      )
    ).linhas,
  );
  r.editarDentroDoTeto = Boolean(
    (
      await P.tentar(
        "authenticated",
        "UPDATE public.reviews SET comment = $2 WHERE id = $1::uuid RETURNING id",
        [legitima, "texto curto"],
        { uid: U.admin, claims: JWT_ADMIN },
      )
    ).linhas?.length,
  );
  r.editarAcimaDoTeto = recusada(
    await P.tentar(
      "authenticated",
      "UPDATE public.reviews SET comment = $2 WHERE id = $1::uuid RETURNING id",
      [legitima, "h".repeat(1001)],
      { uid: U.admin, claims: JWT_ADMIN },
    ),
  );
  return r;
}
const falhou = (r) =>
  Object.entries(r)
    .filter(([, v]) => v !== true)
    .map(([k]) => k)
    .sort();

const restricao = async (c = P.conexao()) =>
  (
    await c.query(
      `SELECT oid::text AS oid, pg_get_constraintdef(oid) AS def, convalidated, contype, conislocal
         FROM pg_constraint WHERE conrelid = 'public.reviews'::regclass AND conname = $1`,
      [CK],
    )
  ).rows;
const aplicado = async (c = P.conexao()) =>
  (
    await c.query(
      "SELECT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.reviews'::regclass AND conname = $1) AS x",
      [CK],
    )
  ).rows[0].x;
const dadosDasAvaliacoes = async () =>
  (
    await P.conexao().query(
      `SELECT count(*)::int AS n, coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') AS h FROM public.reviews x`,
    )
  ).rows[0];
/** Troca a restricao por outra (sabotagem): mesma tabela, mesmo nome, outra regra. */
const trocarRegra = (regra) =>
  `ALTER TABLE public.reviews DROP CONSTRAINT ${CK};
   ALTER TABLE public.reviews ADD CONSTRAINT ${CK} CHECK (${regra}) NOT VALID`;

// ---------------------------------------------------------------------------------------------------------------------------
prova(
  "ANTES (controle): sem o CHECK 1001 caracteres e 1 milhao de caracteres entram (o defeito)",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), false, "o estado ANTES nao montou");
        const r = await roteiro();
        const f = falhou(r);
        for (const k of [
          "recusa1001",
          "recusaGrande",
          "recusaMultilinha",
          "recusaAdmin",
          "recusaServico",
          "recusaDireto",
          "editarAcimaDoTeto",
        ])
          assert.ok(f.includes(k), `controle: ${k} devia falhar sem o CHECK`);
        // o que ja era certo antes continua certo
        for (const k of [
          "ok1000",
          "okAcento",
          "okEmoji",
          "okNulo",
          "okVazio",
          "okCurto",
          "moderarSegue",
          "respostaSegue",
          "editarDentroDoTeto",
        ])
          assert.equal(new Map(Object.entries(r)).get(k), true, k);
      },
      async () => {
        await semear();
        await antes();
      },
    );
  },
);

prova(
  "DEPOIS: 1000 caracteres entram (letra, acento, emoji, nulo, vazio); 1001 e 1 milhao sao recusados para todos; moderar e responder seguem",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), true, "o estado DEPOIS nao montou");
        const r = await roteiro();
        assert.deepEqual(falhou(r), [], JSON.stringify(r));
        const gravadas = (
          await P.conexao().query(
            "SELECT max(char_length(comment))::int AS maior FROM public.reviews",
          )
        ).rows[0].maior;
        assert.ok(gravadas <= 1000, `ficou texto de ${gravadas} caracteres`);
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "O CHECK nasce NOT VALID, uma so restricao, com a regra exata",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await depois();
      const linhas = await restricao();
      assert.equal(linhas.length, 1);
      assert.equal(linhas[0].def, DEF_NOT_VALID);
      assert.equal(linhas[0].convalidated, false);
      assert.equal(linhas[0].contype, "c");
    });
  },
);

prova(
  "LEGADA: avaliacao antiga acima de 1000 nao e' tocada pelo apply; ler e apagar seguem; UPDATE da linha falha ate encurtar (o preco do NOT VALID)",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      const c = P.conexao();
      await c.query(
        "INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status) VALUES ($1, $2, $3, 5, $4, 'publicada')",
        [
          "b1396200-0000-4000-8000-000000000e01",
          PROD,
          U.autor2,
          "legada".padEnd(5000, "x"),
        ],
      );
      await c.query(
        "INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status) VALUES ($1, $2, $3, 5, $4, 'publicada')",
        [
          "b1396200-0000-4000-8000-000000000e02",
          PROD,
          U.autor1,
          "legada".padEnd(2500, "y"),
        ],
      );
      const d0 = await dadosDasAvaliacoes();
      await depois();
      await depois();
      assert.deepEqual(
        await dadosDasAvaliacoes(),
        d0,
        "o apply mexeu em avaliacao",
      );
      const lida = (
        await c.query(
          "SELECT char_length(comment)::int AS n FROM public.reviews WHERE id = 'b1396200-0000-4000-8000-000000000e01'",
        )
      ).rows[0];
      assert.equal(lida.n, 5000, "a linha antiga devia seguir legivel");
      // o aviso do cabecalho, MEDIDO: UPDATE de OUTRA coluna da linha antiga falha (o CHECK e' reavaliado na linha inteira)
      const upd = await P.tentar(
        null,
        "UPDATE public.reviews SET helpful = 7 WHERE id = 'b1396200-0000-4000-8000-000000000e01'",
        [],
        { uid: "" },
      );
      assert.equal(upd.codigo, "23514", `esperava 23514: ${upd.erro}`);
      assert.equal(upd.restricao, CK);
      // encurtar o texto destrava a linha
      const encurtar = await P.tentar(
        null,
        "UPDATE public.reviews SET comment = left(comment, 1000), helpful = 7 WHERE id = 'b1396200-0000-4000-8000-000000000e01' RETURNING helpful",
        [],
        { uid: "" },
      );
      assert.ok(encurtar.linhas, `encurtar devia passar: ${encurtar.erro}`);
      // apagar (recusar a avaliacao) segue funcionando
      const del = await P.tentar(
        null,
        "DELETE FROM public.reviews WHERE id = 'b1396200-0000-4000-8000-000000000e02' RETURNING id",
        [],
        { uid: "" },
      );
      assert.ok(del.linhas?.length === 1, `apagar devia passar: ${del.erro}`);
      // VALIDATE e' do dono, depois da medicao: com legada falharia; sem ela passa. A migration nao o roda.
      assert.equal((await restricao())[0].convalidated, false);
    });
  },
);

prova(
  "LEGADA + rollback: o UPDATE da linha antiga volta a funcionar sem o CHECK; o VALIDATE so passa sem a linha antiga",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      const c = P.conexao();
      await c.query(
        "INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status) VALUES ($1, $2, $3, 5, $4, 'publicada')",
        [
          "b1396200-0000-4000-8000-000000000e03",
          PROD,
          U.autor2,
          "legada".padEnd(3000, "z"),
        ],
      );
      await depois();
      await c.query("SAVEPOINT validar");
      await assert.rejects(
        () => c.query(`ALTER TABLE public.reviews VALIDATE CONSTRAINT ${CK}`),
        /violated by some row/,
      );
      await c.query("ROLLBACK TO SAVEPOINT validar");
      await antes();
      const upd = await P.tentar(
        null,
        "UPDATE public.reviews SET helpful = 3 WHERE id = 'b1396200-0000-4000-8000-000000000e03' RETURNING helpful",
        [],
        { uid: "" },
      );
      assert.ok(upd.linhas, `sem o CHECK o UPDATE devia voltar: ${upd.erro}`);
      // sem a linha antiga, o VALIDATE passa e a migration reaplicada aceita a restricao ja validada (no-op)
      await c.query("DELETE FROM public.reviews WHERE id = $1", [
        "b1396200-0000-4000-8000-000000000e03",
      ]);
      await depois();
      await c.query(`ALTER TABLE public.reviews VALIDATE CONSTRAINT ${CK}`);
      const validada = await restricao();
      assert.equal(validada[0].def, DEF_VALIDA);
      assert.equal(validada[0].convalidated, true);
      await depois();
      assert.deepEqual(
        await restricao(),
        validada,
        "reaplicar sobre a restricao validada mudou algo",
      );
      await antes();
      assert.equal(
        await aplicado(),
        false,
        "o rollback aceita a restricao validada",
      );
    });
  },
);

prova(
  "SO NOVO: o apply cria so a restricao; nada mais muda (funcoes, tabelas, politicas, gatilhos, outras restricoes)",
  async () => {
    await P.emTransacao(async () => {
      await antes();
      const r0 = await P.retrato(NOVOS);
      assert.equal(await aplicado(), false);
      await depois();
      assert.equal(await aplicado(), true);
      assert.deepEqual(
        await P.retrato(NOVOS),
        r0,
        "o apply mexeu em objeto que nao era dele",
      );
      assert.deepEqual(
        await P.conexao()
          .query(
            "SELECT count(*)::int AS n FROM pg_constraint WHERE conname = $1",
            [CK],
          )
          .then((q) => q.rows[0]),
        { n: 1 },
      );
    });
  },
);

// ---- MUTANTES: o mesmo roteiro sobre restricoes sabotadas fica vermelho na expectativa certa ---------------------------------
const MUTANTES = [
  [
    "teto de 1001",
    trocarRegra("char_length(comment) <= 1001"),
    [
      "recusa1001",
      "recusaMultilinha",
      "recusaAdmin",
      "recusaServico",
      "recusaDireto",
      "editarAcimaDoTeto",
    ],
  ],
  [
    "teto de 999",
    trocarRegra("char_length(comment) <= 999"),
    ["ok1000", "okAcento", "okEmoji"],
  ],
  [
    "teto de 5000",
    trocarRegra("char_length(comment) <= 5000"),
    ["recusa1001", "recusaAdmin", "recusaDireto"],
  ],
  [
    "bytes em vez de caracteres",
    trocarRegra("octet_length(comment) <= 1000"),
    ["okAcento", "okEmoji"],
  ],
  [
    "exige texto",
    trocarRegra("comment IS NOT NULL AND char_length(comment) <= 1000"),
    ["okNulo"],
  ],
  [
    "sem a regra",
    `ALTER TABLE public.reviews DROP CONSTRAINT ${CK}`,
    ["recusa1001", "recusaGrande", "recusaAdmin", "recusaDireto"],
  ],
];
for (const [nome, sabotagem, esperado] of MUTANTES) {
  prova(
    `MUTANTE ${nome}: o roteiro fica vermelho nas expectativas certas`,
    async () => {
      await P.emTransacao(
        async () => {
          const f = falhou(await roteiro());
          for (const k of esperado)
            assert.ok(
              f.includes(k),
              `o mutante '${nome}' devia reprovar ${k}, reprovou ${JSON.stringify(f)}`,
            );
        },
        async () => {
          await semear();
          await depois();
          await P.conexao().query(sabotagem);
        },
      );
    },
  );
}

// ---- MIGRATION --------------------------------------------------------------------------------------------------------------
prova(
  "reaplicar 2x e em CRLF = mesmo estado (mesma restricao, mesmo OID)",
  async () => {
    await P.emTransacao(async () => {
      await antes();
      await depois();
      const e1 = await restricao();
      await depois();
      await depois();
      assert.deepEqual(await restricao(), e1, "reaplicar 2x mudou o estado");
      await P.conexao().query(emCRLF(MIGRATION));
      assert.deepEqual(await restricao(), e1, "em CRLF o estado mudou");
    });
  },
);

prova(
  "rollback: apaga so a restricao sem tocar dado; 2x e' no-op; ida e volta termina igual",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await depois();
      await P.conexao().query(
        "INSERT INTO public.reviews (product_id, user_id, rating, comment, status) VALUES ($1, $2, 5, 'fica', 'pendente')",
        [PROD, U.autor1],
      );
      const d0 = await dadosDasAvaliacoes();
      const e0 = await restricao();
      await antes();
      assert.equal(await aplicado(), false);
      assert.deepEqual(
        await dadosDasAvaliacoes(),
        d0,
        "o rollback mexeu em avaliacao",
      );
      await antes();
      assert.equal(await aplicado(), false, "o segundo rollback nao foi no-op");
      await depois();
      const e1 = await restricao();
      assert.deepEqual(
        e1.map(({ oid, ...resto }) => resto),
        e0.map(({ oid, ...resto }) => resto),
      );
      assert.deepEqual(await dadosDasAvaliacoes(), d0);
      assert.equal(sha256(ROLLBACK).length, 64);
    });
  },
);

prova("pre-voo recusa SEM escrever em cada estado ruim", async () => {
  const sabotagens = [
    [
      "CHECK do mesmo nome com outra regra",
      `ALTER TABLE public.reviews ADD CONSTRAINT ${CK} CHECK (char_length(comment) <= 500)`,
    ],
    [
      "CHECK do mesmo nome com outra coluna",
      `ALTER TABLE public.reviews ADD CONSTRAINT ${CK} CHECK (char_length(COALESCE(merchant_reply, '')) <= 1000)`,
    ],
    [
      "reviews.comment inexistente",
      "ALTER TABLE public.reviews RENAME COLUMN comment TO texto",
    ],
  ];
  for (const [nome, sabotar] of sabotagens) {
    await P.emTransacao(
      async () => {
        await P.conexao().query(sabotar);
        const r0 = await P.retrato(NOVOS);
        const antesDeTentar = await restricao();
        await P.recusa(MIGRATION, /B1_BASELINE_DIVERGENT/);
        assert.deepEqual(
          await P.retrato(NOVOS),
          r0,
          `pre-voo (${nome}) escreveu antes de recusar`,
        );
        assert.deepEqual(
          await restricao(),
          antesDeTentar,
          `pre-voo (${nome}) mexeu na restricao`,
        );
      },
      async () => {
        await semear();
        await antes();
      },
    );
  }
});

prova(
  "a conferencia final recusa cada estrago (restricao ausente, regra trocada, outro teto)",
  async () => {
    const bloco = P.blocoDe(MIGRATION, "conferencia_20261396200000");
    const estragos = [
      ["restricao ausente", `ALTER TABLE public.reviews DROP CONSTRAINT ${CK}`],
      ["teto de 500", trocarRegra("char_length(comment) <= 500")],
      ["bytes", trocarRegra("octet_length(comment) <= 1000")],
    ];
    for (const [, estrago] of estragos) {
      await P.emTransacao(
        async () => {
          await P.conexao().query(estrago);
          await P.recusa(bloco, /conferencia 20261396200000/);
        },
        async () => {
          await semear();
          await depois();
        },
      );
    }
    // o bloco aceita a restricao como foi desenhada
    await P.emTransacao(
      async () => {
        assert.equal(await P.aplicar(bloco), null);
      },
      async () => {
        await semear();
        await depois();
      },
    );
  },
);

prova(
  "pre-voo do rollback recusa o que nao e' dele (restricao redefinida) sem apagar nada",
  async () => {
    for (const regra of [
      "char_length(comment) <= 500",
      "octet_length(comment) <= 1000",
    ]) {
      await P.emTransacao(
        async () => {
          await P.conexao().query(trocarRegra(regra));
          const antesDeTentar = await restricao();
          await P.recusa(ROLLBACK, /B1_BASELINE_DIVERGENT/);
          assert.deepEqual(
            await restricao(),
            antesDeTentar,
            `o pre-voo do rollback (${regra}) apagou antes de recusar`,
          );
        },
        async () => {
          await semear();
          await depois();
        },
      );
    }
  },
);

prova(
  "consultas 114a/114b nos dois sentidos, com o rol fechado, e cada linha reprova no estrago certo",
  async () => {
    await P.emTransacao(
      async () => {
        assert.deepEqual(await P.consulta(A114), [], "114a no estado DEPOIS");
        assert.equal(
          (await P.consulta(B114)).length,
          2,
          "114b depois do apply devia reprovar as 2 linhas de ausencia",
        );
        await antes();
        assert.deepEqual(await P.consulta(B114), [], "114b no estado ANTES");
        assert.equal(
          (await P.consulta(A114)).length,
          2,
          "114a no estado ANTES devia reprovar as 2 linhas da restricao",
        );
        await depois();
        for (const [estrago, linha] of [
          [
            `ALTER TABLE public.reviews DROP CONSTRAINT ${CK}`,
            /CHECK reviews_comment/,
          ],
          [trocarRegra("char_length(comment) <= 500"), /CHECK reviews_comment/],
          [
            "ALTER TABLE public.reviews ADD CONSTRAINT prova_outro CHECK (char_length(comment) <= 5000)",
            /so existe UM CHECK/,
          ],
        ]) {
          await P.conexao().query("SAVEPOINT estrago");
          await P.conexao().query(estrago);
          const reprovadas = await P.consulta(A114);
          assert.ok(
            reprovadas.some((i) => linha.test(i)),
            `a 114a nao reprovou a linha certa para '${estrago.slice(0, 60)}': ${JSON.stringify(reprovadas)}`,
          );
          await P.conexao().query("ROLLBACK TO SAVEPOINT estrago");
        }
        // a restricao ja validada tambem e' aceita pela 114a
        await P.conexao().query(
          `ALTER TABLE public.reviews VALIDATE CONSTRAINT ${CK}`,
        );
        assert.deepEqual(
          await P.consulta(A114),
          [],
          "114a com a restricao validada",
        );
      },
      async () => {
        await depois();
      },
    );
  },
);

// ---- ATOMICIDADE e TRAVA (conexoes proprias; deixam o clone no estado ANTES — ficam por ULTIMO) -------------------------------
prova(
  "ATOMICIDADE: sem BEGIN, a conferencia sabotada derruba o arquivo inteiro e nao deixa a restricao",
  async () => {
    const c3 = new Client({ connectionString: lerDatabaseUrlEfemera() });
    await c3.connect();
    try {
      await c3.query(ROLLBACK);
      assert.equal(await aplicado(c3), false);
      const i = MIGRATION.indexOf("DO $conferencia_20261396200000$");
      const quebrada =
        MIGRATION.slice(0, i) +
        MIGRATION.slice(i).replace(
          "<= 1000)) NOT VALID'",
          "<= 1001)) NOT VALID'",
        );
      assert.notEqual(
        quebrada,
        MIGRATION,
        "a sabotagem da conferencia nao pegou",
      );
      await assert.rejects(
        () => c3.query(quebrada),
        /conferencia 20261396200000/,
      );
      assert.equal(
        await aplicado(c3),
        false,
        "a restricao ficou depois da conferencia reprovar",
      );
    } finally {
      await c3.end();
    }
  },
);

prova(
  "TRAVA: gravacao de avaliacao em voo faz a migration falhar limpa no lock_timeout e, depois dela, aplicar",
  async () => {
    await P.travaAberta({
      sqlMigracao: MIGRATION,
      gravar: async (c2) => {
        await c2.query(
          "INSERT INTO public.reviews (product_id, user_id, rating, comment, status) VALUES (gen_random_uuid(), gen_random_uuid(), 5, 'em voo', 'pendente')",
        );
      },
      aplicado,
    });
  },
);

(async () => {
  await P.conectar();
  try {
    await P.executar("o-texto-da-avaliacao-tem-teto-no-banco");
  } finally {
    await P.conexao()
      .end()
      .catch(() => {});
  }
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
