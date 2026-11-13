"use strict";
/* eslint-disable security/detect-non-literal-fs-filename --
 * Arquivos SQL locais do repositorio, todos com nomes literais fechados. */
// Lote 148 / 20261399996000: somente Postgres descartavel do rpc-ci, nunca banco de loja.
// A prova nao roda automaticamente fora do CI_BANCO_EFEMERO=1 + localhost.
//
// O que prova: get_admin_reviews_paged (a lista de Clientes > Avaliacoes) ganha o terceiro valor de p_status. 'sem_resposta' mostra SO as
// avaliacoes sem resposta da loja (merchant_reply IS NULL, a regra do sino do painel), na lista E no total_count (o paginador); NULL, 'todas',
// 'pendente' (que segue como na 20261399700000) e qualquer texto desconhecido seguem como antes (nunca erro, nunca SQL montado); os contadores
// GLOBAIS nao seguem o filtro. A ASSINATURA NAO muda (os mesmos 5 argumentos da 3997): nao ha DROP, o OID, o dono, os atributos e a ACL ficam.
//
// FIXTURE (2032, nenhuma outra prova escreve nesse ano; created_at todos DISTINTOS, a ordem e' a da data):
//   jan: S1 (nota 5), S2 (nota 1), S3 (nota 3) publicadas SEM resposta (NULL); PS pendente sem resposta; PR pendente COM resposta;
//        B1 publicada com resposta '' e B2 com resposta so de espacos (em branco: NAO contam como sem resposta, como no sino)
//   fev/mar: 12 publicadas respondidas;  abr: N1 publicada sem resposta (nota 5)
//   => 20 avaliacoes, 5 sem resposta (N1, PS, S3, S2, S1). Com 5 por pagina, a S1 (a do aviso) so aparece na pagina 3 de "Todas":
//      e' o defeito que a lojista via (o aviso diz "sem resposta" e a lista nao mostra a avaliacao).
//
// USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
//        node tests/banco/rodar-isolado.cjs tests/banco/o-painel-de-avaliacoes-filtra-o-que-esta-sem-resposta-viva.cjs
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera } = require("./efemero.cjs");

const NOME =
  "20261399996000_o_painel_de_avaliacoes_filtra_o_que_esta_sem_resposta.sql";
const NOME_3997 =
  "20261399700000_o_painel_de_avaliacoes_filtra_o_que_esta_em_moderacao.sql";
const RAIZ = path.join(__dirname, "../..");
const ler = (rel) =>
  fs.readFileSync(path.join(RAIZ, rel), "utf8").replace(/\r/g, "");
const migration = ler(`supabase/migrations/${NOME}`);
const rollback = ler(`supabase/migrations/rollback-manual-${NOME}`);
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");
const ARGS_NOVA =
  "p_search text DEFAULT ''::text, p_rating text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10, p_status text DEFAULT 'todas'::text";
const corpoDe = (sql) => {
  const cabeca = `CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(${ARGS_NOVA})
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
const CORPO_ANTES = corpoDe(ler(`supabase/migrations/${NOME_3997}`));
const CORPO_NOVO = corpoDe(migration);
const CORPO_ROLLBACK = corpoDe(rollback);
const HASH_ANTES = "af5d21345d167ca44dd327a93f949ea6";
const HASH_NOVO = "75f5c48de4eb4005a2516e54b3d33135";
const SIG = "public.get_admin_reviews_paged(text,text,integer,integer,text)";
const CABECA_CREATE = (corpo) =>
  `CREATE OR REPLACE FUNCTION public.get_admin_reviews_paged(${ARGS_NOVA}) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$${corpo}$f$`;

// A regra do sino, lida do FONTE do front (nunca copiada): "<coluna>.is.null" -> "<coluna> IS NULL".
const SINO =
  /FILTRO_POSTGREST_AVALIACAO_SEM_RESPOSTA = "([a-z_]+)\.is\.null"/.exec(
    ler("src/lib/avaliacoes-para-atender.ts"),
  );
assert.ok(
  SINO,
  "o front nao declara a regra de 'sem resposta' como <coluna>.is.null",
);
const REGRA_DO_SINO_EM_SQL = `${SINO[1]} IS NULL`;

const ADMIN = "5e399600-0000-4000-8000-000000000001";
const CLIENTE = "5e399600-0000-4000-8000-000000000002";
const EX_ADMIN = "5e399600-0000-4000-8000-000000000003";
const AUTORAS = [1, 2, 3, 4, 5].map(
  (n) => `5e399600-0000-4000-8000-0000000001a${n}`,
);
const PROD_A = "5e399600-0000-4000-8000-0000000000f1";
const PROD_B = "5e399600-0000-4000-8000-0000000000f2";

// Tudo do catalogo que o CREATE OR REPLACE nao pode mudar (menos o corpo).
const EXCLUI = ["prosrc"];
const campoDe = (obj, campo) => new Map(Object.entries(obj)).get(campo);

/** Tudo que existe com o nome get_admin_reviews_paged: oid, assinatura, corpo sem CR, atributos (inclui OID e ACL) e ACL (como lista ordenada). */
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
  await c.query("SAVEPOINT caso3996");
  try {
    return await acao();
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT caso3996");
    await c.query("RELEASE SAVEPOINT caso3996");
  }
}
const comoAdmin = (c) =>
  c.query("SELECT set_config('app.rpc.user_id', $1, true)", [ADMIN]);

// ---- as chamadas -----------------------------------------------------------------------------------------
const chama = async (
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
const chama4 = async (c, busca = "", nota = "all", pagina = 0, tamanho = 10) =>
  (
    await c.query(
      "SELECT public.get_admin_reviews_paged($1, $2, $3, $4) AS r",
      [busca, nota, pagina, tamanho],
    )
  ).rows[0].r;
const ids = (r) => r.data.map((x) => x.id);
const GLOBAIS = [
  "global_total_count",
  "global_average_rating",
  "global_total_verified",
  "global_total_replied",
];

/** Chama a lista como o papel de API `papel` com a sessao de `quem` (numa subtransacao desfeita). */
const comoPapel = async (c, papel, quem, status = "sem_resposta") =>
  isolado(c, async () => {
    await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [quem]);
    await c.query(`SET LOCAL ROLE ${papel}`);
    return chama(c, status);
  });

const F = {
  s1: null,
  s2: null,
  s3: null,
  ps: null,
  pr: null,
  b1: null,
  b2: null,
  n1: null,
  resp: [],
};

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
       VALUES ($1::uuid, $1::text || '@rev3996.invalid', $2::jsonb)`,
      [id, JSON.stringify(metaAdmin ? { role: "admin" } : {})],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role)
       VALUES ($1, $3, $2) ON CONFLICT (id) DO UPDATE SET role = $2`,
      [id, papel, `Ficticia ${id.slice(-3)} 3996`],
    );
  }
  await comoAdmin(c);
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo)
     VALUES ($1, 'Vestido Alfa 3996', 100, 40, 10, true), ($2, 'Bolsa Beta 3996', 80, 30, 10, true)`,
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
  F.s1 = await ins(
    "2032-01-01",
    5,
    "velha um",
    "publicada",
    PROD_A,
    AUTORAS[0],
  );
  F.s2 = await ins(
    "2032-01-02",
    1,
    "velha dois",
    "publicada",
    PROD_B,
    AUTORAS[1],
  );
  F.s3 = await ins(
    "2032-01-03",
    3,
    "velha tres",
    "publicada",
    PROD_A,
    AUTORAS[2],
  );
  F.ps = await ins(
    "2032-01-04",
    2,
    "pendente sem resposta",
    "pendente",
    PROD_B,
    AUTORAS[3],
  );
  F.pr = await ins(
    "2032-01-05",
    4,
    "pendente com resposta",
    "pendente",
    PROD_A,
    AUTORAS[4],
  );
  F.b1 = await ins(
    "2032-01-06",
    4,
    "em branco um",
    "publicada",
    PROD_B,
    AUTORAS[0],
  );
  F.b2 = await ins(
    "2032-01-07",
    4,
    "em branco dois",
    "publicada",
    PROD_A,
    AUTORAS[1],
  );
  for (let i = 0; i < 12; i += 1) {
    const dia =
      i < 6
        ? `2032-02-${String(i + 1).padStart(2, "0")}`
        : `2032-03-${String(i - 5).padStart(2, "0")}`;
    F.resp.push(
      await ins(
        dia,
        (i % 5) + 1,
        `respondida ${i}`,
        "publicada",
        i % 2 ? PROD_B : PROD_A,
        AUTORAS[i % 5],
      ),
    );
  }
  F.n1 = await ins(
    "2032-04-01",
    5,
    "nova sem resposta",
    "publicada",
    PROD_B,
    AUTORAS[3],
  );
  // Respostas: as 12 do meio, a da pendente, e as duas EM BRANCO ('' e so espacos) - que o sino nao conta como sem resposta.
  await c.query(
    "UPDATE public.reviews SET merchant_reply = 'obrigada', merchant_reply_at = now() WHERE id = ANY($1::uuid[])",
    [[...F.resp, F.pr]],
  );
  await c.query("UPDATE public.reviews SET merchant_reply = '' WHERE id = $1", [
    F.b1,
  ]);
  await c.query(
    "UPDATE public.reviews SET merchant_reply = '   ' WHERE id = $1",
    [F.b2],
  );
  await c.query(
    "UPDATE public.reviews SET verified = true WHERE id = ANY($1::uuid[])",
    [[F.resp[0], F.resp[3], F.s1]],
  );
}

/** O comportamento que a migration promete, sobre a fixture inteira. Lanca no primeiro desvio. */
async function conferirFiltro(c) {
  await comoAdmin(c);
  const todas = await chama4(c);
  assert.equal(todas.total_count, 20);
  const semResposta = [F.n1, F.ps, F.s3, F.s2, F.s1];

  // 1. 'sem_resposta': so as sem resposta, na lista e no total, da mais nova para a mais antiga.
  const s = await chama(c, "sem_resposta");
  assert.deepEqual(ids(s), semResposta, "sem_resposta: as 5, nova primeiro");
  assert.equal(
    s.total_count,
    5,
    "sem_resposta: total_count e' o das sem resposta, nao o das 20",
  );
  assert.ok(
    s.data.every((x) => x.merchant_reply === null),
    "sem_resposta: so merchant_reply NULL",
  );
  // 1b. Resposta nula, vazia, so espaco e preenchida: so a NULA entra (regra do sino); a pendente sem resposta TAMBEM entra.
  for (const fora of [F.b1, F.b2, F.pr, ...F.resp])
    assert.equal(
      ids(s).includes(fora),
      false,
      `${fora} tem resposta (mesmo que em branco) e nao pode entrar`,
    );
  assert.equal(
    ids(s).includes(F.ps),
    true,
    "pendente sem resposta tambem espera resposta",
  );
  // 1c. O CHIP = o SINO: a contagem da regra do sino (lida do fonte do front) sobre as linhas e' o total_count.
  const contagemDoSino = (
    await c.query(
      `SELECT count(*)::int AS n FROM public.reviews WHERE ${REGRA_DO_SINO_EM_SQL}`,
    )
  ).rows[0].n;
  assert.equal(contagemDoSino, 5);
  assert.equal(
    s.total_count,
    contagemDoSino,
    "o N do chip (regra do sino) e o total do filtro tem de ser o mesmo",
  );
  // 2. Os contadores globais NAO seguem o filtro.
  for (const k of GLOBAIS)
    assert.deepEqual(
      campoDe(s, k),
      campoDe(todas, k),
      `${k} nao pode seguir o filtro de resposta`,
    );
  assert.equal(s.global_total_count, 20);
  // 3. O DEFEITO DO AVISO: com 5 por pagina a S1 so aparece na pagina 3 de "Todas"; em 'sem_resposta' esta na pagina 0 (com 10 tambem).
  const todasP0 = await chama4(c, "", "all", 0, 5);
  assert.equal(
    ids(todasP0).includes(F.s1),
    false,
    "controle: em Todas a S1 nao esta na pagina 0",
  );
  assert.equal(
    ids(await chama(c, "sem_resposta", "", "all", 0, 5)).includes(F.s1),
    true,
  );
  assert.equal(
    ids(await chama(c, "sem_resposta", "", "all", 0, 10)).includes(F.s1),
    true,
  );
  // 4. Paginacao DENTRO das sem resposta: o total e' o delas.
  const p0 = await chama(c, "sem_resposta", "", "all", 0, 2);
  const p1 = await chama(c, "sem_resposta", "", "all", 1, 2);
  const p2 = await chama(c, "sem_resposta", "", "all", 2, 2);
  assert.deepEqual(ids(p0), [F.n1, F.ps]);
  assert.deepEqual(ids(p1), [F.s3, F.s2]);
  assert.deepEqual(ids(p2), [F.s1]);
  for (const p of [p0, p1, p2]) assert.equal(p.total_count, 5);
  const alem = await chama(c, "sem_resposta", "", "all", 7, 2);
  assert.deepEqual(alem.data, []);
  assert.equal(alem.total_count, 5);
  // 5. Junto com a nota e com a busca (soma com os outros dois filtros).
  assert.deepEqual(ids(await chama(c, "sem_resposta", "", "1")), [F.s2]);
  assert.deepEqual(ids(await chama(c, "sem_resposta", "", "5")), [F.n1, F.s1]);
  assert.deepEqual(ids(await chama(c, "sem_resposta", "velha um")), [F.s1]);
  assert.deepEqual(
    ids(await chama(c, "sem_resposta", "Bolsa Beta")),
    [F.n1, F.ps, F.s2],
    "sem_resposta + produto",
  );
  assert.equal(
    (await chama(c, "sem_resposta", "respondida 3")).total_count,
    0,
    "a busca nao acha a respondida quando o filtro e' o das sem resposta",
  );
  assert.equal(
    (await chama(c, "todas", "respondida 3")).total_count,
    1,
    "sem o filtro a busca acha a respondida (como antes)",
  );
  // 6. Todo valor que NAO e' exatamente 'sem_resposta' nem 'pendente': o JSON inteiro igual ao da chamada de 4 argumentos.
  for (const valor of [
    null,
    "todas",
    "",
    "publicada",
    "qualquer coisa",
    "SEM_RESPOSTA",
    "sem_resposta ",
    " sem_resposta",
    "sem resposta",
    "sem_resposta' OR '1'='1",
    "'; DROP TABLE public.reviews; --",
    "all",
  ])
    assert.deepEqual(
      await chama(c, valor),
      todas,
      `p_status ${JSON.stringify(valor)} devia valer 'todas'`,
    );
  // 7. O filtro de moderacao (20261399700000) segue igual: so a fila, na lista e no total.
  const pendentes = await chama(c, "pendente");
  assert.deepEqual(
    ids(pendentes),
    [F.pr, F.ps],
    "pendente: a fila inteira, nova primeiro",
  );
  assert.equal(pendentes.total_count, 2);
  assert.deepEqual(ids(await chama(c, "pendente", "", "all", 1, 1)), [F.ps]);
  // 8. As formas de chamada: 4 posicional, 4 nomeados, 5 nomeados e so p_status.
  const nomeada4 = (
    await c.query(
      `SELECT public.get_admin_reviews_paged(p_search => '', p_rating => 'all', p_page => 0, p_page_size => 10) AS r`,
    )
  ).rows[0].r;
  assert.deepEqual(nomeada4, todas);
  const soStatus = (
    await c.query(
      "SELECT public.get_admin_reviews_paged(p_status => 'sem_resposta') AS r",
    )
  ).rows[0].r;
  assert.deepEqual(ids(soStatus), semResposta);
  assert.deepEqual(
    (await c.query("SELECT public.get_admin_reviews_paged() AS r")).rows[0].r,
    todas,
  );
  // 9. A resposta tira da lista (a tela recarrega depois de responder); apagar a resposta (NULL) volta; em branco continua fora.
  await isolado(c, async () => {
    await c.query(
      "UPDATE public.reviews SET merchant_reply = 'obrigada!' WHERE id = $1",
      [F.s3],
    );
    const v = await chama(c, "sem_resposta");
    assert.deepEqual(ids(v), [F.n1, F.ps, F.s2, F.s1]);
    assert.equal(v.total_count, 4);
    await c.query(
      "UPDATE public.reviews SET merchant_reply = NULL WHERE id = $1",
      [F.b1],
    );
    assert.equal(
      ids(await chama(c, "sem_resposta")).includes(F.b1),
      true,
      "NULL volta a ser sem resposta",
    );
    await c.query(
      "UPDATE public.reviews SET merchant_reply = '  ' WHERE id = $1",
      [F.s2],
    );
    assert.equal(
      ids(await chama(c, "sem_resposta")).includes(F.s2),
      false,
      "so espacos conta como respondida (a regra do sino)",
    );
  });
  // 10. Tudo respondido: lista [] (nao null), total 0, globais intactos.
  await isolado(c, async () => {
    await c.query(
      "UPDATE public.reviews SET merchant_reply = 'ok' WHERE merchant_reply IS NULL",
    );
    const v = await chama(c, "sem_resposta");
    assert.deepEqual(v.data, []);
    assert.equal(v.total_count, 0);
    assert.equal(v.global_total_count, 20);
  });
  // 11. Aprovar uma pendente sem resposta nao a tira de 'sem_resposta' (aprovar nao responde).
  await isolado(c, async () => {
    await c.query(
      "UPDATE public.reviews SET status = 'publicada' WHERE id = $1",
      [F.ps],
    );
    assert.deepEqual(ids(await chama(c, "sem_resposta")), semResposta);
    assert.deepEqual(ids(await chama(c, "pendente")), [F.pr]);
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
    // ---- 0. O topo instalado pelo CI e' o desta migration; o corpo anterior e' o vivo da 3997. ----
    const topo0 = await umaSo(c);
    assert.equal(
      topo0.sig,
      "get_admin_reviews_paged(text,text,integer,integer,text)",
    );
    assert.equal(
      topo0.corpo,
      CORPO_NOVO,
      "o topo instalado nao e o corpo da 3996",
    );
    assert.equal(md5(CORPO_NOVO), HASH_NOVO, "o corpo novo nao e o pinado");
    assert.equal(
      md5(CORPO_ANTES),
      HASH_ANTES,
      "o corpo anterior nao e o vivo da 3997",
    );
    assert.equal(
      CORPO_ROLLBACK,
      CORPO_ANTES,
      "o rollback nao carrega o corpo da 3997 byte a byte",
    );
    assert.equal(topo0.args, ARGS_NOVA);
    for (const texto of [migration, rollback]) {
      const semComentario = texto.replace(/--.*$/gm, "");
      assert.equal(/^\s*(BEGIN|COMMIT|ROLLBACK)\s*;/im.test(texto), false);
      // Mesma assinatura: nada de DROP, nada de apagar dado, nada de grant novo, nenhum objeto novo.
      assert.equal(
        /^\s*DROP\b/im.test(semComentario),
        false,
        "DROP numa migration que nao muda a assinatura",
      );
      assert.equal(texto.includes("CASCADE"), false);
      assert.equal(
        /\b(DELETE|TRUNCATE|DROP (TABLE|COLUMN|SCHEMA)|INSERT|UPDATE)\b/i.test(
          semComentario.replace(corpoDe(texto), ""),
        ),
        false,
      );
      assert.equal(
        /^\s*(GRANT|REVOKE|CREATE (TABLE|INDEX|POLICY|TRIGGER|SCHEMA))\b/im.test(
          semComentario,
        ),
        false,
      );
      assert.equal(
        (semComentario.match(/CREATE OR REPLACE FUNCTION/g) ?? []).length,
        1,
      );
    }
    // O predicado da migration e' a regra do sino (a do FONTE do front).
    assert.ok(
      CORPO_NOVO.includes(
        `AND (NOT v_so_sem_resposta OR r.${REGRA_DO_SINO_EM_SQL})`,
      ),
      "o SQL nao usa a regra do sino",
    );

    // ---- A. ATOMICIDADE sem BEGIN (conexao em autocommit, o banco e' o clone descartavel). ----
    // Uma query de varios comandos e' UMA transacao implicita: o CREATE e as conferencias valem juntos ou nao valem.
    await c.query(rollback);
    const velha = await umaSo(c);
    assert.equal(
      velha.corpo,
      CORPO_ANTES,
      "o rollback nao devolveu o corpo da 3997",
    );
    assert.equal(md5(velha.corpo), HASH_ANTES);
    assert.equal(
      velha.oid,
      topo0.oid,
      "o rollback trocou o OID (CREATE OR REPLACE preserva)",
    );
    assert.deepEqual(
      velha.atributos,
      topo0.atributos,
      "o rollback mudou atributo, dono, OID ou ACL",
    );
    assert.deepEqual(velha.acl, topo0.acl, "o rollback mudou a ACL");
    const fotoVelha = JSON.stringify(await funcoes(c));
    const sabotagens = [
      [
        "erro DEPOIS do CREATE e ANTES da conferencia (o CREATE nao pode ficar)",
        migration.replace(
          "DO $conferencia_20261399996000$",
          "SELECT 1/0;\nDO $conferencia_20261399996000$",
        ),
        /division by zero/,
      ],
      [
        "erro no pos-voo (anon com EXECUTE na funcao)",
        migration.replace(
          "DO $conferencia_20261399996000$",
          `GRANT EXECUTE ON FUNCTION ${SIG} TO anon;\nDO $conferencia_20261399996000$`,
        ),
        /B1_BASELINE_DIVERGENT/,
      ],
      [
        "corpo trocado depois do CREATE (o pos-voo confere o hash)",
        migration.replace(
          "DO $conferencia_20261399996000$",
          `${CABECA_CREATE("BEGIN RETURN '{}'::jsonb; END;")};\nDO $conferencia_20261399996000$`,
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
        `${rotulo}: a funcao de antes NAO ficou intacta (meia mudanca)`,
      );
    }
    console.log(
      "  PASSOU atomicidade sem BEGIN: erro entre o CREATE e a conferencia, anon no pos-voo, corpo trocado e falha no fim deixam a funcao de ANTES intacta (oid, corpo, atributos, ACL)",
    );
    await c.query(migration);
    const nova1 = await umaSo(c);
    assert.equal(nova1.corpo, CORPO_NOVO);
    assert.equal(
      nova1.oid,
      velha.oid,
      "a migration trocou o OID (nao devia: sem DROP)",
    );
    assert.deepEqual(
      nova1.atributos,
      velha.atributos,
      "migration mudou atributo, dono, OID ou ACL",
    );
    assert.deepEqual(nova1.acl, velha.acl, "migration mudou a ACL");

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
    await comoAdmin(c);
    const todasAntes = await chama4(c, "", "all", 0, 5);
    assert.equal(
      ids(todasAntes).includes(F.s1),
      false,
      "controle: a avaliacao do aviso (S1) nao esta na pagina 0 de Todas",
    );
    assert.deepEqual(
      ids(await chama4(c, "", "all", 3, 5)).includes(F.s1),
      true,
      "controle: a S1 so aparece na pagina 3 (a lojista pagina procurando)",
    );
    // 'sem_resposta' no corpo da 3997 e' texto desconhecido: vale 'todas' (nao filtra) - o defeito continua.
    assert.deepEqual(
      await chama(c, "sem_resposta"),
      await chama4(c),
      "controle: no corpo da 3997 o texto 'sem_resposta' nao filtra",
    );
    await c.query("SAVEPOINT controle3996");
    await assert.rejects(
      () => conferirTudo(c),
      (e) => e.code === "ERR_ASSERTION",
    );
    await c.query("ROLLBACK TO SAVEPOINT controle3996");
    console.log(
      "  PASSOU controle: no corpo da 3997 a avaliacao do aviso so aparece na pagina 3 de Todas (5 por pagina) e p_status = 'sem_resposta' vale 'todas' (nao filtra)",
    );

    // ---- 2. A migration, sobre a fixture que ja existia. ----
    await c.query(migration);
    const topo = await umaSo(c);
    assert.equal(topo.corpo, CORPO_NOVO);
    assert.equal(topo.args, ARGS_NOVA);
    assert.equal(topo.oid, anterior.oid, "apply: o OID mudou");
    assert.deepEqual(
      topo.atributos,
      anterior.atributos,
      "apply: atributo, dono ou ACL mudou",
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
      "  PASSOU p_status='sem_resposta': so as 5 sem resposta (nula; '' e so espacos NAO), na lista e no total_count, nova primeiro, paginada dentro delas, somada a nota e a busca; total == contagem da regra do sino (lida do front); a avaliacao do aviso na pagina 0; globais intocados (20); NULL, 'todas', 'SEM_RESPOSTA', 'sem_resposta ', injecao e lixo valem 'todas'; 'pendente' segue igual; responder tira da lista; tudo respondido = [] e total 0",
    );

    // ---- 3. Porta e permissoes: a ACL e' a de antes; o gate e' o de antes; a assinatura e' uma so. ----
    assert.equal((await funcoes(c)).length, 1);
    const priv = async (papel) =>
      (
        await c.query(
          "SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS x",
          [papel, SIG],
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
      F.n1,
      F.ps,
      F.s3,
      F.s2,
      F.s1,
    ]);
    console.log(
      "  PASSOU anon/PUBLIC sem EXECUTE, authenticated e service_role com; cliente comum e ex-admin recebem 'Acesso negado'; admin atual passa; uma assinatura so",
    );

    // ---- 4. Reaplicar e' inofensivo (LF e CRLF) e nao troca o OID. ----
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

    // ---- 5. O pre-voo recusa o desconhecido SEM escrever. ----
    const recusas = [
      [
        "corpo desconhecido (assinatura de 5)",
        async () => c.query(CABECA_CREATE("BEGIN RETURN '{}'::jsonb; END;")),
      ],
      [
        "corpo anterior a 3997 (o da 381) na assinatura de 5",
        async () => {
          await c.query(rollback);
          const doRollbackDa3997 = ler(
            `supabase/migrations/rollback-manual-${NOME_3997}`,
          );
          await c.query(doRollbackDa3997);
          // Agora so existe a de 4 argumentos (a loja que ainda nao recebeu a 3997): a migration tem de recusar.
        },
      ],
      [
        "as DUAS assinaturas vivas",
        async () =>
          c.query(
            `CREATE FUNCTION public.get_admin_reviews_paged(p_search text DEFAULT ''::text, p_rating text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$BEGIN RETURN '{}'::jsonb; END;$f$`,
          ),
      ],
      ["NENHUMA assinatura viva", async () => c.query(`DROP FUNCTION ${SIG}`)],
      [
        "atributo diferente (STABLE)",
        async () => c.query(`ALTER FUNCTION ${SIG} STABLE`),
      ],
      [
        "search_path diferente",
        async () => c.query(`ALTER FUNCTION ${SIG} SET search_path TO public`),
      ],
      [
        "SECURITY INVOKER",
        async () => c.query(`ALTER FUNCTION ${SIG} SECURITY INVOKER`),
      ],
      [
        "anon com EXECUTE",
        async () => c.query(`GRANT EXECUTE ON FUNCTION ${SIG} TO anon`),
      ],
      [
        "PUBLIC com EXECUTE",
        async () => c.query(`GRANT EXECUTE ON FUNCTION ${SIG} TO PUBLIC`),
      ],
      [
        "authenticated sem EXECUTE",
        async () =>
          c.query(`REVOKE EXECUTE ON FUNCTION ${SIG} FROM authenticated`),
      ],
      [
        "dono diferente",
        async () => {
          await c.query("CREATE ROLE dono_rev3996 NOLOGIN");
          await c.query(`ALTER FUNCTION ${SIG} OWNER TO dono_rev3996`);
        },
      ],
    ];
    for (const [rotulo, preparar] of recusas) {
      await isolado(c, async () => {
        await preparar();
        const estranho = JSON.stringify(await funcoes(c));
        await c.query("SAVEPOINT recusa3996");
        await assert.rejects(
          () => c.query(migration),
          /B1_BASELINE_DIVERGENT/,
          `${rotulo}: a migration devia recusar`,
        );
        await c.query("ROLLBACK TO SAVEPOINT recusa3996");
        assert.equal(
          JSON.stringify(await funcoes(c)),
          estranho,
          `${rotulo}: a recusa gravou algo`,
        );
      });
    }
    // O corpo da 3997 (a base de antes) e' ACEITO: e' o caso normal de aplicar.
    await isolado(c, async () => {
      await c.query(rollback);
      await c.query(migration);
      assert.equal((await umaSo(c)).corpo, CORPO_NOVO);
    });
    console.log(
      `  PASSOU o pre-voo recusa sem gravar: ${recusas.length} estados estranhos (corpo, loja sem a 3997 so com a de 4, duas assinaturas, nenhuma, STABLE, search_path, INVOKER, anon, PUBLIC, authenticated sem EXECUTE, dono) e aceita o corpo da 3997`,
    );

    // ---- 6. MUTANTES da funcao nova: cada um deixa a conferencia VERMELHA por EXPECTATIVA, nunca por erro de SQL. ----
    const PREDICADO = "AND (NOT v_so_sem_resposta OR r.merchant_reply IS NULL)";
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
    const CALCULO =
      "v_so_sem_resposta := COALESCE(p_status = 'sem_resposta', false);";
    const mutantes = [
      [
        "sem o ramo (a migration sem o filtro: o texto vale 'todas')",
        CORPO_NOVO.replace(CALCULO, "v_so_sem_resposta := false;"),
      ],
      [
        "filtro so na lista (total_count sem filtro)",
        trocaNa(CORPO_NOVO, PREDICADO, "", 0),
      ],
      [
        "filtro so no total (lista sem filtro)",
        trocaNa(CORPO_NOVO, PREDICADO, "", 1),
      ],
      [
        "regra diferente da do sino (resposta em branco tambem e' sem resposta)",
        CORPO_NOVO.split("r.merchant_reply IS NULL)").join(
          "COALESCE(btrim(r.merchant_reply), '') = '')",
        ),
      ],
      [
        "regra invertida (mostra as respondidas)",
        CORPO_NOVO.split("r.merchant_reply IS NULL)").join(
          "r.merchant_reply IS NOT NULL)",
        ),
      ],
      [
        "so as publicadas (a pendente sem resposta sai da lista)",
        CORPO_NOVO.split("r.merchant_reply IS NULL)").join(
          "r.merchant_reply IS NULL AND r.status = 'publicada')",
        ),
      ],
      [
        "sempre filtra (ignora o parametro)",
        CORPO_NOVO.replace(CALCULO, "v_so_sem_resposta := true;"),
      ],
      [
        "sem COALESCE (NULL vira filtro)",
        CORPO_NOVO.replace(
          "COALESCE(p_status = 'sem_resposta', false)",
          "(p_status = 'sem_resposta')",
        ),
      ],
      [
        "qualquer texto liga o filtro (<> 'todas')",
        CORPO_NOVO.replace(
          "COALESCE(p_status = 'sem_resposta', false)",
          "COALESCE(p_status <> 'todas', false)",
        ),
      ],
      [
        "comparacao sem exatidao (lower/btrim)",
        CORPO_NOVO.replace(
          "COALESCE(p_status = 'sem_resposta', false)",
          "COALESCE(lower(btrim(p_status)) = 'sem_resposta', false)",
        ),
      ],
      [
        "o filtro de moderacao quebra (pendente deixa de filtrar)",
        CORPO_NOVO.replace(
          "v_so_pendentes := COALESCE(p_status = 'pendente', false);",
          "v_so_pendentes := false;",
        ),
      ],
      [
        "contadores globais seguem o filtro",
        CORPO_NOVO.replace(
          "    FROM public.reviews r;",
          `    FROM public.reviews r WHERE ${PREDICADO.slice(4)};`,
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
        await c.query(CABECA_CREATE(corpo));
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
      `  PASSOU ${mutantes.length} mutantes reprovam (sem o ramo, so na lista, so no total, regra diferente da do sino, invertida, so publicadas, sempre, sem COALESCE, qualquer texto, comparacao frouxa, moderacao quebrada, globais filtrados, ordem invertida, sem gate)`,
    );

    // ---- 7. Rollback: devolve o corpo da 3997 byte a byte; o segundo e o desconhecido recusam; ida e volta limpa. ----
    await comoAdmin(c);
    const aCaminhoDeVolta = await chama(c, null);
    await c.query(rollback);
    const volta = await umaSo(c);
    assert.equal(volta.corpo, CORPO_ANTES);
    assert.equal(md5(volta.corpo), HASH_ANTES);
    assert.equal(volta.args, ARGS_NOVA);
    assert.equal(volta.oid, topo.oid, "o rollback trocou o OID");
    assert.deepEqual(volta.atributos, topo.atributos);
    assert.deepEqual(volta.acl, topo.acl);
    await comoAdmin(c);
    assert.deepEqual(
      await chama(c, null),
      aCaminhoDeVolta,
      "ida e volta: a lista sem filtro e' a mesma",
    );
    // Depois do rollback 'sem_resposta' volta a valer 'todas' (valor desconhecido, nunca erro).
    assert.deepEqual(await chama(c, "sem_resposta"), await chama4(c));
    await c.query("SAVEPOINT segundo3996");
    await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
    await c.query("ROLLBACK TO SAVEPOINT segundo3996");
    assert.equal((await umaSo(c)).corpo, CORPO_ANTES);
    await isolado(c, async () => {
      await c.query(migration);
      await c.query(CABECA_CREATE("BEGIN RETURN '{}'::jsonb; END;"));
      await c.query("SAVEPOINT rbrecusa3996");
      await assert.rejects(() => c.query(rollback), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT rbrecusa3996");
    });
    await c.query(migration);
    assert.equal((await umaSo(c)).corpo, CORPO_NOVO);
    await conferirTudo(c);
    assert.equal(await retrato(c), dadosAntes, "ida e volta alterou dado");
    console.log(
      "  PASSOU rollback devolve a 3997 byte a byte (OID, atributos e ACL iguais), o texto 'sem_resposta' volta a valer 'todas'; o segundo e o corpo desconhecido recusam; a ida e volta nao toca nos dados",
    );

    // ---- 8. Os portoes: a 148a espera o corpo novo, a 148b o da 3997; a 123a e a 86a aceitam os dois. ----
    const consulta = (nome) => ler(`scripts/publicacao/consultas/${nome}.sql`);
    const A148 =
      "148a-conferir-o-painel-de-avaliacoes-filtra-o-que-esta-sem-resposta-aplicado";
    const B148 =
      "148b-antes-o-painel-de-avaliacoes-filtra-o-que-esta-sem-resposta-base-vigente";
    const A123 =
      "123a-conferir-o-painel-de-avaliacoes-filtra-o-que-esta-em-moderacao-aplicado";
    const A86 = "86a-conferir-ex-admin-no-resto-do-painel-aplicado";
    const rodar = async (nome) => (await c.query(consulta(nome))).rows;
    const reprovadas = (rows) =>
      rows.filter((r) => r.ok !== true).map((r) => r.item);
    const ROL = [
      "controle: funcoes de public visiveis a este papel",
      "get_admin_reviews_paged: corpo exato (md5)",
      "get_admin_reviews_paged: assinatura e atributos conhecidos",
      "get_admin_reviews_paged: EXECUTE authenticated e service_role, sem PUBLIC ou anon",
    ];
    const LINHA_86 =
      "RPC: public.get_admin_reviews_paged(text,text,integer,integer)";
    const [CORPO, ATRIB, ACL] = ROL.slice(1);
    const noEstado = async (
      rotulo,
      esperaA148,
      esperaB148,
      esperaA123,
      esperaA86,
    ) => {
      for (const [nome, espera] of [
        [A148, esperaA148],
        [B148, esperaB148],
        [A123, esperaA123],
      ]) {
        const rows = await rodar(nome);
        assert.deepEqual(
          rows.map((r) => r.item).sort(),
          [...ROL].sort(),
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
    // (a) a arvore inteira: o corpo novo no ar
    await noEstado("corpo novo", [], [CORPO], [], []);
    await isolado(c, async () => {
      // (b) loja que ainda nao recebeu a 3996: a de 5 com o corpo da 3997
      await c.query(rollback);
      await noEstado("corpo da 3997", [CORPO], [], [], []);
      // (c) loja que nem a 3997 recebeu: so a de 4 (o corpo da 381). As consultas desta familia olham a de 5.
      await c.query(ler(`supabase/migrations/rollback-manual-${NOME_3997}`));
      await noEstado(
        "so a de 4 (381)",
        [CORPO, ATRIB, ACL],
        [CORPO, ATRIB, ACL],
        [CORPO, ATRIB, ACL],
        [],
      );
    });
    await isolado(c, async () => {
      // (d) corpo estranho na de 5: as tres reprovam o corpo e a 86a a linha da funcao
      await c.query(
        CABECA_CREATE(CORPO_NOVO.replace("BEGIN", "BEGIN -- estranho")),
      );
      await noEstado("a de 5 estranha", [CORPO], [CORPO], [CORPO], [LINHA_86]);
    });
    await isolado(c, async () => {
      // (e) as DUAS assinaturas vivas: a linha de atributos exige UMA so, e a 86a tambem
      await c.query(
        `CREATE FUNCTION public.get_admin_reviews_paged(p_search text DEFAULT ''::text, p_rating text DEFAULT 'all'::text, p_page integer DEFAULT 0, p_page_size integer DEFAULT 10) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'extensions' AS $f$${CORPO_ANTES}$f$`,
      );
      await noEstado(
        "duas assinaturas",
        [ATRIB],
        [CORPO, ATRIB],
        [ATRIB],
        [LINHA_86],
      );
    });
    // (f) a ACL aberta reprova a 148a na linha da ACL
    await isolado(c, async () => {
      await c.query(`GRANT EXECUTE ON FUNCTION ${SIG} TO anon`);
      assert.deepEqual(reprovadas(await rodar(A148)), [ACL]);
    });
    console.log(
      "  PASSOU 148a passa so com o corpo novo; 148b so com o da 3997; 123a e 86a aceitam os dois corpos e reprovam o estranho, a loja sem a 3997 e as duas assinaturas; rol fechado de 4 linhas; ACL aberta reprova a 148a",
    );
    console.log(
      `  estado final: ${(await funcoes(c)).length} assinatura(s), ${(await umaSo(c)).sig}`,
    );
  } finally {
    await c.query("ROLLBACK").catch(() => {});
    await c.end();
  }
  console.log(
    "[o-painel-de-avaliacoes-filtra-sem-resposta] prova viva concluida (20261399996000).",
  );
}

main().catch((erro) => {
  console.error(
    `[o-painel-de-avaliacoes-filtra-sem-resposta] FALHOU: ${erro.stack || erro.message}`,
  );
  process.exit(1);
});
