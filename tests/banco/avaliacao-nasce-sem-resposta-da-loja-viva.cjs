"use strict";

/**
 * Prova VIVA da migration 20261224000000 (a avaliacao nasce sem a resposta da loja: um gatilho BEFORE INSERT em
 * `reviews` limpa `merchant_reply`, `merchant_reply_at`, `helpful` e `created_at` quando quem grava e' cliente;
 * achado da cacada Opus de 14/10/2026), num Postgres EFEMERO local, sem rede, com os papeis de verdade
 * (anon, authenticated, service_role).
 *
 * Cada caso roda numa transacao que termina em ROLLBACK (o da concorrencia usa conexoes reais, grava de verdade
 * e desfaz). O banco e' o clone do rodar-isolado.cjs: a arvore migrada. Como a arvore pode ou nao ja ter a
 * 20261224 (em CI ela tem), os casos do estado ANTES montam esse estado com o rollback-manual dela.
 *
 *  ANTES      controle: sem o gatilho a cliente logada grava a avaliacao com a voz da loja, 9999 uteis e data de 2030
 *             (o defeito); o COMPORTAMENTO ESPERADO desta prova REPROVA nesse estado (e' o mutante "sem gatilho").
 *  DEPOIS     a avaliacao forjada entra LIMPA (resposta e data da resposta nulas, helpful 0, created_at = agora) e
 *             o resto fica (produto, autora, nota, comentario, status pendente); a avaliacao normal do app (5
 *             colunas) entra IGUAL a de antes; o selo "verificado" pela compra (gatilho AFTER) segue; INSERT de
 *             varias linhas, helpful NULL explicito e SECURITY DEFINER de intermediario tambem limpam; admin
 *             (rls_admin_atual), service_role, postgres e a sessao direta (role = none) gravam como vierem;
 *             "admin" so no JWT (rebaixado) e' limpo; anon continua recusado pela RLS; `reply_review_atomic` (UPDATE)
 *             segue gravando a resposta do lojista.
 *  DADOS      avaliacao forjada ANTES do apply nao e' tocada pelo apply (hash do conteudo identico).
 *  SO NOVO    o apply cria so a funcao e o gatilho: nenhuma outra funcao, tabela, policy ou ACL muda; a funcao
 *             nasce FECHADA (nem PUBLIC, nem anon, nem authenticated, nem service_role executam).
 *  MUTANTES   o mesmo comportamento esperado, rodado sobre corpos/gatilhos sabotados (cada coluna sem limpar, sem
 *             a excecao do admin, sem a excecao da sessao direta, excecao invertida, admin so pelo JWT, gatilho
 *             AFTER), FICA VERMELHO.
 *  MIGRATION  reaplicar (2x) e CRLF = mesmo estado; o rollback apaga os DOIS objetos sem tocar dado nem o gatilho
 *             irmao, e rodar de novo e' no-op; ida e volta termina igual; o pre-voo recusa SEM escrever (corpo
 *             desconhecido, sobrecarga, gatilho de outra tabela/momento/evento/WHEN, rls_admin_atual ausente,
 *             coluna ausente, gatilho irmao ausente); a conferencia final recusa estado ruim; o pre-voo do rollback
 *             recusa o que nao e' dele.
 *  CONCORRENCIA uma gravacao em voo segura o CREATE TRIGGER (e nao e' limpa: nasceu antes); a que chega DURANTE a
 *             espera fica na fila e sai limpa; nada trava para sempre.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://postgres@127.0.0.1:<porta>/postgres \
 *        node tests/banco/rodar-isolado.cjs tests/banco/avaliacao-nasce-sem-resposta-da-loja-viva.cjs
 */

/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection --
 * Os caminhos vem do proprio repositorio (as migrations), nunca de entrada de rede; os indices
 * vem de contadores e de listas fechadas deste arquivo. */

const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const { lerDatabaseUrlEfemera, falhar } = require("./efemero.cjs");

const MIGRATIONS = path.resolve(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const ARQ = "20261224000000_a_avaliacao_nasce_sem_a_resposta_da_loja.sql";
const MIGRATION = fs.readFileSync(path.join(MIGRATIONS, ARQ), "utf8");
const ROLLBACK = fs.readFileSync(
  path.join(MIGRATIONS, `rollback-manual-${ARQ}`),
  "utf8",
);
const emCRLF = (s) => s.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
const md5 = (s) => crypto.createHash("md5").update(s).digest("hex");

/** O corpo de um arquivo de migration: do `AS $function$` ao `$function$;`. */
const corpoDe = (sql) => {
  const i = sql.indexOf("AS $function$") + "AS $function$".length;
  return sql.slice(i, sql.indexOf("$function$;", i));
};
const CORPO = corpoDe(MIGRATION);
const H_CORPO = md5(CORPO);
const BLOCO_CONFERENCIA = MIGRATION.match(
  /DO \$conferencia_20261224\$[\s\S]*?END \$conferencia_20261224\$;/,
)[0];

const SQL_27M = fs.readFileSync(
  path.resolve(
    __dirname,
    "..",
    "..",
    "scripts",
    "publicacao",
    "consultas",
    "27m-medir-avaliacao-forjada.sql",
  ),
  "utf8",
);
const FN = "public.avaliacao_nasce_sem_a_resposta_da_loja()";
const GATILHO = "tr_avaliacao_nasce_sem_a_resposta_da_loja";
const TZ = "SET LOCAL TIME ZONE 'UTC'";

const U = {
  admin: "7e7e2240-0000-4000-8000-0000000000a1",
  rebaixado: "7e7e2240-0000-4000-8000-0000000000a2",
  autor1: "7e7e2240-0000-4000-8000-0000000000d4", // comprou o produto (pedido pago)
  autor2: "7e7e2240-0000-4000-8000-0000000000d5",
  autor3: "7e7e2240-0000-4000-8000-0000000000d6",
};
const PROD = "7e7e2240-0000-4000-8000-0000000000f0";
const PEDIDO = "7e7e2240-0000-4000-8000-0000000000e1";
const JWT_ADMIN = JSON.stringify({
  role: "authenticated",
  app_metadata: { role: "admin" },
});

const FORJADO = {
  comentario: "bom produto",
  resposta:
    "Resposta Oficial da Loja: use o cupom FALSO50 no site golpe.example",
  respostaEm: "2030-01-01T00:00:00Z",
  helpful: 9999,
  criadaEm: "2030-06-01T00:00:00Z",
};

let C;
const PROVAS = [];
const prova = (nome, corpo) => PROVAS.push({ nome, corpo });

/** Uma transacao por caso, sempre desfeita; `antes` monta o estado ANTES (rollback-manual). */
async function emTransacao(fn, { antes = false } = {}) {
  await C.query("BEGIN");
  try {
    await C.query(TZ);
    if (antes) {
      await C.query(ROLLBACK);
      assert.equal(await funcaoExiste(), false, "o estado ANTES nao montou");
      assert.equal(await gatilhoExiste(), false, "o gatilho devia sumir");
    } else {
      await C.query(MIGRATION);
      assert.equal(await hashVivo(), H_CORPO, "o estado DEPOIS nao montou");
    }
    return await fn();
  } finally {
    await C.query("ROLLBACK");
  }
}

/** Roda `sql` como `papel` (null = sessao direta, `role` = none), com o JWT e o auth.uid() pedidos. */
async function como(
  papel,
  sql,
  params = [],
  { uid = "", claims = "" } = {},
  conexao = C,
) {
  await conexao.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [uid, claims],
  );
  if (papel) await conexao.query(`SET LOCAL ROLE ${papel}`);
  try {
    return (await conexao.query(sql, params)).rows;
  } finally {
    // transacao abortada nao aceita RESET ROLE e o erro dela esconderia o original
    await conexao.query("RESET ROLE").catch(() => {});
  }
}

/** Como `como`, mas o erro nao derruba a transacao: devolve {linhas} ou {erro, codigo}. */
async function tentar(papel, sql, params = [], id = {}) {
  await C.query("SAVEPOINT tentativa");
  try {
    const linhas = await como(papel, sql, params, id);
    await C.query("RELEASE SAVEPOINT tentativa");
    return { linhas };
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT tentativa");
    await C.query("RESET ROLE");
    return { erro: e.message, codigo: e.code };
  }
}

/** Aplica um arquivo dentro de um savepoint: devolve null se aplicou ou {erro, codigo}. */
async function aplicar(sql) {
  await C.query("SAVEPOINT arquivo");
  try {
    await C.query(sql);
    await C.query("RELEASE SAVEPOINT arquivo");
    return null;
  } catch (e) {
    await C.query("ROLLBACK TO SAVEPOINT arquivo");
    return { erro: e.message, codigo: e.code };
  }
}

const COLUNAS_SAIDA = `id, product_id, user_id, rating, comment, status, verified, merchant_reply, merchant_reply_at,
  helpful, created_at, (created_at = now()) AS criada_agora`;

/** INSERT da avaliacao FORJADA (as 4 colunas do defeito preenchidas). */
const SQL_FORJADA = `INSERT INTO public.reviews (product_id, user_id, rating, comment, status, merchant_reply,
    merchant_reply_at, helpful, created_at)
  VALUES ($1::uuid, $2::uuid, 5, $3, 'pendente', $4, $5::timestamptz, $6::int, $7::timestamptz)
  RETURNING ${COLUNAS_SAIDA}`;
const PARAMS_FORJADA = (uid) => [
  PROD,
  uid,
  FORJADO.comentario,
  FORJADO.resposta,
  FORJADO.respostaEm,
  FORJADO.helpful,
  FORJADO.criadaEm,
];
/** INSERT como o app faz (as 5 colunas de addReview). */
const SQL_NORMAL = `INSERT INTO public.reviews (product_id, user_id, rating, comment, status)
  VALUES ($1::uuid, $2::uuid, 4, 'chegou certinho', 'pendente') RETURNING ${COLUNAS_SAIDA}`;

const forjar = (papel, uid, claims = "") =>
  tentar(papel, SQL_FORJADA, PARAMS_FORJADA(uid), { uid, claims });
const normal = (papel, uid) => tentar(papel, SQL_NORMAL, [PROD, uid], { uid });

const funcaoExiste = async () =>
  (await C.query("SELECT to_regprocedure($1) IS NOT NULL AS x", [FN])).rows[0]
    .x;
const gatilhoExiste = async () =>
  (
    await C.query(
      "SELECT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = $1) AS x",
      [GATILHO],
    )
  ).rows[0].x;
const hashVivo = async () =>
  (
    await C.query(
      "SELECT md5(replace(prosrc, E'\\r', '')) AS h FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0]?.h;
const oidVivo = async () =>
  (await C.query("SELECT to_regprocedure($1)::oid::text AS o", [FN])).rows[0].o;
const aclFuncao = async () =>
  (
    await C.query(
      "SELECT proacl::text AS a FROM pg_proc WHERE oid = to_regprocedure($1)",
      [FN],
    )
  ).rows[0].a;
const gatilhoDef = async () =>
  (
    await C.query(
      `SELECT tgrelid::regclass::text AS tabela, tgtype, tgenabled, tgfoid::regproc::text AS funcao,
              tgqual IS NULL AS sem_when, tgnargs, oid::text AS oid
         FROM pg_trigger WHERE tgname = $1`,
      [GATILHO],
    )
  ).rows;

/** Funcoes e tabelas (corpo e ACL) e as policies de reviews: o que a migration nao pode tocar. */
async function retratoDoSchema() {
  const funcoes = (
    await C.query(
      `SELECT p.oid::regprocedure::text AS f, p.oid::text AS oid, p.proacl::text AS acl,
              md5(p.prosrc) AS corpo, p.prosecdef, p.provolatile, p.proconfig::text AS cfg
         FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname <> 'avaliacao_nasce_sem_a_resposta_da_loja' ORDER BY 1`,
    )
  ).rows;
  const tabelas = (
    await C.query(
      `SELECT c.oid::regclass::text AS t, c.relacl::text AS acl
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind IN ('r','v','m','p') ORDER BY 1`,
    )
  ).rows;
  const policies = (
    await C.query(
      `SELECT polname, polcmd, polroles::text AS roles, pg_get_expr(polqual, polrelid) AS q,
              pg_get_expr(polwithcheck, polrelid) AS wc
         FROM pg_policy WHERE polrelid = 'public.reviews'::regclass ORDER BY polname`,
    )
  ).rows;
  const gatilhosIrmaos = (
    await C.query(
      `SELECT tgname, tgtype, tgenabled FROM pg_trigger
        WHERE tgrelid = 'public.reviews'::regclass AND NOT tgisinternal AND tgname <> $1 ORDER BY 1`,
      [GATILHO],
    )
  ).rows;
  return { funcoes, tabelas, policies, gatilhosIrmaos };
}

/** O conteudo inteiro das avaliacoes, byte a byte (hash). */
async function retratoDosDados() {
  const r = await C.query(
    `SELECT coalesce(md5(string_agg(x::text, '|' ORDER BY x.id::text)), '') AS avaliacoes,
            count(*)::int AS n FROM public.reviews x`,
  );
  return r.rows[0];
}

/** Pessoas, produto e um pedido PAGO da autora 1 (o selo "verificado" vem dele). */
async function semear() {
  for (const id of Object.values(U))
    await C.query(
      "INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@24.teste', '{}'::jsonb)",
      [id],
    );
  await C.query(
    `INSERT INTO public.profiles (id, full_name, role) VALUES
       ($1, 'Admin 24', 'admin'), ($2, 'Ex Admin 24', 'customer'), ($3, 'Marina Autora', 'customer'),
       ($4, 'Autora Dois', 'customer'), ($5, 'Autora Tres', 'customer')`,
    [U.admin, U.rebaixado, U.autor1, U.autor2, U.autor3],
  );
  await C.query(
    'UPDATE auth.users SET raw_app_meta_data = \'{"role":"admin"}\'::jsonb WHERE id = $1',
    [U.admin],
  );
  await C.query(
    "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Camiseta Azul 24', 100, 10, true, 40)",
    [PROD],
  );
  await C.query(
    `INSERT INTO public.marketplace_orders (id, user_id, customer_data, customer_name, subtotal, total, payment_status, status)
     VALUES ($1, $2, '{}'::jsonb, 'Marina Autora', 100, 100, 'pago', 'delivered')`,
    [PEDIDO, U.autor1],
  );
  await C.query(
    "INSERT INTO public.marketplace_order_items (order_id, product_id, quantity, price) VALUES ($1, $2, 1, 100)",
    [PEDIDO, PROD],
  );
}

/** A linha que o banco guardou, lida como dono (por cima da RLS). */
const guardada = async (id) =>
  (
    await C.query(
      `SELECT merchant_reply, merchant_reply_at, helpful, (created_at = now()) AS criada_agora, status, verified
         FROM public.reviews WHERE id = $1`,
      [id],
    )
  ).rows[0];

/** O que tem de valer para uma avaliacao LIMPA: entrou, sem o que foi forjado, com o resto no lugar. */
function assertLimpa(r, rotulo, { verified = false } = {}) {
  assert.ok(
    r.linhas,
    `${rotulo}: a insercao devia entrar (limpa), recusou: ${r.erro}`,
  );
  assert.equal(r.linhas.length, 1, rotulo);
  const l = r.linhas[0];
  assert.equal(
    l.merchant_reply,
    null,
    `${rotulo}: merchant_reply forjada ficou`,
  );
  assert.equal(
    l.merchant_reply_at,
    null,
    `${rotulo}: merchant_reply_at forjada ficou`,
  );
  assert.equal(l.helpful, 0, `${rotulo}: helpful forjado ficou (${l.helpful})`);
  assert.equal(
    l.criada_agora,
    true,
    `${rotulo}: created_at forjado ficou (${l.created_at})`,
  );
  assert.equal(l.status, "pendente", rotulo);
  assert.equal(l.verified, verified, `${rotulo}: selo`);
  return l;
}

/** Idem para quem grava COMO VEIO (admin, servidor, sessao direta). */
function assertComoVeio(r, rotulo) {
  assert.ok(r.linhas, `${rotulo}: devia entrar como veio, recusou: ${r.erro}`);
  const l = r.linhas[0];
  assert.equal(
    l.merchant_reply,
    FORJADO.resposta,
    `${rotulo}: resposta perdida`,
  );
  assert.equal(
    new Date(l.merchant_reply_at).toISOString(),
    new Date(FORJADO.respostaEm).toISOString(),
    `${rotulo}: data da resposta perdida`,
  );
  assert.equal(l.helpful, FORJADO.helpful, `${rotulo}: helpful perdido`);
  assert.equal(
    new Date(l.created_at).toISOString(),
    new Date(FORJADO.criadaEm).toISOString(),
    `${rotulo}: created_at perdido`,
  );
}

/**
 * O COMPORTAMENTO que a migration promete, sobre o que estiver vivo (precisa das fixtures de `semear`).
 * Levanta (assert) se qualquer parte falhar.
 */
async function comportamentoEsperado() {
  // CLIENTE FORJANDO: entra limpa; produto, autora, nota e comentario ficam; nada e' recusado
  const f = await forjar("authenticated", U.autor2);
  const l = assertLimpa(f, "cliente forjando");
  assert.equal(l.product_id, PROD);
  assert.equal(l.user_id, U.autor2);
  assert.equal(l.rating, 5);
  assert.equal(l.comment, FORJADO.comentario);
  const lida = await guardada(l.id);
  assert.equal(
    lida.merchant_reply,
    null,
    "o que o banco guardou tambem esta limpo",
  );
  assert.equal(lida.helpful, 0);

  // O SELO pela compra segue (o gatilho AFTER roda depois deste e nao e' desfeito)
  // (o RETURNING mostra a linha como foi inserida; o selo e' gravado pelo UPDATE do gatilho AFTER, lido depois)
  const comprou = assertLimpa(
    await forjar("authenticated", U.autor1),
    "cliente que comprou",
  );
  assert.equal(
    (await guardada(comprou.id)).verified,
    true,
    "o selo pela compra (gatilho AFTER) tem de seguir funcionando",
  );
  assert.equal((await guardada(l.id)).verified, false, "sem compra, sem selo");

  // A AVALIACAO NORMAL DO APP entra igual: sem resposta, 0 uteis, criada agora, pendente
  const n = assertLimpa(
    await normal("authenticated", U.autor3),
    "avaliacao normal",
  );
  assert.equal(n.rating, 4);
  assert.equal(n.comment, "chegou certinho");

  // VARIAS LINHAS num so INSERT: todas limpas (o gatilho e' por linha)
  const varias = await tentar(
    "authenticated",
    `INSERT INTO public.reviews (product_id, user_id, rating, comment, status, merchant_reply, helpful, created_at)
     SELECT $1::uuid, $2::uuid, 3, 'lote ' || g, 'pendente', 'voz da loja ' || g, 500 + g, '2031-01-01'::timestamptz
       FROM generate_series(1, 3) g RETURNING ${COLUNAS_SAIDA}`,
    [PROD, U.autor2],
    { uid: U.autor2 },
  );
  assert.ok(varias.linhas, `varias linhas: ${varias.erro}`);
  assert.equal(varias.linhas.length, 3);
  for (const x of varias.linhas) {
    assert.equal(x.merchant_reply, null, "lote: resposta ficou");
    assert.equal(x.helpful, 0, "lote: helpful ficou");
    assert.equal(x.criada_agora, true, "lote: data ficou");
  }

  // helpful NULL EXPLICITO (a coluna aceita NULL) tambem vira 0
  const nulo = await tentar(
    "authenticated",
    `INSERT INTO public.reviews (product_id, user_id, rating, comment, status, helpful)
     VALUES ($1::uuid, $2::uuid, 2, 'nulo', 'pendente', NULL) RETURNING helpful`,
    [PROD, U.autor3],
    { uid: U.autor3 },
  );
  assert.equal(nulo.linhas?.[0].helpful, 0, `helpful NULL: ${nulo.erro}`);

  // SECURITY DEFINER de intermediario: o `role` da sessao segue authenticated, entao tambem limpa
  await C.query(
    `CREATE FUNCTION public.t_inserir_via_definer(p_user uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER
       SET search_path = public AS $$
     DECLARE v uuid;
     BEGIN
       INSERT INTO public.reviews (product_id, user_id, rating, comment, status, merchant_reply, helpful)
       VALUES ('${PROD}', p_user, 5, 'via definer', 'pendente', 'voz da loja', 77) RETURNING id INTO v;
       RETURN v;
     END $$`,
  );
  await C.query(
    "GRANT EXECUTE ON FUNCTION public.t_inserir_via_definer(uuid) TO authenticated",
  );
  const d = await tentar(
    "authenticated",
    "SELECT public.t_inserir_via_definer($1::uuid) AS id",
    [U.autor2],
    { uid: U.autor2 },
  );
  assert.ok(d.linhas, `definer: ${d.erro}`);
  const viaDefiner = await guardada(d.linhas[0].id);
  assert.equal(viaDefiner.merchant_reply, null, "definer: a resposta passou");
  assert.equal(viaDefiner.helpful, 0, "definer: helpful passou");

  // QUEM GRAVA COMO VEIO: admin de agora, service_role, postgres e a sessao direta
  assertComoVeio(
    await forjar("authenticated", U.admin, JWT_ADMIN),
    "admin (rls_admin_atual)",
  );
  await C.query("ALTER ROLE service_role BYPASSRLS"); // o Supabase real da BYPASSRLS; o clone nao (desfeito no ROLLBACK)
  assertComoVeio(await forjar("service_role", U.autor2), "service_role");
  assertComoVeio(await forjar("postgres", U.autor2), "postgres");
  assertComoVeio(await forjar(null, U.autor2), "sessao direta (role = none)");

  // "ADMIN" SO NO JWT (rebaixado: o banco nao o tem como admin): limpo
  assertLimpa(
    await forjar("authenticated", U.rebaixado, JWT_ADMIN),
    "admin so no JWT",
  );

  // ANON: continua recusado pela RLS (42501), nada gravado
  const antes = await retratoDosDados();
  const a = await tentar("anon", SQL_FORJADA, PARAMS_FORJADA(U.autor2), {
    uid: U.autor2,
  });
  assert.ok(!a.linhas, "anon nao pode gravar avaliacao");
  assert.equal(a.codigo, "42501", a.erro);
  assert.deepEqual(await retratoDosDados(), antes, "anon: nada gravado");

  // A RESPOSTA DO LOJISTA (UPDATE) segue valendo: reply_review_atomic grava resposta e data
  const alvo = await guardada(l.id);
  assert.equal(alvo.merchant_reply, null);
  const rep = await tentar(
    "authenticated",
    "SELECT public.reply_review_atomic($1::uuid, $2::text)",
    [l.id, "Obrigada pela avaliacao!"],
    { uid: U.admin, claims: JWT_ADMIN },
  );
  assert.ok(rep.linhas, `reply_review_atomic recusada: ${rep.erro}`);
  const respondida = (
    await C.query(
      "SELECT merchant_reply, merchant_reply_at IS NOT NULL AS tem_data, helpful FROM public.reviews WHERE id = $1",
      [l.id],
    )
  ).rows[0];
  assert.equal(respondida.merchant_reply, "Obrigada pela avaliacao!");
  assert.equal(respondida.tem_data, true);
  assert.equal(respondida.helpful, 0);
}

// ---------------------------------------------------------------------------
// ANTES: o controle (o defeito existe)
// ---------------------------------------------------------------------------

prova(
  "ANTES: sem o gatilho a cliente logada grava a avaliacao com a voz da loja, 9999 uteis e data de 2030 (o defeito); a normal do app entra com created_at = agora",
  () =>
    emTransacao(
      async () => {
        await semear();
        const f = await forjar("authenticated", U.autor2);
        assert.ok(
          f.linhas,
          `o defeito: a insercao forjada devia passar. ${f.erro}`,
        );
        const l = f.linhas[0];
        assert.equal(l.merchant_reply, FORJADO.resposta);
        assert.equal(l.helpful, FORJADO.helpful);
        assert.equal(new Date(l.created_at).getUTCFullYear(), 2030);
        assert.notEqual(l.merchant_reply_at, null);
        // o que a normal tinha ANTES (fuso UTC): o mesmo que o gatilho entrega depois
        const n = await normal("authenticated", U.autor3);
        assert.equal(n.linhas[0].criada_agora, true);
        assert.equal(n.linhas[0].helpful, 0);
        assert.equal(n.linhas[0].merchant_reply, null);
        assert.equal(n.linhas[0].status, "pendente");
      },
      { antes: true },
    ),
);

prova(
  "ANTES (mutante 'sem gatilho'): o COMPORTAMENTO ESPERADO reprova no estado sem o gatilho",
  () =>
    emTransacao(
      async () => {
        await semear();
        await assert.rejects(
          () => comportamentoEsperado(),
          /cliente forjando: merchant_reply forjada ficou/,
        );
      },
      { antes: true },
    ),
);

// ---------------------------------------------------------------------------
// DEPOIS
// ---------------------------------------------------------------------------

prova(
  "DEPOIS: forjada entra LIMPA; normal e selo pela compra iguais; varias linhas, helpful NULL e definer limpam; admin, service_role, postgres e sessao direta gravam como vieram; admin so no JWT e' limpo; anon recusado; reply_review_atomic segue",
  () =>
    emTransacao(async () => {
      await semear();
      await comportamentoEsperado();
    }),
);

prova(
  "DADOS: a avaliacao forjada que JA existia antes do apply nao e' tocada (o gatilho so age em INSERT novo); o apply nao escreve em reviews",
  () =>
    emTransacao(
      async () => {
        await semear();
        const f = await forjar("authenticated", U.autor2);
        assert.equal(
          f.linhas[0].helpful,
          FORJADO.helpful,
          "controle: forjada no ANTES",
        );
        const antes = await retratoDosDados();
        assert.equal(antes.n, 1);
        assert.equal(await aplicar(MIGRATION), null);
        assert.deepEqual(await retratoDosDados(), antes, "o apply tocou dado");
        const viva = await guardada(f.linhas[0].id);
        assert.equal(viva.merchant_reply, FORJADO.resposta);
        assert.equal(viva.helpful, FORJADO.helpful);
        // e uma NOVA do mesmo autor, agora, entra limpa (o estado de dados misto e' o esperado)
        assertLimpa(
          await forjar("authenticated", U.autor2),
          "nova depois do apply",
        );
        assert.equal((await retratoDosDados()).n, 2);
      },
      { antes: true },
    ),
);

prova(
  "SO NOVO: o apply cria so a funcao e o gatilho (nenhuma outra funcao, tabela, policy, gatilho irmao ou ACL muda) e a funcao nasce FECHADA a PUBLIC, anon, authenticated e service_role",
  () =>
    emTransacao(
      async () => {
        const antes = await retratoDoSchema();
        assert.equal(await aplicar(MIGRATION), null);
        const depois = await retratoDoSchema();
        assert.deepEqual(
          depois,
          antes,
          "algo alem dos dois objetos novos mudou",
        );
        assert.equal(await funcaoExiste(), true);
        assert.equal(await hashVivo(), H_CORPO);
        assert.equal(await aclFuncao(), "{postgres=X/postgres}");
        const g = await gatilhoDef();
        assert.equal(g.length, 1);
        assert.equal(g[0].tabela, "reviews");
        assert.equal(g[0].tgtype, 7); // ROW + BEFORE + INSERT
        assert.equal(g[0].tgenabled, "O");
        assert.equal(g[0].sem_when, true);
        assert.equal(g[0].tgnargs, 0);
        // um papel de fora nao consegue chamar a funcao de gatilho (fechada), nem como RPC
        for (const papel of ["anon", "authenticated", "service_role"]) {
          const r = await tentar(
            papel,
            `SELECT ${FN.replace("()", "")}()`,
            [],
            {},
          );
          assert.equal(
            r.codigo,
            "42501",
            `${papel} executou a funcao de gatilho: ${r.erro}`,
          );
        }
      },
      { antes: true },
    ),
);

// ---------------------------------------------------------------------------
// MUTANTES: o comportamento esperado DISTINGUE o certo de cada sabotagem
// ---------------------------------------------------------------------------

const criarFuncao = (corpo) =>
  `CREATE OR REPLACE FUNCTION public.avaliacao_nasce_sem_a_resposta_da_loja()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$${corpo}$function$`;
const NL = "\n";
const MUTANTES_DE_CORPO = [
  [
    "sem limpar merchant_reply",
    (c) => c.replace(`        NEW.merchant_reply := NULL;${NL}`, ""),
    /cliente forjando: merchant_reply forjada ficou/,
  ],
  [
    "sem limpar merchant_reply_at",
    (c) => c.replace(`        NEW.merchant_reply_at := NULL;${NL}`, ""),
    /cliente forjando: merchant_reply_at forjada ficou/,
  ],
  [
    "sem zerar helpful",
    (c) => c.replace(`        NEW.helpful := 0;${NL}`, ""),
    /cliente forjando: helpful forjado ficou/,
  ],
  [
    "sem refazer created_at",
    (c) => c.replace(`        NEW.created_at := now();${NL}`, ""),
    /cliente forjando: created_at forjado ficou/,
  ],
  [
    "sem a excecao do administrador (limpa todo mundo)",
    (c) =>
      c.replace(`${NL}       AND NOT public.rls_admin_atual() THEN`, " THEN"),
    /admin \(rls_admin_atual\): resposta perdida/,
  ],
  [
    "sem a excecao da sessao direta (role = none tambem e' limpo)",
    (c) =>
      c.replace(
        `COALESCE(NULLIF(current_setting('role', true), ''), 'none') <> 'none'${NL}       AND `,
        "",
      ),
    /sessao direta \(role = none\): resposta perdida/,
  ],
  [
    "excecao invertida (so limpa o administrador)",
    (c) =>
      c.replace(
        "AND NOT public.rls_admin_atual()",
        "AND public.rls_admin_atual()",
      ),
    /cliente forjando: merchant_reply forjada ficou/,
  ],
  [
    "admin pelo JWT (is_admin) em vez do papel de agora: o rebaixado passa",
    (c) => c.replace("NOT public.rls_admin_atual()", "NOT public.is_admin()"),
    /admin so no JWT: merchant_reply forjada ficou/,
  ],
];
for (const [rotulo, muta, esperada] of MUTANTES_DE_CORPO) {
  prova(
    `MUTANTE (${rotulo}): o comportamento esperado FICA VERMELHO, na linha certa`,
    () =>
      emTransacao(async () => {
        const corpo = muta(CORPO);
        assert.notEqual(
          corpo,
          CORPO,
          "o mutante nao mudou o corpo (o texto-alvo sumiu)",
        );
        await C.query(criarFuncao(corpo));
        assert.notEqual(await hashVivo(), H_CORPO);
        await semear();
        await assert.rejects(() => comportamentoEsperado(), esperada);
      }),
  );
}
prova(
  "MUTANTE (gatilho AFTER INSERT em vez de BEFORE): o comportamento esperado FICA VERMELHO",
  () =>
    emTransacao(async () => {
      await C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`);
      await C.query(
        `CREATE TRIGGER ${GATILHO} AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION ${FN}`,
      );
      await semear();
      await assert.rejects(
        () => comportamentoEsperado(),
        /cliente forjando: merchant_reply forjada ficou/,
      );
    }),
);
prova(
  "MUTANTE (gatilho desligado, DISABLE TRIGGER): o comportamento esperado FICA VERMELHO",
  () =>
    emTransacao(async () => {
      await C.query(`ALTER TABLE public.reviews DISABLE TRIGGER ${GATILHO}`);
      await semear();
      await assert.rejects(
        () => comportamentoEsperado(),
        /cliente forjando: merchant_reply forjada ficou/,
      );
    }),
);

// ---------------------------------------------------------------------------
// MIGRATION: idempotencia, CRLF, rollback, pre-voo, conferencia
// ---------------------------------------------------------------------------

prova(
  "MIGRATION: reaplicar (2x) e em CRLF deixa o MESMO estado (corpo, funcao, ACL, gatilho)",
  () =>
    emTransacao(async () => {
      const oid = await oidVivo();
      const acl = await aclFuncao();
      const gat = await gatilhoDef();
      const schema = await retratoDoSchema();
      assert.equal(await aplicar(MIGRATION), null, "2a vez");
      assert.equal(await aplicar(MIGRATION), null, "3a vez");
      assert.equal(await aplicar(emCRLF(MIGRATION)), null, "CRLF");
      assert.equal(await oidVivo(), oid, "o oid da funcao mudou");
      assert.equal(await aclFuncao(), acl);
      assert.equal(await hashVivo(), H_CORPO);
      assert.deepEqual(await gatilhoDef(), gat, "o gatilho mudou ao reaplicar");
      assert.deepEqual(await retratoDoSchema(), schema);
      // o corpo em CRLF (gravado com \r) continua sendo reconhecido pelo pre-voo e pelo md5
      await C.query(criarFuncao(emCRLF(CORPO)));
      assert.equal(await hashVivo(), H_CORPO, "o md5 desconta o CR");
      assert.equal(
        await aplicar(MIGRATION),
        null,
        "o pre-voo aceita o corpo em CRLF",
      );
    }),
);

prova(
  "MIGRATION: o rollback apaga os DOIS objetos, nao toca dado nem o gatilho irmao, e rodar de novo e' no-op; ida e volta termina igual",
  () =>
    emTransacao(async () => {
      await semear();
      await forjar("authenticated", U.autor2);
      const dados = await retratoDosDados();
      const schema = await retratoDoSchema();
      const antes = {
        oid: await oidVivo(),
        acl: await aclFuncao(),
        gat: await gatilhoDef(),
      };
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(await funcaoExiste(), false);
      assert.equal(await gatilhoExiste(), false);
      assert.deepEqual(await retratoDosDados(), dados, "o rollback tocou dado");
      assert.deepEqual(
        await retratoDoSchema(),
        schema,
        "o rollback tocou outro objeto",
      );
      assert.equal(await aplicar(ROLLBACK), null, "rollback duas vezes");
      assert.equal(await aplicar(emCRLF(ROLLBACK)), null, "rollback em CRLF");
      // com o rollback o defeito volta (e SO ele)
      assert.equal(
        (await forjar("authenticated", U.autor3)).linhas[0].helpful,
        FORJADO.helpful,
      );
      // ida e volta
      assert.equal(await aplicar(MIGRATION), null);
      assert.equal(await hashVivo(), H_CORPO);
      assert.equal(await aclFuncao(), antes.acl);
      assert.deepEqual(
        (await gatilhoDef()).map(({ oid, ...r }) => r),
        antes.gat.map(({ oid, ...r }) => r),
      );
      assertLimpa(
        await forjar("authenticated", U.autor3),
        "depois da ida e volta",
      );
    }),
);

/** O motivo que cada estado sujo tem de ter dado (a recusa por outra razao nao prova o pre-voo certo). */
function motivoEsperado(rotulo) {
  if (rotulo.startsWith("rollback: funcao redefinida"))
    return /não é o da 20261224000000/;
  if (rotulo.includes("gatilho irmao")) return /tr_avaliacao_nasce_verificada/;
  if (rotulo.includes("gatilho")) return /NÃO é o desenhado/;
  if (rotulo.includes("rls_admin_atual"))
    return /rls_admin_atual\(\) não existe/;
  if (rotulo.includes("coluna")) return /não tem merchant_reply/;
  if (rotulo.includes("corpo desconhecido"))
    return /já existe com corpo desconhecido/;
  if (rotulo.includes("outra assinatura")) return /com outra assinatura/;
  if (rotulo.includes("sobrecarga ao lado")) return /tem sobrecarga/;
  throw new Error(`sem motivo declarado para: ${rotulo}`);
}

/** Estado "sujo" -> o pre-voo recusa com B1_BASELINE_DIVERGENT e NAO deixa nada para tras. */
async function recusaSemEscrever(
  rotulo,
  montar,
  arquivo = MIGRATION,
  { antes = true } = {},
) {
  await emTransacao(
    async () => {
      await montar();
      const foto = {
        schema: await retratoDoSchema(),
        funcao: await funcaoExiste(),
        hash: await hashVivo(),
        gat: await gatilhoDef(),
      };
      const r = await aplicar(arquivo);
      assert.ok(r, `${rotulo}: o pre-voo devia recusar`);
      assert.equal(r.codigo, "P0001", `${rotulo}: ${r.erro}`);
      assert.match(r.erro, /^B1_BASELINE_DIVERGENT/, rotulo);
      assert.match(
        r.erro,
        motivoEsperado(rotulo),
        `recusou, mas por OUTRO motivo: ${rotulo}`,
      );
      assert.deepEqual(
        {
          schema: await retratoDoSchema(),
          funcao: await funcaoExiste(),
          hash: await hashVivo(),
          gat: await gatilhoDef(),
        },
        foto,
        `${rotulo}: o pre-voo recusou DEPOIS de escrever`,
      );
    },
    { antes },
  );
}

prova(
  "PRE-VOO: recusa SEM escrever (corpo desconhecido, sobrecarga, gatilho fora do desenho, rls_admin_atual ou coluna ausente, gatilho irmao ausente)",
  async () => {
    await recusaSemEscrever("funcao existe com corpo desconhecido", () =>
      C.query(
        `CREATE FUNCTION ${FN} RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RETURN NEW; END $$`,
      ),
    );
    await recusaSemEscrever("sobrecarga so com outra assinatura", () =>
      C.query(
        "CREATE FUNCTION public.avaliacao_nasce_sem_a_resposta_da_loja(x int) RETURNS int LANGUAGE sql AS 'SELECT 1'",
      ),
    );
    await recusaSemEscrever(
      "sobrecarga ao lado da funcao certa",
      () =>
        C.query(
          "CREATE FUNCTION public.avaliacao_nasce_sem_a_resposta_da_loja(x int) RETURNS int LANGUAGE sql AS 'SELECT 1'",
        ),
      MIGRATION,
      { antes: false },
    );
    await recusaSemEscrever(
      "gatilho de mesmo nome em OUTRA tabela",
      async () => {
        await C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`);
        await C.query(
          `CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION ${FN}`,
        );
      },
      MIGRATION,
      { antes: false },
    );
    for (const [rotulo, def] of [
      ["AFTER INSERT", "AFTER INSERT ON public.reviews FOR EACH ROW"],
      [
        "BEFORE INSERT OR UPDATE",
        "BEFORE INSERT OR UPDATE ON public.reviews FOR EACH ROW",
      ],
      [
        "BEFORE INSERT com WHEN",
        "BEFORE INSERT ON public.reviews FOR EACH ROW WHEN (NEW.helpful > 0)",
      ],
      [
        "BEFORE INSERT por comando (FOR EACH STATEMENT)",
        "BEFORE INSERT ON public.reviews FOR EACH STATEMENT",
      ],
    ])
      await recusaSemEscrever(
        `gatilho no mesmo nome: ${rotulo}`,
        async () => {
          await C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`);
          await C.query(
            `CREATE TRIGGER ${GATILHO} ${def} EXECUTE FUNCTION ${FN}`,
          );
        },
        MIGRATION,
        { antes: false },
      );
    await recusaSemEscrever("rls_admin_atual ausente", () =>
      C.query(
        "ALTER FUNCTION public.rls_admin_atual() RENAME TO rls_admin_atual_x",
      ),
    );
    await recusaSemEscrever("coluna helpful ausente", () =>
      C.query("ALTER TABLE public.reviews RENAME COLUMN helpful TO helpful_x"),
    );
    await recusaSemEscrever(
      "coluna merchant_reply_at com outro tipo",
      async () => {
        await C.query("DROP VIEW IF EXISTS public.vw_reviews_public CASCADE");
        await C.query(
          "ALTER TABLE public.reviews ALTER COLUMN merchant_reply_at TYPE text USING merchant_reply_at::text",
        );
      },
    );
    await recusaSemEscrever("gatilho irmao do selo ausente", () =>
      C.query("DROP TRIGGER tr_avaliacao_nasce_verificada ON public.reviews"),
    );
  },
);

prova(
  "PRE-VOO do ROLLBACK: recusa SEM apagar o que nao e' dele (corpo redefinido, gatilho de outra tabela ou fora do desenho)",
  async () => {
    await recusaSemEscrever(
      "rollback: funcao redefinida por outra pessoa",
      () =>
        C.query(
          `CREATE OR REPLACE FUNCTION ${FN} RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
           SET search_path TO 'public' AS $$ BEGIN RETURN NEW; END $$`,
        ),
      ROLLBACK,
      { antes: false },
    );
    await recusaSemEscrever(
      "rollback: gatilho de mesmo nome em outra tabela",
      async () => {
        await C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`);
        await C.query(
          `CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION ${FN}`,
        );
      },
      ROLLBACK,
      { antes: false },
    );
    await recusaSemEscrever(
      "rollback: gatilho com WHEN",
      async () => {
        await C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`);
        await C.query(
          `CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.reviews FOR EACH ROW WHEN (NEW.helpful > 0) EXECUTE FUNCTION ${FN}`,
        );
      },
      ROLLBACK,
      { antes: false },
    );
  },
);

prova(
  "CONFERENCIA final: passa no estado certo e RECUSA corpo trocado, atributo mudado, ACL aberta (PUBLIC, anon, authenticated, service_role), gatilho ausente, desligado, em outra tabela ou duplicado",
  () =>
    emTransacao(async () => {
      assert.equal(
        await aplicar(BLOCO_CONFERENCIA),
        null,
        "a conferencia reprovou o estado certo",
      );
      const sujos = [
        [
          "corpo trocado",
          () =>
            C.query(
              criarFuncao(
                CORPO.replace("NEW.helpful := 0;", "NEW.helpful := 1;"),
              ),
            ),
        ],
        [
          "atributo: STABLE",
          () =>
            C.query(
              `CREATE OR REPLACE FUNCTION ${FN} RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER STABLE
               SET search_path TO 'public' AS $function$${CORPO}$function$`,
            ),
        ],
        [
          "atributo: SECURITY INVOKER",
          () =>
            C.query(
              `CREATE OR REPLACE FUNCTION ${FN} RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER
               SET search_path TO 'public' AS $function$${CORPO}$function$`,
            ),
        ],
        [
          "PUBLIC executa",
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO PUBLIC`),
        ],
        [
          "anon executa",
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO anon`),
        ],
        [
          "authenticated executa",
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO authenticated`),
        ],
        [
          "service_role executa",
          () => C.query(`GRANT EXECUTE ON FUNCTION ${FN} TO service_role`),
        ],
        [
          "gatilho ausente",
          () => C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`),
        ],
        [
          "gatilho desligado",
          () =>
            C.query(`ALTER TABLE public.reviews DISABLE TRIGGER ${GATILHO}`),
        ],
        [
          "gatilho AFTER",
          async () => {
            await C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`);
            await C.query(
              `CREATE TRIGGER ${GATILHO} AFTER INSERT ON public.reviews FOR EACH ROW EXECUTE FUNCTION ${FN}`,
            );
          },
        ],
        [
          "gatilho em outra tabela",
          async () => {
            await C.query(`DROP TRIGGER ${GATILHO} ON public.reviews`);
            await C.query(
              `CREATE TRIGGER ${GATILHO} BEFORE INSERT ON public.questions FOR EACH ROW EXECUTE FUNCTION ${FN}`,
            );
          },
        ],
      ];
      for (const [rotulo, sujar] of sujos) {
        await C.query("SAVEPOINT sujo");
        try {
          await sujar();
          const r = await aplicar(BLOCO_CONFERENCIA);
          assert.ok(r, `conferencia aceitou: ${rotulo}`);
          assert.equal(r.codigo, "P0001", `${rotulo}: ${r.erro}`);
          assert.match(r.erro, /^conferencia 20261224/, rotulo);
        } finally {
          await C.query("ROLLBACK TO SAVEPOINT sujo");
        }
      }
      // e a conferencia do rollback: recusa se um dos objetos sobrou
      const conf = ROLLBACK.match(
        /DO \$conferencia_rollback_20261224\$[\s\S]*?END \$conferencia_rollback_20261224\$;/,
      )[0];
      const sobrou = await aplicar(conf);
      assert.ok(
        sobrou && /ainda existe/.test(sobrou.erro),
        "a conferencia do rollback aceitou objeto que sobrou",
      );
      assert.equal(await aplicar(ROLLBACK), null);
      assert.equal(
        await aplicar(conf),
        null,
        "a conferencia do rollback reprovou o estado certo",
      );
    }),
);

// ---------------------------------------------------------------------------
// A CONSULTA DE LEITURA 27m: conta o que ja foi forjado (a migration nao limpa o que ja existia)
// ---------------------------------------------------------------------------

/** Roda a 27m e devolve as linhas por "tipo|objeto", com o detalhe (chave=valor) aberto em objeto. */
async function rodar27m() {
  // o efemero nao tem o registro de migrations da Supabase: cria o minimo DENTRO da transacao do caso (desfeito no ROLLBACK)
  await C.query("CREATE SCHEMA IF NOT EXISTS supabase_migrations");
  await C.query(
    "CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY)",
  );
  const r = await C.query(SQL_27M);
  const por = {};
  for (const l of r.rows) {
    const chave = `${l.tipo}|${l.objeto}`;
    por[chave] = Object.fromEntries(
      l.detalhe.split("|").map((kv) => {
        const i = kv.indexOf("=");
        return i < 0 ? [kv, ""] : [kv.slice(0, i), kv.slice(i + 1)];
      }),
    );
    por[chave]._bruto = l.detalhe;
  }
  return { linhas: r.rows, por };
}
/** total/publicadas/pendentes de um sinal da 27m. */
const sinal = (por, nome) => {
  const x = por[`sinal|${nome}`];
  assert.ok(x, `falta o sinal ${nome}`);
  return [x.total, x.publicadas, x.pendentes].join("/");
};

/** Grava a avaliacao de `uid` em `produto` como authenticated: a FORJADA (as 4 colunas do defeito) ou a normal do app. */
async function gravarEm(produto, uid, forjada) {
  return forjada
    ? tentar(
        "authenticated",
        SQL_FORJADA,
        [
          produto,
          uid,
          FORJADO.comentario,
          FORJADO.resposta,
          FORJADO.respostaEm,
          FORJADO.helpful,
          FORJADO.criadaEm,
        ],
        { uid },
      )
    : tentar("authenticated", SQL_NORMAL, [produto, uid], { uid });
}

prova(
  "CONSULTA 27m: conta, por sinal, so entre as publicadas e so entre as pendentes, as avaliacoes forjadas que ja existiam (resposta sem log, data no futuro, helpful alto), nao conta a resposta legitima do lojista, nao escreve nada e mostra o gatilho AUSENTE antes e presente depois do apply",
  () =>
    emTransacao(
      async () => {
        assert.ok(
          SQL_27M.includes(H_CORPO),
          "a 27m cita o md5 do corpo da migration",
        );
        await semear();
        const PROD2 = "7e7e2240-0000-4000-8000-0000000000f2";
        await C.query(
          "INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo) VALUES ($1, 'Camiseta Verde 24', 100, 10, true, 40)",
          [PROD2],
        );
        // legitima: a autora 3 avalia o PROD, a loja responde pela RPC (que grava o log) e a avaliacao e publicada
        const legit = (await gravarEm(PROD, U.autor3, false)).linhas[0];
        await C.query(
          "UPDATE public.reviews SET status = 'publicada' WHERE id = $1",
          [legit.id],
        );
        const resposta = await tentar(
          "authenticated",
          "SELECT public.reply_review_atomic($1::uuid, $2::text)",
          [legit.id, "Obrigada!"],
          { uid: U.admin, claims: JWT_ADMIN },
        );
        assert.ok(
          resposta.linhas,
          `a resposta legitima nao gravou: ${resposta.erro}`,
        );
        // forjada 1: no PROD2 (sem nenhuma resposta de verdade), publicada pela loja, com as quatro colunas forjadas
        const f1 = (await gravarEm(PROD2, U.autor2, true)).linhas[0];
        assert.equal(
          f1.helpful,
          FORJADO.helpful,
          "controle: a forjada 1 nasceu forjada (estado ANTES)",
        );
        await C.query(
          "UPDATE public.reviews SET status = 'publicada' WHERE id = $1",
          [f1.id],
        );
        // forjada 2: pendente, so com o helpful alto (sem resposta)
        await C.query(
          "INSERT INTO public.reviews (product_id, user_id, rating, comment, status, helpful) VALUES ($1, $2, 3, 'x', 'pendente', 150)",
          [PROD, U.autor1],
        );
        // e uma normal, pendente
        await C.query(
          "INSERT INTO public.reviews (product_id, user_id, rating, comment, status) VALUES ($1, $2, 4, 'y', 'pendente')",
          [PROD2, U.autor1],
        );
        const dados = await retratoDosDados();
        const { por } = await rodar27m();
        assert.deepEqual(await retratoDosDados(), dados, "a consulta escreveu");
        assert.equal(por["contagem|avaliacoes"].total, "4");
        assert.equal(por["contagem|avaliacoes"].publicadas, "2");
        assert.equal(por["contagem|avaliacoes"].pendentes, "2");
        assert.equal(por["contagem|maior helpful"].max, "9999");
        // formato do que sai: total/publicadas/pendentes
        assert.equal(sinal(por, "resposta preenchida"), "2/2/0");
        assert.equal(sinal(por, "resposta sem data da resposta"), "0/0/0");
        assert.equal(sinal(por, "data da resposta no futuro"), "1/1/0");
        assert.equal(
          sinal(por, "resposta sem nenhum log do produto"),
          "1/1/0",
          "a resposta legitima tem log; a forjada nao",
        );
        assert.equal(
          sinal(por, "resposta sem log na data (+-10 min)"),
          "1/1/0",
        );
        assert.equal(sinal(por, "helpful maior que 0"), "2/1/1");
        assert.equal(sinal(por, "helpful >= 100"), "2/1/1");
        assert.equal(
          sinal(por, "helpful maior que 0 em avaliacao pendente"),
          "1/0/1",
        );
        assert.equal(sinal(por, "criada no futuro"), "1/1/0");
        assert.equal(sinal(por, "criada mais de 1 dia no futuro"), "1/1/0");
        assert.equal(sinal(por, "SUSPEITA FORTE"), "2/1/1");
        // ANTES do apply: o gatilho e a funcao AUSENTES
        assert.equal(
          por["gatilho|tr_avaliacao_nasce_sem_a_resposta_da_loja"]._bruto,
          "AUSENTE",
        );
        assert.equal(
          por["gatilho|public.avaliacao_nasce_sem_a_resposta_da_loja()"]._bruto,
          "AUSENTE",
        );
        assert.equal(por["migration|20261224000000"]._bruto, "ausente");
        await C.query(
          "INSERT INTO supabase_migrations.schema_migrations (version) VALUES ('20261224000000')",
        );
        assert.equal(
          (await rodar27m()).por["migration|20261224000000"]._bruto,
          "presente",
        );
        // DEPOIS do apply: presente, ligado, BEFORE INSERT por linha, corpo da migration; o dado forjado segue contado
        assert.equal(await aplicar(MIGRATION), null);
        const depois = (await rodar27m()).por;
        assert.equal(
          depois["gatilho|tr_avaliacao_nasce_sem_a_resposta_da_loja"]._bruto,
          "ligado=O|tabela=reviews|tipo=7",
        );
        assert.equal(
          depois["gatilho|public.avaliacao_nasce_sem_a_resposta_da_loja()"]
            ._bruto,
          "corpo_e_o_da_migration=sim",
        );
        assert.equal(
          sinal(depois, "SUSPEITA FORTE"),
          "2/1/1",
          "o apply nao limpa o que ja existia",
        );
        // e a forja de DEPOIS do apply ja nasce limpa (nao entra na contagem)
        const f3 = await gravarEm(PROD2, U.autor3, true);
        assert.equal(f3.linhas[0].merchant_reply, null);
        assert.equal(sinal((await rodar27m()).por, "SUSPEITA FORTE"), "2/1/1");
      },
      { antes: true },
    ),
);

prova(
  "CONSULTA 27m (limite declarado): a forjada num produto que JA teve resposta de verdade nao aparece nos sinais de log, mas a data no futuro a pega; banco vazio devolve zeros (nunca erro)",
  () =>
    emTransacao(
      async () => {
        const vazio = (await rodar27m()).por;
        assert.equal(
          vazio["contagem|avaliacoes"]._bruto,
          "total=0|publicadas=0|pendentes=0",
        );
        assert.equal(sinal(vazio, "SUSPEITA FORTE"), "0/0/0");
        assert.equal(vazio["contagem|maior helpful"].max, "0");
        await semear();
        const legit = (await gravarEm(PROD, U.autor3, false)).linhas[0];
        await tentar(
          "authenticated",
          "SELECT public.reply_review_atomic($1::uuid, $2::text)",
          [legit.id, "Obrigada!"],
          { uid: U.admin, claims: JWT_ADMIN },
        );
        const f = (await gravarEm(PROD, U.autor2, true)).linhas[0]; // MESMO produto da resposta legitima
        assert.equal(
          f.merchant_reply,
          FORJADO.resposta,
          "controle: nasceu forjada (estado ANTES)",
        );
        const { por } = await rodar27m();
        assert.equal(
          sinal(por, "resposta sem nenhum log do produto"),
          "0/0/0",
          "o limite: o log e por produto",
        );
        assert.equal(
          sinal(por, "resposta sem log na data (+-10 min)"),
          "1/0/1",
          "o log na data pega o que o log do produto nao pega",
        );
        assert.equal(sinal(por, "data da resposta no futuro"), "1/0/1");
        assert.equal(sinal(por, "SUSPEITA FORTE"), "1/0/1");
      },
      { antes: true },
    ),
);

// ---------------------------------------------------------------------------
// CONCORRENCIA (COMMITADA, por isso a ULTIMA prova; o clone e' descartavel)
// ---------------------------------------------------------------------------

prova(
  "CONCORRENCIA: uma gravacao em voo segura o CREATE TRIGGER e nao e' limpa (nasceu antes); a que chega DURANTE a espera fica na fila e sai limpa; nada trava para sempre",
  async () => {
    const url = lerDatabaseUrlEfemera();
    const abrir = async () => {
      const c = new Client({ connectionString: url });
      await c.connect();
      return c;
    };
    const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
    const emVoo = async (c, uid, id) => {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [uid]);
      await c.query("SET LOCAL ROLE authenticated");
      await c.query(
        `INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status, merchant_reply, helpful)
         VALUES ($1, $2, $3, 5, 'em voo', 'pendente', 'voz da loja', 4242)`,
        [id, PROD, uid],
      );
    };
    const IDS = {
      voo: "7e7e2240-0000-4000-8000-0000000000c1",
      fila: "7e7e2240-0000-4000-8000-0000000000c2",
      depois: "7e7e2240-0000-4000-8000-0000000000c3",
    };
    const c2 = await abrir();
    const c3 = await abrir();
    const c4 = await abrir();
    try {
      await C.query(ROLLBACK); // estado ANTES, commitado
      await semear(); // fixtures commitadas
      await emVoo(c2, U.autor2, IDS.voo); // gravacao em voo, ainda sem commit
      // o apply (pelo aplicador: uma transacao) entra e ESPERA a gravacao em voo
      const apply = c3.query(`BEGIN;\n${MIGRATION}\nCOMMIT;`).then(
        () => "ok",
        (e) => `erro: ${e.message}`,
      );
      let esperando = false;
      for (let i = 0; i < 100 && !esperando; i++) {
        esperando =
          (
            await C.query(
              `SELECT count(*)::int AS n FROM pg_locks WHERE NOT granted AND relation = 'public.reviews'::regclass`,
            )
          ).rows[0].n >= 1;
        if (!esperando) await dorme(50);
      }
      assert.ok(
        esperando,
        "o CREATE TRIGGER devia estar esperando a gravacao em voo",
      );
      assert.equal(
        await gatilhoExiste(),
        false,
        "o gatilho nao pode existir antes do commit do apply",
      );
      // uma gravacao que chega DURANTE a espera entra na fila atras do apply
      await c4.query("BEGIN");
      await c4.query("SELECT set_config('app.rpc.user_id', $1, true)", [
        U.autor3,
      ]);
      await c4.query("SET LOCAL ROLE authenticated");
      const fila = c4
        .query(
          `INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status, merchant_reply, helpful)
           VALUES ($1, $2, $3, 5, 'na fila', 'pendente', 'voz da loja', 4243)`,
          [IDS.fila, PROD, U.autor3],
        )
        .then(
          () => "ok",
          (e) => `erro: ${e.message}`,
        );
      await dorme(300);
      assert.equal(
        await Promise.race([apply, dorme(200).then(() => "pendente")]),
        "pendente",
        "o apply nao devia terminar enquanto a gravacao em voo segura a tabela",
      );
      await c2.query("COMMIT"); // a em voo termina
      assert.equal(
        await apply,
        "ok",
        "o apply devia terminar depois do commit da gravacao em voo",
      );
      assert.equal(await fila, "ok", "a gravacao da fila devia entrar");
      await c4.query("COMMIT");
      assert.equal(await gatilhoExiste(), true);
      assert.equal(await hashVivo(), H_CORPO);
      const voo = await guardada(IDS.voo);
      assert.equal(
        voo.merchant_reply,
        "voz da loja",
        "a gravacao em voo nasceu ANTES do gatilho: nao e' limpa (limite declarado)",
      );
      assert.equal(voo.helpful, 4242);
      const naFila = await guardada(IDS.fila);
      assert.equal(
        naFila.merchant_reply,
        null,
        "a gravacao que esperou atras do apply tem de sair LIMPA",
      );
      assert.equal(naFila.helpful, 0);
      // e uma nova, agora, tambem
      await c2.query("BEGIN");
      await c2.query("SELECT set_config('app.rpc.user_id', $1, true)", [
        U.autor2,
      ]);
      await c2.query("SET LOCAL ROLE authenticated");
      await c2.query(
        `INSERT INTO public.reviews (id, product_id, user_id, rating, comment, status, merchant_reply, helpful)
         VALUES ($1, $2, $3, 5, 'depois', 'pendente', 'voz da loja', 4244)`,
        [IDS.depois, PROD, U.autor2],
      );
      await c2.query("COMMIT");
      assert.equal((await guardada(IDS.depois)).merchant_reply, null);
    } finally {
      for (const c of [c2, c4]) await c.query("ROLLBACK").catch(() => {});
      await c2.end().catch(() => {});
      await c3.end().catch(() => {});
      await c4.end().catch(() => {});
      // limpeza (o clone e' descartavel, mas a prova devolve a arvore ao estado em que a encontrou: migration aplicada)
      await C.query("DELETE FROM public.reviews WHERE product_id = $1", [
        PROD,
      ]).catch(() => {});
      await C.query(
        "DELETE FROM public.marketplace_order_items WHERE order_id = $1",
        [PEDIDO],
      ).catch(() => {});
      await C.query("DELETE FROM public.marketplace_orders WHERE id = $1", [
        PEDIDO,
      ]).catch(() => {});
      await C.query("DELETE FROM public.produtos WHERE id = $1", [PROD]).catch(
        () => {},
      );
      await C.query("DELETE FROM public.profiles WHERE id = ANY($1::uuid[])", [
        Object.values(U),
      ]).catch(() => {});
      await C.query("DELETE FROM auth.users WHERE id = ANY($1::uuid[])", [
        Object.values(U),
      ]).catch(() => {});
      await C.query(MIGRATION).catch(() => {});
    }
  },
);

// ---------------------------------------------------------------------------

async function main() {
  const url = lerDatabaseUrlEfemera();
  C = new Client({ connectionString: url });
  await C.connect();
  let falhas = 0;
  try {
    // A arvore tem de estar migrada ate a 20261223 e o arquivo desta migration tem de ser aplicavel.
    assert.ok(
      (
        await C.query(
          "SELECT to_regprocedure('public.rls_admin_atual()') IS NOT NULL AS x",
        )
      ).rows[0].x,
      "a arvore nao tem rls_admin_atual (20261197)",
    );
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo();
        console.log(`ok   ${nome}`);
      } catch (e) {
        falhas += 1;
        console.log(
          `FALHOU ${nome}\n     ${String(e.stack || e)
            .split("\n")
            .slice(0, 6)
            .join("\n     ")}`,
        );
        await C.query("ROLLBACK").catch(() => {});
      }
    }
  } finally {
    await C.end().catch(() => {});
  }
  console.log(`\n${PROVAS.length - falhas}/${PROVAS.length} provas passaram.`);
  if (falhas) falhar("REPROVADO", `${falhas} prova(s) falharam`);
}

main().catch((e) => falhar("INDETERMINADO", e.stack || e.message));
