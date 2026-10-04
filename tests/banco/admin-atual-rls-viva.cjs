"use strict";
/* eslint-disable security/detect-object-injection, security/detect-non-literal-regexp --
 * Toda chave indexada aqui vem de constante do próprio teste (QUEM, CASOS,
 * POLITICAS, nomes de política) ou do catálogo do Postgres efêmero; nunca de entrada de rede
 * nem de payload de terceiro. */

/**
 * PROVA VIVA da migration
 * 20261202000000_as_politicas_do_pedido_e_do_financeiro_exigem_o_admin_atual.sql
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * O DEFEITO (inventário de RLS da revisão da 20261200000000, 04/10/2026):
 *   14 políticas de RLS do pedido, da devolução e do financeiro ainda
 *   decidiam o admin por `is_admin()` (JWT, vale ~1 h depois do
 *   rebaixamento). O ex-admin lia e ESCREVIA direto nas tabelas pelo
 *   PostgREST, por cima das RPCs que a 97, a 99 e a 200 já fecharam.
 *
 * O QUE SE PROVA, para CADA uma das 14 políticas (por tabela e operação):
 *   (a) ex-admin rebaixado só no profiles e ex-admin rebaixado só no
 *       auth.users (JWT ainda dizendo admin) LEEM 0 linhas e NÃO escrevem
 *       (UPDATE/DELETE afetam 0 linhas; INSERT recusa com 42501 da RLS);
 *       CONTROLE: com a política ANTIGA (rollback dentro da transação) os
 *       dois leem a linha e escrevem — é a política, e não outra coisa,
 *       que barra;
 *   (b) admin de verdade (admin nas duas fontes) lê e escreve como antes;
 *   (c) o DONO continua lendo o que é dele (e, nas duas políticas ALL, mexendo
 *       no que é dele, como antes) e um TERCEIRO não lê nem escreve;
 *   anon em mkt_order_payment_history_select (política TO public): nenhuma
 *   linha vaza (recebe o erro 42501 de EXECUTE de rls_admin_atual());
 *   (d) o banco nascido das migrations tem as 14 políticas DESTA migration;
 *       reaplicar por cima (2x) não muda a impressão digital; o
 *       rollback-manual troca SÓ as 14 expressões (o ramo do dono, comando,
 *       papéis e nome iguais), o 2o rollback recusa sem escrever e reaplicar
 *       volta ao estado da migration; o preflight recusa (sem escrever)
 *       política divergente (expressão, comando e papel) e rls_admin_atual()
 *       divergente; o rollback recusa sobre estado divergente.
 *
 * Toda chamada roda numa transação DESFEITA no fim.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/admin-atual-rls-viva.cjs
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

const NOME_MIGRATION =
  "20261202000000_as_politicas_do_pedido_e_do_financeiro_exigem_o_admin_atual.sql";
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

const U_ADMIN = "a9c00000-0000-4000-8000-000000000001";
const U_REB_PERFIL = "a9c00000-0000-4000-8000-000000000002";
const U_REB_AUTH = "a9c00000-0000-4000-8000-000000000003";
const U_TERCEIRO = "a9c00000-0000-4000-8000-000000000004";
const U_DONO = "a9c00000-0000-4000-8000-000000000005";
const P_PROD = "a9caaaaa-0000-4000-8000-000000000001";
const O_PEDIDO = "a9cccccc-0000-4000-8000-000000000001";
const D_DEV = "a9cddddd-0000-4000-8000-000000000001";
const BANCO = "f1000000-0000-4000-8000-000000000002";
const CAT_ALUGUEL = "f2000000-0000-4000-8000-000000000020";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

const QUEM = {
  anon: { papel: "anon", uid: "", jwt: "" },
  terceiro: {
    papel: "authenticated",
    uid: U_TERCEIRO,
    jwt: claims(U_TERCEIRO, null),
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
};

async function entrar(c, quem) {
  const q = QUEM[quem];
  await c.query(`SET LOCAL ROLE ${q.papel}`);
  await c.query(
    "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
    [q.uid, q.jwt],
  );
}

// Roda `passos` ([nome, sql, params]) como `quem` numa transação SEMPRE
// desfeita; cada passo num savepoint (a recusa de um não derruba os outros).
// `preparo`: SQL rodado como dono do banco antes de entrar (o CONTROLE troca
// a política aqui). Devolve { nome: { ok, n, code, message } }.
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
        out[nome] = {
          ok: true,
          n: r.rowCount,
          linha: r.rows[0],
        };
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
  const m = new RegExp(`ALTER POLICY ${politica} ON [^;]+;`).exec(rollback());
  assert.ok(m, `${politica} não está no rollback`);
  return m[0];
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

const fx = {};
const PROVAS = [];

PROVAS.push({
  nome: "(0) fixtures: admin atual, rebaixados nas duas direções, dono, terceiro; pedido com item, histórico, evento de envio e histórico de pagamento; devolução com item e evento; lançamento e caixa do financeiro",
  corpo: async (c) => {
    // Fábrica do Supabase que o provisionar.cjs não emula — só neste CLONE
    // (rodar-isolado.cjs): o INSERT por authenticated precisa do default
    // uuid_generate_v4() (schema extensions) e a RLS lê auth.users.
    await c.query(
      "GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role",
    );
    await c.query(
      "GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role",
    );
    for (const id of [U_ADMIN, U_REB_PERFIL, U_REB_AUTH, U_TERCEIRO, U_DONO]) {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@rls.teste', '{}'::jsonb)`,
        [id],
      );
    }
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Admin Atual', 'admin'), ($2, 'Rebaixado Perfil', 'customer'),
         ($3, 'Rebaixado Auth', 'admin'), ($4, 'Terceiro', 'customer'),
         ($5, 'Dono do Pedido', 'customer')`,
      [U_ADMIN, U_REB_PERFIL, U_REB_AUTH, U_TERCEIRO, U_DONO],
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
        WHERE u.id::text LIKE 'a9c00000-%' ORDER BY u.id`,
    );
    assert.deepEqual(
      r.rows.map((l) => [l.id, l.auth_role, l.perfil_role]),
      [
        [U_ADMIN, "admin", "admin"],
        [U_REB_PERFIL, "admin", "customer"],
        [U_REB_AUTH, "customer", "admin"],
        [U_TERCEIRO, "customer", "customer"],
        [U_DONO, "customer", "customer"],
      ],
    );
    await c.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
       VALUES ($1, 'Produto RLS', 100, 1000, true, 40)`,
      [P_PROD],
    );
    await c.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
          payment_method, payment_status, paid_at, cancelled_after_shipping)
       VALUES ($1, $2, 'Cliente RLS', '{}'::jsonb, 100, 100, 'delivered', 'online',
               'pix', 'pago', now(), false)`,
      [O_PEDIDO, U_DONO],
    );
    fx.item = (
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, 'Item RLS', 1, 100) RETURNING id`,
        [O_PEDIDO, P_PROD],
      )
    ).rows[0].id;
    // Um 2o item, sem devolução atrelada: o DELETE do teste não esbarra na FK.
    fx.item2 = (
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, 'Item RLS 2', 1, 100) RETURNING id`,
        [O_PEDIDO, P_PROD],
      )
    ).rows[0].id;
    fx.historico = (
      await c.query(
        `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes)
         VALUES ($1, 'processing', 'delivered', 'Nota RLS') RETURNING id`,
        [O_PEDIDO],
      )
    ).rows[0].id;
    fx.envio = (
      await c.query(
        `INSERT INTO public.order_shipping_events (order_id, event_type, tracking_code)
         VALUES ($1, 'rastreio_consultado', 'RASTREIO-RLS') RETURNING id`,
        [O_PEDIDO],
      )
    ).rows[0].id;
    fx.pagamento = (
      await c.query(
        `INSERT INTO public.marketplace_order_payment_history (order_id, acao, payment_status_antes, payment_status_depois)
         VALUES ($1, 'recebido', NULL, 'recebido_na_entrega') RETURNING id`,
        [O_PEDIDO],
      )
    ).rows[0].id;
    await c.query(
      `INSERT INTO public.devolucoes
         (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade,
          metodo_retorno, status, valor_itens, prazo_ate, politica)
       VALUES ($1, 'DEV-RLS-1', $2, $3, 'arrependimento', 'desisti', 'troca', 'local',
               'entrega_na_loja', 'solicitada', 100, current_date + 7, '{}'::jsonb)`,
      [D_DEV, O_PEDIDO, U_DONO],
    );
    fx.devItem = (
      await c.query(
        `INSERT INTO public.devolucao_itens
           (devolucao_id, order_item_id, product_id, product_name, quantidade, valor_unitario)
         VALUES ($1, $2, $3, 'Item RLS', 1, 100) RETURNING id`,
        [D_DEV, fx.item, P_PROD],
      )
    ).rows[0].id;
    fx.devEvento = (
      await c.query(
        `INSERT INTO public.devolucao_eventos (devolucao_id, de_status, para_status, ator, nota)
         VALUES ($1, NULL, 'solicitada', 'cliente', 'Evento RLS') RETURNING id`,
        [D_DEV],
      )
    ).rows[0].id;
    // Financeiro: contas e categorias semeadas pela 20261177 (BANCO,
    // CAT_ALUGUEL); lançamento e caixa pelo caminho das RPCs (automação de
    // confiança), como o financeiro-viva e a prova das portas.
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE service_role");
    const lanc = await c.query(
      "SELECT public.fin_lancamento_salvar($1::jsonb) AS r",
      [
        JSON.stringify({
          tipo: "saida",
          valor: 10,
          conta_id: BANCO,
          categoria_id: CAT_ALUGUEL,
          descricao: "Previsto RLS",
          status: "previsto",
          data_vencimento: new Date().toISOString().slice(0, 10),
        }),
      ],
    );
    await c.query("SELECT public.fin_caixa_abrir(0)");
    await c.query("COMMIT");
    fx.lancamento = lanc.rows[0].r.ids[0];
    fx.sessao = (
      await c.query("SELECT id FROM public.fin_caixa_sessoes LIMIT 1")
    ).rows[0].id;
    assert.ok(fx.lancamento && fx.sessao);
  },
});

// ---------------------------------------------------------------------------
// (a)(b)(c) comportamento, para cada tabela e operação
// ---------------------------------------------------------------------------

// `politicas`: as políticas que o caso exercita (o CONTROLE desfaz todas).
// `ler`: SELECT de contagem da linha da fixture. `escritas`: passos de
// escrita (nome -> SQL); update/delete devolvem rowCount, insert devolve o
// erro de RLS. `dono`: o dono vê a linha. `donoEscreve`: o dono também
// escreve (as duas ALL). `escritaAdmin`: o que o admin consegue.
const CASOS = [
  {
    nome: "marketplace_order_items (order_items_all_policy, ALL)",
    politicas: ["order_items_all_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.marketplace_order_items WHERE id = $1",
      [fx.item2],
    ],
    escritas: () => ({
      update: [
        "UPDATE public.marketplace_order_items SET product_name = 'X' WHERE id = $1",
        [fx.item2],
      ],
      delete: [
        "DELETE FROM public.marketplace_order_items WHERE id = $1",
        [fx.item2],
      ],
      insert: [
        "INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, $2, 'Novo', 1, 1)",
        [O_PEDIDO, P_PROD],
      ],
    }),
    dono: true,
    donoEscreve: true,
  },
  {
    nome: "marketplace_order_history (order_history_all_policy, ALL)",
    politicas: ["order_history_all_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.marketplace_order_history WHERE id = $1",
      [fx.historico],
    ],
    escritas: () => ({
      update: [
        "UPDATE public.marketplace_order_history SET notes = 'X' WHERE id = $1",
        [fx.historico],
      ],
      delete: [
        "DELETE FROM public.marketplace_order_history WHERE id = $1",
        [fx.historico],
      ],
      insert: [
        "INSERT INTO public.marketplace_order_history (order_id, new_status) VALUES ($1, 'x')",
        [O_PEDIDO],
      ],
    }),
    dono: true,
    donoEscreve: true,
  },
  {
    nome: "order_shipping_events (select, insert, update e delete)",
    politicas: [
      "order_shipping_events_select_policy",
      "order_shipping_events_admin_insert_policy",
      "order_shipping_events_admin_update_policy",
      "order_shipping_events_admin_delete_policy",
    ],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.order_shipping_events WHERE id = $1",
      [fx.envio],
    ],
    escritas: () => ({
      update: [
        "UPDATE public.order_shipping_events SET tracking_code = 'X' WHERE id = $1",
        [fx.envio],
      ],
      delete: [
        "DELETE FROM public.order_shipping_events WHERE id = $1",
        [fx.envio],
      ],
      insert: [
        "INSERT INTO public.order_shipping_events (order_id, event_type) VALUES ($1, 'erro')",
        [O_PEDIDO],
      ],
    }),
    dono: true,
    donoEscreve: false,
  },
  {
    nome: "marketplace_order_payment_history (mkt_order_payment_history_select, public)",
    politicas: ["mkt_order_payment_history_select"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.marketplace_order_payment_history WHERE id = $1",
      [fx.pagamento],
    ],
    dono: false,
    anon: true,
  },
  {
    nome: "devolucoes (devolucoes_dono_ou_admin_select_policy)",
    politicas: ["devolucoes_dono_ou_admin_select_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.devolucoes WHERE id = $1",
      [D_DEV],
    ],
    dono: true,
  },
  {
    nome: "devolucao_itens (devolucao_itens_dono_ou_admin_select_policy)",
    politicas: ["devolucao_itens_dono_ou_admin_select_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.devolucao_itens WHERE id = $1",
      [fx.devItem],
    ],
    dono: true,
  },
  {
    nome: "devolucao_eventos (devolucao_eventos_dono_ou_admin_select_policy)",
    politicas: ["devolucao_eventos_dono_ou_admin_select_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.devolucao_eventos WHERE id = $1",
      [fx.devEvento],
    ],
    dono: true,
  },
  {
    nome: "fin_contas (fin_contas_admin_select_policy)",
    politicas: ["fin_contas_admin_select_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.fin_contas WHERE id = $1",
      [BANCO],
    ],
    dono: false,
  },
  {
    nome: "fin_categorias (fin_categorias_admin_select_policy)",
    politicas: ["fin_categorias_admin_select_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.fin_categorias WHERE id = $1",
      [CAT_ALUGUEL],
    ],
    dono: false,
  },
  {
    nome: "fin_caixa_sessoes (fin_caixa_sessoes_admin_select_policy)",
    politicas: ["fin_caixa_sessoes_admin_select_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.fin_caixa_sessoes WHERE id = $1",
      [fx.sessao],
    ],
    dono: false,
  },
  {
    nome: "fin_lancamentos (fin_lancamentos_admin_select_policy)",
    politicas: ["fin_lancamentos_admin_select_policy"],
    ler: () => [
      "SELECT count(*)::int AS n FROM public.fin_lancamentos WHERE id = $1",
      [fx.lancamento],
    ],
    dono: false,
  },
];

const RLS_INSERT = /new row violates row-level security policy/;

for (const caso of CASOS) {
  PROVAS.push({
    nome: `(a)(b)(c) ${caso.nome}: ex-admin (JWT velho) lê 0 e não escreve; admin atual como antes; dono e terceiro; CONTROLE com a política antiga`,
    corpo: async (c) => {
      const [sqlLer, parLer] = caso.ler();
      const escritas = caso.escritas ? caso.escritas() : {};
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

      // (c) o dono vê o que é dele (e, nas duas ALL, mexe, como antes); o
      //     terceiro não vê nem mexe.
      const dono = await como(c, "dono", passos);
      assert.equal(dono.ler.ok, true);
      assert.equal(
        lido(dono),
        caso.dono ? 1 : 0,
        `${caso.nome}: o dono ${caso.dono ? "perdeu o que é dele" : "passou a ver o que não é dele"}`,
      );
      for (const op of ["update", "delete"]) {
        if (escritas[op])
          assert.equal(
            dono[op].n,
            caso.donoEscreve ? 1 : 0,
            `${caso.nome}: dono ${op} mudou`,
          );
      }
      if (escritas.insert)
        assert.equal(
          dono.insert.ok,
          Boolean(caso.donoEscreve),
          `${caso.nome}: dono insert mudou`,
        );
      const terc = await como(c, "terceiro", passos);
      assert.equal(lido(terc), 0, `${caso.nome}: o terceiro LEU`);
      for (const op of ["update", "delete"]) {
        if (escritas[op])
          assert.equal(
            terc[op].n,
            0,
            `${caso.nome}: o terceiro ESCREVEU (${op})`,
          );
      }
      if (escritas.insert)
        assert.equal(terc.insert.ok, false, `${caso.nome}: o terceiro INSERIU`);

      // anon (só a política TO public): nenhuma linha vaza.
      if (caso.anon) {
        const a = await como(c, "anon", [["ler", sqlLer, parLer]]);
        assert.equal(a.ler.ok, false, `${caso.nome}: anon não recebeu erro`);
        assert.equal(a.ler.code, "42501");
        assert.match(a.ler.message, /rls_admin_atual/);
        // Antes (política antiga) o anon recebia 0 linhas, sem erro.
        const antes = await como(c, "anon", [["ler", sqlLer, parLer]], {
          preparo: caso.politicas.map(alterAntigo),
        });
        assert.equal(antes.ler.ok, true);
        assert.equal(lido(antes), 0);
      }
    },
  });
}

// ---------------------------------------------------------------------------
// (d) corpo vivo, rollback, idempotência, preflight
// ---------------------------------------------------------------------------

const POLITICAS = CASOS.flatMap((x) => x.politicas);

PROVAS.push({
  nome: "(d) o banco nascido das migrations tem as 14 políticas DESTA migration (rls_admin_atual no lugar de is_admin; dono, comando, papéis e nome iguais)",
  corpo: async (c) => {
    assert.equal(POLITICAS.length, 14);
    const dig = await digital(c);
    const chaves = Object.keys(dig).filter(
      (k) =>
        k.startsWith("pol public.") &&
        POLITICAS.some((p) => k.endsWith(`.${p}`)),
    );
    assert.equal(chaves.length, 14, "as 14 políticas existem");
    for (const k of chaves) {
      assert.ok(
        dig[k].includes("rls_admin_atual()"),
        `${k}: não usa rls_admin_atual()`,
      );
      assert.ok(
        !/\bis_admin\(\)/.test(dig[k].replace(/rls_admin_atual\(\)/g, "")),
        `${k}: ainda usa is_admin()`,
      );
    }
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
  nome: "(d) rollback-manual: SÓ as 14 políticas mudam, e só a porta (o resto da expressão, comando, papéis e nome iguais); 2o rollback recusa sem escrever; reaplicar volta ao estado da migration",
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
      const mudou = Object.keys(com)
        .filter((k) => com[k] !== sem[k])
        .sort();
      const esperadas = Object.keys(com)
        .filter(
          (k) =>
            k.startsWith("pol public.") &&
            POLITICAS.some((p) => k.endsWith(`.${p}`)),
        )
        .sort();
      assert.equal(esperadas.length, 14);
      assert.deepEqual(
        mudou,
        esperadas,
        "o rollback mudou algo além das 14 políticas",
      );
      const NOVO = "( SELECT public.rls_admin_atual() AS rls_admin_atual)";
      for (const k of esperadas) {
        assert.ok(
          !sem[k].includes("rls_admin_atual"),
          `${k}: o rollback deixou a porta nova`,
        );
        assert.ok(
          /is_admin\(\)/.test(sem[k]),
          `${k}: o rollback não voltou a is_admin()`,
        );
        // Só a porta muda: trocando-a de volta no estado antigo sai o estado novo.
        const velho = k.endsWith(".mkt_order_payment_history_select")
          ? "public.is_admin()"
          : "( SELECT public.is_admin() AS is_admin)";
        assert.equal(
          sem[k].split(velho).join(NOVO),
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
  nome: "(d) preflight: política divergente (expressão, comando, papel) ou rls_admin_atual() divergente -> B1_BASELINE_DIVERGENT sem NENHUMA escrita; rollback sobre estado divergente idem",
  corpo: async (c) => {
    const alvo = "fin_lancamentos_admin_select_policy";
    const divergir = {
      expressao: (c0) =>
        c0.query(
          `ALTER POLICY ${alvo} ON public.fin_lancamentos USING ((SELECT public.is_admin()) AND true)`,
        ),
      comando: async (c0) => {
        await c0.query(`DROP POLICY ${alvo} ON public.fin_lancamentos`);
        await c0.query(
          `CREATE POLICY ${alvo} ON public.fin_lancamentos FOR ALL TO authenticated USING ((SELECT public.is_admin()))`,
        );
      },
      papel: async (c0) => {
        await c0.query(`DROP POLICY ${alvo} ON public.fin_lancamentos`);
        await c0.query(
          `CREATE POLICY ${alvo} ON public.fin_lancamentos FOR SELECT TO anon USING ((SELECT public.is_admin()))`,
        );
      },
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
    };
    const regex = {
      expressao: new RegExp(`B1_BASELINE_DIVERGENT: política ${alvo}`),
      comando: new RegExp(`B1_BASELINE_DIVERGENT: política ${alvo}`),
      papel: new RegExp(`B1_BASELINE_DIVERGENT: política ${alvo}`),
      atualDiferente: /B1_BASELINE_DIVERGENT: public\.rls_admin_atual\(\)/,
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
    // Rollback por cima de estado divergente (política mexida, ou ausente):
    // recusa sem escrever.
    for (const rotulo of ["mexida", "ausente"]) {
      await c.query("BEGIN");
      try {
        if (rotulo === "mexida") {
          await c.query(
            `ALTER POLICY ${alvo} ON public.fin_lancamentos USING ((SELECT public.rls_admin_atual()) AND true)`,
          );
        } else {
          await c.query(`DROP POLICY ${alvo} ON public.fin_lancamentos`);
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

async function main() {
  const url = lerDatabaseUrlEfemera();
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  const linhas = [];
  const titulo = "Prova viva das políticas de RLS com admin atual (rpc-ci)";
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
          "Uma regra do admin atual nas políticas de RLS foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[admin-atual-rls] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    titulo,
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
