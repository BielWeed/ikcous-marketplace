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
 *  GUARDA      avaliacao antiga acima de 1000: a migration se RECUSA (B1_BASELINE_DIVERGENT) e nada muda (o CHECK reavaliado em todo UPDATE faria o PAGAMENTO do pedido da compradora falhar via tr_compra_verifica_avaliacoes).
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

// Pedido + item + avaliacao NAO verificada da mesma compradora: o gatilho do pagamento (tr_compra_verifica_avaliacoes) atualiza essa avaliacao.
const PEDIDO = "b1396200-0000-4000-8000-000000000d01";
async function semearPedidoEAvaliacao(textoDaAvaliacao, idDaAvaliacao) {
  const c = P.conexao();
  await c.query(
    `INSERT INTO public.marketplace_orders (id, user_id, customer_data, customer_name, subtotal, total, payment_status, status)
     VALUES ($1, $2, '{}'::jsonb, 'Autora Um', 100, 100, 'aguardando', 'pending')`,
    [PEDIDO, U.autor1],
  );
  await c.query(
    "INSERT INTO public.marketplace_order_items (order_id, product_id, quantity, price) VALUES ($1, $2, 1, 100)",
    [PEDIDO, PROD],
  );
  await c.query(
    "INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status) VALUES ($1, $2, $3, 5, $4, 'pendente')",
    [idDaAvaliacao, PROD, U.autor1, textoDaAvaliacao],
  );
}
const marcarComoPago = () =>
  P.tentar(
    null,
    "UPDATE public.marketplace_orders SET payment_status = 'pago' WHERE id = $1 RETURNING payment_status",
    [PEDIDO],
    { uid: "" },
  );
const avaliacaoVerificada = async (id) =>
  (
    await P.conexao().query(
      "SELECT verified FROM public.reviews WHERE id = $1",
      [id],
    )
  ).rows[0].verified;
const E01 = "b1396200-0000-4000-8000-000000000e01";
const E02 = "b1396200-0000-4000-8000-000000000e02";
/** A migration SEM a guarda (mutante): tira o bloco `IF v_acima > 0 THEN ... END IF;`. */
const SEM_A_GUARDA = MIGRATION.replace(
  /\n {4}IF v_acima > 0 THEN[\s\S]*?\n {4}END IF;\n/,
  "\n",
);

prova(
  "GUARDA: com avaliacao antiga acima de 1000 a migration se RECUSA (B1_BASELINE_DIVERGENT), o CHECK nao fica e nada muda; no limite (1000) aplica; encurtada, aplica",
  async () => {
    assert.notEqual(SEM_A_GUARDA, MIGRATION, "o mutante nao tirou a guarda");
    await P.emTransacao(async () => {
      await semear();
      await antes();
      const c = P.conexao();
      await c.query(
        "INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status) VALUES ($1, $2, $3, 5, $4, 'publicada'), ($5, $2, $6, 5, $7, 'publicada')",
        [
          E01,
          PROD,
          U.autor2,
          "legada".padEnd(1500, "x"),
          E02,
          U.autor1,
          "limite".padEnd(1000, "y"),
        ],
      );
      const d0 = await dadosDasAvaliacoes();
      const r0 = await P.retrato(NOVOS);
      // so a de 1500 conta (a de exatamente 1000 esta dentro do teto)
      await P.recusa(
        MIGRATION,
        /B1_BASELINE_DIVERGENT: há 1 avaliação\(ões\) com mais de 1000 caracteres em public\.reviews \(a maior tem 1500\) — a migration NÃO foi aplicada/,
      );
      assert.equal(await aplicado(), false, "o CHECK ficou depois da recusa");
      assert.deepEqual(await P.retrato(NOVOS), r0, "a recusa mudou o esquema");
      assert.deepEqual(
        await dadosDasAvaliacoes(),
        d0,
        "a recusa mexeu em avaliacao",
      );
      // a guarda vale para varias linhas (o texto conta todas)
      await c.query(
        "INSERT INTO public.reviews (product_id, user_id, rating, comment, status) VALUES ($1, $2, 5, $3, 'publicada')",
        [PROD, U.autor2, "outra".padEnd(1001, "z")],
      );
      await P.recusa(MIGRATION, /há 2 avaliação\(ões\).*a maior tem 1500/);
      // encurtadas as duas (decisao da lojista), a migration aplica
      await c.query(
        "UPDATE public.reviews SET comment = left(comment, 1000) WHERE char_length(comment) > 1000",
      );
      assert.equal(
        await P.aplicar(MIGRATION),
        null,
        "encurtada, devia aplicar",
      );
      assert.equal(await aplicado(), true);
      assert.equal((await restricao())[0].def, DEF_NOT_VALID);
    });
  },
);

prova(
  "GUARDA sem linha acima de 1000 e com a restricao ja presente: aplica e reaplicar nao revarre nem reclama",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await P.conexao().query(
        "INSERT INTO public.reviews (product_id, user_id, rating, comment, status) VALUES ($1, $2, 5, $3, 'publicada')",
        [PROD, U.autor2, "limite".padEnd(1000, "y")],
      );
      await depois();
      const e1 = await restricao();
      await depois();
      assert.deepEqual(await restricao(), e1);
    });
  },
);

prova(
  "PAGAMENTO (controle): com o CHECK aplicado e avaliacao normal, marcar o pedido como pago funciona e a compradora fica com o selo",
  async () => {
    await P.emTransacao(
      async () => {
        assert.equal(await aplicado(), true);
        const pago = await marcarComoPago();
        assert.ok(pago.linhas, `o pagamento devia registrar: ${pago.erro}`);
        assert.equal(pago.linhas[0].payment_status, "pago");
        assert.equal(await avaliacaoVerificada(E01), true);
      },
      async () => {
        await semear();
        await antes();
        await semearPedidoEAvaliacao("chegou certinho", E01);
        await depois();
      },
    );
  },
);

prova(
  "MUTANTE sem a guarda: a migration aplica por cima da avaliacao antiga e o PAGAMENTO do pedido da compradora FALHA (23514) - e' o que a guarda impede; sem o CHECK o pagamento registra",
  async () => {
    // sem o CHECK (estado ANTES) o pagamento registra mesmo com a avaliacao antiga longa
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await semearPedidoEAvaliacao("legada".padEnd(1500, "x"), E01);
      const pago = await marcarComoPago();
      assert.ok(
        pago.linhas,
        `sem o CHECK o pagamento devia registrar: ${pago.erro}`,
      );
      assert.equal(await avaliacaoVerificada(E01), true);
    });
    // com a migration SEM a guarda: aplica (a guarda faria recusar) e o pagamento quebra
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await semearPedidoEAvaliacao("legada".padEnd(1500, "x"), E01);
      assert.equal(
        await P.aplicar(SEM_A_GUARDA),
        null,
        "sem a guarda a migration devia aplicar (e' o defeito)",
      );
      const pago = await marcarComoPago();
      assert.ok(
        !pago.linhas,
        "o pagamento devia falhar com o CHECK e a linha antiga",
      );
      assert.equal(pago.codigo, "23514", pago.erro);
      assert.equal(pago.restricao, CK);
      const pedido = (
        await P.conexao().query(
          "SELECT payment_status FROM public.marketplace_orders WHERE id = $1",
          [PEDIDO],
        )
      ).rows[0].payment_status;
      assert.equal(pedido, "aguardando", "o pagamento nao foi registrado");
    });
    // com a migration REAL e a mesma avaliacao antiga: recusa, nada muda, o pagamento segue registrando
    await P.emTransacao(async () => {
      await semear();
      await antes();
      await semearPedidoEAvaliacao("legada".padEnd(1500, "x"), E01);
      await P.recusa(MIGRATION, /B1_BASELINE_DIVERGENT/);
      assert.equal(await aplicado(), false);
      const pago = await marcarComoPago();
      assert.ok(
        pago.linhas,
        `apos a recusa o pagamento devia registrar: ${pago.erro}`,
      );
    });
  },
);

prova(
  "VALIDATE: com a restricao aplicada o VALIDATE passa (nao ha linha antiga); reaplicar sobre a validada e' no-op; o rollback aceita a validada",
  async () => {
    await P.emTransacao(async () => {
      await semear();
      await antes();
      const c = P.conexao();
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
