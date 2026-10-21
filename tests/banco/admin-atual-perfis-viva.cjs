"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp --
 * Toda chave indexada aqui vem de constante do próprio teste (QUEM, CASOS, nomes de política) ou do
 * catálogo do Postgres efêmero; nunca de entrada de rede nem de payload de terceiro. */

/**
 * PROVA VIVA da migration
 * 20261340000000_as_politicas_de_perfil_e_endereco_exigem_o_admin_atual.sql
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * O DEFEITO: 13 políticas de RLS de dado de CLIENTE (perfil com whatsapp e CPF, endereço, carrinho, inscrição
 * de push, notificação) e de configuração (log de push, analytics, credenciais de frete) decidiam o admin por
 * `is_admin()` (JWT, vale ~1 h depois do rebaixamento). O ex-admin lia e ALTERAVA direto pelo PostgREST os
 * dados de todas as clientes.
 *
 * O QUE SE PROVA, para CADA uma das 13 políticas (por tabela e operação):
 *   (a) ex-admin rebaixado só no profiles e ex-admin rebaixado só no auth.users (JWT ainda dizendo admin)
 *       LEEM 0 linhas e NÃO escrevem (UPDATE/DELETE afetam 0 linhas; INSERT recusa com 42501 da RLS);
 *       CONTROLE: com a política ANTIGA (ALTER POLICY do rollback, dentro da transação) os dois leem a linha
 *       e escrevem — é a política, e não outra coisa, que barra;
 *   (b) admin de verdade (admin nas duas fontes) lê e escreve como antes;
 *   (c) a CLIENTE comum lê e mexe no que é dela (perfil, endereço, carrinho, inscrição, notificação) como antes
 *       e uma TERCEIRA não lê nem escreve o que não é dela; o recado para todas (usuario_id NULL) segue visível;
 *   (r) SEM RECURSÃO: ler o próprio perfil (o caminho do login) e o admin ler os perfis das outras funcionam com
 *       a política de profiles chamando rls_admin_atual() (sem recursão); o MUTANTE mostra por que o pré-voo
 *       existe: com o dono das funções sujeito à RLS de profiles nenhum admin é reconhecido (o painel fecha), e
 *       o pré-voo RECUSA a migration com FORCE ROW LEVEL SECURITY e com dono de função diferente da tabela;
 *   (d) o banco nascido das migrations tem as 13 políticas com rls_admin_atual() e sem is_admin(); reaplicar
 *       (2x) não muda a impressão digital; o rollback-manual volta SÓ as 13 (só a porta muda: o resto do texto
 *       da política é idêntico), o 2o rollback recusa sem escrever e reaplicar volta ao estado da migration; o
 *       pré-voo recusa (sem escrever) política divergente (expressão, comando, papel), função divergente,
 *       FORCE e dono diferente; o rollback recusa sobre estado divergente;
 *   (f) a consulta de "papel contraditório" do cabeçalho acha os dois rebaixados da fixture e nenhum dos outros.
 *
 * Toda chamada roda numa transação DESFEITA no fim.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/admin-atual-perfis-viva.cjs
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

// eslint-disable-next-line security/detect-non-literal-require -- caminho constante do próprio teste.
const CONF = require(
  path.join(
    __dirname,
    "..",
    "..",
    "scripts",
    "publicacao",
    "conferir-banco.cjs",
  ),
);

const NOME_MIGRATION =
  "20261340000000_as_politicas_de_perfil_e_endereco_exigem_o_admin_atual.sql";
const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
const memo = {};
function lerMigration(nome) {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
  memo[nome] ??= fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");
  return memo[nome];
}
const migration = () => lerMigration(NOME_MIGRATION);
const rollback = () => lerMigration(`rollback-manual-${NOME_MIGRATION}`);

const U_ADMIN = "b3400000-0000-4000-8000-000000000001";
const U_REB_PERFIL = "b3400000-0000-4000-8000-000000000002";
const U_REB_AUTH = "b3400000-0000-4000-8000-000000000003";
const U_TERCEIRA = "b3400000-0000-4000-8000-000000000004";
const U_CLIENTE = "b3400000-0000-4000-8000-000000000005";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

const QUEM = {
  anon: { papel: "anon", uid: "", jwt: "" },
  terceira: {
    papel: "authenticated",
    uid: U_TERCEIRA,
    jwt: claims(U_TERCEIRA, null),
  },
  // A cliente comum, dona das linhas da fixture.
  cliente: {
    papel: "authenticated",
    uid: U_CLIENTE,
    jwt: claims(U_CLIENTE, null),
  },
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
};

async function entrar(c, quem) {
  const q = QUEM[quem];
  await c.query(`SET LOCAL ROLE ${q.papel}`);
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [q.uid, q.jwt],
  );
}

// Roda `passos` ([nome, sql, params]) como `quem` numa transação SEMPRE desfeita; cada passo num savepoint (a
// recusa de um não derruba os outros). `preparo`: SQL rodado como dono do banco antes de entrar (o CONTROLE troca
// a política aqui). Devolve { nome: { ok, n, linha, code, message } }.
async function como(c, quem, passos, { preparo = [] } = {}) {
  await c.query("BEGIN");
  try {
    for (const s of preparo) await c.query(s);
    await entrar(c, quem);
    const out = {};
    for (const [nome, sql, params] of passos) {
      await c.query("SAVEPOINT passo");
      try {
        const r = await c.query(sql, params || []);
        out[nome] = { ok: true, n: r.rowCount, linha: r.rows[0] };
        await c.query("RELEASE SAVEPOINT passo");
      } catch (e) {
        out[nome] = { ok: false, code: e.code, message: e.message };
        await c.query("ROLLBACK TO SAVEPOINT passo");
      }
    }
    return out;
  } finally {
    await c.query("ROLLBACK");
  }
}

// O ALTER POLICY de antes da migration, como está no rollback-manual.
function alterAntigo(politica) {
  const nome = /^[a-z_0-9]+$/.test(politica) ? politica : `"${politica}"`;
  const inicio = rollback().indexOf(`ALTER POLICY ${nome} ON `);
  assert.ok(inicio >= 0, `${politica} não está no rollback`);
  return rollback().slice(inicio, rollback().indexOf(";", inicio) + 1);
}

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
      SELECT 'rls ' || c.oid::regclass::text, c.relrowsecurity::text || ' ' || c.relforcerowsecurity::text
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind = 'r'`);
    return Object.fromEntries(r.rows.map((l) => [l.k, l.v]));
  } finally {
    await c.query("RESET search_path");
  }
}

const fx = {};
const PROVAS = [];

PROVAS.push({
  nome: "(0) fixtures: admin atual, rebaixados nas duas direções, cliente dona dos dados e terceira; perfil com whatsapp/CPF, endereço, carrinho, inscrição de push, notificações, log de push, evento de analytics e credencial de frete",
  corpo: async (c) => {
    // Fábrica do Supabase que o provisionar.cjs não emula — só neste CLONE (rodar-isolado.cjs): a RLS lê auth.users.
    await c.query(
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
    );
    await c.query(
      "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
    );
    for (const id of [
      U_ADMIN,
      U_REB_PERFIL,
      U_REB_AUTH,
      U_TERCEIRA,
      U_CLIENTE,
    ]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@perfis.teste', '{}'::jsonb)`,
        [id],
      );
    }
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role, whatsapp, cpf) VALUES
         ($1, 'Admin Atual', 'admin', '11900000001', '11111111111'),
         ($2, 'Rebaixado Perfil', 'customer', '11900000002', '22222222222'),
         ($3, 'Rebaixado Auth', 'admin', '11900000003', '33333333333'),
         ($4, 'Terceira', 'customer', '11900000004', '44444444444'),
         ($5, 'Cliente Dona', 'customer', '11900000005', '55555555555')`,
      [U_ADMIN, U_REB_PERFIL, U_REB_AUTH, U_TERCEIRA, U_CLIENTE],
    );
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
        WHERE u.id::text LIKE 'b3400000-%' ORDER BY u.id`,
    );
    assert.deepEqual(
      r.rows.map((l) => [l.id, l.auth_role, l.perfil_role]),
      [
        [U_ADMIN, "admin", "admin"],
        [U_REB_PERFIL, "admin", "customer"],
        [U_REB_AUTH, "customer", "admin"],
        [U_TERCEIRA, "customer", "customer"],
        [U_CLIENTE, "customer", "customer"],
      ],
    );
    fx.endereco = (
      await c.query(
        `INSERT INTO public.user_addresses (user_id, name, recipient_name, cep, street, number, neighborhood, city, state)
         VALUES ($1, 'Casa', 'Cliente Dona', '01001000', 'Rua Privada', '10', 'Centro', 'Sao Paulo', 'SP') RETURNING id`,
        [U_CLIENTE],
      )
    ).rows[0].id;
    fx.inscricao = (
      await c.query(
        `INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, user_id)
         VALUES ('https://push.invalid/cliente-dona', 'p256dh-x', 'auth-x', $1) RETURNING id`,
        [U_CLIENTE],
      )
    ).rows[0].id;
    fx.carrinho = (
      await c.query(
        `INSERT INTO public.cart_items (user_id, product_id, quantity) VALUES ($1, 'produto-x', 2) RETURNING id`,
        [U_CLIENTE],
      )
    ).rows[0].id;
    fx.notificacao = (
      await c.query(
        `INSERT INTO public.notificacoes (usuario_id, titulo) VALUES ($1, 'Aviso da cliente') RETURNING id`,
        [U_CLIENTE],
      )
    ).rows[0].id;
    fx.recado = (
      await c.query(
        `INSERT INTO public.notificacoes (usuario_id, titulo) VALUES (NULL, 'Recado para todas') RETURNING id`,
      )
    ).rows[0].id;
    fx.log = (
      await c.query(
        `INSERT INTO public.push_notifications_log (title, body) VALUES ('Log', 'Corpo do log') RETURNING id`,
      )
    ).rows[0].id;
    fx.evento = (
      await c.query(
        `INSERT INTO public.analytics_events (event_type, user_id) VALUES ('view_product', $1) RETURNING id`,
        [U_CLIENTE],
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO public.store_shipping_credentials (provider, credentials) VALUES ('perfis_teste', '{"token":"segredo-ficticio"}'::jsonb)`,
    );
  },
});

// ---------------------------------------------------------------------------
// (a)(b)(c) comportamento, para cada tabela e operação
// ---------------------------------------------------------------------------

// `politicas`: as políticas que o caso exercita (o CONTROLE desfaz todas). `ler`: SELECT de contagem da linha da
// fixture. `escritas`: passos (update/delete devolvem rowCount; insert devolve o erro de RLS). `dono`: a cliente
// vê a linha. `donoEscreve`: a cliente também escreve. `soAdmin`: ninguém além do admin de agora toca.
const CASOS = [
  {
    nome: "profiles (profiles_select_policy, profiles_update_policy)",
    politicas: ["profiles_select_policy", "profiles_update_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.profiles WHERE id = $1",
      [U_CLIENTE],
    ],
    escritas: () => ({
      update: [
        "UPDATE public.profiles SET whatsapp = '11999990000' WHERE id = $1",
        [U_CLIENTE],
      ],
    }),
    dono: true,
    donoEscreve: true,
  },
  {
    nome: "user_addresses (user_addresses_all_policy, ALL)",
    politicas: ["user_addresses_all_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.user_addresses WHERE id = $1",
      [fx.endereco],
    ],
    escritas: () => ({
      update: [
        "UPDATE public.user_addresses SET street = 'Rua Mexida' WHERE id = $1",
        [fx.endereco],
      ],
      delete: [
        "DELETE FROM public.user_addresses WHERE id = $1",
        [fx.endereco],
      ],
      insert: [
        `INSERT INTO public.user_addresses (user_id, name, recipient_name, cep, street, number, neighborhood, city, state)
         VALUES ($1, 'Outra', 'Alguem', '01001000', 'Rua Nova', '2', 'Centro', 'Sao Paulo', 'SP')`,
        [U_CLIENTE],
      ],
    }),
    dono: true,
    donoEscreve: true,
  },
  {
    nome: "push_subscriptions (push_subscriptions_all_policy, ALL)",
    politicas: ["push_subscriptions_all_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.push_subscriptions WHERE id = $1",
      [fx.inscricao],
    ],
    escritas: () => ({
      update: [
        "UPDATE public.push_subscriptions SET p256dh = 'mexida' WHERE id = $1",
        [fx.inscricao],
      ],
      delete: [
        "DELETE FROM public.push_subscriptions WHERE id = $1",
        [fx.inscricao],
      ],
      insert: [
        `INSERT INTO public.push_subscriptions (endpoint, p256dh, auth, user_id)
         VALUES ('https://push.invalid/nova-' || gen_random_uuid(), 'p', 'a', $1)`,
        [U_CLIENTE],
      ],
    }),
    dono: true,
    donoEscreve: true,
  },
  {
    nome: "cart_items (cart_items_select_policy e cart_items_delete_policy)",
    politicas: ["cart_items_select_policy", "cart_items_delete_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.cart_items WHERE id = $1",
      [fx.carrinho],
    ],
    escritas: () => ({
      delete: ["DELETE FROM public.cart_items WHERE id = $1", [fx.carrinho]],
    }),
    dono: true,
    donoEscreve: true,
  },
  {
    nome: "notificacoes (select, insert, update, delete)",
    politicas: [
      "notificacoes_select_policy",
      "notificacoes_insert_policy",
      "notificacoes_update_policy",
      "notificacoes_delete_policy",
    ],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.notificacoes WHERE id = $1",
      [fx.notificacao],
    ],
    escritas: () => ({
      update: [
        "UPDATE public.notificacoes SET lida = true WHERE id = $1",
        [fx.notificacao],
      ],
      delete: [
        "DELETE FROM public.notificacoes WHERE id = $1",
        [fx.notificacao],
      ],
      insert: [
        "INSERT INTO public.notificacoes (usuario_id, titulo) VALUES ($1, 'Nova')",
        [U_CLIENTE],
      ],
    }),
    dono: true,
    donoEscreve: true,
  },
  {
    nome: "push_notifications_log (push_notifications_log_admin_all_policy, ALL)",
    politicas: ["push_notifications_log_admin_all_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.push_notifications_log WHERE id = $1",
      [fx.log],
    ],
    escritas: () => ({
      update: [
        "UPDATE public.push_notifications_log SET status = 'mexido' WHERE id = $1",
        [fx.log],
      ],
      delete: [
        "DELETE FROM public.push_notifications_log WHERE id = $1",
        [fx.log],
      ],
      insert: [
        "INSERT INTO public.push_notifications_log (title, body) VALUES ('t', 'b')",
        [],
      ],
    }),
    dono: false,
  },
  {
    nome: "analytics_events (analytics_events_select_policy)",
    politicas: ["analytics_events_select_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.analytics_events WHERE id = $1",
      [fx.evento],
    ],
    escritas: () => ({}),
    dono: false,
  },
  {
    nome: 'store_shipping_credentials ("Admins have full access to shipping credentials", ALL)',
    politicas: ["Admins have full access to shipping credentials"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.store_shipping_credentials WHERE provider = 'perfis_teste'",
      [],
    ],
    escritas: () => ({
      update: [
        "UPDATE public.store_shipping_credentials SET credentials = '{}'::jsonb WHERE provider = 'perfis_teste'",
        [],
      ],
      delete: [
        "DELETE FROM public.store_shipping_credentials WHERE provider = 'perfis_teste'",
        [],
      ],
      insert: [
        "INSERT INTO public.store_shipping_credentials (provider, credentials) VALUES ('novo_' || gen_random_uuid()::text, '{}'::jsonb)",
        [],
      ],
    }),
    dono: false,
  },
];

const RLS_INSERT = /new row violates row-level security policy/;

for (const caso of CASOS) {
  PROVAS.push({
    nome: `(a)(b)(c) ${caso.nome}: ex-admin (JWT velho) lê 0 e não escreve; admin atual como antes; cliente e terceira; CONTROLE com a política antiga`,
    corpo: async (c) => {
      const [sqlLer, parLer] = caso.ler();
      const escritas = caso.escritas();
      const passos = [
        ["ler", sqlLer, parLer],
        ...Object.entries(escritas).map(([n, [s, p]]) => [n, s, p]),
      ];
      const lido = (r) => r.ler.linha.n;

      // (b) admin de verdade: lê e escreve como antes.
      const adm = await como(c, "admin", passos);
      assert.equal(adm.ler.ok, true, `${caso.nome}: admin recusado`);
      assert.equal(lido(adm), 1, `${caso.nome}: admin não leu a linha`);
      for (const op of ["update", "delete"]) {
        if (escritas[op])
          assert.equal(
            adm[op].n,
            1,
            `${caso.nome}: admin ${op}: ${adm[op].message}`,
          );
      }
      if (escritas.insert)
        assert.equal(
          adm.insert.ok,
          true,
          `${caso.nome}: admin insert: ${adm.insert.message}`,
        );

      // (a) os dois rebaixados, com o JWT ainda dizendo admin.
      for (const quem of ["rebaixadoPerfil", "rebaixadoAuth"]) {
        const r = await como(c, quem, passos);
        assert.equal(
          r.ler.ok,
          true,
          `${caso.nome}: ${quem} leitura com erro: ${r.ler.message}`,
        );
        assert.equal(lido(r), 0, `${caso.nome}: ${quem} LEU a linha`);
        for (const op of ["update", "delete"]) {
          if (escritas[op]) {
            assert.equal(
              r[op].ok,
              true,
              `${caso.nome}: ${quem} ${op}: ${r[op].message}`,
            );
            assert.equal(r[op].n, 0, `${caso.nome}: ${quem} ESCREVEU (${op})`);
          }
        }
        if (escritas.insert) {
          assert.equal(r.insert.ok, false, `${caso.nome}: ${quem} INSERIU`);
          assert.equal(
            r.insert.code,
            "42501",
            `${caso.nome}: ${quem} insert ${r.insert.code}`,
          );
          assert.match(r.insert.message, RLS_INSERT);
        }
        // CONTROLE: com a política ANTIGA o mesmo rebaixado lê e escreve.
        const ctl = await como(c, quem, passos, {
          preparo: caso.politicas.map(alterAntigo),
        });
        assert.equal(
          lido(ctl),
          1,
          `CONTROLE FALHOU (${caso.nome}, ${quem}): na política antiga não leu — a prova não mede a política`,
        );
        for (const op of ["update", "delete"]) {
          if (escritas[op])
            assert.equal(
              ctl[op].n,
              1,
              `CONTROLE FALHOU (${caso.nome}, ${quem}): na política antiga não escreveu (${op})`,
            );
        }
        if (escritas.insert)
          assert.equal(
            ctl.insert.ok,
            true,
            `CONTROLE FALHOU (${caso.nome}, ${quem}): na política antiga o insert recusou`,
          );
      }

      // (c) a cliente comum vê e mexe no que é dela (quando o caso é dela); a terceira não vê nem mexe.
      const dona = await como(c, "cliente", passos);
      assert.equal(dona.ler.ok, true);
      assert.equal(
        lido(dona),
        caso.dono ? 1 : 0,
        `${caso.nome}: a cliente ${caso.dono ? "perdeu o que é dela" : "passou a ver o que não é dela"}`,
      );
      for (const op of ["update", "delete"]) {
        if (escritas[op])
          assert.equal(
            dona[op].n,
            caso.donoEscreve ? 1 : 0,
            `${caso.nome}: cliente ${op} mudou`,
          );
      }
      if (escritas.insert)
        assert.equal(
          dona.insert.ok,
          Boolean(caso.donoEscreve),
          `${caso.nome}: cliente insert mudou`,
        );
      const terc = await como(c, "terceira", passos);
      assert.equal(lido(terc), 0, `${caso.nome}: a terceira LEU`);
      for (const op of ["update", "delete"]) {
        if (escritas[op])
          assert.equal(
            terc[op].n,
            0,
            `${caso.nome}: a terceira ESCREVEU (${op})`,
          );
      }
      if (escritas.insert) {
        // Para a tabela da cliente, a terceira tenta inserir EM NOME DELA (user_id/usuario_id alheio).
        assert.equal(
          terc.insert.ok,
          false,
          `${caso.nome}: a terceira INSERIU em nome alheio`,
        );
      }

      // anon: as políticas são TO authenticated — nenhuma linha vaza.
      const a = await como(c, "anon", [["ler", sqlLer, parLer]]);
      if (a.ler.ok) assert.equal(lido(a), 0, `${caso.nome}: anon LEU`);
    },
  });
}

PROVAS.push({
  nome: "(c) o recado para todas (usuario_id NULL) segue visível a qualquer logada — inclusive ao ex-admin; a terceira não vê a notificação da cliente",
  corpo: async (c) => {
    const passos = [
      [
        "recado",
        "SELECT count(*)::int AS n FROM public.notificacoes WHERE id = $1",
        [fx.recado],
      ],
      [
        "dela",
        "SELECT count(*)::int AS n FROM public.notificacoes WHERE id = $1",
        [fx.notificacao],
      ],
    ];
    for (const quem of [
      "cliente",
      "terceira",
      "rebaixadoPerfil",
      "rebaixadoAuth",
      "admin",
    ]) {
      const r = await como(c, quem, passos);
      assert.equal(r.recado.linha.n, 1, `${quem}: não viu o recado para todas`);
      assert.equal(
        r.dela.linha.n,
        quem === "cliente" || quem === "admin" ? 1 : 0,
        `${quem}: viu/deixou de ver a notificação da cliente`,
      );
    }
  },
});

// ---------------------------------------------------------------------------
// (r) SEM RECURSÃO
// ---------------------------------------------------------------------------

PROVAS.push({
  nome: "(r) sem recursão: o caminho do login (ler o PRÓPRIO perfil) e o admin lendo os perfis das outras funcionam com a política de profiles chamando rls_admin_atual(); a premissa (sem FORCE; mesmo dono) está no catálogo",
  corpo: async (c) => {
    const cat = await c.query(`
      SELECT t.relowner::regrole::text AS dono_tabela, t.relrowsecurity, t.relforcerowsecurity,
             a.proowner::regrole::text AS dono_atual, b.proowner::regrole::text AS dono_rls
        FROM pg_class t, pg_proc a, pg_proc b
       WHERE t.oid = 'public.profiles'::regclass
         AND a.oid = 'public.is_admin_atual()'::regprocedure
         AND b.oid = 'public.rls_admin_atual()'::regprocedure`);
    const k = cat.rows[0];
    assert.equal(k.relrowsecurity, true);
    assert.equal(k.relforcerowsecurity, false, "profiles NÃO pode ter FORCE");
    assert.equal(
      k.dono_atual,
      k.dono_tabela,
      "is_admin_atual() tem de ser do dono da tabela",
    );
    assert.equal(
      k.dono_rls,
      k.dono_tabela,
      "rls_admin_atual() tem de ser do dono da tabela",
    );

    const proprio = [
      [
        "proprio",
        "SELECT id, whatsapp, cpf FROM public.profiles WHERE id = auth.uid()",
        [],
      ],
      [
        "tudo",
        "SELECT count(*)::int AS n FROM public.profiles WHERE id::text LIKE 'b3400000-%'",
        [],
      ],
    ];
    const cli = await como(c, "cliente", proprio);
    assert.equal(
      cli.proprio.ok,
      true,
      `leitura do próprio perfil falhou: ${cli.proprio.message}`,
    );
    assert.equal(cli.proprio.n, 1);
    assert.equal(cli.proprio.linha.cpf, "55555555555");
    assert.equal(cli.tudo.linha.n, 1, "a cliente comum só vê o próprio perfil");
    const adm = await como(c, "admin", proprio);
    assert.equal(
      adm.tudo.ok,
      true,
      `admin lendo todos falhou: ${adm.tudo.message}`,
    );
    assert.equal(
      adm.tudo.linha.n,
      5,
      "o admin atual lê os 5 perfis da fixture",
    );
    for (const quem of ["rebaixadoPerfil", "rebaixadoAuth"]) {
      const r = await como(c, quem, proprio);
      assert.equal(r.proprio.ok, true);
      assert.equal(r.proprio.n, 1, `${quem}: lê o PRÓPRIO perfil`);
      assert.equal(
        r.tudo.linha.n,
        1,
        `${quem}: só o próprio perfil depois do rebaixamento`,
      );
    }
  },
});

PROVAS.push({
  nome: "(r) MUTANTE: dono das funções sujeito à RLS de profiles = nenhum admin reconhecido (por isso o pré-voo recusa dono diferente e FORCE)",
  corpo: async (c) => {
    // 1) Se o dono das funções PASSA pela RLS de profiles (aqui, um papel sem BYPASSRLS que não é o dono da
    //    tabela), a função enxerga ZERO perfis e NENHUM admin é reconhecido: o admin atual passa a ver só o
    //    próprio perfil (o painel fecha — falha para o lado seguro). É por isso que o pré-voo exige o dono
    //    certo. (A recursão infinita que se temia NÃO foi reproduzida em nenhuma configuração tentada — nem
    //    com o dono membro de authenticated e sem índice —, porque a função só consulta a linha do PRÓPRIO
    //    usuário, que passa pelo 1o ramo da política.)
    await c.query("BEGIN");
    try {
      await c.query("CREATE ROLE dono_sem_bypass_perfis NOLOGIN");
      await c.query(
        "GRANT CREATE, USAGE ON SCHEMA public TO dono_sem_bypass_perfis",
      );
      await c.query("GRANT USAGE ON SCHEMA auth TO dono_sem_bypass_perfis");
      await c.query(
        "GRANT SELECT ON public.profiles, auth.users TO dono_sem_bypass_perfis",
      );
      await c.query(
        "GRANT EXECUTE ON FUNCTION auth.uid() TO dono_sem_bypass_perfis",
      );
      await c.query(
        "ALTER FUNCTION public.is_admin_atual() OWNER TO dono_sem_bypass_perfis",
      );
      await c.query(
        "ALTER FUNCTION public.rls_admin_atual() OWNER TO dono_sem_bypass_perfis",
      );
      await entrar(c, "admin");
      const n = (
        await c.query(
          "SELECT count(*)::int AS n FROM public.profiles WHERE id::text LIKE 'b3400000-%'",
        )
      ).rows[0].n;
      assert.equal(
        n,
        1,
        "com o dono sujeito à RLS o admin deveria ver só o próprio perfil (nenhum admin reconhecido)",
      );
    } finally {
      await c.query("ROLLBACK");
    }

    // 2) O pré-voo recusa a migration com FORCE — sem escrever nada.
    for (const [rotulo, preparar, regex] of [
      [
        "force",
        async (c0) =>
          c0.query("ALTER TABLE public.profiles FORCE ROW LEVEL SECURITY"),
        /B1_BASELINE_DIVERGENT: public\.profiles precisa de RLS ligada e SEM FORCE/,
      ],
      [
        "dono-diferente",
        async (c0) => {
          await c0.query("CREATE ROLE dono_estranho_perfis NOLOGIN");
          await c0.query(
            "GRANT CREATE ON SCHEMA public TO dono_estranho_perfis",
          );
          await c0.query(
            "ALTER FUNCTION public.rls_admin_atual() OWNER TO dono_estranho_perfis",
          );
        },
        /B1_BASELINE_DIVERGENT: is_admin_atual\(\) e rls_admin_atual\(\) precisam ter o MESMO dono/,
      ],
    ]) {
      await c.query("BEGIN");
      try {
        await c.query(rollback());
        await preparar(c);
        const antes = await digital(c);
        await c.query("SAVEPOINT aplicar");
        await assert.rejects(c.query(migration()), regex, rotulo);
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
  },
});

// ---------------------------------------------------------------------------
// (d) corpo vivo, rollback, idempotência, preflight
// ---------------------------------------------------------------------------

const TROCADAS = CASOS.flatMap((x) => x.politicas);
const ehPolitica = (k) =>
  k.startsWith("pol public.") && TROCADAS.some((p) => k.endsWith(`.${p}`));

PROVAS.push({
  nome: "(d) o banco nascido das migrations tem as 13 políticas com rls_admin_atual() e SEM is_admin(); o ramo do dono, o comando e os papéis estão onde estavam",
  corpo: async (c) => {
    assert.equal(TROCADAS.length, 13);
    const dig = await digital(c);
    const chaves = Object.keys(dig).filter(ehPolitica);
    assert.equal(chaves.length, 13, "as 13 políticas existem");
    for (const k of chaves) {
      assert.ok(
        dig[k].includes("rls_admin_atual()"),
        `${k}: não usa rls_admin_atual()`,
      );
      assert.ok(!/\bis_admin\(\)/.test(dig[k]), `${k}: ainda usa is_admin()`);
      assert.ok(dig[k].includes("{authenticated}"), `${k}: papéis`);
    }
    for (const k of chaves.filter((x) =>
      /\.(profiles|user_addresses|push_subscriptions|cart_items|notificacoes)\./.test(
        x,
      ),
    )) {
      assert.ok(/auth\.uid\(\)/.test(dig[k]), `${k}: perdeu o ramo da dona`);
    }
    assert.ok(
      dig["pol public.notificacoes.notificacoes_select_policy"].includes(
        "usuario_id IS NULL",
      ),
      "notificacoes_select_policy perdeu o recado para todas",
    );
  },
});

PROVAS.push({
  nome: "(d) reaplicar a migration por cima de si mesma (2x) não muda a impressão digital",
  corpo: async (c) => {
    const antes = await digital(c);
    await c.query("BEGIN");
    try {
      await c.query(migration());
      await c.query(migration());
      assert.deepEqual(await digital(c), antes, "reaplicar mudou alguma coisa");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(d) rollback-manual: volta SÓ as 13 (só a porta muda — o resto do texto é idêntico); 2o rollback recusa sem escrever; reaplicar volta ao estado da migration; nada mais mexe",
  corpo: async (c) => {
    const com = await digital(c);
    await c.query("BEGIN");
    try {
      await c.query(rollback());
      const sem = await digital(c);
      assert.deepEqual(
        Object.keys(sem).sort(),
        Object.keys(com).sort(),
        "o rollback criou ou apagou objeto",
      );
      const mudou = Object.keys(sem)
        .filter((k) => com[k] !== sem[k])
        .sort();
      const esperadas = Object.keys(sem).filter(ehPolitica).sort();
      assert.equal(esperadas.length, 13);
      assert.deepEqual(
        mudou,
        esperadas,
        "o rollback mudou algo além das 13 políticas",
      );
      for (const k of esperadas) {
        assert.ok(
          !sem[k].includes("rls_admin_atual"),
          `${k}: o rollback deixou a porta nova`,
        );
        assert.ok(
          /is_admin\(\)/.test(sem[k]),
          `${k}: o rollback não voltou a is_admin()`,
        );
        assert.equal(
          sem[k]
            .split("( SELECT public.is_admin() AS is_admin)")
            .join("( SELECT public.rls_admin_atual() AS rls_admin_atual)"),
          com[k],
          `${k}: o rollback mudou mais que a porta de admin`,
        );
      }
      await c.query("SAVEPOINT segundo");
      await assert.rejects(c.query(rollback()), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT segundo");
      assert.deepEqual(await digital(c), sem, "o 2o rollback escreveu algo");
      await c.query(migration());
      assert.deepEqual(
        await digital(c),
        com,
        "reaplicar depois do rollback divergiu",
      );
      await c.query(migration());
      assert.deepEqual(await digital(c), com, "reaplicar 2x divergiu");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(d) preflight: política divergente (expressão, comando, papel, ausente) ou função divergente -> B1_BASELINE_DIVERGENT sem NENHUMA escrita; rollback sobre estado divergente idem",
  corpo: async (c) => {
    const alvo = "push_notifications_log_admin_all_policy";
    const tab = "public.push_notifications_log";
    const divergir = {
      expressao: (c0) =>
        c0.query(
          `ALTER POLICY ${alvo} ON ${tab} USING ((SELECT public.is_admin()) AND true)`,
        ),
      comando: async (c0) => {
        await c0.query(`DROP POLICY ${alvo} ON ${tab}`);
        await c0.query(
          `CREATE POLICY ${alvo} ON ${tab} FOR SELECT TO authenticated USING ((SELECT public.is_admin()))`,
        );
      },
      papel: async (c0) => {
        await c0.query(`DROP POLICY ${alvo} ON ${tab}`);
        await c0.query(
          `CREATE POLICY ${alvo} ON ${tab} TO anon USING ((SELECT public.is_admin())) WITH CHECK ((SELECT public.is_admin()))`,
        );
      },
      ausente: (c0) => c0.query(`DROP POLICY ${alvo} ON ${tab}`),
      atualDiferente: async (c0) => {
        const def = (
          await c0.query(
            "SELECT pg_get_functiondef(to_regprocedure('public.rls_admin_atual()')) AS d",
          )
        ).rows[0].d;
        const d = def.replace(
          "a MESMA regra das RPCs",
          "a MESMA regra das RPCs (divergente)",
        );
        assert.notEqual(d, def, "o texto do corpo de rls_admin_atual mudou");
        await c0.query(d);
      },
      isAdminDiferente: async (c0) => {
        const def = (
          await c0.query(
            "SELECT pg_get_functiondef(to_regprocedure('public.is_admin()')) AS d",
          )
        ).rows[0].d;
        const d = def.replace(
          "-- 1º tentar ler dos claims do JWT (mais rápido)",
          "-- (divergente)",
        );
        assert.notEqual(d, def, "o texto do corpo de is_admin mudou");
        await c0.query(d);
      },
    };
    const regex = {
      expressao: new RegExp(`B1_BASELINE_DIVERGENT: politica ${alvo}`),
      comando: new RegExp(`B1_BASELINE_DIVERGENT: politica ${alvo}`),
      papel: new RegExp(`B1_BASELINE_DIVERGENT: politica ${alvo}`),
      ausente: new RegExp(`B1_BASELINE_DIVERGENT: politica ${alvo}`),
      atualDiferente: /B1_BASELINE_DIVERGENT: public\.rls_admin_atual\(\)/,
      isAdminDiferente: /B1_BASELINE_DIVERGENT: public\.is_admin\(\)/,
    };
    for (const rotulo of Object.keys(divergir)) {
      await c.query("BEGIN");
      try {
        // Volta ao estado de antes da migration e diverge UMA peça.
        await c.query(rollback());
        await divergir[rotulo](c);
        const antes = await digital(c);
        await c.query("SAVEPOINT aplicar");
        await assert.rejects(c.query(migration()), regex[rotulo], rotulo);
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
    // Rollback por cima de estado divergente (política mexida ou ausente): recusa sem escrever.
    for (const rotulo of ["mexida", "ausente"]) {
      await c.query("BEGIN");
      try {
        if (rotulo === "mexida") {
          await c.query(
            `ALTER POLICY ${alvo} ON ${tab} USING ((SELECT public.rls_admin_atual()) AND true)`,
          );
        } else {
          await c.query(`DROP POLICY ${alvo} ON ${tab}`);
        }
        const antes = await digital(c);
        await c.query("SAVEPOINT reverter");
        await assert.rejects(
          c.query(rollback()),
          /B1_BASELINE_DIVERGENT/,
          rotulo,
        );
        await c.query("ROLLBACK TO SAVEPOINT reverter");
        assert.deepEqual(
          await digital(c),
          antes,
          `rollback recusado (${rotulo}) escreveu algo`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    }
  },
});

PROVAS.push({
  nome: "(f) a consulta de papel contraditório do cabeçalho acha EXATAMENTE os dois rebaixados da fixture",
  corpo: async (c) => {
    const cab = migration();
    assert.ok(
      cab.includes("IS DISTINCT FROM COALESCE(p.role = 'admin', false)"),
      "a consulta sumiu do cabeçalho",
    );
    const r = await c.query(`
      SELECT u.id::text FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
       WHERE COALESCE(u.raw_app_meta_data ->> 'role' = 'admin', false)
             IS DISTINCT FROM COALESCE(p.role = 'admin', false)
         AND u.id::text LIKE 'b3400000-%' ORDER BY 1`);
    assert.deepEqual(
      r.rows.map((x) => x.id),
      [U_REB_PERFIL, U_REB_AUTH],
    );
  },
});

// ---------------------------------------------------------------------------
// (g) as consultas de publicação 64a (DEPOIS) e 64b (ANTES)
// ---------------------------------------------------------------------------

const A64 = "64a-conferir-politicas-de-perfil-e-endereco-aplicado";
const B64 = "64b-antes-politicas-de-perfil-e-endereco-is-admin";
const L_POLITICAS_A =
  "perfil, endereco e notificacoes: 13 politicas com a porta do admin atual";
const L_POLITICAS_B =
  "perfil, endereco e notificacoes: 13 politicas com a porta is_admin de antes";
const L_PORTAS = "portas do admin atual: corpos, dono e EXECUTE";
const L_TABELAS = "tabelas das 13 politicas: RLS ligada e sem FORCE";
const sql64 = (nome) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
  fs.readFileSync(
    path.join(
      __dirname,
      "..",
      "..",
      "scripts",
      "publicacao",
      "consultas",
      `${nome}.sql`,
    ),
    "utf8",
  );

/** Roda uma consulta de publicação como `authenticated`, numa transação SOMENTE LEITURA (o que o leitor da loja faz). */
async function rodar64(c, nome) {
  await c.query("SAVEPOINT leitura64");
  try {
    await c.query("SET LOCAL ROLE authenticated");
    await c.query("SET LOCAL transaction_read_only = on");
    const r = await c.query(sql64(nome));
    assert.deepEqual(
      r.fields.map((x) => x.name),
      ["item", "esperado", "vivo", "ok"],
    );
    return r.rows;
  } finally {
    await c.query("RESET ROLE");
    // O ROLLBACK TO desfaz o SET LOCAL (papel e somente-leitura voltam ao que eram antes do savepoint).
    await c.query("ROLLBACK TO SAVEPOINT leitura64");
  }
}
const reprovadas64 = (linhas) =>
  linhas
    .filter((l) => l.ok !== true)
    .map((l) => l.item)
    .sort();
const veredito64 = (nome, linhas) =>
  CONF.veredictoDaConsulta({
    consulta: nome,
    ref: "abcdefghijklmnopqrst",
    sha: "0".repeat(40),
    linhas,
  });

PROVAS.push({
  nome: "(g) consultas 64a/64b: rol fechado de 4 linhas nos dois estados; DEPOIS => 64a positiva e 64b reprova SÓ a linha das políticas; ANTES (rollback) => o inverso; só catálogo, lida por authenticated em transação somente leitura",
  corpo: async (c) => {
    for (const nome of [A64, B64]) {
      const rol = CONF.ROL_FECHADO_POR_CONSULTA[nome];
      assert.equal(rol.length, 4, nome);
      const sql = sql64(nome);
      // Só catálogo: nenhuma tabela de dados no FROM/JOIN.
      // (`IS NOT DISTINCT FROM a.qual` é comparação, não fonte de linhas.)
      for (const m of sql.matchAll(
        /(?<!DISTINCT\s+)\b(?:FROM|JOIN)\s+([a-z_][\w.]*)/gi,
      )) {
        const alvo = m[1].toLowerCase();
        assert.ok(
          [
            "pg_class",
            "pg_policy",
            "pg_proc",
            "pg_roles",
            "alvo",
            "politicas",
            "itens",
            "aclexplode",
          ].includes(alvo),
          `${nome}: lê de ${alvo}, que não é catálogo nem CTE`,
        );
      }
    }
    await c.query("BEGIN");
    try {
      const a = await rodar64(c, A64);
      const b = await rodar64(c, B64);
      assert.deepEqual(
        a.map((l) => l.item).sort(),
        [...CONF.ROL_FECHADO_POR_CONSULTA[A64]].sort(),
      );
      assert.deepEqual(
        b.map((l) => l.item).sort(),
        [...CONF.ROL_FECHADO_POR_CONSULTA[B64]].sort(),
      );
      assert.deepEqual(reprovadas64(a), [], "64a toda ok no DEPOIS");
      assert.deepEqual(
        reprovadas64(b),
        [L_POLITICAS_B],
        "64b reprova SÓ a linha das políticas no DEPOIS",
      );
      assert.match(
        veredito64(A64, a),
        / linhas=4 ok_false=0 ok_nao_booleano=0 rol=ok$/,
      );
      assert.match(
        veredito64(B64, b),
        / linhas=4 ok_false=1 ok_nao_booleano=0 rol=ok$/,
      );
      assert.match(veredito64(A64, a.slice(1)), / rol=invalido$/);

      // ANTES: o rollback devolve as 13 expressões de antes.
      await c.query(rollback());
      const a2 = await rodar64(c, A64);
      const b2 = await rodar64(c, B64);
      assert.deepEqual(reprovadas64(b2), [], "64b toda ok no ANTES");
      assert.deepEqual(
        reprovadas64(a2),
        [L_POLITICAS_A],
        "64a reprova SÓ a linha das políticas no ANTES",
      );
      assert.match(
        veredito64(A64, a2),
        / linhas=4 ok_false=1 ok_nao_booleano=0 rol=ok$/,
      );
      // E de volta: a migration por cima.
      await c.query(migration());
      assert.deepEqual(reprovadas64(await rodar64(c, A64)), []);
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

PROVAS.push({
  nome: "(g) consultas 64a/64b, NEGATIVOS: cada defeito reprova SÓ a sua linha (política sem a porta, papel errado, política ausente, corpo da função, EXECUTE, FORCE, RLS desligada)",
  corpo: async (c) => {
    const casos = [
      {
        rotulo: "política sem o ramo do admin",
        sql: "ALTER POLICY cart_items_delete_policy ON public.cart_items USING ((( SELECT auth.uid() AS uid) = user_id))",
        a: [L_POLITICAS_A],
      },
      {
        rotulo: "política de analytics aberta ao anon",
        sql: "ALTER POLICY analytics_events_select_policy ON public.analytics_events TO anon, authenticated",
        a: [L_POLITICAS_A],
      },
      {
        rotulo: "a porta antiga (is_admin) de volta numa só política",
        sql: alterAntigo("profiles_update_policy"),
        a: [L_POLITICAS_A],
      },
      {
        rotulo: "política ausente",
        sql: "DROP POLICY notificacoes_delete_policy ON public.notificacoes",
        a: [L_POLITICAS_A],
      },
      {
        rotulo: "corpo de rls_admin_atual diferente",
        sql: `CREATE OR REPLACE FUNCTION public.rls_admin_atual() RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path TO 'public' AS $x$ SELECT true $x$`,
        a: [L_PORTAS],
      },
      {
        rotulo: "authenticated sem EXECUTE em rls_admin_atual",
        sql: "REVOKE EXECUTE ON FUNCTION public.rls_admin_atual() FROM authenticated",
        a: [L_PORTAS],
      },
      {
        rotulo: "FORCE ROW LEVEL SECURITY numa das tabelas",
        sql: "ALTER TABLE public.user_addresses FORCE ROW LEVEL SECURITY",
        a: [L_TABELAS],
      },
      {
        rotulo: "RLS desligada numa das tabelas",
        sql: "ALTER TABLE public.push_subscriptions DISABLE ROW LEVEL SECURITY",
        a: [L_TABELAS],
      },
    ];
    for (const { rotulo, sql, a } of casos) {
      await c.query("BEGIN");
      try {
        await c.query(sql);
        assert.deepEqual(
          reprovadas64(await rodar64(c, A64)),
          a,
          `64a: ${rotulo}`,
        );
      } finally {
        await c.query("ROLLBACK");
      }
    }
    // No estado de ANTES, o espelho: uma política com a porta nova reprova SÓ a linha das políticas da 64b.
    await c.query("BEGIN");
    try {
      await c.query(rollback());
      await c.query(
        "ALTER POLICY profiles_select_policy ON public.profiles USING ((((SELECT auth.uid()) = id) OR (SELECT public.rls_admin_atual())))",
      );
      assert.deepEqual(
        reprovadas64(await rodar64(c, B64)),
        [L_POLITICAS_B],
        "64b: uma política já trocada",
      );
      await c.query("ALTER TABLE public.cart_items FORCE ROW LEVEL SECURITY");
      assert.deepEqual(
        reprovadas64(await rodar64(c, B64)),
        [L_POLITICAS_B, L_TABELAS].sort(),
        "64b: FORCE reprova a linha das tabelas também",
      );
    } finally {
      await c.query("ROLLBACK");
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
  const titulo =
    "Prova viva das políticas de perfil/endereço com admin atual (rpc-ci)";
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
        anexarAoSummary(titulo, linhas.join("\n"));
        falhar(
          "FALHOU",
          "Uma regra do admin atual nas políticas de perfil/endereço foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[admin-atual-perfis] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    titulo,
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
