"use strict";

// PROVA VIVA da migration 20261641000000 (uma avaliacao por cliente e produto, e a media do painel so das publicadas).
// Somente o clone descartavel de rodar-isolado.cjs (Postgres efemero do CI); nunca banco de loja.
//
// O que prova:
//   * CONTROLE (sem a migration, pelo rollback dela): a mesma cliente grava a segunda avaliacao do mesmo produto e o topo do
//     painel soma a pendente — os dois defeitos existem.
//   * Com a migration: a segunda avaliacao da mesma conta no mesmo produto e' recusada (23505, a frase e o DETAIL), seja a
//     primeira pendente ou publicada, pela cliente e pelo service_role, e no INSERT de varias linhas; outro produto e outra
//     conta passam; a sessao direta no banco fica de fora; cliente gravando em nome de OUTRA conta recebe 42501 (a RLS), nunca
//     o "ja avaliou" (o gatilho nao conta a ninguem que aquela conta avaliou); o selo de compra continua nascendo.
//   * As repetidas que JA existiam: o apply nao toca nenhuma linha (retrato igual) e a terceira e' recusada.
//   * Corrida: DUAS conexoes reais da mesma cliente no mesmo produto — a segunda espera a primeira e e' recusada.
//   * Metricas: global_* e get_reviews_metrics so das publicadas; lista e total_count (paginador) seguem com todas.
//   * Reaplicar, rollback (corpos de antes byte a byte, 2x) e pre-voo que recusa corpo estranho; consultas 201a/201b.
const P = require("./prova-de-objeto-novo.cjs");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");
const { assert, prova } = P;

const NOME =
  "20261641000000_uma_avaliacao_por_cliente_e_a_media_do_painel_so_das_publicadas.sql";
const MIGRATION = P.lerMigration(NOME);
const ROLLBACK = P.lerMigration(`rollback-manual-${NOME}`);
const A201 =
  "201a-conferir-uma-avaliacao-por-cliente-e-a-media-so-das-publicadas-aplicado";
const B201 =
  "201b-antes-uma-avaliacao-por-cliente-e-a-media-so-das-publicadas-base-vigente";
const H = {
  pagedAntes: "75f5c48de4eb4005a2516e54b3d33135",
  pagedNovo: "21ba271d66edd776cab2443d32800db7",
  metricsAntes: "71a40c86c6c1b23fbf991d653c746091",
  metricsNovo: "971268999fce410628356d65b99fbca5",
  gatilho: "a84f4bc295a088c75ad926f43e16c39d",
};

// "g" nao e hexadecimal: os UUIDs usam b3641000; os emails, r3641.
const ADMIN = "b3641000-0000-4000-8000-000000000001";
const CLIENTE = "b3641000-0000-4000-8000-000000000002";
const OUTRA = "b3641000-0000-4000-8000-000000000003";
const TERCEIRA = "b3641000-0000-4000-8000-000000000004";
const PROD_A = "b3641000-0000-4000-8000-0000000000a1";
const PROD_B = "b3641000-0000-4000-8000-0000000000b1";
const PEDIDO = "b3641000-0000-4000-8000-0000000000d1";

const SQL_AVALIAR = `INSERT INTO public.reviews (product_id, user_id, rating, comment, status)
  VALUES ($1::uuid, $2::uuid, $3::int, 'Produto ficticio', 'pendente')`;
/** A avaliacao como o app grava: `authenticated`, em nome de `uid` (ou de `autora`, para o caso de outra conta). */
const avaliar = (uid, produto, nota = 4, autora = uid) =>
  P.tentar("authenticated", SQL_AVALIAR, [produto, autora, nota], { uid });
const contar = async (uid, produto) =>
  Number(
    (
      await P.conexao().query(
        "SELECT count(*) AS n FROM public.reviews WHERE user_id = $1 AND product_id = $2",
        [uid, produto],
      )
    ).rows[0].n,
  );
const recusadaRepetida = (r, msg) => {
  assert.equal(r.codigo, "23505", `${msg}: ${r.erro}`);
  assert.equal(r.erro, "Você já avaliou este produto.", msg);
  assert.equal(r.detalhe, "avaliacao_repetida", msg);
};
const aceita = (r, msg) =>
  assert.equal(r.codigo, undefined, `${msg}: ${r.erro}`);

async function semear(c = P.conexao()) {
  for (const [id, papel, meta] of [
    [ADMIN, "admin", { role: "admin" }],
    [CLIENTE, "customer", {}],
    [OUTRA, "customer", {}],
    [TERCEIRA, "customer", {}],
  ]) {
    await c.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@r3641.fixture.invalid', $2::jsonb)",
      [id, JSON.stringify(meta)],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Pessoa ficticia 3641', $2)
       ON CONFLICT (id) DO UPDATE SET role = $2`,
      [id, papel],
    );
  }
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
     VALUES ($1, 'Produto ficticio A 3641', 100, 10, true, 40), ($2, 'Produto ficticio B 3641', 80, 10, true, 30)`,
    [PROD_A, PROD_B],
  );
  await c.query(`INSERT INTO public.store_config (id, enable_reviews) VALUES (1, true)
    ON CONFLICT (id) DO UPDATE SET enable_reviews = true`);
}

const hash = async (assinatura) =>
  (
    await P.conexao().query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [assinatura],
    )
  ).rows[0]?.h ?? null;
const PAGED = "public.get_admin_reviews_paged(text,text,integer,integer,text)";
const METRICS = "public.get_reviews_metrics(text,integer)";
const GATILHO_FN = "public.avaliacao_uma_por_cliente_e_produto()";
async function estado() {
  return {
    paged: await hash(PAGED),
    metrics: await hash(METRICS),
    gatilho: await hash(GATILHO_FN),
    trigger: Number(
      (
        await P.conexao().query(
          "SELECT count(*) AS n FROM pg_trigger WHERE tgname = 'tr_avaliacao_uma_por_cliente_e_produto'",
        )
      ).rows[0].n,
    ),
  };
}
const NO_AR = {
  paged: H.pagedNovo,
  metrics: H.metricsNovo,
  gatilho: H.gatilho,
  trigger: 1,
};
const DESFEITO = {
  paged: H.pagedAntes,
  metrics: H.metricsAntes,
  gatilho: null,
  trigger: 0,
};
async function desfazer() {
  const r = await P.aplicar(ROLLBACK);
  assert.equal(r, null, `o rollback falhou: ${r?.erro}`);
  assert.deepEqual(await estado(), DESFEITO);
}
async function aplicarMigration() {
  const r = await P.aplicar(MIGRATION);
  assert.equal(r, null, `a migration falhou: ${r?.erro}`);
  assert.deepEqual(await estado(), NO_AR);
}

/** O topo do painel como o admin de agora o le (sessao direta com o usuario do app = o admin). */
async function painel() {
  const c = P.conexao();
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);
  const r = (
    await c.query(
      "SELECT public.get_admin_reviews_paged('', 'all', 0, 50, 'todas') AS r",
    )
  ).rows[0].r;
  const m = (
    await c.query("SELECT * FROM public.get_reviews_metrics(NULL, NULL)")
  ).rows[0];
  return { r, m };
}
/** O que a VITRINE conta: so as publicadas, a tabela inteira (o oraculo das metricas globais). */
async function oraculo(filtro) {
  return (
    await P.conexao().query(
      `SELECT count(*)::bigint AS total, COALESCE(avg(rating), 0)::numeric AS media,
              count(*) FILTER (WHERE verified)::bigint AS verificadas,
              count(*) FILTER (WHERE merchant_reply IS NOT NULL AND trim(merchant_reply) <> '')::bigint AS respondidas
         FROM public.reviews WHERE ${filtro}`,
    )
  ).rows[0];
}
async function semearMetricas() {
  const c = P.conexao();
  // Sessao direta (o app nunca grava publicada; e' a aprovacao da loja): duas publicadas (5 e 4), uma respondida.
  await c.query(
    `INSERT INTO public.reviews (product_id, user_id, rating, comment, status, merchant_reply) VALUES
       ($1, $2, 5, 'otima', 'publicada', 'Obrigada!'), ($1, $3, 4, 'boa', 'publicada', NULL)`,
    [PROD_A, CLIENTE, OUTRA],
  );
  // A pendente (nota 1) entra pelo caminho do app.
  aceita(await avaliar(TERCEIRA, PROD_A, 1), "a pendente do app");
}

// ---------------------------------------------------------------------------

prova(
  "ESTADO: o clone tem a migration no ar (os tres corpos e o gatilho)",
  () =>
    P.emTransacao(async () => {
      assert.deepEqual(await estado(), NO_AR);
    }),
);

prova(
  "CONTROLE (sem a migration): a mesma cliente grava a segunda avaliacao do mesmo produto e o topo do painel soma a pendente",
  () =>
    P.emTransacao(async () => {
      await semear();
      await desfazer();
      aceita(await avaliar(CLIENTE, PROD_A), "primeira");
      aceita(await avaliar(CLIENTE, PROD_A, 2), "o defeito: a segunda entra");
      assert.equal(await contar(CLIENTE, PROD_A), 2);
      await semearMetricas();
      const { r } = await painel();
      const todas = await oraculo("true");
      assert.equal(
        Number(r.global_total_count),
        Number(todas.total),
        "o defeito: o total global conta as pendentes",
      );
      assert.notEqual(
        Number(todas.total),
        Number((await oraculo("status = 'publicada'")).total),
        "a semente tem pendente (senao o controle nao distingue)",
      );
    }),
);

prova(
  "RECUSA: a segunda avaliacao da mesma conta no mesmo produto (pendente ou publicada) volta 23505 e nada entra; outro produto e outra conta passam",
  () =>
    P.emTransacao(async () => {
      await semear();
      aceita(await avaliar(CLIENTE, PROD_A), "primeira");
      recusadaRepetida(
        await avaliar(CLIENTE, PROD_A, 5),
        "segunda (primeira pendente)",
      );
      assert.equal(await contar(CLIENTE, PROD_A), 1);
      aceita(await avaliar(CLIENTE, PROD_B), "outro produto");
      aceita(await avaliar(OUTRA, PROD_A), "outra conta");
      // Publicada (aprovada pela loja) tambem barra.
      await P.conexao().query(
        "UPDATE public.reviews SET status = 'publicada' WHERE user_id = $1 AND product_id = $2",
        [OUTRA, PROD_A],
      );
      recusadaRepetida(
        await avaliar(OUTRA, PROD_A),
        "segunda (primeira publicada)",
      );
      assert.equal(await contar(OUTRA, PROD_A), 1);
    }),
);

prova(
  "RECUSA: service_role tambem nao grava a repetida; INSERT de varias linhas da mesma conta e produto cai inteiro",
  () =>
    P.emTransacao(async () => {
      await semear();
      aceita(await avaliar(CLIENTE, PROD_A), "primeira");
      recusadaRepetida(
        await P.tentar("service_role", SQL_AVALIAR, [PROD_A, CLIENTE, 3], {
          uid: "",
        }),
        "service_role",
      );
      const varias = await P.tentar(
        "authenticated",
        `INSERT INTO public.reviews (product_id, user_id, rating, comment, status) VALUES
           ($1, $2, 5, 'um', 'pendente'), ($1, $2, 4, 'dois', 'pendente')`,
        [PROD_B, OUTRA],
        { uid: OUTRA },
      );
      recusadaRepetida(varias, "varias linhas no mesmo comando");
      assert.equal(await contar(OUTRA, PROD_B), 0, "o comando cai inteiro");
    }),
);

prova(
  "FORA DA TRAVA: a sessao direta no banco grava a repetida; cliente em nome de OUTRA conta recebe 42501 (RLS), nunca o 'ja avaliou'",
  () =>
    P.emTransacao(async () => {
      await semear();
      aceita(await avaliar(OUTRA, PROD_A), "a da OUTRA");
      // A CLIENTE tenta gravar em nome da OUTRA, que ja avaliou: a resposta nao pode revelar isso.
      const alheia = await avaliar(CLIENTE, PROD_A, 4, OUTRA);
      assert.equal(alheia.codigo, "42501", `esperava a RLS: ${alheia.erro}`);
      const semAvaliacao = await avaliar(CLIENTE, PROD_B, 4, OUTRA);
      assert.equal(
        semAvaliacao.codigo,
        "42501",
        "mesma resposta sem avaliacao",
      );
      // Sessao direta (migration, seed, script): fora da trava.
      aceita(
        await P.tentar(null, SQL_AVALIAR, [PROD_A, OUTRA, 2]),
        "sessao direta",
      );
      assert.equal(await contar(OUTRA, PROD_A), 2);
    }),
);

prova(
  "SELO: a compra paga continua dando o selo na avaliacao nova, e a segunda continua recusada",
  () =>
    P.emTransacao(async () => {
      await semear();
      const c = P.conexao();
      await c.query(
        `INSERT INTO public.marketplace_orders (id, user_id, customer_data, customer_name, subtotal, total, payment_status, status)
         VALUES ($1, $2, '{}'::jsonb, 'Pessoa ficticia 3641', 100, 100, 'aguardando', 'pending')`,
        [PEDIDO, CLIENTE],
      );
      await c.query(
        "INSERT INTO public.marketplace_order_items (order_id, product_id, quantity, price) VALUES ($1, $2, 1, 100)",
        [PEDIDO, PROD_A],
      );
      await c.query(
        "UPDATE public.marketplace_orders SET payment_status = 'pago' WHERE id = $1",
        [PEDIDO],
      );
      aceita(await avaliar(CLIENTE, PROD_A, 5), "a de quem comprou");
      const v = (
        await c.query(
          "SELECT verified FROM public.reviews WHERE user_id = $1 AND product_id = $2",
          [CLIENTE, PROD_A],
        )
      ).rows;
      assert.deepEqual(v, [{ verified: true }]);
      recusadaRepetida(
        await avaliar(CLIENTE, PROD_A),
        "segunda de quem comprou",
      );
    }),
);

prova(
  "DADO DE ANTES: as repetidas que ja existiam ficam (o apply nao toca nenhuma linha) e a terceira e' recusada; reaplicar e' igual",
  () =>
    P.emTransacao(async () => {
      await semear();
      await desfazer();
      aceita(await avaliar(CLIENTE, PROD_A, 5), "antiga 1");
      aceita(
        await avaliar(CLIENTE, PROD_A, 2),
        "antiga 2 (a repetida de antes)",
      );
      const fotoDasLinhas = async () =>
        (
          await P.conexao().query(
            "SELECT md5(COALESCE(string_agg(to_jsonb(r)::text, '|' ORDER BY r.id), '')) AS h, count(*) AS n FROM public.reviews r",
          )
        ).rows[0];
      const antes = await fotoDasLinhas();
      await aplicarMigration();
      assert.deepEqual(
        await fotoDasLinhas(),
        antes,
        "o apply mexeu em avaliacao",
      );
      await aplicarMigration(); // reaplicar
      assert.deepEqual(
        await fotoDasLinhas(),
        antes,
        "reaplicar mexeu em avaliacao",
      );
      assert.equal(await contar(CLIENTE, PROD_A), 2, "as duas antigas ficam");
      recusadaRepetida(await avaliar(CLIENTE, PROD_A), "a terceira");
      assert.equal(await contar(CLIENTE, PROD_A), 2);
    }),
);

prova(
  "METRICAS: media, total, verificadas e respondidas do topo so das publicadas (igual a vitrine); lista e paginador seguem com todas",
  () =>
    P.emTransacao(async () => {
      await semear();
      await semearMetricas();
      const { r, m } = await painel();
      const pub = await oraculo("status = 'publicada'");
      const todas = await oraculo("true");
      assert.equal(Number(r.global_total_count), Number(pub.total));
      assert.equal(Number(r.global_average_rating), Number(pub.media));
      assert.equal(Number(r.global_total_verified), Number(pub.verificadas));
      assert.equal(Number(r.global_total_replied), Number(pub.respondidas));
      assert.equal(Number(m.average_rating), Number(pub.media));
      assert.equal(Number(m.total_verified), Number(pub.verificadas));
      assert.equal(Number(m.total_replied), Number(pub.respondidas));
      // A pendente de nota 1 nao derruba a media (o defeito do 3,7 x 5,0).
      assert.ok(Number(pub.media) > Number(todas.media));
      // A lista e o paginador nao mudam: a pendente continua aparecendo para a loja aprovar.
      assert.equal(Number(r.total_count), Number(todas.total));
      assert.ok(
        r.data.some((x) => x.user_id === TERCEIRA && x.status === "pendente"),
        "a pendente sumiu da lista",
      );
      // A fila (p_status = 'pendente') continua achando a pendente.
      const fila = (
        await P.conexao().query(
          "SELECT public.get_admin_reviews_paged('', 'all', 0, 50, 'pendente') AS r",
        )
      ).rows[0].r;
      assert.ok(fila.data.some((x) => x.user_id === TERCEIRA));
    }),
);

prova(
  "ROLLBACK: devolve os corpos da 3996 e da 381 byte a byte e tira gatilho e funcao; 2x igual; o pre-voo recusa corpo estranho sem escrever",
  () =>
    P.emTransacao(async () => {
      await desfazer();
      await desfazer(); // idempotente
      await aplicarMigration();
      // Corpo estranho em get_reviews_metrics: a migration e o rollback recusam (B1) e nada muda.
      await desfazer();
      await P.conexao().query(
        `CREATE OR REPLACE FUNCTION public.get_reviews_metrics(p_search text DEFAULT NULL::text, p_rating integer DEFAULT NULL::integer)
           RETURNS TABLE(average_rating numeric, total_verified bigint, total_replied bigint)
           LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
         AS $f$BEGIN RETURN; END;$f$`,
      );
      const r = await P.aplicar(MIGRATION);
      assert.ok(r, "a migration aplicou sobre corpo estranho");
      assert.match(r.erro, /B1_BASELINE_DIVERGENT/);
      assert.equal(
        await hash(GATILHO_FN),
        null,
        "o pre-voo deixou a funcao do gatilho",
      );
    }),
);

prova(
  "CONSULTAS: 201a e 201b positivas no ar; desfeita, a 201a reprova so o que e' da migration e a 201b segue positiva",
  () =>
    P.emTransacao(async () => {
      assert.deepEqual(await P.consulta(A201), []);
      assert.deepEqual(await P.consulta(B201), []);
      await desfazer();
      assert.deepEqual(
        await P.consulta(A201),
        [
          "avaliacao_uma_por_cliente_e_produto: corpo exato (md5)",
          "avaliacao_uma_por_cliente_e_produto: uma so, plpgsql SECURITY DEFINER VOLATILE, retorno trigger, search_path=public e EXECUTE de ninguem",
          "get_admin_reviews_paged: corpo exato (md5), metricas globais so das publicadas",
          "get_reviews_metrics: corpo exato (md5), so as publicadas",
          "tr_avaliacao_uma_por_cliente_e_produto: BEFORE INSERT por linha em reviews, chama a funcao, ligado, sem WHEN",
        ].sort(),
      );
      assert.deepEqual(await P.consulta(B201), []);
    }),
);

/** Corrida real: duas conexoes, COMMIT de verdade no clone (as linhas sao apagadas no fim). */
prova(
  "CORRIDA: duas conexoes da mesma cliente no mesmo produto ao mesmo tempo — a segunda espera a primeira e e' recusada; fica UMA",
  async () => {
    const c = P.conexao();
    const url = lerDatabaseUrlEfemera();
    const c1 = new Client({ connectionString: url });
    const c2 = new Client({ connectionString: url });
    await c.query("BEGIN");
    await semear(c);
    await c.query("COMMIT");
    await c1.connect();
    await c2.connect();
    const abrir = async (cx) => {
      await cx.query("BEGIN");
      await cx.query("SELECT set_config('app.rpc.user_id', $1, true)", [
        CLIENTE,
      ]);
      await cx.query("SET LOCAL ROLE authenticated");
    };
    try {
      await abrir(c1);
      await abrir(c2);
      await c1.query(SQL_AVALIAR, [PROD_A, CLIENTE, 5]);
      let terminou = false;
      const segunda = c2
        .query(SQL_AVALIAR, [PROD_A, CLIENTE, 4])
        .then(
          () => ({ ok: true }),
          (e) => ({ codigo: e.code, erro: e.message, detalhe: e.detail }),
        )
        .finally(() => {
          terminou = true;
        });
      await new Promise((ok) => setTimeout(ok, 500));
      assert.equal(
        terminou,
        false,
        "a segunda nao esperou a primeira (sem trava)",
      );
      await c1.query("COMMIT");
      const r = await segunda;
      await c2.query("ROLLBACK");
      recusadaRepetida(r, "a segunda conexao");
      assert.equal(await contar(CLIENTE, PROD_A), 1);
    } finally {
      await c1.query("ROLLBACK").catch(() => {});
      await c2.query("ROLLBACK").catch(() => {});
      await c1.end().catch(() => {});
      await c2.end().catch(() => {});
      // Limpa as avaliacoes que esta prova gravou de verdade no clone (o clone some no fim; o resto da semente pode ficar).
      await c
        .query("DELETE FROM public.reviews WHERE product_id IN ($1, $2)", [
          PROD_A,
          PROD_B,
        ])
        .catch(() => {});
    }
  },
);

async function main() {
  await P.conectar();
  try {
    await P.conexao().query(
      "GRANT USAGE ON SCHEMA auth TO authenticated, anon",
    );
    await P.executar("uma avaliacao por cliente e a media so das publicadas");
  } finally {
    await P.conexao().end();
  }
}

main().catch((e) => P.falhar("FALHOU", e.stack || e.message));
