"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (QUEM, CASOS,
 * HASH_VIGENTE, HASH_DESTA, fx) ou do catálogo do Postgres efêmero; nunca de
 * entrada de rede nem de payload de terceiro. */

/**
 * PROVA VIVA da migration 20261199000000_portas_do_painel_exigem_admin_atual.sql
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * O DEFEITO (revisão Opus da 20261197000000, 04/10/2026):
 *   R1 AUTOPROMOÇÃO — `tr_sync_profile_role_to_auth` (AFTER INSERT OR UPDATE
 *      OF role ON profiles) dispara mesmo regravando o MESMO valor; cada um
 *      pode dar UPDATE no próprio profiles.role (política + grant). Quem foi
 *      rebaixado SÓ no app_metadata (profiles ainda 'admin') regravava
 *      `role = 'admin'` igual -> ensure_role_protection/prevent_role_change
 *      não barram (OLD = NEW) -> o gatilho copiava 'admin' para auth.users ->
 *      is_admin_atual() voltava a ser true. E as duas funções de proteção
 *      decidiam pelo JWT (prevent_role_change: is_admin()) ou por UMA fonte
 *      (ensure_role_protection: só profiles): o rebaixado só no app_metadata,
 *      com JWT velho, promovia um cúmplice.
 *   R2/R3 — RPCs SECURITY DEFINER do painel guardadas só por is_admin() (que
 *      confia no JWT ~1 h): o ex-admin lia pedidos, clientes, CRM, devoluções
 *      e o livro financeiro, e mexia em caixa, lançamentos, estoque e
 *      configuração da loja.
 *
 * O QUE SE PROVA:
 *   (1) R1: a autopromoção falha (auth.users continua customer,
 *       rls_admin_atual() continua false) — com JWT novo e velho, e
 *       alternando o valor; o ex-admin não promove cúmplice; o admin de
 *       verdade AINDA muda o papel de outro pelo caminho do painel (UPDATE em
 *       profiles como authenticated) e o gatilho sincroniza; service_role e
 *       postgres mudam papel como antes; o INSERT continua sincronizando.
 *       CONTROLE: com os corpos antigos (tirados do rollback-manual, dentro
 *       de transação desfeita) a autopromoção e a promoção do cúmplice
 *       PASSAM — é a correção, e não outra coisa, que barra.
 *   (2) Para CADA RPC guardada: admin atual passa (e, onde há dado de
 *       cliente, VÊ o marcador da fixture); rebaixado-só-profiles e
 *       rebaixado-só-app_metadata (JWT ainda dizendo admin) recebem a MESMA
 *       recusa de quem não é admin; cliente recusa; anon não passa;
 *       service_role e postgres passam como antes (as duas que já exigiam
 *       login seguem recusando). CONTROLE: o corpo vivo SEM a guarda deixa o
 *       rebaixado passar (e ver o marcador) — é a guarda que recusa. Nas três
 *       RPCs "dono OU admin", o dono continua vendo o que é dele.
 *   (3) rollback-manual: os 42 corpos voltam ao md5 de antes; a impressão
 *       digital inteira (md5 de prosrc, proacl, prosecdef, proconfig, dono,
 *       assinatura das funções de public/auth; definição/tgenabled/tgtype dos
 *       gatilhos; políticas; ACL de tabela e de coluna) fica igual à de antes
 *       da migration — só os 42 hashes mudam, e para os vigentes; segundo
 *       rollback recusa sem escrever; reaplicar a migration volta ao estado
 *       dela, e reaplicar por cima de si mesma não muda nada; preflight
 *       recusa corpo vivo divergente e gatilho divergente sem escrever.
 *
 * Toda chamada de RPC roda numa transação DESFEITA no fim: a recusa é a
 * exceção (que já desfaz o que veio antes dela); a prova de "antes de
 * qualquer escrita" é de texto (tests/migration_portas_do_painel_exigem_admin_atual_test.ts).
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/admin-atual-portas-viva.cjs
 */

const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const NOME_MIGRATION = "20261199000000_portas_do_painel_exigem_admin_atual.sql";
const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
const MIGRATION = fs.readFileSync(
  path.join(DIR_MIGRATIONS, NOME_MIGRATION),
  "utf8",
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
const ROLLBACK = fs.readFileSync(
  path.join(DIR_MIGRATIONS, `rollback-manual-${NOME_MIGRATION}`),
  "utf8",
);

// Os hashes (md5 de prosrc sem \r) de antes e de depois, lidos do PREFLIGHT
// da própria migration — a prova de texto amarra cada um ao md5 real do
// corpo; aqui se prova que o banco nascido das migrations bate com eles.
const HASH_VIGENTE = {};
const HASH_DESTA = {};
for (const m of MIGRATION.matchAll(
  /\('(public\.[a-z_0-9]+\([^)]*\))', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/g,
)) {
  HASH_VIGENTE[m[1]] = m[2];
  HASH_DESTA[m[1]] = m[3];
}
const ASSINATURAS = Object.keys(HASH_VIGENTE);

const U_ADMIN = "a9900000-0000-4000-8000-000000000001";
const U_REB_PERFIL = "a9900000-0000-4000-8000-000000000002";
const U_REB_AUTH = "a9900000-0000-4000-8000-000000000003";
const U_CLIENTE = "a9900000-0000-4000-8000-000000000004";
const U_DONO = "a9900000-0000-4000-8000-000000000005";
const U_ALVO = "a9900000-0000-4000-8000-000000000006";
const U_NOVO = "a9900000-0000-4000-8000-000000000007";
const P_ESTOQUE = "a99aaaaa-0000-4000-8000-000000000001";
const O_ENTREGUE = "a99ccccc-0000-4000-8000-000000000001";
const O_CANCELADO = "a99ccccc-0000-4000-8000-000000000002";
const D_DEV = "a99ddddd-0000-4000-8000-000000000001";
const BANCO = "f1000000-0000-4000-8000-000000000002";
const CAT_ALUGUEL = "f2000000-0000-4000-8000-000000000020";

const MARCA_PEDIDO = "Cliente Marcador Portas";
const MARCA_PERFIL = "Dono Marcador Portas";
const MARCA_ITEM = "Item Marcador Portas";
const MARCA_PUSH = "https://push.teste/marcador-portas";
const MARCA_PROTOCOLO = "DEV-PORTAS-1";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

// papel do Postgres (o SET ROLE do PostgREST), login (auth.uid() desta suíte
// lê app.rpc.user_id) e o JWT.
const QUEM = {
  anon: { papel: "anon", uid: "", jwt: "" },
  cliente: {
    papel: "authenticated",
    uid: U_CLIENTE,
    jwt: claims(U_CLIENTE, null),
  },
  dono: { papel: "authenticated", uid: U_DONO, jwt: claims(U_DONO, null) },
  admin: {
    papel: "authenticated",
    uid: U_ADMIN,
    jwt: claims(U_ADMIN, "admin"),
  },
  // Rebaixado só no profiles (auth.users ainda admin), JWT velho dizendo admin.
  rebaixadoPerfil: {
    papel: "authenticated",
    uid: U_REB_PERFIL,
    jwt: claims(U_REB_PERFIL, "admin"),
  },
  // Rebaixado só no app_metadata (painel do Supabase; profiles ainda admin).
  rebaixadoAuth: {
    papel: "authenticated",
    uid: U_REB_AUTH,
    jwt: claims(U_REB_AUTH, "admin"),
  },
  // O mesmo, já com o JWT NOVO (diz customer).
  rebaixadoAuthJwtNovo: {
    papel: "authenticated",
    uid: U_REB_AUTH,
    jwt: claims(U_REB_AUTH, "customer"),
  },
  // O JWT da chave de serviço diz role = service_role (auth.role() lê isso).
  service: {
    papel: "service_role",
    uid: "",
    jwt: JSON.stringify({ role: "service_role" }),
  },
  postgres: { papel: "postgres", uid: "", jwt: "" },
};

async function entrar(c, quem) {
  const q = QUEM[quem];
  await c.query(`SET LOCAL ROLE ${q.papel}`);
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [q.uid, q.jwt],
  );
}

// Roda `sql` como `quem` numa transação SEMPRE desfeita. `preparo`: passos
// rodados antes, como outro papel (ex.: abrir o caixa como admin).
async function comoQuem(c, quem, sql, params = [], { preparo = null } = {}) {
  await c.query("BEGIN");
  try {
    if (preparo) {
      await entrar(c, preparo.quem);
      for (const s of preparo.sql) await c.query(s);
      await c.query("RESET ROLE");
    }
    await entrar(c, quem);
    const r = await c.query(sql, params);
    return { ok: true, linhas: r.rows, n: r.rowCount };
  } catch (erro) {
    return { ok: false, code: erro.code, message: erro.message };
  } finally {
    await c.query("ROLLBACK");
  }
}

// O CREATE OR REPLACE de uma função como está num dos arquivos.
function defNoArquivo(sql, nome) {
  const marcador = `\nCREATE OR REPLACE FUNCTION public.${nome}(`;
  const i = sql.indexOf(marcador);
  assert.ok(i >= 0, `${nome} não está no arquivo`);
  const resto = sql.slice(i + 1);
  return resto.slice(0, resto.indexOf("\n$$;") + "\n$$;".length);
}

// A guarda desta migration, como aparece no corpo vivo.
const RE_GUARDA =
  /\n[ \t]*-- Papel ATUAL[^\n]*\(20261199000000\)\.\n[ \t]*IF [^\n]*public\.is_admin_atual\(\)[\s\S]*?\n[ \t]*END IF;\n/g;

function semGuarda(def) {
  const achados = def.match(RE_GUARDA) || [];
  assert.equal(
    achados.length,
    1,
    "a guarda tem de aparecer UMA vez no corpo vivo",
  );
  return def.replace(RE_GUARDA, "\n");
}

async function catalogo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS hash, pg_get_functiondef(oid) AS def
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] || null;
}

// Impressão digital: funções (public, auth), gatilhos, políticas e ACL de
// tabela/coluna — deparseadas com search_path = pg_catalog.
async function digital(c) {
  await c.query("SET search_path = pg_catalog");
  try {
    const r = await c.query(`
      SELECT 'fn ' || p.oid::regprocedure::text AS k,
             concat_ws(' | ', md5(replace(p.prosrc, chr(13), '')), coalesce(p.proacl::text, ''),
                       p.prosecdef::text, coalesce(array_to_string(p.proconfig, ','), ''),
                       p.provolatile::text, p.proowner::regrole::text,
                       pg_get_function_arguments(p.oid), pg_get_function_result(p.oid)) AS v
        FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname IN ('public', 'auth')
      UNION ALL
      SELECT 'tg ' || c.oid::regclass::text || '.' || t.tgname,
             concat_ws(' | ', pg_get_triggerdef(t.oid), t.tgenabled::text, t.tgtype::text)
        FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE NOT t.tgisinternal AND n.nspname IN ('public', 'auth')
      UNION ALL
      SELECT 'pol ' || pol.polrelid::regclass::text || '.' || pol.polname,
             concat_ws(' | ', coalesce(pg_get_expr(pol.polqual, pol.polrelid), '-'),
                       coalesce(pg_get_expr(pol.polwithcheck, pol.polrelid), '-'),
                       pol.polroles::regrole[]::text, pol.polcmd::text, pol.polpermissive::text)
        FROM pg_policy pol
      UNION ALL
      SELECT 'acl ' || c.oid::regclass::text, coalesce(c.relacl::text, '')
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'm', 'p')
      UNION ALL
      SELECT 'col ' || a.attrelid::regclass::text || '.' || a.attname, a.attacl::text
        FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND a.attacl IS NOT NULL`);
    return Object.fromEntries(r.rows.map((l) => [l.k, l.v]));
  } finally {
    await c.query("RESET search_path");
  }
}

const fnChave = (assinatura) => `fn ${assinatura}`;

const PROVAS = [];
const fx = {};

PROVAS.push({
  nome: "(0) fixtures: admin atual, rebaixados nas duas direções, cliente, dono de pedido/devolução, alvo de promoção; auth.role() como o do Supabase",
  corpo: async (c) => {
    // Fábrica do Supabase que o provisionar.cjs não emula — só neste CLONE
    // (rodar-isolado.cjs): USAGE em auth/extensions e o auth.role() real
    // (lê o 'role' do JWT). Sem o auth.role() real, o stub devolve NULL e
    // ensure_role_protection nunca age aqui — a prova não mediria a guarda
    // que esta migration põe nela.
    await c.query(
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
    );
    await c.query(
      "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
    );
    await c.query(`CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT coalesce(
        nullif(current_setting('request.jwt.claim.role', true), ''),
        (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
      )::text $$`);
    for (const id of [
      U_ADMIN,
      U_REB_PERFIL,
      U_REB_AUTH,
      U_CLIENTE,
      U_DONO,
      U_ALVO,
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@portas.teste', '{}'::jsonb)`,
        [id],
      );
    }
    // O INSERT em profiles leva o papel a auth.users (gatilho de sincronia).
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role, whatsapp) VALUES
         ($1, 'Admin Atual', 'admin', NULL), ($2, 'Rebaixado Perfil', 'customer', NULL),
         ($3, 'Rebaixado Auth', 'admin', NULL), ($4, 'Cliente', 'customer', NULL),
         ($5, $7, 'customer', '5599999990000'), ($6, 'Alvo', 'customer', NULL)`,
      [
        U_ADMIN,
        U_REB_PERFIL,
        U_REB_AUTH,
        U_CLIENTE,
        U_DONO,
        U_ALVO,
        MARCA_PERFIL,
      ],
    );
    // As contradições, direto em auth.users (como o painel do Supabase faz).
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb WHERE id = $1`,
      [U_REB_PERFIL],
    );
    await c.query(
      `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"customer"}'::jsonb WHERE id = $1`,
      [U_REB_AUTH],
    );
    const r = await c.query(
      `SELECT u.id::text, u.raw_app_meta_data ->> 'role' AS auth_role, p.role AS perfil_role
         FROM auth.users u JOIN public.profiles p ON p.id = u.id
        WHERE u.id::text LIKE 'a9900000-%' ORDER BY u.id`,
    );
    assert.deepEqual(
      r.rows.map((l) => [l.id, l.auth_role, l.perfil_role]),
      [
        [U_ADMIN, "admin", "admin"],
        [U_REB_PERFIL, "admin", "customer"],
        [U_REB_AUTH, "customer", "admin"],
        [U_CLIENTE, "customer", "customer"],
        [U_DONO, "customer", "customer"],
        [U_ALVO, "customer", "customer"],
      ],
    );

    await c.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
       VALUES ($1, 'Produto Portas', 100, 1000, true, 40)`,
      [P_ESTOQUE],
    );
    const dados = JSON.stringify({
      whatsapp: "5599999990000",
      email: "dono@portas.teste",
    });
    await c.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
          payment_method, payment_status, paid_at, cancelled_after_shipping)
       VALUES ($1, $3, $4, $5::jsonb, 100, 100, 'delivered', 'online', 'pix', 'pago', now(), false),
              ($2, $3, $4, $5::jsonb, 100, 100, 'cancelled', 'online', 'pix', 'pago', now(), true)`,
      [O_ENTREGUE, O_CANCELADO, U_DONO, MARCA_PEDIDO, dados],
    );
    const itens = [];
    for (const o of [O_ENTREGUE, O_CANCELADO]) {
      const i = await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, $3, 1, 100) RETURNING id`,
        [o, P_ESTOQUE, MARCA_ITEM],
      );
      itens.push(i.rows[0].id);
    }
    await c.query(
      `INSERT INTO public.devolucoes
         (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade,
          metodo_retorno, status, valor_itens, prazo_ate, politica)
       VALUES ($1, $2, $3, $4, 'arrependimento', 'desisti', 'troca', 'local',
               'entrega_na_loja', 'solicitada', 100, current_date + 7, '{}'::jsonb)`,
      [D_DEV, MARCA_PROTOCOLO, O_ENTREGUE, U_DONO],
    );
    await c.query(
      `INSERT INTO public.devolucao_itens
         (devolucao_id, order_item_id, product_id, product_name, quantidade, valor_unitario)
       VALUES ($1, $2, $3, $4, 1, 100)`,
      [D_DEV, itens[0], P_ESTOQUE, MARCA_ITEM],
    );
    await c.query(
      `INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, user_id)
       VALUES ($1, 'p256dh-portas', 'auth-portas', $2)`,
      [MARCA_PUSH, U_DONO],
    );

    // Config da loja e um lançamento previsto, pelo caminho das RPCs (como a
    // automação de confiança: service_role).
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE service_role");
    await c.query(
      'SELECT public.upsert_store_config(\'{"store_name":"Loja Portas"}\'::jsonb)',
    );
    const lanc = await c.query(
      "SELECT public.fin_lancamento_salvar($1::jsonb) AS r",
      [
        JSON.stringify({
          tipo: "saida",
          valor: 10,
          conta_id: BANCO,
          categoria_id: CAT_ALUGUEL,
          descricao: "Previsto Portas",
          status: "previsto",
          data_vencimento: new Date().toISOString().slice(0, 10),
        }),
      ],
    );
    const ident = await c.query("SELECT public.read_store_identity() AS r");
    await c.query("COMMIT");
    fx.lancamento = lanc.rows[0].r.ids[0];
    fx.identidade = ident.rows[0].r;
    assert.ok(fx.lancamento && fx.identidade.revision !== undefined);
  },
});

// ---------------------------------------------------------------------------
// (1) R1 — papel
// ---------------------------------------------------------------------------

// Roda `passos` como `quem` numa transação desfeita e devolve, ANTES de
// desfazer, o papel nas duas fontes de cada id pedido e o rls_admin_atual()
// de quem fez.
async function papelDepois(c, quem, passos, ids, { antes = [] } = {}) {
  await c.query("BEGIN");
  try {
    for (const s of antes) await c.query(s);
    await entrar(c, quem);
    const resultados = [];
    for (const [sql, params] of passos) {
      await c.query("SAVEPOINT passo");
      try {
        const r = await c.query(sql, params || []);
        resultados.push({ ok: true, n: r.rowCount });
        await c.query("RELEASE SAVEPOINT passo");
      } catch (e) {
        resultados.push({ ok: false, code: e.code, message: e.message });
        await c.query("ROLLBACK TO SAVEPOINT passo");
      }
    }
    const atual = (await c.query("SELECT public.rls_admin_atual() AS r"))
      .rows[0].r;
    await c.query("RESET ROLE");
    const papeis = {};
    for (const id of ids) {
      const l = (
        await c.query(
          `SELECT u.raw_app_meta_data ->> 'role' AS auth_role, p.role AS perfil_role
             FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id WHERE u.id = $1`,
          [id],
        )
      ).rows[0];
      papeis[id] = [l.auth_role, l.perfil_role];
    }
    return { resultados, atual, papeis };
  } finally {
    await c.query("ROLLBACK");
  }
}

const AUTOPROMO = [
  ["UPDATE public.profiles SET role = 'admin' WHERE id = $1", [U_REB_AUTH]],
];
const ALTERNA = [
  ["UPDATE public.profiles SET role = 'customer' WHERE id = $1", [U_REB_AUTH]],
  ["UPDATE public.profiles SET role = 'admin' WHERE id = $1", [U_REB_AUTH]],
];
const PROMOVE_ALVO = [
  ["UPDATE public.profiles SET role = 'admin' WHERE id = $1", [U_ALVO]],
];

PROVAS.push({
  nome: "(1) R1 autopromoção: o rebaixado só no app_metadata regrava profiles.role = 'admin' (JWT novo e velho, e alternando) e auth.users CONTINUA customer, rls_admin_atual() continua false; CONTROLE com o gatilho antigo: promove",
  corpo: async (c) => {
    for (const quem of ["rebaixadoAuthJwtNovo", "rebaixadoAuth"]) {
      for (const passos of [AUTOPROMO, ALTERNA]) {
        const r = await papelDepois(c, quem, passos, [U_REB_AUTH]);
        for (const p of r.resultados)
          assert.equal(p.ok, true, `${quem}: ${p.message}`);
        assert.deepEqual(
          r.papeis[U_REB_AUTH],
          ["customer", "admin"],
          `${quem}: o papel mudou`,
        );
        assert.equal(r.atual, false, `${quem}: virou admin atual`);
      }
    }
    // CONTROLE: o gatilho de sincronia com o corpo de antes (rollback-manual).
    const antigo = defNoArquivo(ROLLBACK, "handle_profile_role_sync_to_auth");
    assert.ok(!antigo.includes("IS NOT DISTINCT FROM OLD.role"));
    const r = await papelDepois(
      c,
      "rebaixadoAuthJwtNovo",
      AUTOPROMO,
      [U_REB_AUTH],
      { antes: [antigo] },
    );
    assert.deepEqual(
      r.papeis[U_REB_AUTH],
      ["admin", "admin"],
      "CONTROLE FALHOU: sem a correção a autopromoção não acontece — a prova não mede a correção",
    );
    assert.equal(
      r.atual,
      true,
      "CONTROLE: sem a correção o rebaixado não voltou a admin atual",
    );
  },
});

PROVAS.push({
  nome: "(1) R1 cúmplice: rebaixado (só app_metadata ou só profiles) com JWT velho não promove ninguém; cliente não se promove; CONTROLE com as proteções antigas: o rebaixado só no app_metadata promove",
  corpo: async (c) => {
    for (const quem of ["rebaixadoAuth", "rebaixadoPerfil", "cliente"]) {
      const r = await papelDepois(c, quem, PROMOVE_ALVO, [U_ALVO]);
      // A recusa de papel é silenciosa em ensure_role_protection (NEW.role
      // volta a OLD.role) ou com exceção em prevent_role_change — as duas
      // deixam o alvo como estava.
      assert.deepEqual(
        r.papeis[U_ALVO],
        ["customer", "customer"],
        `${quem} promoveu o alvo`,
      );
    }
    const autopromo = await papelDepois(
      c,
      "cliente",
      [
        [
          "UPDATE public.profiles SET role = 'admin' WHERE id = $1",
          [U_CLIENTE],
        ],
      ],
      [U_CLIENTE],
    );
    assert.deepEqual(autopromo.papeis[U_CLIENTE], ["customer", "customer"]);
    // CONTROLE: ensure_role_protection e prevent_role_change como antes.
    const antes = [
      defNoArquivo(ROLLBACK, "ensure_role_protection"),
      defNoArquivo(ROLLBACK, "prevent_role_change"),
    ];
    const r = await papelDepois(c, "rebaixadoAuth", PROMOVE_ALVO, [U_ALVO], {
      antes,
    });
    assert.deepEqual(
      r.papeis[U_ALVO],
      ["admin", "admin"],
      "CONTROLE FALHOU: com as proteções antigas o cúmplice não foi promovido — a prova não mede a guarda",
    );
  },
});

PROVAS.push({
  nome: "(1) R1 o caminho do painel continua: admin atual promove e rebaixa outro (as duas fontes acompanham), edita perfil alheio sem mexer em papel; service_role e postgres mudam papel; o INSERT sincroniza",
  corpo: async (c) => {
    const promove = await papelDepois(c, "admin", PROMOVE_ALVO, [U_ALVO]);
    assert.equal(promove.resultados[0].ok, true, promove.resultados[0].message);
    assert.equal(promove.resultados[0].n, 1);
    assert.deepEqual(
      promove.papeis[U_ALVO],
      ["admin", "admin"],
      "o admin atual não promoveu",
    );
    // Rebaixar o rebaixado-só-no-app_metadata de vez (as duas fontes).
    const rebaixa = await papelDepois(
      c,
      "admin",
      [
        [
          "UPDATE public.profiles SET role = 'customer' WHERE id = $1",
          [U_REB_AUTH],
        ],
      ],
      [U_REB_AUTH],
    );
    assert.deepEqual(rebaixa.papeis[U_REB_AUTH], ["customer", "customer"]);
    // E de volta, na mesma transação: promove e rebaixa.
    const ida = await papelDepois(
      c,
      "admin",
      [
        ["UPDATE public.profiles SET role = 'admin' WHERE id = $1", [U_ALVO]],
        [
          "UPDATE public.profiles SET role = 'customer' WHERE id = $1",
          [U_ALVO],
        ],
      ],
      [U_ALVO],
    );
    assert.deepEqual(ida.papeis[U_ALVO], ["customer", "customer"]);
    const nome = await papelDepois(
      c,
      "admin",
      [
        [
          "UPDATE public.profiles SET full_name = 'Alvo Renomeado' WHERE id = $1",
          [U_ALVO],
        ],
      ],
      [U_ALVO],
    );
    assert.equal(nome.resultados[0].ok, true, nome.resultados[0].message);
    assert.equal(nome.resultados[0].n, 1);
    // No Supabase o service_role tem BYPASSRLS; aqui (papel do cluster
    // inteiro, que a prova não altera) a mesma coisa vem de uma política só
    // dele, criada e desfeita dentro da transação da chamada.
    const bypass = [
      "CREATE POLICY prova_service_bypass ON public.profiles TO service_role USING (true) WITH CHECK (true)",
    ];
    for (const quem of ["service", "postgres"]) {
      const r = await papelDepois(c, quem, PROMOVE_ALVO, [U_ALVO], {
        antes: quem === "service" ? bypass : [],
      });
      assert.equal(
        r.resultados[0].ok,
        true,
        `${quem}: ${r.resultados[0].message}`,
      );
      assert.deepEqual(
        r.papeis[U_ALVO],
        ["admin", "admin"],
        `${quem} não promoveu`,
      );
    }
    // INSERT continua sincronizando (o caminho de handle_new_user/admin).
    await c.query("BEGIN");
    try {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, 'novo@portas.teste', '{}'::jsonb)`,
        [U_NOVO],
      );
      await c.query(
        "INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Novo', 'admin')",
        [U_NOVO],
      );
      const r = await c.query(
        "SELECT raw_app_meta_data ->> 'role' AS r FROM auth.users WHERE id = $1",
        [U_NOVO],
      );
      assert.equal(r.rows[0].r, "admin", "o INSERT deixou de sincronizar");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

// ---------------------------------------------------------------------------
// (2) R2/R3 — cada RPC guardada
// ---------------------------------------------------------------------------

const NEG_PADRAO = { code: "42501", mensagem: /^Acesso negado\.$/ };
const NEG_PRIV = {
  code: "P0001",
  mensagem: /^Acesso negado: privilégios de administrador necessários\.$/,
};
// devolucao_elegibilidade já exigia login antes da guarda de admin.
const NEG_LOGIN_DEV = {
  code: "42501",
  mensagem: /^Entre na sua conta para pedir uma devolução\.$/,
};
const ABRE_CAIXA = { quem: "admin", sql: ["SELECT public.fin_caixa_abrir(0)"] };

// `sql`/`params`: a chamada do painel. `marca`: texto que SÓ aparece se a RPC
// devolveu o dado do cliente da fixture. `vazio`: a recusa desta é devolver
// '[]' (não exceção). `dono`: RPC "dono OU admin" (o dono passa).
// `negService`/`negPostgres`: a recusa que service_role/postgres JÁ recebiam
// antes desta migration (ausente = passam, como antes).
const CASOS = [
  {
    nome: "get_admin_orders_paged",
    sql: "SELECT * FROM public.get_admin_orders_paged('', 'all', '', '', 0, 50, 'all', 'all') x",
    neg: NEG_PRIV,
    marca: MARCA_PEDIDO,
  },
  {
    nome: "get_admin_orders_cancelados_recentes",
    sql: "SELECT * FROM public.get_admin_orders_cancelados_recentes(3650, 0, 200) x",
    neg: NEG_PRIV,
    marca: MARCA_PEDIDO,
  },
  {
    nome: "get_admin_user_detail",
    sql: "SELECT * FROM public.get_admin_user_detail($1::uuid) x",
    params: [U_DONO],
    neg: NEG_PRIV,
    marca: MARCA_PERFIL,
  },
  {
    nome: "get_admin_customers_paged",
    sql: "SELECT * FROM public.get_admin_customers_paged('', 'created_at', 'desc', 0, 100) x",
    neg: NEG_PRIV,
    marca: MARCA_PERFIL,
  },
  {
    nome: "crm_clientes",
    sql: "SELECT * FROM public.crm_clientes(NULL, NULL, 200, 0) x",
    neg: NEG_PADRAO,
    marca: "Marcador Portas",
  },
  {
    nome: "admin_devolucoes_listar",
    sql: "SELECT * FROM public.admin_devolucoes_listar(NULL, NULL, 50, 0) x",
    neg: NEG_PADRAO,
    marca: MARCA_PEDIDO,
  },
  {
    nome: "devolucao_detalhe",
    sql: "SELECT * FROM public.devolucao_detalhe($1::uuid) x",
    params: [D_DEV],
    neg: { code: "P0002", mensagem: /^Devolução não encontrada\.$/ },
    marca: MARCA_PEDIDO,
    dono: true,
  },
  {
    nome: "devolucao_elegibilidade",
    sql: "SELECT * FROM public.devolucao_elegibilidade($1::uuid) x",
    params: [O_ENTREGUE],
    neg: { code: "P0002", mensagem: /^Pedido não encontrado\.$/ },
    marca: MARCA_ITEM,
    dono: true,
    negService: NEG_LOGIN_DEV,
    negPostgres: NEG_LOGIN_DEV,
  },
  {
    nome: "devolucoes_do_pedido",
    sql: "SELECT * FROM public.devolucoes_do_pedido($1::uuid) x",
    params: [O_ENTREGUE],
    vazio: true,
    marca: MARCA_PROTOCOLO,
    dono: true,
    negService: NEG_PADRAO,
    negPostgres: NEG_PADRAO,
  },
  {
    nome: "get_segmented_push_targets",
    sql: "SELECT * FROM public.get_segmented_push_targets('all', 150, 30) x",
    neg: NEG_PRIV,
    marca: MARCA_PUSH,
  },
  {
    nome: "crm_visao",
    sql: "SELECT * FROM public.crm_visao(current_date - 30, current_date) x",
    neg: NEG_PADRAO,
  },
  // painel_inicio chama fin_dre (também guardada): o controle tira as duas.
  {
    nome: "painel_inicio",
    sql: "SELECT * FROM public.painel_inicio() x",
    neg: NEG_PADRAO,
    controleTambem: ["fin_dre"],
  },
  {
    nome: "get_admin_analytics_v2",
    sql: "SELECT * FROM public.get_admin_analytics_v2(90) x",
    neg: NEG_PRIV,
  },
  {
    nome: "get_category_analytics",
    sql: "SELECT * FROM public.get_category_analytics(now() - interval '30 days', now()) x",
    neg: NEG_PRIV,
  },
  {
    nome: "get_coupon_stats",
    sql: "SELECT * FROM public.get_coupon_stats() x",
    neg: { code: "P0001", mensagem: /^Não autorizado$/ },
  },
  {
    nome: "get_retention_rate",
    sql: "SELECT * FROM public.get_retention_rate() x",
    neg: { code: "P0001", mensagem: /^Não autorizado\.$/ },
  },
  {
    nome: "get_segmented_push_count",
    sql: "SELECT * FROM public.get_segmented_push_count('all', 150, 30) x",
    neg: NEG_PRIV,
  },
  {
    nome: "fin_contas_listar",
    sql: "SELECT * FROM public.fin_contas_listar() x",
    neg: NEG_PADRAO,
  },
  {
    nome: "fin_categorias_listar",
    sql: "SELECT * FROM public.fin_categorias_listar() x",
    neg: NEG_PADRAO,
  },
  {
    nome: "fin_extrato",
    sql: "SELECT * FROM public.fin_extrato(current_date - 30, current_date, NULL) x",
    neg: NEG_PADRAO,
  },
  {
    nome: "fin_previstos",
    sql: "SELECT * FROM public.fin_previstos('saida') x",
    neg: NEG_PADRAO,
    marca: "Previsto Portas",
  },
  {
    nome: "fin_resumo",
    sql: "SELECT * FROM public.fin_resumo(current_date - 30, current_date) x",
    neg: NEG_PADRAO,
  },
  {
    nome: "fin_dre",
    sql: "SELECT * FROM public.fin_dre(current_date - 30, current_date) x",
    neg: NEG_PADRAO,
  },
  {
    nome: "fin_caixa_atual",
    sql: "SELECT * FROM public.fin_caixa_atual() x",
    neg: NEG_PADRAO,
  },
  {
    nome: "fin_caixa_historico",
    sql: "SELECT * FROM public.fin_caixa_historico(30) x",
    neg: NEG_PADRAO,
  },
  {
    nome: "confirmar_retorno_do_produto",
    sql: "SELECT * FROM public.confirmar_retorno_do_produto($1::uuid) x",
    params: [O_CANCELADO],
    neg: {
      code: "P0001",
      mensagem: /^Não autorizado: só a loja confirma que o produto voltou\.$/,
    },
  },
  // Venda no balcão: sem EXECUTE para service_role e exige login (a
  // vendedora é a sessão) — os dois já eram recusados antes.
  {
    nome: "registrar_venda_presencial",
    sql: "SELECT * FROM public.registrar_venda_presencial($1::jsonb, 'cash') x",
    params: [JSON.stringify([{ product_id: P_ESTOQUE, quantity: 1 }])],
    neg: {
      code: "42501",
      mensagem: /^Acesso negado: só a loja registra venda no balcão\.$/,
    },
    negService: {
      code: "42501",
      mensagem: /^permission denied for function registrar_venda_presencial$/,
    },
    negPostgres: {
      code: "42501",
      mensagem:
        /^Não autorizado: é preciso estar autenticado para registrar a venda\.$/,
    },
  },
  {
    nome: "fin_caixa_abrir",
    sql: "SELECT * FROM public.fin_caixa_abrir(0) x",
    neg: NEG_PADRAO,
  },
  {
    nome: "fin_caixa_movimentar",
    sql: "SELECT * FROM public.fin_caixa_movimentar('suprimento', 5, 'Prova Portas', NULL) x",
    neg: NEG_PADRAO,
    preparo: ABRE_CAIXA,
  },
  {
    nome: "fin_caixa_fechar",
    sql: "SELECT * FROM public.fin_caixa_fechar(0, 'prova portas') x",
    neg: NEG_PADRAO,
    preparo: ABRE_CAIXA,
  },
  {
    nome: "fin_lancamento_salvar",
    sql: "SELECT * FROM public.fin_lancamento_salvar($1::jsonb) x",
    params: [
      JSON.stringify({
        tipo: "saida",
        valor: 10,
        conta_id: BANCO,
        categoria_id: CAT_ALUGUEL,
        descricao: "Prova Portas",
        status: "realizado",
        forma_pagamento: "pix",
      }),
    ],
    neg: NEG_PADRAO,
  },
  {
    nome: "fin_lancamento_baixar",
    sql: "SELECT * FROM public.fin_lancamento_baixar($1::uuid) x",
    params: () => [fx.lancamento],
    neg: NEG_PADRAO,
  },
  {
    nome: "fin_lancamento_cancelar",
    sql: "SELECT * FROM public.fin_lancamento_cancelar($1::uuid, 'motivo portas') x",
    params: () => [fx.lancamento],
    neg: NEG_PADRAO,
  },
  {
    nome: "fin_conta_salvar",
    sql: "SELECT * FROM public.fin_conta_salvar($1::jsonb) x",
    params: [JSON.stringify({ nome: "Conta Portas", tipo: "banco" })],
    neg: NEG_PADRAO,
  },
  {
    nome: "fin_categoria_salvar",
    sql: "SELECT * FROM public.fin_categoria_salvar($1::jsonb) x",
    params: [
      JSON.stringify({
        nome: "Categoria Portas",
        natureza: "despesa",
        grupo_dre: "despesa_fixa",
      }),
    ],
    neg: NEG_PADRAO,
  },
  {
    nome: "salvar_config_pagamento_cartao",
    sql: "SELECT * FROM public.salvar_config_pagamento_cartao(true, true, 6) x",
    neg: NEG_PADRAO,
  },
  {
    nome: "salvar_politica_de_devolucao",
    sql: "SELECT * FROM public.salvar_politica_de_devolucao('{\"prazo_troca_dias\":15}'::jsonb) x",
    neg: NEG_PADRAO,
  },
  {
    nome: "upsert_store_config",
    sql: 'SELECT * FROM public.upsert_store_config(\'{"store_name":"Loja Portas 2"}\'::jsonb) x',
    neg: {
      code: "P0001",
      mensagem: /^Não autorizado: Apenas admins podem configurar a loja\.$/,
    },
  },
  {
    nome: "save_store_identity",
    sql: "SELECT * FROM public.save_store_identity($1, $2::jsonb, $3::jsonb) x",
    params: () => [
      fx.identidade.revision,
      JSON.stringify(fx.identidade.identity),
      JSON.stringify({
        ...fx.identidade.identity,
        store_name: "Loja Portas Identidade",
      }),
    ],
    neg: { code: "42501", mensagem: /^IDENTITY_PERMISSION$/ },
    // save_store_identity grava por upsert_store_config (também guardada).
    controleTambem: ["upsert_store_config"],
  },
];

const texto = (r) => JSON.stringify(r.linhas);

function recusou(r, caso, quem, neg = caso.neg) {
  assert.equal(r.ok, false, `${caso.nome} como ${quem} PASSOU — devia recusar`);
  assert.equal(
    r.code,
    neg.code,
    `${caso.nome} como ${quem}: ${r.code} ${r.message}`,
  );
  assert.match(r.message, neg.mensagem, `${caso.nome} como ${quem}`);
}

for (const caso of CASOS) {
  PROVAS.push({
    nome: `(2) ${caso.nome}: admin atual passa; rebaixado (só profiles, só app_metadata) e cliente recebem a recusa de não-admin; anon não passa; service_role/postgres ${caso.negService || caso.negPostgres ? "seguem como antes (recusados)" : "passam"}; CONTROLE sem a guarda: o rebaixado passa`,
    corpo: async (c) => {
      const params =
        typeof caso.params === "function" ? caso.params() : caso.params || [];
      const chamar = (quem) =>
        comoQuem(c, quem, caso.sql, params, { preparo: caso.preparo || null });
      const recusa = async (quem) => {
        const r = await chamar(quem);
        if (caso.vazio) {
          assert.equal(
            r.ok,
            true,
            `${caso.nome} como ${quem}: ${r.code} ${r.message}`,
          );
          assert.ok(
            !texto(r).includes(caso.marca),
            `${caso.nome} como ${quem} VIU o dado do cliente`,
          );
          assert.equal(r.linhas.length, 1);
          assert.deepEqual(
            Object.values(r.linhas[0])[0],
            [],
            `${caso.nome} como ${quem}: não veio '[]'`,
          );
          return;
        }
        recusou(r, caso, quem);
      };

      // admin atual passa (e vê o dado).
      const adm = await chamar("admin");
      assert.equal(
        adm.ok,
        true,
        `${caso.nome} admin atual recusado: ${adm.code} ${adm.message}`,
      );
      if (caso.marca)
        assert.ok(
          texto(adm).includes(caso.marca),
          `${caso.nome}: o admin não viu o marcador`,
        );

      // rebaixados com JWT velho e cliente: a recusa de sempre.
      await recusa("rebaixadoPerfil");
      await recusa("rebaixadoAuth");
      await recusa("cliente");
      const anon = await chamar("anon");
      assert.equal(anon.ok, false, `${caso.nome}: anon passou`);

      // dono (RPCs "dono OU admin") continua vendo o que é dele.
      if (caso.dono) {
        const d = await chamar("dono");
        assert.equal(
          d.ok,
          true,
          `${caso.nome} dono recusado: ${d.code} ${d.message}`,
        );
        assert.ok(
          texto(d).includes(caso.marca),
          `${caso.nome}: o dono perdeu o próprio dado`,
        );
      }

      for (const quem of ["service", "postgres"]) {
        const r = await chamar(quem);
        const antes = quem === "service" ? caso.negService : caso.negPostgres;
        if (antes) {
          recusou(r, caso, quem, antes);
        } else {
          assert.equal(
            r.ok,
            true,
            `${caso.nome} como ${quem} recusado: ${r.code} ${r.message}`,
          );
        }
      }

      // CONTROLE: o corpo vivo sem a guarda deixa os dois rebaixados passarem.
      const vivo = await catalogoComAssinatura(c, assinaturaDe(caso.nome));
      const tambem = [];
      for (const n of caso.controleTambem || [])
        tambem.push(await catalogoComAssinatura(c, assinaturaDe(n)));
      for (const quem of ["rebaixadoPerfil", "rebaixadoAuth"]) {
        await c.query("BEGIN");
        try {
          await c.query(semGuarda(vivo.def));
          for (const t of tambem) await c.query(semGuarda(t.def));
          if (caso.preparo) {
            await entrar(c, caso.preparo.quem);
            for (const s of caso.preparo.sql) await c.query(s);
            await c.query("RESET ROLE");
          }
          await entrar(c, quem);
          let r;
          try {
            r = { ok: true, linhas: (await c.query(caso.sql, params)).rows };
          } catch (e) {
            r = { ok: false, code: e.code, message: e.message };
          }
          assert.equal(
            r.ok,
            true,
            `CONTROLE FALHOU (${caso.nome}, ${quem}): sem a guarda ainda recusa (${r.code} ${r.message}) — a prova não mede a guarda`,
          );
          if (caso.marca)
            assert.ok(
              texto(r).includes(caso.marca),
              `CONTROLE (${caso.nome}, ${quem}): sem a guarda não vazou o marcador`,
            );
        } finally {
          await c.query("ROLLBACK");
        }
      }
      assert.equal(
        (await catalogo(c, vivo.assinatura)).hash,
        vivo.hash,
        "o controle vazou para o corpo vivo",
      );
    },
  });
}

function assinaturaDe(nome) {
  const a = ASSINATURAS.find((s) => s.startsWith(`public.${nome}(`));
  assert.ok(a, `${nome} não está no preflight da migration`);
  return a;
}

async function catalogoComAssinatura(c, assinatura) {
  const r = await catalogo(c, assinatura);
  assert.ok(r, `${assinatura} não existe`);
  return { ...r, assinatura };
}

// ---------------------------------------------------------------------------
// (3) rollback, idempotência, preflight
// ---------------------------------------------------------------------------

PROVAS.push({
  nome: "(3) o banco nascido das migrations tem os 42 corpos DESTA migration (e cada um deles é o que o preflight declara)",
  corpo: async (c) => {
    assert.equal(
      ASSINATURAS.length,
      42,
      `o preflight lista ${ASSINATURAS.length} funções`,
    );
    for (const a of ASSINATURAS) {
      const r = await catalogoComAssinatura(c, a);
      assert.ok(r, `${a} não existe`);
      assert.equal(
        r.hash,
        HASH_DESTA[a],
        `${a}: o corpo vivo não é o desta migration`,
      );
    }
  },
});

PROVAS.push({
  nome: "(3) reaplicar a migration por cima de si mesma (2x) não muda a impressão digital",
  corpo: async (c) => {
    const antes = await digital(c);
    await c.query("BEGIN");
    try {
      await c.query(MIGRATION);
      await c.query(MIGRATION);
      assert.deepEqual(await digital(c), antes, "reaplicar mudou alguma coisa");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(3) rollback-manual: SÓ os 42 corpos mudam, cada um para o md5 de antes; o resto da impressão digital (funções, gatilhos, políticas, ACL) igual; 2o rollback recusa sem escrever; reaplicar volta ao estado da migration",
  corpo: async (c) => {
    const com = await digital(c);
    await c.query("BEGIN");
    try {
      await c.query(ROLLBACK);
      const sem = await digital(c);
      assert.deepEqual(
        Object.keys(sem).sort(),
        Object.keys(com).sort(),
        "o rollback criou ou apagou objeto",
      );
      const mudou = Object.keys(com)
        .filter((k) => com[k] !== sem[k])
        .sort();
      assert.deepEqual(
        mudou,
        ASSINATURAS.map(fnChave).sort(),
        "o rollback mudou algo além dos 42 corpos",
      );
      for (const a of ASSINATURAS) {
        const [hCom, ...restoCom] = com[fnChave(a)].split(" | ");
        const [hSem, ...restoSem] = sem[fnChave(a)].split(" | ");
        assert.equal(hCom, HASH_DESTA[a]);
        assert.equal(
          hSem,
          HASH_VIGENTE[a],
          `${a}: o rollback não voltou ao corpo de antes`,
        );
        assert.deepEqual(
          restoSem,
          restoCom,
          `${a}: ACL/SECURITY DEFINER/search_path/dono/assinatura mudou`,
        );
      }
      // Segundo rollback: recusa sem escrever.
      await c.query("SAVEPOINT segundo");
      await assert.rejects(c.query(ROLLBACK), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT segundo");
      assert.deepEqual(await digital(c), sem, "o 2o rollback escreveu algo");
      // Reaplicar: volta exatamente ao estado da migration; de novo: igual.
      await c.query(MIGRATION);
      assert.deepEqual(
        await digital(c),
        com,
        "reaplicar depois do rollback divergiu",
      );
      await c.query(MIGRATION);
      assert.deepEqual(await digital(c), com, "reaplicar 2x divergiu");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(3) preflight: corpo vivo divergente, gatilho desligado/alterado ou is_admin_atual() diferente -> B1_BASELINE_DIVERGENT sem NENHUMA escrita; rollback sobre estado divergente idem",
  corpo: async (c) => {
    const ultima = ASSINATURAS[ASSINATURAS.length - 1];
    const divergir = {
      corpo: async () => {
        const def = (await catalogo(c, ultima)).def;
        const d = def.replace(
          "IDENTITY_MISSING",
          "IDENTITY_MISSING_DIVERGENTE",
        );
        assert.notEqual(d, def);
        await c.query(d);
      },
      gatilhoDesligado: () =>
        c.query(
          "ALTER TABLE public.profiles DISABLE TRIGGER tr_sync_profile_role_to_auth",
        ),
      gatilhoAlterado: async () => {
        await c.query(
          "DROP TRIGGER tr_ensure_role_protection ON public.profiles",
        );
        await c.query(
          "CREATE TRIGGER tr_ensure_role_protection BEFORE INSERT OR UPDATE ON public.profiles FOR EACH ROW EXECUTE FUNCTION public.ensure_role_protection()",
        );
      },
      atualDiferente: async () => {
        const def = (await catalogo(c, "public.is_admin_atual()")).def;
        await c.query(
          def.replace(
            "(c) Qualquer outra coisa: false.",
            "(c) Qualquer outra coisa: false (divergente).",
          ),
        );
      },
    };
    const regex = {
      corpo: /B1_BASELINE_DIVERGENT: corpo vivo de public\.save_store_identity/,
      gatilhoDesligado:
        /B1_BASELINE_DIVERGENT: gatilho tr_sync_profile_role_to_auth/,
      gatilhoAlterado:
        /B1_BASELINE_DIVERGENT: gatilho tr_ensure_role_protection/,
      atualDiferente: /B1_BASELINE_DIVERGENT: public\.is_admin_atual\(\)/,
    };
    for (const rotulo of Object.keys(divergir)) {
      await c.query("BEGIN");
      try {
        // Volta ao estado de antes da migration e diverge UMA peça.
        await c.query(ROLLBACK);
        await divergir[rotulo]();
        const antes = await digital(c);
        await c.query("SAVEPOINT aplicar");
        await assert.rejects(c.query(MIGRATION), regex[rotulo], rotulo);
        await c.query("ROLLBACK TO SAVEPOINT aplicar");
        assert.deepEqual(
          await digital(c),
          antes,
          `a recusa (${rotulo}) escreveu algo`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    }
    // Rollback por cima de estado divergente (a primeira e a última da
    // lista): recusa sem escrever.
    for (const a of [ASSINATURAS[0], ultima]) {
      await c.query("BEGIN");
      try {
        const def = (await catalogo(c, a)).def;
        const d = def.replace(
          "(20261199000000)",
          "(20261199000000, divergente)",
        );
        assert.notEqual(d, def);
        await c.query(d);
        const antes = await digital(c);
        await c.query("SAVEPOINT reverter");
        await assert.rejects(c.query(ROLLBACK), /B1_BASELINE_DIVERGENT/, a);
        await c.query("ROLLBACK TO SAVEPOINT reverter");
        assert.deepEqual(
          await digital(c),
          antes,
          `rollback recusado (${a}) escreveu algo`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    }
  },
});

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  try {
    for (const { nome, corpo } of PROVAS) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        anexarAoSummary(
          "Prova viva das portas do painel com admin atual (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Uma regra do admin atual nas portas do painel foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[admin-atual-portas] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva das portas do painel com admin atual (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
