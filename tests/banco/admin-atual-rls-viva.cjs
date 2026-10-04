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
 *   E o COMPRADOR, dono do pedido, também escrevia: itens e histórico tinham
 *   uma política ALL com o ramo "o pedido é meu" (insere item, troca
 *   produto/variação/quantidade/preço, apaga item, forja evento "pago").
 *
 * O QUE SE PROVA, para CADA uma das 14 políticas (por tabela e operação):
 *   (a) ex-admin rebaixado só no profiles e ex-admin rebaixado só no
 *       auth.users (JWT ainda dizendo admin) LEEM 0 linhas e NÃO escrevem
 *       (UPDATE/DELETE afetam 0 linhas; INSERT recusa com 42501 da RLS);
 *       CONTROLE: com a política ANTIGA (rollback dentro da transação) os
 *       dois leem a linha e escrevem — é a política, e não outra coisa,
 *       que barra;
 *   (b) admin de verdade (admin nas duas fontes) lê e escreve como antes;
 *   (c) o DONO continua lendo o que é dele e um TERCEIRO não lê nem escreve;
 *   (e) o DONO, em pedido PAGO e em PENDENTE com cobrança em curso, direto pela
 *       RLS, NÃO insere/altera/apaga item nem insere/altera/apaga evento do
 *       histórico (42501 ou 0 linhas, retrato antes = depois); CONTROLE com as
 *       ALL antigas: as mesmas tentativas passam e o retrato muda;
 *   anon em mkt_order_payment_history_select (política TO public): nenhuma
 *   linha vaza (recebe o erro 42501 de EXECUTE de rls_admin_atual());
 *   (d) o banco nascido das migrations tem as 16 políticas DESTA migration
 *       (14 trocadas + 2 de SELECT criadas);
 *       reaplicar por cima (2x) não muda a impressão digital; o
 *       rollback-manual apaga as 2 de SELECT e volta as 14 (nas 12 só-porta,
 *       só a porta muda; comando, papéis e nome iguais), o 2o rollback recusa sem escrever e reaplicar
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
const P_PROD2 = "a9caaaaa-0000-4000-8000-000000000002";
const V_VAR = "a9cbbbbb-0000-4000-8000-000000000001";
const O_PEDIDO = "a9cccccc-0000-4000-8000-000000000001";
const O_PENDENTE = "a9cccccc-0000-4000-8000-000000000002";
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
      `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
       VALUES ($1, 'Produto RLS 2', 50, 1000, true, 20)`,
      [P_PROD2],
    );
    await c.query(
      `INSERT INTO public.product_variants (id, product_id, name, value)
       VALUES ($1, $2, 'Cor', 'Azul')`,
      [V_VAR, P_PROD2],
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
    // Pedido PENDENTE com cobrança em curso (PIX gerado, aguardando): o dono
    // também não pode alterar/forjar itens e histórico dele.
    await c.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
          payment_method, payment_status, gateway_payment_id, expires_at)
       VALUES ($1, $2, 'Cliente RLS', '{}'::jsonb, 100, 100, 'pending', 'online',
               'pix', 'aguardando', 'ORD-RLS-PEND', now() + interval '30 minutes')`,
      [O_PENDENTE, U_DONO],
    );
    fx.pItem = (
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, 'Item pendente', 1, 100) RETURNING id`,
        [O_PENDENTE, P_PROD],
      )
    ).rows[0].id;
    fx.pItem2 = (
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, 'Item pendente 2', 1, 100) RETURNING id`,
        [O_PENDENTE, P_PROD],
      )
    ).rows[0].id;
    fx.pHist = (
      await c.query(
        `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes)
         VALUES ($1, NULL, 'pending', 'Pedido criado') RETURNING id`,
        [O_PENDENTE],
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
    donoEscreve: false,
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
    donoEscreve: false,
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
// (e) o DONO do pedido não altera nem forja itens e histórico do que pagou
// ---------------------------------------------------------------------------

// Como `como`, mas tira um RETRATO (como dono do banco, fora da RLS) dos itens
// e do histórico do pedido ANTES e DEPOIS das tentativas: "recusou" só vale se
// a linha ficou como estava.
async function comoComRetrato(c, quem, pedido, passos, { preparo = [] } = {}) {
  await c.query("BEGIN");
  try {
    for (const s of preparo) await c.query(s);
    const retrato = async () =>
      (
        await c.query(
          `SELECT
             (SELECT coalesce(jsonb_agg(to_jsonb(i) ORDER BY i.id), '[]'::jsonb)
                FROM public.marketplace_order_items i WHERE i.order_id = $1) AS itens,
             (SELECT coalesce(jsonb_agg(to_jsonb(h) ORDER BY h.id), '[]'::jsonb)
                FROM public.marketplace_order_history h WHERE h.order_id = $1) AS historico`,
          [pedido],
        )
      ).rows[0];
    const antes = await retrato();
    await entrar(c, quem);
    const out = {};
    for (const [nome, sql, params] of passos) {
      await c.query("SAVEPOINT passo");
      try {
        const r = await c.query(sql, params || []);
        out[nome] = { ok: true, n: r.rowCount };
        await c.query("RELEASE SAVEPOINT passo");
      } catch (e) {
        out[nome] = { ok: false, code: e.code, message: e.message };
        await c.query("ROLLBACK TO SAVEPOINT passo");
      }
    }
    await c.query("RESET ROLE");
    return { out, antes, depois: await retrato() };
  } finally {
    await c.query("ROLLBACK");
  }
}

const PEDIDOS_DO_DONO = () => [
  {
    rotulo: "pedido PAGO",
    id: O_PEDIDO,
    item: fx.item,
    outroItem: fx.item2,
    evento: fx.historico,
  },
  {
    rotulo: "pedido PENDENTE com cobrança em curso (PIX aguardando)",
    id: O_PENDENTE,
    item: fx.pItem,
    outroItem: fx.pItem2,
    evento: fx.pHist,
  },
];

// As tentativas do comprador, direto pela RLS (sem RPC): (a) item novo; (b)
// trocar produto, variação, quantidade e preço; (c) apagar item; (d) forjar
// evento de "pago"/"approved" e mexer/apagar o evento existente.
const TENTATIVAS_DO_DONO = (p) => [
  [
    "a_insere_item",
    "INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price) VALUES ($1, $2, 'Forjado', 1, 1)",
    [p.id, P_PROD],
  ],
  [
    "b_troca_produto",
    "UPDATE public.marketplace_order_items SET product_id = $2 WHERE id = $1",
    [p.item, P_PROD2],
  ],
  [
    "b_troca_variacao",
    "UPDATE public.marketplace_order_items SET variant_id = $2 WHERE id = $1",
    [p.item, V_VAR],
  ],
  [
    "b_troca_quantidade",
    "UPDATE public.marketplace_order_items SET quantity = 9 WHERE id = $1",
    [p.item],
  ],
  [
    "b_troca_preco",
    "UPDATE public.marketplace_order_items SET price = 0.01 WHERE id = $1",
    [p.item],
  ],
  [
    "c_apaga_item",
    "DELETE FROM public.marketplace_order_items WHERE id = $1",
    [p.outroItem],
  ],
  [
    "d_insere_evento_pago",
    "INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes) VALUES ($1, 'pending', 'paid', 'approved')",
    [p.id],
  ],
  [
    "d_insere_evento_approved",
    "INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, notes) VALUES ($1, 'pending', 'approved', 'pagamento approved')",
    [p.id],
  ],
  [
    "d_altera_evento",
    "UPDATE public.marketplace_order_history SET new_status = 'paid', notes = 'approved' WHERE id = $1",
    [p.evento],
  ],
  [
    "d_apaga_evento",
    "DELETE FROM public.marketplace_order_history WHERE id = $1",
    [p.evento],
  ],
];

const INSERTS = [
  "a_insere_item",
  "d_insere_evento_pago",
  "d_insere_evento_approved",
];

PROVAS.push({
  nome: "(e) o DONO, direto pela RLS e em pedido pago e em pendente com cobrança em curso, NÃO insere/altera/apaga item nem insere/altera/apaga evento do histórico (42501 ou 0 linhas, retrato igual); CONTROLE com as ALL antigas: faz tudo; a leitura do dono continua",
  corpo: async (c) => {
    for (const p of PEDIDOS_DO_DONO()) {
      const passos = TENTATIVAS_DO_DONO(p);
      const rot = p.rotulo;
      const r = await comoComRetrato(c, "dono", p.id, passos);
      for (const [nome] of passos) {
        if (INSERTS.includes(nome)) {
          assert.equal(r.out[nome].ok, false, `${rot}: dono ${nome} PASSOU`);
          assert.equal(
            r.out[nome].code,
            "42501",
            `${rot}: ${nome} recusou por outro motivo: ${r.out[nome].message}`,
          );
          assert.match(r.out[nome].message, RLS_INSERT);
        } else {
          assert.equal(
            r.out[nome].ok,
            true,
            `${rot}: ${nome}: ${r.out[nome].message}`,
          );
          assert.equal(r.out[nome].n, 0, `${rot}: dono ${nome} ESCREVEU`);
        }
      }
      assert.deepEqual(
        r.depois,
        r.antes,
        `${rot}: o retrato mudou depois das tentativas do dono`,
      );

      // CONTROLE: com as duas ALL de antes (o dono no ramo de escrita) as
      // MESMAS tentativas passam e o retrato muda — a política é quem barra.
      const ctl = await comoComRetrato(c, "dono", p.id, passos, {
        preparo: ["order_items_all_policy", "order_history_all_policy"].map(
          alterAntigo,
        ),
      });
      for (const [nome] of passos) {
        assert.equal(
          ctl.out[nome].ok,
          true,
          `CONTROLE FALHOU (${rot}): ${nome} recusou na política antiga: ${ctl.out[nome].message}`,
        );
        if (!INSERTS.includes(nome))
          assert.equal(
            ctl.out[nome].n,
            1,
            `CONTROLE FALHOU (${rot}): ${nome} não afetou a linha na política antiga`,
          );
      }
      assert.notDeepEqual(
        ctl.depois,
        ctl.antes,
        `CONTROLE FALHOU (${rot}): o retrato não mudou na política antiga`,
      );

      // A leitura do dono continua (itens e histórico do pedido dele).
      const le = await como(c, "dono", [
        [
          "itens",
          "SELECT count(*)::int AS n FROM public.marketplace_order_items WHERE order_id = $1",
          [p.id],
        ],
        [
          "historico",
          "SELECT count(*)::int AS n FROM public.marketplace_order_history WHERE order_id = $1",
          [p.id],
        ],
      ]);
      assert.equal(le.itens.linha.n, 2, `${rot}: o dono não lê os itens`);
      assert.ok(le.historico.linha.n >= 1, `${rot}: o dono não lê o histórico`);

      // O admin de agora continua escrevendo (a ALL ficou dele); o terceiro nada.
      const adm = await comoComRetrato(c, "admin", p.id, passos);
      for (const [nome] of passos) {
        assert.equal(
          adm.out[nome].ok,
          true,
          `${rot}: admin ${nome}: ${adm.out[nome].message}`,
        );
        if (!INSERTS.includes(nome))
          assert.equal(adm.out[nome].n, 1, `${rot}: admin ${nome} não afetou`);
      }
      assert.notDeepEqual(adm.depois, adm.antes);
      const terc = await comoComRetrato(c, "terceiro", p.id, passos);
      for (const [nome] of passos) {
        if (INSERTS.includes(nome)) assert.equal(terc.out[nome].ok, false);
        else assert.equal(terc.out[nome].n, 0, `${rot}: terceiro ${nome}`);
      }
      assert.deepEqual(terc.depois, terc.antes);
    }
  },
});

// ---------------------------------------------------------------------------
// (f) COMPOSIÇÃO com a 20261198000000 e o resto da pilha: depois da 202, quem
//     escreve em itens e histórico COMO FUNÇÃO continua escrevendo
// ---------------------------------------------------------------------------

// As escritoras legítimas são funções SECURITY DEFINER (dono do banco: ignoram
// a RLS). Aqui se mede (1) POR BUSCA no corpo vivo — sem lista — que toda
// função que dá INSERT/UPDATE/DELETE nessas duas tabelas é SECURITY DEFINER
// (uma INVOKER quebraria com a 202: o comprador não escreve mais); (2) que as
// escritoras nomeadas existem e são DEFINER; e (3) COMPORTAMENTO: criação
// (v23, v24), balcão, mudança de status e cancelamento com cobrança gravam
// itens e histórico chamados por quem NÃO é admin (comprador) ou por admin.
const ESCRITORAS_NOMEADAS = [
  "create_marketplace_order(jsonb,text,uuid,text,text,text,text)",
  "create_marketplace_order_v23(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)",
  "create_marketplace_order_v24(jsonb,numeric,numeric,text,uuid,text,text,text,text,jsonb,text,text,uuid)",
  "registrar_venda_presencial(jsonb,text,uuid,text,text,numeric,text,uuid)",
  "update_order_status_atomic(uuid,text,text,boolean)",
  "pedido__mudar_status(uuid,text,text,uuid,boolean,boolean)",
  "cancelar_pedido_com_cobranca(uuid,uuid,text,text,text)",
];

PROVAS.push({
  nome: "(f) composição: toda função que escreve em itens/histórico é SECURITY DEFINER (busca no corpo vivo + as nomeadas); criação v23/v24 (itens), balcão, status e cancelamento com cobrança (itens e histórico) seguem gravando depois da 202",
  corpo: async (c) => {
    // (1) por busca, sem lista.
    const achadas = (
      await c.query(
        `SELECT p.oid::regprocedure::text AS f, p.prosecdef AS definer
           FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
          WHERE n.nspname = 'public'
            AND p.prosrc ~* '(insert\\s+into|update|delete\\s+from)\\s+(public\\.)?marketplace_order_(items|history)\\M'
          ORDER BY 1`,
      )
    ).rows;
    assert.ok(
      achadas.length >= 5,
      `achei poucas escritoras: ${achadas.length}`,
    );
    const invoker = achadas.filter((x) => !x.definer).map((x) => x.f);
    assert.deepEqual(
      invoker,
      [],
      `escritora INVOKER quebra com a 202: ${invoker.join(", ")}`,
    );
    // (2) as nomeadas existem e são DEFINER.
    for (const assinatura of ESCRITORAS_NOMEADAS) {
      const r = await c.query(
        "SELECT prosecdef FROM pg_proc WHERE oid = to_regprocedure($1)",
        [assinatura],
      );
      assert.equal(
        r.rows.length,
        1,
        `${assinatura} não existe no banco composto`,
      );
      assert.equal(
        r.rows[0].prosecdef,
        true,
        `${assinatura} não é SECURITY DEFINER`,
      );
    }
    console.log(
      `    (f) escritoras achadas por busca (todas DEFINER): ${achadas.map((x) => x.f.split("(")[0]).join(", ")}`,
    );

    // (3) comportamento, numa transação desfeita.
    const contar = async (pedido) =>
      (
        await c.query(
          `SELECT (SELECT count(*)::int FROM public.marketplace_order_items WHERE order_id = $1) AS itens,
                  (SELECT count(*)::int FROM public.marketplace_order_history WHERE order_id = $1) AS historico`,
          [pedido],
        )
      ).rows[0];
    await c.query("BEGIN");
    try {
      await c.query(
        `INSERT INTO public.store_config
           (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage)
         VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national')
         ON CONFLICT (id) DO UPDATE
           SET origin_cep = EXCLUDED.origin_cep,
               local_cep_range = EXCLUDED.local_cep_range,
               free_shipping_min = EXCLUDED.free_shipping_min,
               shipping_coverage = EXCLUDED.shipping_coverage`,
      );
      const P_F = "a9caaaaa-0000-4000-8000-0000000000f2";
      await c.query(
        `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo, frete_gratis)
         VALUES ($1, 'Produto composição', 100, 1000, true, 40, false)`,
        [P_F],
      );
      const ITENS = JSON.stringify([
        { product_id: P_F, variant_id: null, quantity: 1 },
      ]);
      const criar = (rpc, metodo) => [
        `SELECT public.${rpc}($1::jsonb, 100::numeric, 0::numeric, $2::text, NULL::uuid, NULL::text,
           'Comprador', '5539000000000', NULL::text, $3::jsonb, '38500-000', 'local-delivery', NULL::uuid) AS id`,
        [
          ITENS,
          metodo,
          JSON.stringify({
            cep: "38500-000",
            rua: "Rua da Prova",
            numero: "1",
          }),
        ],
      ];

      // Criação pelo COMPRADOR (authenticated, sem ser admin): v24 (pix) e v23 (dinheiro).
      const criados = {};
      for (const [rpc, metodo] of [
        ["create_marketplace_order_v24", "pix"],
        ["create_marketplace_order_v23", "cash"],
      ]) {
        await entrar(c, "dono");
        const [sql, par] = criar(rpc, metodo);
        const r = await c.query(sql, par);
        await c.query("RESET ROLE");
        const id = r.rows[0].id;
        const n = await contar(id);
        assert.ok(n.itens >= 1, `${rpc}: não gravou item`);
        // A criação só grava ITENS (o corpo da v23/v24 não escreve histórico:
        // a linha do tempo começa na primeira mudança de status).
        criados[rpc] = id;
      }

      // Balcão pelo ADMIN atual.
      await entrar(c, "admin");
      const venda = await c.query(
        `SELECT public.registrar_venda_presencial($1::jsonb, 'cash', NULL::uuid, NULL::text, NULL::text,
           0::numeric, NULL::text, NULL::uuid) AS venda`,
        [JSON.stringify([{ product_id: P_F, quantity: 1 }])],
      );
      await c.query("RESET ROLE");
      const idVenda = venda.rows[0].venda.order.id;
      const nv = await contar(idVenda);
      assert.ok(
        nv.itens >= 1 && nv.historico >= 1,
        "balcão não gravou itens e histórico",
      );

      // Mudança de status pelo admin atual (pedido v23, dinheiro): o histórico cresce.
      const antesStatus = await contar(criados.create_marketplace_order_v23);
      await entrar(c, "admin");
      await c.query(
        "SELECT public.update_order_status_atomic($1::uuid, 'processing') AS r",
        [criados.create_marketplace_order_v23],
      );
      await c.query("RESET ROLE");
      const depoisStatus = await contar(criados.create_marketplace_order_v23);
      assert.equal(
        depoisStatus.historico,
        antesStatus.historico + 1,
        "update_order_status_atomic não gravou o histórico",
      );

      // Cancelamento com cobrança aberta (a RPC da 98, chamada como a edge: service_role).
      const O_COBRANCA = "a9cccccc-0000-4000-8000-0000000000f3";
      await c.query(
        `INSERT INTO public.marketplace_orders
           (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
            payment_method, payment_status, expires_at, metodo_online, gateway_payment_id)
         VALUES ($1, $2, 'Comprador', '{}'::jsonb, 100, 100, 'pending', 'online',
                 'online', 'aguardando', now() + interval '30 minutes', 'pix', 'ORDF202')`,
        [O_COBRANCA, U_DONO],
      );
      await c.query(
        `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
         VALUES ($1, $2, 'Produto composição', 1, 100)`,
        [O_COBRANCA, P_F],
      );
      const antesCancel = await contar(O_COBRANCA);
      await c.query("SELECT set_config('app.rpc.user_id', '', true)");
      await c.query("SET LOCAL ROLE service_role");
      const cancel = await c.query(
        "SELECT public.cancelar_pedido_com_cobranca($1::uuid, $2::uuid, 'ORDF202', 'aguardando', NULL) AS r",
        [O_COBRANCA, U_ADMIN],
      );
      await c.query("RESET ROLE");
      assert.equal(
        cancel.rows[0].r.cancelado,
        true,
        JSON.stringify(cancel.rows[0].r),
      );
      const depoisCancel = await contar(O_COBRANCA);
      assert.equal(
        depoisCancel.historico,
        antesCancel.historico + 1,
        "cancelar_pedido_com_cobranca não gravou o histórico",
      );
      const ultimo = (
        await c.query(
          "SELECT new_status FROM public.marketplace_order_history WHERE order_id = $1 ORDER BY created_at DESC, id DESC LIMIT 1",
          [O_COBRANCA],
        )
      ).rows[0];
      assert.equal(ultimo.new_status, "cancelled");
    } finally {
      await c.query("ROLLBACK");
    }
  },
});

// ---------------------------------------------------------------------------
// (d) corpo vivo, rollback, idempotência, preflight
// ---------------------------------------------------------------------------

// As 14 políticas trocadas + as 2 de SELECT que esta migration cria (leitura
// do dono/admin de itens e histórico, antes dentro das ALL).
const TROCADAS = CASOS.flatMap((x) => x.politicas);
const NOVAS_SELECT = [
  "order_items_select_policy",
  "order_history_select_policy",
];
const POLITICAS = [...TROCADAS, ...NOVAS_SELECT];
const ehPolitica = (k, lista) =>
  k.startsWith("pol public.") && lista.some((p) => k.endsWith(`.${p}`));

PROVAS.push({
  nome: "(d) o banco nascido das migrations tem as 16 políticas DESTA migration (14 trocadas para rls_admin_atual e 2 de SELECT criadas; dono, comando, papéis e nome iguais)",
  corpo: async (c) => {
    assert.equal(TROCADAS.length, 14);
    assert.equal(POLITICAS.length, 16);
    const dig = await digital(c);
    const chaves = Object.keys(dig).filter((k) => ehPolitica(k, POLITICAS));
    assert.equal(chaves.length, 16, "as 16 políticas existem");
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
    // As duas ALL ficaram SÓ do admin de agora (sem o ramo do dono) e a
    // leitura do dono mora nas duas de SELECT.
    for (const k of chaves.filter((x) => /_all_policy$/.test(x))) {
      assert.ok(!/auth\.uid\(\)/.test(dig[k]), `${k}: a ALL ainda tem o dono`);
    }
    for (const n of NOVAS_SELECT) {
      const k = chaves.find((x) => x.endsWith(`.${n}`));
      assert.ok(/auth\.uid\(\)/.test(dig[k]), `${k}: sem o ramo do dono`);
      assert.ok(/ \| r \| true$/.test(dig[k]), `${k}: não é só SELECT`);
      assert.ok(dig[k].includes("{authenticated}"), `${k}: papéis`);
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
  nome: "(d) rollback-manual: apaga SÓ as 2 de SELECT e volta as 14 ao de antes (nas 12 que só trocam a porta, só a porta muda; nas 2 ALL volta o ramo do dono); 2o rollback recusa sem escrever; reaplicar volta ao estado da migration",
  corpo: async (c) => {
    const com = await digital(c);
    await c.query("BEGIN");
    try {
      await c.query(rollback());
      const sem = await digital(c);
      const kNovas = Object.keys(com).filter((k) =>
        ehPolitica(k, NOVAS_SELECT),
      );
      assert.equal(kNovas.length, 2);
      assert.deepEqual(
        Object.keys(sem).sort(),
        Object.keys(com)
          .filter((k) => !kNovas.includes(k))
          .sort(),
        "o rollback criou objeto ou apagou algo além das 2 políticas de SELECT",
      );
      const mudou = Object.keys(sem)
        .filter((k) => com[k] !== sem[k])
        .sort();
      const esperadas = Object.keys(sem)
        .filter((k) => ehPolitica(k, TROCADAS))
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
        const velho = k.endsWith(".mkt_order_payment_history_select")
          ? "public.is_admin()"
          : "( SELECT public.is_admin() AS is_admin)";
        if (/_all_policy$/.test(k)) {
          // A ALL de antes = ramo do dono + porta velha; o ramo do dono e a
          // porta são os da política de SELECT que a migration criou.
          const tabela = (x) => x.slice(0, x.lastIndexOf("."));
          const nova = kNovas.find((n) => tabela(n) === tabela(k));
          assert.ok(nova, `${k}: sem política de SELECT na mesma tabela`);
          assert.equal(
            sem[k].split(" | ")[0].split(velho).join(NOVO),
            com[nova].split(" | ")[0],
            `${k}: o ramo do dono de antes não é o da política de SELECT nova`,
          );
          assert.equal(
            sem[k].split(" | ")[1].split(velho).join(NOVO),
            com[nova].split(" | ")[0],
            `${k}: o WITH CHECK de antes não é o ramo do dono`,
          );
        } else {
          // Só a porta muda: trocando-a de volta no estado antigo sai o novo.
          assert.equal(
            sem[k].split(velho).join(NOVO),
            com[k],
            `${k}: o rollback mudou mais que a porta de admin`,
          );
        }
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
      selectNovaDiferente: async (c0) => {
        // Já existe uma política com o nome da de SELECT nova, mas com
        // outra regra: a migration não a sobrescreve em silêncio.
        await c0.query(
          "CREATE POLICY order_items_select_policy ON public.marketplace_order_items FOR SELECT TO authenticated USING (true)",
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
      selectNovaDiferente:
        /B1_BASELINE_DIVERGENT: política order_items_select_policy/,
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
    for (const rotulo of ["mexida", "ausente", "selectAusente"]) {
      await c.query("BEGIN");
      try {
        if (rotulo === "mexida") {
          await c.query(
            `ALTER POLICY ${alvo} ON public.fin_lancamentos USING ((SELECT public.rls_admin_atual()) AND true)`,
          );
        } else if (rotulo === "selectAusente") {
          await c.query(
            "DROP POLICY order_items_select_policy ON public.marketplace_order_items",
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
