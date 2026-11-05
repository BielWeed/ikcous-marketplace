"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
// Lote 123 / 20261399700000: somente Postgres descartavel do rpc-ci, nunca banco de loja.
// A prova nao roda automaticamente fora do CI_BANCO_EFEMERO=1 + localhost.
//
// O que prova: get_admin_reviews_paged (a lista de Clientes > Avaliacoes) ganha p_status. 'pendente' mostra SO as avaliacoes em
// moderacao, na lista E no total_count (o paginador); NULL, 'todas' e qualquer texto desconhecido valem 'todas' (nunca erro, nunca SQL
// montado); os contadores GLOBAIS nao seguem o filtro. A assinatura TROCA (de 4 para 5 argumentos): a antiga e' apagada na mesma
// migration (sobrecarga velha ao lado da nova daria "is not unique" nas chamadas nomeadas, PGRST203 no PostgREST), e a ACL, o dono e os
// atributos da funcao nova sao IGUAIS aos da antiga mesmo quando o schema tem privilegios padrao frouxos (como o do Supabase).
//
// FIXTURE (2031, nenhuma outra prova escreve nesse ano; created_at todos DISTINTOS, a ordem e' a da data):
//   3 pendentes ANTIGAS (jan: o1 nota 5, o2 nota 1, o3 nota 3) + 20 publicadas (fev/mar) + 1 pendente NOVA (abr, nota 5)
//   => 24 avaliacoes, 4 em moderacao. Com 10 por pagina a pagina 0 mostra so a pendente nova; as 3 antigas afundam na pagina 2:
//      e' o defeito que a lojista via ("N para aprovar" no topo e nenhuma pendente na tela).
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-viva.cjs
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261399700000_o_painel_de_avaliacoes_filtra_o_que_esta_em_moderacao.sql";
const NOME_381 =
  "20261381000000_ex_admin_perde_o_acesso_na_hora_no_resto_do_painel.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const corpoDe = (sql, argumentos) => {
  const cabeca = `CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(${argumentos})
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$`;
  const i = sql.indexOf(cabeca);
  assert.notEqual(i, -1, "a definicao da funcao nao esta no arquivo");
  const inicio = i + cabeca.length;
  return sql.slice(inicio, sql.indexOf("$function$;", inicio));
};
const ARGS_ANTIGA =
  "p_search text DEFAULT ''::text, p_rating text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10";
const ARGS_NOVA = `${ARGS_ANTIGA}, p_status text DEFAULT 'todas'::text`;
const CORPO_ANTES = corpoDe(
  ler(`supabase/migrations/${NOME_381}`),
  ARGS_ANTIGA,
);
const CORPO_NOVO = corpoDe(migration, ARGS_NOVA);
const CORPO_ROLLBACK = corpoDe(rollback, ARGS_ANTIGA);
const HASH_ANTES = "8571a56a9b21e90ebdcf941d762870ac";
const HASH_NOVO = "af5d21345d167ca44dd327a93f949ea6";
const SIG_NOVA =
  "public.get_admin_reviews_paged(text,text,integer,integer,text)";

const ADMIN = "5e399700-0000-4000-8000-000000000001";
const CLIENTE = "5e399700-0000-4000-8000-000000000002";
const EX_ADMIN = "5e399700-0000-4000-8000-000000000003";
const AUTORAS = [1, 2, 3, 4, 5].map(
  (n) => `5e399700-0000-4000-8000-0000000001a${n}`,
);
const PROD_A = "5e399700-0000-4000-8000-0000000000f1";
const PROD_B = "5e399700-0000-4000-8000-0000000000f2";

// Atributos de pg_proc que o DROP + CREATE nao pode mudar (menos oid, argumentos, corpo e ACL, que mudam por construcao).
const EXCLUI = [
  "oid",
  "pronargs",
  "pronargdefaults",
  "proargtypes",
  "proargnames",
  "proargdefaults",
  "proallargtypes",
  "proargmodes",
  "prosrc",
  "proacl",
];
// Leitura de campo por nome sem indexar o objeto (a regra de seguranca do lint reprova obj[chave]).
const campoDe = (obj, campo) => new Map(Object.entries(obj)).get(campo);

/** Tudo que existe com o nome get_admin_reviews_paged: oid, assinatura, corpo sem CR, atributos e ACL (como lista ordenada). */
async function funcoes(c) {
  const r = await c.query(
    `SELECT p.oid::text AS oid, p.oid::regprocedure::text AS sig,
      replace(p.prosrc, chr(13), '') AS corpo, pg_get_function_arguments(p.oid) AS args,
      to_jsonb(p) - $1::text[] AS atributos,
      (SELECT COALESCE(jsonb_agg(x ORDER BY x), '[]'::jsonb) FROM (
         SELECT (CASE WHEN a.grantee = 0 THEN 'PUBLIC' ELSE a.grantee::regrole::text END) || ':' || a.privilege_type || ':' || a.is_grantable AS x
           FROM aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) a) s) AS acl
    FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace AND p.proname = 'get_admin_reviews_paged' ORDER BY p.oid`,
    [EXCLUI],
  );
  return r.rows;
}
const umaSo = async (c) => {
  const f = await funcoes(c);
  assert.equal(f.length, 1, `devia haver UMA assinatura, ha ${f.length}`);
  return f[0];
};

// Retrato dos dados que a migration nao pode tocar.
async function retrato(c) {
  return (
    await c.query(`SELECT md5(concat_ws('|',
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.reviews x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.profiles x),
      (SELECT COALESCE(jsonb_agg(to_jsonb(x) ORDER BY x.id), '[]')::text FROM public.produtos x))) AS h`)
  ).rows[0].h;
}
async function isolado(c, acao) {
  await c.query("SAVEPOINT caso3997");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso3997");
    await c.query("RELEASE SAVEPOINT caso3997");
  }
}
const comoAdmin = (c) =>
  c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);

// ---- as chamadas -----------------------------------------------------------------------------------------
const chama4 = async (c, busca = "", nota = "all", pagina = 0, tamanho = 10) =>
  (
    await c.query(
      "SELECT public.get_admin_reviews_paged($1, $2, $3, $4) AS r",
      [busca, nota, pagina, tamanho],
    )
  ).rows[0].r;
const chama5 = async (
  c,
  status,
  busca = "",
  nota = "all",
  pagina = 0,
  tamanho = 10,
) =>
  (
    await c.query(
      "SELECT public.get_admin_reviews_paged($1, $2, $3, $4, $5::text) AS r",
      [busca, nota, pagina, tamanho, status],
    )
  ).rows[0].r;
const ids = (r) => r.data.map((x) => x.id);
const statusDe = (r) => r.data.map((x) => x.status);
const GLOBAIS = [
  "global_total_count",
  "global_average_rating",
  "global_total_verified",
  "global_total_replied",
];

/** Chama a lista como o papel de API `papel` com a sessao de `quem` (numa subtransacao desfeita). */
const comoPapel = async (c, papel, quem, status = "pendente") =>
  isolado(c, async () => {
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [quem]);
    await c.query(`SET LOCAL ROLE ${papel}`);
    return chama5(c, status);
  });

const F = { o1: null, o2: null, o3: null, nova: null, pub: [] };

async function semear(c) {
  for (const [id, papel, metaAdmin] of [
    [ADMIN, "admin", true],
    [CLIENTE, "customer", false],
    // Ex-admin: ainda admin no auth.users (JWT velho), mas ja customer em profiles.
    [EX_ADMIN, "customer", true],
    ...AUTORAS.map((a) => [a, "customer", false]),
  ]) {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1::uuid, $1::text || '@rev3997.invalid', $2::jsonb)`,
      [id, JSON.stringify(metaAdmin ? { role: "admin" } : {})],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, $3, $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
      [id, papel, `Ficticia ${id.slice(-3)} 3997`],
    );
  }
  await comoAdmin(c);
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo)
     VALUES ($1, 'Vestido Alfa 3997', 100, 40, 10, true), ($2, 'Bolsa Beta 3997', 80, 30, 10, true)`,
    [PROD_A, PROD_B],
  );
  const ins = async (dia, nota, comentario, status, produto, autora) =>
    (
      await c.query(
        `INSERT INTO public.reviews (product_id, user_id, rating, comment, status, created_at)
         VALUES ($1, $2, $3, $4, $5, $6::timestamptz) RETURNING id`,
        [produto, autora, nota, comentario, status, `${dia} 12:00:00-03`],
      )
    ).rows[0].id;
  F.o1 = await ins("2031-01-01", 5, "velha um", "pendente", PROD_A, AUTORAS[0]);
  F.o2 = await ins(
    "2031-01-02",
    1,
    "velha dois",
    "pendente",
    PROD_B,
    AUTORAS[1],
  );
  F.o3 = await ins(
    "2031-01-03",
    3,
    "velha tres",
    "pendente",
    PROD_A,
    AUTORAS[2],
  );
  for (let i = 0; i < 20; i += 1) {
    const dia =
      i < 10
        ? `2031-02-${String(i + 1).padStart(2, "0")}`
        : `2031-03-${String(i - 9).padStart(2, "0")}`;
    F.pub.push(
      await ins(
        dia,
        (i % 5) + 1,
        `publicada ${i}`,
        "publicada",
        i % 2 ? PROD_B : PROD_A,
        AUTORAS[i % 5],
      ),
    );
  }
  F.nova = await ins(
    "2031-04-01",
    5,
    "nova pendente",
    "pendente",
    PROD_B,
    AUTORAS[3],
  );
  // Alguns selos e respostas, para os contadores globais nao serem todos zero.
  await c.query(
    "UPDATE public.reviews SET verified = true WHERE id = ANY($1::uuid[])",
    [[F.pub[0], F.pub[3], F.pub[6], F.o1]],
  );
  await c.query(
    "UPDATE public.reviews SET merchant_reply = 'obrigada', merchant_reply_at = now() WHERE id = ANY($1::uuid[])",
    [[F.pub[0], F.pub[1], F.o2]],
  );
}

/** O comportamento que a migration promete, sobre a fixture inteira (assinatura de 5 argumentos). Lanca no primeiro desvio. */
async function conferirFiltro(c) {
  await comoAdmin(c);
  const todas4 = await chama4(c);
  assert.equal(todas4.total_count, 24);
  assert.equal(todas4.data.length, 10);
  const pendentesEsperadas = [F.nova, F.o3, F.o2, F.o1];

  // 1. 'pendente': so a fila, na lista e no total, da mais nova para a mais antiga, as antigas na PRIMEIRA pagina.
  const p = await chama5(c, "pendente");
  assert.deepEqual(
    ids(p),
    pendentesEsperadas,
    "pendente: a fila inteira, nova primeiro",
  );
  assert.deepEqual(statusDe(p), Array(4).fill("pendente"));
  assert.equal(
    p.total_count,
    4,
    "pendente: total_count e' o da fila, nao o das 24",
  );
  // 2. Os contadores globais NAO seguem o filtro de status (nem o de nota ou busca, como antes).
  for (const k of GLOBAIS)
    assert.deepEqual(
      campoDe(p, k),
      campoDe(todas4, k),
      `${k} nao pode seguir o filtro de status`,
    );
  assert.equal(p.global_total_count, 24);
  // 3. Paginacao DENTRO da fila: o total e' da fila, a pagina 1 de 3 em 3 tem a ultima.
  const p0 = await chama5(c, "pendente", "", "all", 0, 3);
  const p1 = await chama5(c, "pendente", "", "all", 1, 3);
  assert.deepEqual(ids(p0), [F.nova, F.o3, F.o2]);
  assert.deepEqual(ids(p1), [F.o1]);
  assert.equal(p0.total_count, 4);
  assert.equal(p1.total_count, 4);
  const alem = await chama5(c, "pendente", "", "all", 5, 3);
  assert.deepEqual(alem.data, []);
  assert.equal(alem.total_count, 4);
  // 4. Junto com a nota e com a busca (o filtro de status soma com os outros dois).
  assert.deepEqual(ids(await chama5(c, "pendente", "", "1")), [F.o2]);
  assert.deepEqual(ids(await chama5(c, "pendente", "", "5")), [F.nova, F.o1]);
  assert.deepEqual(ids(await chama5(c, "pendente", "velha um")), [F.o1]);
  assert.deepEqual(
    ids(await chama5(c, "pendente", "Bolsa Beta")),
    [F.nova, F.o2],
    "pendente + produto",
  );
  assert.equal(
    (await chama5(c, "pendente", "publicada 3")).total_count,
    0,
    "a busca deixa de achar publicada quando o filtro e' o da fila",
  );
  assert.equal(
    (await chama5(c, "todas", "publicada 3")).total_count,
    1,
    "sem o filtro a busca acha a publicada (como antes)",
  );
  // 5. Todo valor que NAO e' exatamente 'pendente' e' o comportamento de antes: o JSON inteiro igual ao da chamada de 4 argumentos.
  for (const valor of [
    null,
    "todas",
    "",
    "publicada",
    "qualquer coisa",
    "PENDENTE",
    "pendente ",
    "pendente' OR '1'='1",
    "'; DROP TABLE public.reviews; --",
    "all",
  ])
    assert.deepEqual(
      await chama5(c, valor),
      todas4,
      `p_status ${JSON.stringify(valor)} devia valer 'todas'`,
    );
  assert.deepEqual(
    await chama5(c, "qualquer coisa", "", "5", 1, 4),
    await chama4(c, "", "5", 1, 4),
    "valor desconhecido + nota + pagina = igual ao de antes",
  );
  // 6. As formas de chamada: posicional de 4 (o Inicio, o prefetch, o hook), nomeada de 4 e de 5, so p_status e sem nada.
  const nomeada4 = (
    await c.query(
      `SELECT public.get_admin_reviews_paged(p_search => '', p_rating => 'all', p_page => 0, p_page_size => 10) AS r`,
    )
  ).rows[0].r;
  assert.deepEqual(
    nomeada4,
    todas4,
    "4 nomeados resolve na funcao nova pelo default",
  );
  const nomeada5 = (
    await c.query(
      `SELECT public.get_admin_reviews_paged(p_search => '', p_rating => 'all', p_page => 0, p_page_size => 10, p_status => 'pendente') AS r`,
    )
  ).rows[0].r;
  assert.deepEqual(ids(nomeada5), pendentesEsperadas);
  const soStatus = (
    await c.query(
      "SELECT public.get_admin_reviews_paged(p_status => 'pendente') AS r",
    )
  ).rows[0].r;
  assert.deepEqual(ids(soStatus), pendentesEsperadas);
  const semNada = (
    await c.query("SELECT public.get_admin_reviews_paged() AS r")
  ).rows[0].r;
  assert.deepEqual(semNada, todas4);
  // 7. Fila vazia: todas decididas => lista [] (nao null), total 0, globais intactos.
  await isolado(c, async () => {
    await c.query("UPDATE public.reviews SET status = 'publicada'");
    const v = await chama5(c, "pendente");
    assert.deepEqual(v.data, []);
    assert.equal(v.total_count, 0);
    assert.equal(v.global_total_count, 24);
  });
  // 8. Uma pendente aprovada sai da fila na chamada seguinte (a tela recarrega depois de aprovar).
  await isolado(c, async () => {
    await c.query(
      "UPDATE public.reviews SET status = 'publicada' WHERE id = $1",
      [F.o3],
    );
    const v = await chama5(c, "pendente");
    assert.deepEqual(ids(v), [F.nova, F.o2, F.o1]);
    assert.equal(v.total_count, 3);
  });
}

/** O comportamento da lista MAIS o gate (cliente comum e ex-admin barrados): o que um mutante tem de quebrar. */
async function conferirTudo(c) {
  await conferirFiltro(c);
  for (const quem of [CLIENTE, EX_ADMIN])
    await assert.rejects(
      () => comoPapel(c, "authenticated", quem),
      /Acesso negado/,
      "o gate de admin atual sumiu",
    );
}

async function main() {
  const c = new Client({ connectionString: lerDatabaseUrlEfemera() });
  await c.connect();
  try {
    // ---- 0. O topo instalado pelo CI e' o desta migration; o corpo anterior e' o vivo da 381. ----
    const topo0 = await umaSo(c);
    assert.equal(
      topo0.sig,
      "get_admin_reviews_paged(text,text,integer,integer,text)",
    );
    assert.equal(
      topo0.corpo,
      CORPO_NOVO,
      "o topo instalado nao e o corpo da 3997",
    );
    assert.equal(md5(CORPO_NOVO), HASH_NOVO, "o corpo novo nao e o pinado");
    assert.equal(
      md5(CORPO_ANTES),
      HASH_ANTES,
      "o corpo anterior nao e o vivo da 381",
    );
    assert.equal(
      CORPO_ROLLBACK,
      CORPO_ANTES,
      "o rollback nao carrega o corpo da 381 byte a byte",
    );
    assert.equal(topo0.args, ARGS_NOVA);
    assert.equal(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(migration), false);
    assert.equal(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(rollback), false);
    // So esta funcao e' apagada: o DROP da migration nomeia a assinatura de 4 argumentos inteira e nenhuma outra.
    assert.deepEqual(migration.match(/^DROP .*$/gm), [
      "DROP FUNCTION IF EXISTS public.get_admin_reviews_paged(text, text, integer, integer);",
    ]);
    assert.equal(migration.includes("CASCADE"), false);
    // Aditiva: nada de apagar dado.
    assert.equal(
      /\b(DELETE|TRUNCATE|DROP (TABLE|COLUMN|SCHEMA))\b/i.test(
        migration.replace(/--.*$/gm, ""),
      ),
      false,
    );

    // ---- A. ATOMICIDADE sem BEGIN (conexao em autocommit, o banco e' o clone descartavel). ----
    // Uma query de varios comandos e' UMA transacao implicita: DROP, CREATE, REVOKE e GRANT valem juntos ou nao valem.
    await c.query(rollback);
    const velha = await umaSo(c);
    assert.equal(
      velha.sig,
      "get_admin_reviews_paged(text,text,integer,integer)",
    );
    assert.equal(
      velha.corpo,
      CORPO_ANTES,
      "o rollback nao devolveu o corpo da 381",
    );
    assert.equal(velha.args, ARGS_ANTIGA);
    assert.deepEqual(
      velha.atributos,
      topo0.atributos,
      "o rollback mudou atributo ou dono (menos oid, argumentos, corpo, ACL)",
    );
    assert.deepEqual(velha.acl, topo0.acl, "o rollback mudou a ACL");
    const fotoVelha = JSON.stringify(await funcoes(c));
    const sabotagens = [
      [
        "erro DEPOIS do DROP e ANTES do CREATE (o DROP nao pode ficar)",
        migration.replace(
          "CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(",
          "SELECT 1/0;\nCREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(",
        ),
        /division by zero/,
      ],
      [
        "erro no pos-voo (anon com EXECUTE na funcao nova)",
        migration.replace(
          "DO $conferencia_20261399700000$",
          `GRANT EXECUTE ON FUNCTION ${SIG_NOVA} TO anon;\nDO $conferencia_20261399700000$`,
        ),
        /B1_BASELINE_DIVERGENT/,
      ],
      [
        "falha depois de tudo",
        `${migration}\nDO $x$ BEGIN RAISE EXCEPTION 'falha depois da troca'; END $x$;`,
        /falha depois da troca/,
      ],
    ];
    for (const [rotulo, sql, erro] of sabotagens) {
      assert.notEqual(sql, migration, `${rotulo}: a sabotagem entrou no texto`);
      await assert.rejects(() => c.query(sql), erro, rotulo);
      assert.equal(
        JSON.stringify(await funcoes(c)),
        fotoVelha,
        `${rotulo}: a funcao antiga NAO ficou intacta (meia mudanca)`,
      );
    }
    console.log(
      "  PASSOU atomicidade sem BEGIN: erro entre o DROP e o CREATE, anon no pos-voo e falha no fim deixam a funcao ANTIGA intacta (oid, corpo, atributos, ACL)",
    );
    await c.query(migration);
    const nova1 = await umaSo(c);
    assert.equal(nova1.corpo, CORPO_NOVO);
    assert.deepEqual(
      nova1.atributos,
      velha.atributos,
      "migration mudou atributo ou dono",
    );
    assert.deepEqual(nova1.acl, velha.acl, "migration mudou a ACL");
    assert.notEqual(
      nova1.oid,
      velha.oid,
      "o DROP + CREATE nasce com outro OID (custo conhecido)",
    );

    await c.query("BEGIN");
    assert.equal(
      (await c.query("SELECT count(*)::int AS n FROM public.reviews")).rows[0]
        .n,
      0,
      "o banco base ja tem avaliacoes: a prova assume a fixture sozinha",
    );
    await semear(c);
    const dadosAntes = await retrato(c);

    // ---- 1. CONTROLE: com o corpo ANTERIOR (o rollback) o defeito aparece NESTA fixture. ----
    await c.query(rollback);
    const anterior = await umaSo(c);
    assert.equal(anterior.corpo, CORPO_ANTES);
    assert.equal(md5(anterior.corpo), HASH_ANTES);
    await comoAdmin(c);
    const pag0 = await chama4(c);
    assert.equal(pag0.total_count, 24);
    assert.equal(
      pag0.data.filter((x) => x.status === "pendente").length,
      1,
      "controle: na pagina 0 so a pendente NOVA aparece",
    );
    assert.deepEqual(
      ids(await chama4(c, "", "all", 2))
        .filter((id) => [F.o1, F.o2, F.o3].includes(id))
        .sort(),
      [F.o1, F.o2, F.o3].sort(),
      "controle: as 3 pendentes antigas so aparecem na pagina 2",
    );
    assert.equal(
      (await chama4(c, "publicada 3")).total_count,
      1,
      "controle: a busca acha publicada",
    );
    await c.query("SAVEPOINT controle3997");
    await assert.rejects(
      () => chama5(c, "pendente"),
      (e) => e.code === "42883",
      "controle: a funcao antiga nao conhece p_status",
    );
    await c.query("ROLLBACK TO SAVEPOINT controle3997");
    await c.query("SAVEPOINT controle3997");
    await assert.rejects(
      () => conferirTudo(c),
      (e) => e.code === "42883",
    );
    await c.query("ROLLBACK TO SAVEPOINT controle3997");
    console.log(
      "  PASSOU controle: no corpo da 381 a pagina 0 mostra 1 das 4 em moderacao e as 3 antigas so aparecem na pagina 2 (a lojista pagina procurando); p_status nao existe",
    );

    // ---- 2. A migration, sobre a fixture que ja existia. ----
    await c.query(migration);
    const topo = await umaSo(c);
    assert.equal(topo.corpo, CORPO_NOVO);
    assert.equal(topo.args, ARGS_NOVA);
    assert.deepEqual(
      topo.atributos,
      anterior.atributos,
      "apply: atributo ou dono mudou",
    );
    assert.deepEqual(topo.acl, anterior.acl, "apply: a ACL nao e a de antes");
    assert.equal(
      await retrato(c),
      dadosAntes,
      "apply alterou dado que ja existia",
    );
    await conferirTudo(c);
    assert.equal(await retrato(c), dadosAntes, "ler a lista alterou dado");
    console.log(
      "  PASSOU p_status='pendente': so a fila (4), na lista e no total_count, nova primeiro, paginada dentro da fila, somada a nota e a busca; contadores globais intocados (24); NULL, 'todas', '', 'publicada', 'PENDENTE', 'pendente ', injecao e lixo valem 'todas' (JSON identico ao de antes); 4 posicionais, 4 nomeados, 5, so p_status e sem argumento resolvem; fila vazia = [] e total 0; aprovar tira da fila",
    );

    // ---- 3. Uma assinatura so; e por que o DROP e' obrigatorio. ----
    assert.equal((await funcoes(c)).length, 1);
    await isolado(c, async () => {
      // Com a de 4 ao lado da de 5, a chamada com 4 NOMEADOS (a do painel) nao resolve - o PostgREST a recusa (PGRST203).
      await c.query(
        `CREATE FUNCTION public.get_admin_reviews_paged(${ARGS_ANTIGA}) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$`,
      );
      await assert.rejects(
        () =>
          c.query(
            `SELECT public.get_admin_reviews_paged(p_search => '', p_rating => 'all', p_page => 0, p_page_size => 10)`,
          ),
        (e) => e.code === "42725",
        "duas assinaturas: a chamada de 4 nomeados devia ser ambigua",
      );
    });
    console.log(
      "  PASSOU uma unica assinatura no schema; com a de 4 viva ao lado, a chamada de 4 nomeados vira 'is not unique' (42725; PGRST203 no PostgREST): o DROP e' obrigatorio",
    );

    // ---- 4. Porta e permissoes: a ACL e' a de antes, mesmo com privilegios padrao frouxos; o gate e' o de antes. ----
    const priv = async (papel) =>
      (
        await c.query(
          "SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS x",
          [papel, SIG_NOVA],
        )
      ).rows[0].x;
    assert.equal(await priv("anon"), false);
    assert.equal(await priv("authenticated"), true);
    assert.equal(await priv("service_role"), true);
    assert.equal(
      (await umaSo(c)).acl.some((x) => x.startsWith("PUBLIC:")),
      false,
      "PUBLIC com EXECUTE",
    );
    await assert.rejects(
      () => comoPapel(c, "anon", CLIENTE),
      (e) => e.code === "42501",
      "anon nao executa",
    );
    for (const quem of [CLIENTE, EX_ADMIN])
      await assert.rejects(
        () => comoPapel(c, "authenticated", quem),
        /Acesso negado/,
        "cliente comum e ex-admin sao barrados pelo gate",
      );
    assert.deepEqual(ids(await comoPapel(c, "authenticated", ADMIN)), [
      F.nova,
      F.o3,
      F.o2,
      F.o1,
    ]);
    // Privilegios padrao do Supabase (EXECUTE para anon/authenticated/service_role em toda funcao nova): a migration fecha o que o DROP reabriu.
    await isolado(c, async () => {
      await c.query(rollback);
      await c.query(
        "ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO anon, authenticated, service_role",
      );
      const antes = await umaSo(c);
      await c.query(migration);
      const depois = await umaSo(c);
      assert.deepEqual(
        depois.acl,
        antes.acl,
        "com privilegios padrao frouxos a ACL tem de ser a de antes",
      );
      assert.equal(
        await priv("anon"),
        false,
        "anon abriu com o privilegio padrao",
      );
      // E o pos-voo pega quem esquecer o REVOKE (mutante da propria migration).
      await c.query(rollback);
      const semRevoke = migration.replace(
        `REVOKE ALL ON FUNCTION ${SIG_NOVA} FROM PUBLIC, anon;\n`,
        "",
      );
      assert.notEqual(semRevoke, migration);
      await c.query("SAVEPOINT semrevoke3997");
      await assert.rejects(() => c.query(semRevoke), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT semrevoke3997");
    });
    console.log(
      "  PASSOU anon/PUBLIC sem EXECUTE, authenticated e service_role com; cliente comum e ex-admin recebem 'Acesso negado'; admin atual passa; com privilegios padrao frouxos (anon/authenticated/service_role) a ACL fica IGUAL a de antes, e a migration sem o REVOKE e' derrubada pelo pos-voo",
    );

    // ---- 5. Reaplicar e' inofensivo (LF e CRLF) e nao troca o OID de novo. ----
    const oidNovo = (await umaSo(c)).oid;
    await c.query(migration);
    assert.equal((await umaSo(c)).oid, oidNovo, "reaplicar trocou o OID");
    await c.query(migration.replace(/\n/g, "\r\n"));
    const aposCrlf = await umaSo(c);
    assert.equal(
      md5(aposCrlf.corpo),
      HASH_NOVO,
      "o hash e' o do corpo sem CR mesmo aplicado em CRLF",
    );
    assert.equal(aposCrlf.oid, oidNovo);
    assert.deepEqual(aposCrlf.acl, topo.acl);
    assert.equal(await retrato(c), dadosAntes);
    console.log(
      "  PASSOU reaplicar (LF e CRLF) nao muda corpo, ACL, atributos nem OID e nao toca nos dados",
    );

    // ---- 6. O pre-voo recusa o desconhecido SEM escrever. ----
    const recusas = [
      [
        "corpo desconhecido (assinatura de 5)",
        async () =>
          c.query(
            `CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(${ARGS_NOVA}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$BEGIN RETURN '{}'::jsonb; END;$f$`,
          ),
      ],
      [
        "corpo da 381 na assinatura de 5",
        async () =>
          c.query(
            `CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(${ARGS_NOVA}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$${CORPO_ANTES}$f$`,
          ),
      ],
      [
        "as DUAS assinaturas vivas",
        async () =>
          c.query(
            `CREATE FUNCTION public.get_admin_reviews_paged(${ARGS_ANTIGA}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$${CORPO_ANTES}$f$`,
          ),
      ],
      [
        "NENHUMA assinatura viva",
        async () => c.query(`DROP FUNCTION ${SIG_NOVA}`),
      ],
      [
        "atributo diferente (STABLE)",
        async () => c.query(`ALTER FUNCTION ${SIG_NOVA} STABLE`),
      ],
      [
        "search_path diferente",
        async () =>
          c.query(`ALTER FUNCTION ${SIG_NOVA} SET search_path TO public`),
      ],
      [
        "SECURITY INVOKER",
        async () => c.query(`ALTER FUNCTION ${SIG_NOVA} SECURITY INVOKER`),
      ],
      [
        "anon com EXECUTE",
        async () => c.query(`GRANT EXECUTE ON FUNCTION ${SIG_NOVA} TO anon`),
      ],
      [
        "PUBLIC com EXECUTE",
        async () => c.query(`GRANT EXECUTE ON FUNCTION ${SIG_NOVA} TO PUBLIC`),
      ],
      [
        "authenticated sem EXECUTE",
        async () =>
          c.query(`REVOKE EXECUTE ON FUNCTION ${SIG_NOVA} FROM authenticated`),
      ],
      [
        "dono diferente",
        async () => {
          await c.query("CREATE ROLE dono_rev3997 NOLOGIN");
          await c.query(`ALTER FUNCTION ${SIG_NOVA} OWNER TO dono_rev3997`);
        },
      ],
    ];
    for (const [rotulo, preparar] of recusas) {
      await isolado(c, async () => {
        await preparar();
        const estranho = JSON.stringify(await funcoes(c));
        await c.query("SAVEPOINT recusa3997");
        await assert.rejects(
          () => c.query(migration),
          /B1_BASELINE_DIVERGENT/,
          `${rotulo}: a migration devia recusar`,
        );
        await c.query("ROLLBACK TO SAVEPOINT recusa3997");
        assert.equal(
          JSON.stringify(await funcoes(c)),
          estranho,
          `${rotulo}: a recusa gravou algo`,
        );
      });
    }
    // A assinatura antiga com corpo estranho (loja que nao e' a vigente) tambem recusa.
    await isolado(c, async () => {
      await c.query(rollback);
      await c.query(
        `CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(${ARGS_ANTIGA}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$BEGIN RETURN '{}'::jsonb; END;$f$`,
      );
      await c.query("SAVEPOINT antiga3997");
      await assert.rejects(() => c.query(migration), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT antiga3997");
    });
    console.log(
      `  PASSOU o pre-voo recusa sem gravar: ${recusas.length + 1} estados estranhos (corpo, corpo da 381 na de 5, duas assinaturas, nenhuma, STABLE, search_path, INVOKER, anon, PUBLIC, authenticated sem EXECUTE, dono, antiga com corpo estranho)`,
    );

    // ---- 7. MUTANTES da funcao nova: cada um deixa a conferencia VERMELHA por EXPECTATIVA, nunca por erro de SQL. ----
    const PREDICADO = "AND (NOT v_so_pendentes OR r.status = 'pendente')";
    assert.equal(
      CORPO_NOVO.split(PREDICADO).length - 1,
      2,
      "o predicado aparece na contagem e na consulta paginada",
    );
    const trocaNa = (corpo, de, para, ocorrencia) => {
      let i = -1;
      for (let k = 0; k <= ocorrencia; k += 1) i = corpo.indexOf(de, i + 1);
      assert.notEqual(i, -1, `mutante: "${de}" (${ocorrencia}) nao existe`);
      return corpo.slice(0, i) + para + corpo.slice(i + de.length);
    };
    const mutantes = [
      [
        "filtro so na lista (total_count sem filtro)",
        trocaNa(CORPO_NOVO, PREDICADO, "", 0),
      ],
      [
        "filtro so no total (lista sem filtro)",
        trocaNa(CORPO_NOVO, PREDICADO, "", 1),
      ],
      [
        "status invertido (mostra as publicadas)",
        CORPO_NOVO.split("r.status = 'pendente'").join(
          "r.status <> 'pendente'",
        ),
      ],
      [
        "sempre filtra (ignora o parametro)",
        CORPO_NOVO.replace(
          "v_so_pendentes := COALESCE(p_status = 'pendente', false);",
          "v_so_pendentes := true;",
        ),
      ],
      [
        "nunca filtra",
        CORPO_NOVO.replace(
          "v_so_pendentes := COALESCE(p_status = 'pendente', false);",
          "v_so_pendentes := false;",
        ),
      ],
      [
        "sem COALESCE (NULL vira filtro)",
        CORPO_NOVO.replace(
          "COALESCE(p_status = 'pendente', false)",
          "(p_status = 'pendente')",
        ),
      ],
      [
        "qualquer texto liga o filtro (<> 'todas')",
        CORPO_NOVO.replace(
          "COALESCE(p_status = 'pendente', false)",
          "COALESCE(p_status <> 'todas', false)",
        ),
      ],
      [
        "comparacao sem exatidao (lower/btrim)",
        CORPO_NOVO.replace(
          "COALESCE(p_status = 'pendente', false)",
          "COALESCE(lower(btrim(p_status)) = 'pendente', false)",
        ),
      ],
      [
        "contadores globais seguem o filtro",
        CORPO_NOVO.replace(
          "    FROM public.reviews r;",
          `    FROM public.reviews r WHERE (NOT v_so_pendentes OR r.status = 'pendente');`,
        ),
      ],
      [
        "ordem invertida (mais velha primeiro)",
        CORPO_NOVO.replace(
          "ORDER BY r.created_at DESC",
          "ORDER BY r.created_at ASC",
        ),
      ],
      [
        "sem o gate de admin",
        CORPO_NOVO.replace(
          "IF NOT public.is_admin_atual() THEN",
          "IF false THEN",
        ),
      ],
    ];
    for (const [rotulo, corpo] of mutantes) {
      await isolado(c, async () => {
        assert.notEqual(
          corpo,
          CORPO_NOVO,
          `mutante "${rotulo}" nao mudou o corpo`,
        );
        await c.query(
          `CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(${ARGS_NOVA}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$${corpo}$f$`,
        );
        await assert.rejects(
          () => conferirTudo(c),
          // Reprova por EXPECTATIVA nao cumprida, nunca por erro de SQL do mutante.
          (e) => e.code === "ERR_ASSERTION",
          `mutante "${rotulo}" sobreviveu`,
        );
      });
    }
    assert.equal((await umaSo(c)).corpo, CORPO_NOVO, "o mutante deixou rastro");
    console.log(
      `  PASSOU ${mutantes.length} mutantes reprovam (filtro so na lista, so no total, invertido, sempre, nunca, sem COALESCE, qualquer texto, comparacao frouxa, globais filtrados, ordem invertida, sem gate)`,
    );

    // ---- 8. Rollback: devolve a assinatura de 4 e o corpo da 381 byte a byte; o segundo e o desconhecido recusam; ida e volta limpa. ----
    await comoAdmin(c);
    const aCaminhoDeVolta = await chama5(c, null);
    await c.query(rollback);
    const volta = await umaSo(c);
    assert.equal(
      volta.sig,
      "get_admin_reviews_paged(text,text,integer,integer)",
    );
    assert.equal(volta.corpo, CORPO_ANTES);
    assert.equal(md5(volta.corpo), HASH_ANTES);
    assert.equal(volta.args, ARGS_ANTIGA);
    assert.deepEqual(volta.atributos, topo.atributos);
    assert.deepEqual(volta.acl, topo.acl);
    await comoAdmin(c);
    assert.deepEqual(
      await chama4(c),
      aCaminhoDeVolta,
      "ida e volta: a lista de 4 argumentos e' a mesma",
    );
    await c.query("SAVEPOINT segundo3997");
    await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
    await c.query("ROLLBACK TO SAVEPOINT segundo3997");
    assert.equal((await umaSo(c)).corpo, CORPO_ANTES);
    await isolado(c, async () => {
      await c.query(migration);
      await c.query(
        `CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(${ARGS_NOVA}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$BEGIN RETURN '{}'::jsonb; END;$f$`,
      );
      await c.query("SAVEPOINT rbrecusa3997");
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rbrecusa3997");
    });
    await c.query(migration);
    assert.equal((await umaSo(c)).corpo, CORPO_NOVO);
    await conferirTudo(c);
    assert.equal(await retrato(c), dadosAntes, "ida e volta alterou dado");
    console.log(
      "  PASSOU rollback devolve a assinatura de 4 e a 381 byte a byte (atributos e ACL iguais), a lista volta a ser a de antes; o segundo e o corpo desconhecido recusam; a ida e volta nao toca nos dados",
    );

    // ---- 9. Os portoes: a 123a espera a funcao nova (e so ela), a 123b a antiga; a 86a aceita a nova como sucessora da 381. ----
    const consulta = (nome) => ler(`scripts/publicacao/consultas/${nome}.sql`);
    const A123 =
      "123a-conferir-o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-aplicado";
    const B123 =
      "123b-antes-o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-base-vigente";
    const A86 = "86a-conferir-ex-admin-no-resto-do-painel-aplicado";
    const rodar = async (nome) => (await c.query(consulta(nome))).rows;
    const reprovadas = (rows) =>
      rows.filter((r) => r.ok !== true).map((r) => r.item);
    const ROL_123 = [
      "controle: funcoes de public visiveis a este papel",
      "get_admin_reviews_paged: corpo exato (md5)",
      "get_admin_reviews_paged: assinatura e atributos conhecidos",
      "get_admin_reviews_paged: EXECUTE authenticated e service_role, sem PUBLIC ou anon",
    ];
    const LINHA_86 =
      "RPC: public.get_admin_reviews_paged(text,text,integer,integer)";
    const [CORPO, ATRIB, ACL] = ROL_123.slice(1);
    // O que cada consulta reprova (lista de itens) no estado do banco; o resto do rol tem de estar ok.
    const noEstado = async (rotulo, esperaA, esperaB, esperaA86) => {
      for (const [nome, espera] of [
        [A123, esperaA],
        [B123, esperaB],
      ]) {
        const rows = await rodar(nome);
        assert.deepEqual(
          rows.map((r) => r.item).sort(),
          [...ROL_123].sort(),
          `${nome}: rol fechado de 4 linhas`,
        );
        assert.deepEqual(
          reprovadas(rows).sort(),
          [...espera].sort(),
          `${rotulo}: ${nome}`,
        );
      }
      const r86 = await rodar(A86);
      assert.equal(r86.length, 36, "86a: 36 itens");
      assert.deepEqual(reprovadas(r86), esperaA86, `${rotulo}: 86a`);
    };
    // (a) a arvore inteira: funcao nova no ar
    await noEstado("funcao nova", [], [CORPO, ATRIB, ACL], []);
    await isolado(c, async () => {
      // (b) loja que ainda nao recebeu a 3997: a de 4 com o corpo da 381
      await c.query(rollback);
      await noEstado("a de 4 (381)", [CORPO, ATRIB, ACL], [], []);
      // (c) corpo estranho na antiga: a 123b reprova o corpo, a 86a a linha da funcao
      await c.query(
        `CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(${ARGS_ANTIGA}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$${CORPO_ANTES.replace("BEGIN", "BEGIN -- estranho")}$f$`,
      );
      await noEstado(
        "a de 4 estranha",
        [CORPO, ATRIB, ACL],
        [CORPO],
        [LINHA_86],
      );
    });
    await isolado(c, async () => {
      // (d) corpo estranho na de 5: a 123a reprova o corpo, a 86a a linha da funcao
      await c.query(
        `CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(${ARGS_NOVA}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$${CORPO_NOVO.replace("BEGIN", "BEGIN -- estranho")}$f$`,
      );
      await noEstado(
        "a de 5 estranha",
        [CORPO],
        [CORPO, ATRIB, ACL],
        [LINHA_86],
      );
    });
    await isolado(c, async () => {
      // (e) as DUAS assinaturas vivas: a linha de atributos das duas consultas exige UMA so, e a 86a tambem
      await c.query(
        `CREATE FUNCTION public.get_admin_reviews_paged(${ARGS_ANTIGA}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$${CORPO_ANTES}$f$`,
      );
      // A antiga recriada aqui nasce com EXECUTE para PUBLIC (o padrao do Postgres): a 123b reprova tambem a ACL dela.
      await noEstado("duas assinaturas", [ATRIB], [ATRIB, ACL], [LINHA_86]);
    });
    // (f) a ACL aberta reprova a 123a na linha da ACL
    await isolado(c, async () => {
      await c.query(`GRANT EXECUTE ON FUNCTION ${SIG_NOVA} TO anon`);
      assert.deepEqual(reprovadas(await rodar(A123)), [ACL]);
    });
    console.log(
      "  PASSOU 123a passa so com a de 5 (corpo, atributos, ACL, uma assinatura) e reprova a antiga; 123b passa so com a de 4 da 381; rol fechado de 4 linhas; a 86a aceita a de 5 e a de 4 e reprova so a linha da funcao com corpo estranho ou duas assinaturas",
    );
    console.log(
      `  estado final: ${(await funcoes(c)).length} assinatura(s), ${(await umaSo(c)).sig}`,
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
  console.log(
    "[o-painel-de-avaliacoes-filtra] prova viva concluida (20261399700000).",
  );
}

main().catch((erro) => {
  console.error(
    `[o-painel-de-avaliacoes-filtra] FALHOU: ${erro.stack || erro.message}`,
  );
  process.exit(1);
});
