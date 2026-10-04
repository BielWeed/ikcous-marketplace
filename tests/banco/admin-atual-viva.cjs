"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (QUEM, GUARDADAS,
 * FUNCOES_NOVAS, POLITICAS_ANTES, HASH_ANTERIOR) ou do catálogo do Postgres
 * efêmero; nunca de entrada de rede nem de payload de terceiro. */

/**
 * PROVA VIVA da migration 20261197000000_dinheiro_exige_admin_atual.sql
 * contra o Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * O DEFEITO: `public.is_admin()` aceita o papel admin escrito no JWT
 * (`request.jwt.claims -> app_metadata.role`) ANTES de olhar o papel ATUAL
 * em `auth.users`. Um admin rebaixado continua, enquanto o JWT antigo valer
 * (até ~1 h), mexendo em dinheiro. A migration cria `public.is_admin_atual()`
 * e a acrescenta como guarda ADICIONAL (is_admin() continua) nas RPCs que
 * movem dinheiro/estoque.
 *
 * Para CADA RPC guardada:
 *   (1) admin REBAIXADO com o JWT ainda dizendo admin -> a MESMA recusa de
 *       quem não é admin (42501; em registrar_pagamento_recebido, P0001
 *       'Não autorizado: ...', a que ela sempre usou), e nada muda (md5 de
 *       pedidos, order_refunds, devoluções, itens, eventos, estoque e
 *       histórico de recebimento antes/depois). Dois caminhos de
 *       rebaixamento: pela tabela `profiles` (o gatilho
 *       tr_sync_profile_role_to_auth leva a auth.users) e direto em
 *       `auth.users.raw_app_meta_data` (painel do Supabase).
 *   (2) cliente logado -> a mesma recusa; anon -> permission denied (sem
 *       EXECUTE).
 *   (3) CONTROLE: o MESMO chamado do rebaixado contra o corpo SEM a guarda
 *       (tirada do pg_get_functiondef vivo, dentro de transação desfeita)
 *       PASSA e escreve — é a guarda, e não outra coisa, que recusa.
 *   (4) admin atual -> passa; service_role sem login -> passa (contrato de
 *       automação de confiança), exceto admin_devolucao_liberar_vinculo_reverso,
 *       que JÁ exigia login (20261179000000) e continua recusando.
 * E da migration em si:
 *   (5) is_admin_atual(): SECURITY DEFINER, STABLE, search_path fixo, sem
 *       EXECUTE para PUBLIC/anon/authenticated; a semântica caso a caso.
 *   (6) rollback-manual: os corpos voltam ao md5 de antes, ACL/SECURITY
 *       DEFINER/search_path iguais, is_admin_atual some; reaplicar a
 *       migration depois do rollback e reaplicá-la por cima dela mesma
 *       devolvem o mesmo estado; preflight recusa corpo vivo divergente.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/admin-atual-viva.cjs
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

const NOME_MIGRATION = "20261197000000_dinheiro_exige_admin_atual.sql";
const CAMINHO_MIGRATION = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  NOME_MIGRATION,
);
const CAMINHO_ROLLBACK = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
  `rollback-manual-${NOME_MIGRATION}`,
);

// md5(replace(prosrc, E'\r', '')) dos corpos ANTES desta migration (medidos
// no banco nascido das migrations até a 20261194000000) — o rollback tem de
// voltar exatamente a eles.
const HASH_ANTERIOR = {
  "public.solicitar_estorno(uuid,numeric,text)":
    "ee9fe85d9b18b0e38e23cf48dd3b1111",
  "public.registrar_estorno_manual(uuid)": "18ea2e76d075634b57189592fb91ac0d",
  "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)":
    "2207a35be5937de4e1f6205dcd3340d1",
  "public.admin_devolucao_reemitir_reembolso(uuid,boolean)":
    "06c92efbbf5b3db1f97853e121612c88",
  "public.admin_devolucao_liberar_vinculo_reverso(uuid,boolean)":
    "83144be5ac2bc52f07f02274023a83ab",
  // O corpo que a 20261195000000 deixa.
  "public.registrar_pagamento_recebido(uuid,boolean)":
    "0a594768d4836bcc6d5064ce537b47dc",
};
const GUARDADAS = Object.keys(HASH_ANTERIOR);

const U_ADMIN = "a7000000-0000-4000-8000-000000000001";
const U_REBAIXADO_PERFIL = "a7000000-0000-4000-8000-000000000002";
const U_REBAIXADO_AUTH = "a7000000-0000-4000-8000-000000000003";
const U_CLIENTE = "a7000000-0000-4000-8000-000000000004";
const U_REBAIXADO_AMBOS = "a7000000-0000-4000-8000-000000000005";
// Só auth.users diz admin, sem linha em profiles (admin criado pelo painel).
const U_SO_AUTH_SEM_PERFIL = "a7000000-0000-4000-8000-000000000006";
const P_ESTOQUE = "a7aaaaaa-0000-4000-8000-000000000001";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

// Quem chama: papel do Postgres (o que o PostgREST faz com SET ROLE), o
// "login" (auth.uid() desta suíte lê app.rpc.user_id) e o JWT.
const QUEM = {
  anon: { papel: "anon", uid: "", jwt: "" },
  cliente: {
    papel: "authenticated",
    uid: U_CLIENTE,
    jwt: claims(U_CLIENTE, null),
  },
  rebaixadoPerfil: {
    papel: "authenticated",
    uid: U_REBAIXADO_PERFIL,
    jwt: claims(U_REBAIXADO_PERFIL, "admin"),
  },
  rebaixadoAuth: {
    papel: "authenticated",
    uid: U_REBAIXADO_AUTH,
    jwt: claims(U_REBAIXADO_AUTH, "admin"),
  },
  rebaixadoAmbos: {
    papel: "authenticated",
    uid: U_REBAIXADO_AMBOS,
    jwt: claims(U_REBAIXADO_AMBOS, "admin"),
  },
  soAuthSemPerfil: {
    papel: "authenticated",
    uid: U_SO_AUTH_SEM_PERFIL,
    jwt: claims(U_SO_AUTH_SEM_PERFIL, "admin"),
  },
  admin: { papel: "authenticated", uid: U_ADMIN, jwt: claims(U_ADMIN, "admin") },
  service: { papel: "service_role", uid: "", jwt: "" },
};

// `desfazer`: a chamada roda e é desfeita (ROLLBACK) mesmo dando certo —
// para medir escrita direta em tabela sem deixar rastro.
async function comoQuem(cliente, quem, sql, params = [], { desfazer = false } = {}) {
  const q = QUEM[quem];
  await cliente.query("BEGIN");
  try {
    await cliente.query(`SET LOCAL ROLE ${q.papel}`);
    await cliente.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    const r = await cliente.query(sql, params);
    await cliente.query(desfazer ? "ROLLBACK" : "COMMIT");
    return { ok: true, linhas: r.rows, linhasAfetadas: r.rowCount };
  } catch (erro) {
    await cliente.query("ROLLBACK");
    return { ok: false, code: erro.code, message: erro.message };
  }
}

// Impressão digital de tudo que as RPCs guardadas podem escrever.
async function foto(cliente) {
  const r = await cliente.query(`
    SELECT md5(COALESCE(string_agg(t, '|' ORDER BY t), '')) AS h FROM (
      SELECT 'o' || o::text AS t FROM public.marketplace_orders o
      UNION ALL SELECT 'r' || r::text FROM public.order_refunds r
      UNION ALL SELECT 'd' || d::text FROM public.devolucoes d
      UNION ALL SELECT 'i' || i::text FROM public.devolucao_itens i
      UNION ALL SELECT 'e' || e::text FROM public.devolucao_eventos e
      UNION ALL SELECT 'p' || p::text FROM public.produtos p
      UNION ALL SELECT 'h' || h::text FROM public.marketplace_order_payment_history h
    ) x`);
  return r.rows[0].h;
}

async function catalogo(cliente, assinatura) {
  const r = await cliente.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS hash,
            pg_get_functiondef(oid) AS def,
            proacl::text AS acl, prosecdef, provolatile,
            proconfig::text AS config
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] || null;
}

// As duas funções que a migration cria.
const FUNCOES_NOVAS = ["public.is_admin_atual()", "public.rls_admin_atual()"];

// As políticas de RLS financeira, deparseadas com search_path = pg_catalog
// (nomes sempre qualificados) — a mesma forma que os preflights comparam.
async function politicas(cliente) {
  await cliente.query("SET search_path = pg_catalog");
  try {
    const r = await cliente.query(
      `SELECT c.relname || '.' || p.polname AS nome,
              pg_get_expr(p.polqual, p.polrelid) AS qual,
              pg_get_expr(p.polwithcheck, p.polrelid) AS checagem,
              p.polcmd::text AS cmd, p.polroles::regrole[]::text AS papeis,
              p.polpermissive AS permissiva
         FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
        WHERE c.relname IN ('marketplace_orders', 'order_refunds')
        ORDER BY 1`,
    );
    return Object.fromEntries(r.rows.map((l) => [l.nome, l]));
  } finally {
    await cliente.query("RESET search_path");
  }
}

// O que estava vivo ANTES desta migration (baseline e 2026110000000).
const POLITICAS_ANTES = {
  "marketplace_orders.marketplace_orders_admin_delete_policy": [
    "( SELECT public.is_admin() AS is_admin)",
    null,
  ],
  "marketplace_orders.marketplace_orders_admin_insert_policy": [
    null,
    "( SELECT public.is_admin() AS is_admin)",
  ],
  "marketplace_orders.marketplace_orders_admin_update_policy": [
    "( SELECT public.is_admin() AS is_admin)",
    "( SELECT public.is_admin() AS is_admin)",
  ],
  "marketplace_orders.marketplace_orders_select_policy": [
    "((( SELECT auth.uid() AS uid) = user_id) OR ( SELECT public.is_admin() AS is_admin))",
    null,
  ],
  "order_refunds.order_refunds_admin_all": ["public.is_admin()", "public.is_admin()"],
};

let seq = 0;
const novoId = (prefixo) => {
  seq += 1;
  return `${prefixo}-0000-4000-8000-${String(seq).padStart(12, "0")}`;
};

async function pedido(cliente, o) {
  const id = novoId("a7cccccc");
  await cliente.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, paid_at)
     VALUES ($1, $2, 'Cliente Admin Atual', '{}'::jsonb, 100, 100, $3, 'online', $4, $5,
             CASE WHEN $5::text IS NULL THEN NULL ELSE now() END)`,
    [
      id,
      o.userId || U_CLIENTE,
      o.status,
      o.pagamento || "online",
      o.paymentStatus === undefined ? "pago" : o.paymentStatus,
    ],
  );
  const item = await cliente.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Item', 1, 100) RETURNING id`,
    [id, P_ESTOQUE],
  );
  return { id, itemId: item.rows[0].id };
}

async function devolucao(cliente, o) {
  const p = await pedido(cliente, { status: "delivered", pagamento: o.pagamento });
  const id = novoId("a7dddddd");
  await cliente.query(
    `INSERT INTO public.devolucoes
       (id, protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, modalidade,
        metodo_retorno, status, valor_itens, prazo_ate, politica, resolucao_final,
        valor_reembolso, me_reverse_id)
     VALUES ($1, $2, $3, $4, 'arrependimento', 'desisti', 'troca', 'local',
             'entrega_na_loja', $5, 100, current_date + 7, '{}'::jsonb, $6, $7, $8)`,
    [
      id,
      `DEV-${seq}`,
      p.id,
      U_CLIENTE,
      o.status,
      o.resolucaoFinal || null,
      o.valorReembolso || null,
      o.meReverseId || null,
    ],
  );
  const di = await cliente.query(
    `INSERT INTO public.devolucao_itens
       (devolucao_id, order_item_id, product_id, product_name, quantidade, valor_unitario)
     VALUES ($1, $2, $3, 'Item', 1, 100) RETURNING id`,
    [id, p.itemId, P_ESTOQUE],
  );
  if (o.refundRecusado) {
    const r = await cliente.query(
      `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status)
       VALUES ($1, 100, 'lojista', 'recusado') RETURNING id`,
      [p.id],
    );
    await cliente.query(
      "UPDATE public.devolucoes SET refund_id = $2 WHERE id = $1",
      [id, r.rows[0].id],
    );
  }
  return { id, orderId: p.id, itemId: di.rows[0].id };
}

// Cada RPC guardada: como montar um alvo VÁLIDO (onde o admin escreve de
// verdade) e como chamá-la. `servicePassa`: o que o service_role sem login
// recebe — igual ao comportamento ANTES desta migration.
const CASOS = [
  {
    assinatura: "public.solicitar_estorno(uuid,numeric,text)",
    alvo: async (c) => (await pedido(c, { status: "cancelled" })).id,
    chamada: (alvo) => [
      "SELECT public.solicitar_estorno($1, 10, 'prova admin atual') AS r",
      [alvo],
    ],
    servicePassa: true,
  },
  {
    assinatura: "public.registrar_estorno_manual(uuid)",
    alvo: async (c) => (await pedido(c, { status: "cancelled" })).id,
    chamada: (alvo) => ["SELECT public.registrar_estorno_manual($1) AS r", [alvo]],
    servicePassa: true,
  },
  {
    assinatura: "public.admin_devolucao_concluir(uuid,text,jsonb,numeric,text)",
    alvo: async (c) => {
      const d = await devolucao(c, { status: "recebida" });
      return { id: d.id, itens: JSON.stringify([{ item_id: d.itemId, condicao: "nova", reestocar: true }]) };
    },
    chamada: (alvo) => [
      "SELECT public.admin_devolucao_concluir($1, 'troca', $2::jsonb) AS r",
      [alvo.id, alvo.itens],
    ],
    servicePassa: true,
  },
  {
    assinatura: "public.admin_devolucao_reemitir_reembolso(uuid,boolean)",
    alvo: async (c) =>
      (
        await devolucao(c, {
          status: "concluida",
          resolucaoFinal: "reembolso",
          valorReembolso: 100,
          refundRecusado: true,
        })
      ).id,
    chamada: (alvo) => [
      "SELECT public.admin_devolucao_reemitir_reembolso($1, true) AS r",
      [alvo],
    ],
    servicePassa: true,
  },
  {
    assinatura: "public.admin_devolucao_liberar_vinculo_reverso(uuid,boolean)",
    alvo: async (c) =>
      (await devolucao(c, { status: "aprovada", meReverseId: "ME-PROVA-1" })).id,
    chamada: (alvo) => [
      "SELECT public.admin_devolucao_liberar_vinculo_reverso($1, true) AS r",
      [alvo],
    ],
    // 20261179000000: `IF NOT public.is_admin() OR auth.uid() IS NULL` — a
    // decisão é humana; o service_role sem login já era recusado.
    servicePassa: false,
  },
  {
    assinatura: "public.registrar_pagamento_recebido(uuid,boolean)",
    // Pedido de ENTREGA ainda sem pagamento: "recebi" grava
    // recebido_na_entrega + histórico.
    alvo: async (c) =>
      (await pedido(c, { status: "delivered", pagamento: "cash", paymentStatus: null })).id,
    chamada: (alvo) => [
      "SELECT public.registrar_pagamento_recebido($1, true) AS r",
      [alvo],
    ],
    servicePassa: true,
    // A recusa de não-admin desta RPC nunca teve ERRCODE (20261020000000):
    // a guarda repete a mesma, P0001 'Não autorizado: ...'.
    codigo: "P0001",
    mensagem: /^Não autorizado: só a loja registra pagamento recebido\.$/,
  },
];

// A guarda que a migration acrescenta, como aparece no corpo vivo.
const RE_GUARDA =
  /\n[ \t]*-- Papel ATUAL[^\n]*\n[ \t]*IF NOT public\.is_admin_atual\(\) THEN\n[\s\S]*?\n[ \t]*END IF;\n/g;

function semGuarda(def) {
  const achados = def.match(RE_GUARDA) || [];
  assert.equal(achados.length, 1, "a guarda tem de aparecer UMA vez no corpo vivo");
  return def.replace(RE_GUARDA, "\n");
}

// A recusa do rebaixado é a MESMA de quem não é admin: mesmo SQLSTATE (42501,
// ou o que a função sempre usou) e, quando declarada, a mesma mensagem.
async function recusaComoNaoAdmin(cliente, quem, caso, alvo) {
  const antes = await foto(cliente);
  const [sql, params] = caso.chamada(alvo);
  const r = await comoQuem(cliente, quem, sql, params);
  assert.equal(r.ok, false, `${caso.assinatura} como ${quem} PASSOU — devia recusar`);
  assert.equal(
    r.code,
    caso.codigo || "42501",
    `${caso.assinatura} como ${quem}: ${r.code} ${r.message}`,
  );
  if (caso.mensagem) assert.match(r.message, caso.mensagem);
  assert.equal(await foto(cliente), antes, `${caso.assinatura} como ${quem} escreveu algo`);
  return r;
}

const PROVAS = [];

PROVAS.push({
  nome: "(0) fixtures: admin atual, rebaixados nas duas direções e nas duas fontes, admin só do painel, cliente",
  corpo: async (cliente) => {
    // Fábrica do Supabase que o provisionar.cjs não emula: authenticated tem
    // USAGE nos schemas auth (as políticas `auth.uid() = user_id` rodam como
    // o usuário) e extensions (o UPDATE do admin em pedido que já existia
    // passa por gatilho com `f_unaccent` -> extensions.unaccent; sem isso a
    // prova só passaria em banco VAZIO). Só neste CLONE (rodar-isolado.cjs)
    // — as outras provas não enxergam.
    await cliente.query("GRANT USAGE ON SCHEMA auth TO anon, authenticated, service_role");
    await cliente.query("GRANT USAGE ON SCHEMA extensions TO anon, authenticated, service_role");
    for (const id of [
      U_ADMIN,
      U_REBAIXADO_PERFIL,
      U_REBAIXADO_AUTH,
      U_CLIENTE,
      U_REBAIXADO_AMBOS,
      U_SO_AUTH_SEM_PERFIL,
    ]) {
      await cliente.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@admin-atual.teste', '{}'::jsonb)`,
        [id],
      );
    }
    // O papel nasce em profiles e o gatilho tr_sync_profile_role_to_auth o
    // leva a auth.users.raw_app_meta_data — o caminho de produção.
    await cliente.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Admin Atual', 'admin'), ($2, 'Rebaixado Perfil', 'admin'),
         ($3, 'Rebaixado Auth', 'admin'), ($4, 'Cliente', 'customer'),
         ($5, 'Rebaixado Ambos', 'admin')`,
      [U_ADMIN, U_REBAIXADO_PERFIL, U_REBAIXADO_AUTH, U_CLIENTE, U_REBAIXADO_AMBOS],
    );
    // Admin só pelo app_metadata (painel do Supabase), sem linha em profiles.
    await cliente.query(
      `UPDATE auth.users SET raw_app_meta_data = '{"role":"admin"}'::jsonb WHERE id = $1`,
      [U_SO_AUTH_SEM_PERFIL],
    );
    await cliente.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
       VALUES ($1, 'Produto Admin Atual', 100, 1000, true, 40)`,
      [P_ESTOQUE],
    );
    // Rebaixamento pelo app: profiles.role, feito por um admin (o gatilho
    // tr_prevent_role_change exige is_admin() de quem muda papel); o gatilho
    // de sincronia leva a auth.users — as DUAS fontes dizem customer.
    await cliente.query("BEGIN");
    await cliente.query(
      "SELECT set_config('request.jwt.claims', $1, true)",
      [claims(U_ADMIN, "admin")],
    );
    await cliente.query(
      "UPDATE public.profiles SET role = 'customer' WHERE id = ANY($1::uuid[])",
      [[U_REBAIXADO_AMBOS, U_REBAIXADO_PERFIL]],
    );
    await cliente.query("COMMIT");
    // Direção 1 — SÓ profiles rebaixado: auth.users volta a dizer admin
    // (UPDATE direto depois do gatilho; ou gatilho fora do ar).
    await cliente.query(
      `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"admin"}'::jsonb WHERE id = $1`,
      [U_REBAIXADO_PERFIL],
    );
    // Direção 2 — SÓ auth.users rebaixado: direto no app_metadata (painel do
    // Supabase); profiles continua dizendo admin.
    await cliente.query(
      `UPDATE auth.users SET raw_app_meta_data = raw_app_meta_data || '{"role":"customer"}'::jsonb WHERE id = $1`,
      [U_REBAIXADO_AUTH],
    );
    const r = await cliente.query(
      `SELECT u.id::text, u.raw_app_meta_data ->> 'role' AS auth_role, p.role AS perfil_role
         FROM auth.users u LEFT JOIN public.profiles p ON p.id = u.id
        WHERE u.id::text LIKE 'a7000000-%' ORDER BY u.id`,
    );
    assert.deepEqual(
      r.rows.map((l) => [l.id, l.auth_role, l.perfil_role]),
      [
        [U_ADMIN, "admin", "admin"],
        [U_REBAIXADO_PERFIL, "admin", "customer"],
        [U_REBAIXADO_AUTH, "customer", "admin"],
        [U_CLIENTE, "customer", "customer"],
        [U_REBAIXADO_AMBOS, "customer", "customer"],
        [U_SO_AUTH_SEM_PERFIL, "admin", null],
      ],
    );
  },
});

PROVAS.push({
  nome: "(5) is_admin_atual: SECURITY DEFINER, STABLE, search_path fixo, sem EXECUTE para PUBLIC/anon/authenticated",
  corpo: async (cliente) => {
    const c = await catalogo(cliente, "public.is_admin_atual()");
    assert.ok(c, "public.is_admin_atual() não existe");
    assert.equal(c.prosecdef, true);
    assert.equal(c.provolatile, "s");
    assert.equal(c.config, "{search_path=public}");
    // Nenhuma entrada sem dono (PUBLIC), nem anon, nem authenticated.
    assert.ok(!/(^|[{,])=/.test(c.acl), `PUBLIC com EXECUTE: ${c.acl}`);
    assert.ok(!/\banon=/.test(c.acl), `anon com EXECUTE: ${c.acl}`);
    assert.ok(!/\bauthenticated=/.test(c.acl), `authenticated com EXECUTE: ${c.acl}`);
    for (const quem of ["anon", "cliente", "admin"]) {
      const r = await comoQuem(cliente, quem, "SELECT public.is_admin_atual() AS r");
      assert.equal(r.ok, false, `${quem} executou is_admin_atual direto`);
      assert.equal(r.code, "42501");
      assert.match(r.message, /permission denied for function is_admin_atual/);
    }
    // O embrulho das políticas: mesmo desenho, EXECUTE só para authenticated
    // (a política roda como o usuário); anon e PUBLIC sem.
    const w = await catalogo(cliente, "public.rls_admin_atual()");
    assert.ok(w, "public.rls_admin_atual() não existe");
    assert.equal(w.prosecdef, true);
    assert.equal(w.provolatile, "s");
    assert.equal(w.config, "{search_path=public}");
    assert.ok(!/(^|[{,])=/.test(w.acl), `PUBLIC com EXECUTE: ${w.acl}`);
    assert.ok(!/\banon=/.test(w.acl), `anon com EXECUTE: ${w.acl}`);
    assert.match(w.acl, /\bauthenticated=X\//);
    const anon = await comoQuem(cliente, "anon", "SELECT public.rls_admin_atual() AS r");
    assert.equal(anon.ok, false);
    assert.match(anon.message, /permission denied for function rls_admin_atual/);
    // Pelo embrulho, cada um recebe só o próprio boolean: a mesma regra.
    for (const [quem, esperado] of [
      ["admin", true],
      ["cliente", false],
      ["rebaixadoPerfil", false],
      ["rebaixadoAuth", false],
      ["rebaixadoAmbos", false],
      ["soAuthSemPerfil", false],
    ]) {
      const r = await comoQuem(cliente, quem, "SELECT public.rls_admin_atual() AS r");
      assert.equal(r.ok, true, `${quem}: ${r.message}`);
      assert.equal(r.linhas[0].r, esperado, `rls_admin_atual() como ${quem}`);
    }
  },
});

PROVAS.push({
  nome: "(5) is_admin_atual: papel ATUAL nas DUAS fontes (auth.users E profiles); contradição nega; JWT sozinho não basta; service_role explícito passa",
  corpo: async (cliente) => {
    // Avaliada como as RPCs guardadas a avaliam: de dentro de uma função
    // SECURITY DEFINER do dono, chamada pelo papel da requisição (o GUC
    // 'role' continua sendo o de quem chamou). O embrulho nasce e morre na
    // transação da prova.
    const avaliar = async (papel, uid, jwt) => {
      await cliente.query("BEGIN");
      try {
        await cliente.query(
          `CREATE FUNCTION public.prova__avaliar_admin_atual() RETURNS boolean
             LANGUAGE sql SECURITY DEFINER SET search_path = public
             AS 'SELECT public.is_admin_atual()'`,
        );
        await cliente.query(
          "GRANT EXECUTE ON FUNCTION public.prova__avaliar_admin_atual() TO anon, authenticated, service_role",
        );
        await cliente.query(`SET LOCAL ROLE ${papel}`);
        await cliente.query(
          "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
          [uid, jwt],
        );
        return (await cliente.query("SELECT public.prova__avaliar_admin_atual() AS r")).rows[0].r;
      } finally {
        await cliente.query("ROLLBACK");
      }
    };
    const A = "authenticated";
    assert.equal(await avaliar(A, U_ADMIN, ""), true, "admin atual sem JWT");
    assert.equal(await avaliar(A, U_ADMIN, claims(U_ADMIN, "admin")), true, "admin atual com JWT");
    assert.equal(
      await avaliar(A, U_REBAIXADO_PERFIL, claims(U_REBAIXADO_PERFIL, "admin")),
      false,
      "só profiles rebaixado (auth.users ainda admin) com JWT velho",
    );
    assert.equal(
      await avaliar(A, U_REBAIXADO_AUTH, claims(U_REBAIXADO_AUTH, "admin")),
      false,
      "só app_metadata rebaixado (profiles ainda admin) com JWT velho",
    );
    assert.equal(
      await avaliar(A, U_REBAIXADO_AMBOS, claims(U_REBAIXADO_AMBOS, "admin")),
      false,
      "rebaixado pelo app (as duas fontes) com JWT velho",
    );
    assert.equal(
      await avaliar(A, U_SO_AUTH_SEM_PERFIL, claims(U_SO_AUTH_SEM_PERFIL, "admin")),
      false,
      "admin só no app_metadata, sem profiles",
    );
    assert.equal(await avaliar(A, U_CLIENTE, claims(U_CLIENTE, "admin")), false, "cliente com JWT forjado");
    assert.equal(await avaliar(A, "", claims(U_ADMIN, "admin")), false, "JWT admin sem login");
    assert.equal(
      await avaliar(A, "a7000000-0000-4000-8000-0000000000ff", ""),
      false,
      "login sem usuário em auth.users",
    );
    assert.equal(await avaliar(A, "", ""), false, "authenticated sem login");
    assert.equal(await avaliar("anon", "", ""), false, "anon");
    assert.equal(await avaliar("service_role", "", ""), true, "service_role explícito");
  },
});

for (const caso of CASOS) {
  PROVAS.push({
    nome: `(1)(2)(3)(4) ${caso.assinatura}: rebaixado/cliente ${caso.codigo || "42501"} sem escrita, anon sem EXECUTE, controle sem a guarda escreve, admin atual passa, service_role ${caso.servicePassa ? "passa" : "segue recusado (já exigia login)"}`,
    corpo: async (cliente) => {
      const alvo = await caso.alvo(cliente);

      // (1) rebaixado com o JWT ainda dizendo admin: só profiles, só
      // auth.users, as duas; e o admin só do painel (sem profiles).
      await recusaComoNaoAdmin(cliente, "rebaixadoPerfil", caso, alvo);
      await recusaComoNaoAdmin(cliente, "rebaixadoAuth", caso, alvo);
      await recusaComoNaoAdmin(cliente, "rebaixadoAmbos", caso, alvo);
      await recusaComoNaoAdmin(cliente, "soAuthSemPerfil", caso, alvo);
      // (2) cliente logado; anon sem EXECUTE.
      await recusaComoNaoAdmin(cliente, "cliente", caso, alvo);
      const antesAnon = await foto(cliente);
      const [sql, params] = caso.chamada(alvo);
      const anon = await comoQuem(cliente, "anon", sql, params);
      assert.equal(anon.ok, false, "anon executou");
      assert.match(anon.message, /permission denied for function/);
      assert.equal(await foto(cliente), antesAnon);

      // (3) CONTROLE: o corpo vivo sem a guarda deixa o rebaixado escrever —
      // nas DUAS direções da contradição.
      const vivo = await catalogo(cliente, caso.assinatura);
      for (const uid of [U_REBAIXADO_PERFIL, U_REBAIXADO_AUTH]) {
        await cliente.query("BEGIN");
        try {
          await cliente.query(semGuarda(vivo.def));
          await cliente.query("SAVEPOINT controle");
          const antes = await foto(cliente);
          await cliente.query("SET LOCAL ROLE authenticated");
          await cliente.query(
            "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
            [uid, claims(uid, "admin")],
          );
          let erro = null;
          try {
            await cliente.query(sql, params);
          } catch (e) {
            erro = e;
            await cliente.query("ROLLBACK TO SAVEPOINT controle");
          }
          await cliente.query("RESET ROLE");
          assert.equal(
            erro,
            null,
            `CONTROLE FALHOU (${uid}): sem a guarda, o rebaixado ainda é recusado (${erro && erro.code} ${erro && erro.message}) — a prova (1) não mede a guarda`,
          );
          assert.notEqual(await foto(cliente), antes, `CONTROLE (${uid}): sem a guarda a chamada não escreveu nada`);
        } finally {
          await cliente.query("ROLLBACK");
        }
      }
      assert.equal((await catalogo(cliente, caso.assinatura)).hash, vivo.hash, "o controle vazou para o corpo vivo");

      // (4) admin atual passa e escreve.
      const antesAdmin = await foto(cliente);
      const adm = await comoQuem(cliente, "admin", sql, params);
      assert.equal(adm.ok, true, `admin atual recusado: ${adm.code} ${adm.message}`);
      assert.notEqual(await foto(cliente), antesAdmin, "admin atual não escreveu");

      // (4) service_role sem login, num alvo novo.
      const alvo2 = await caso.alvo(cliente);
      const [sql2, params2] = caso.chamada(alvo2);
      const antesSr = await foto(cliente);
      const sr = await comoQuem(cliente, "service", sql2, params2);
      if (caso.servicePassa) {
        assert.equal(sr.ok, true, `service_role recusado: ${sr.code} ${sr.message}`);
        assert.notEqual(await foto(cliente), antesSr, "service_role não escreveu");
      } else {
        assert.equal(sr.ok, false, "service_role sem login passou");
        assert.equal(sr.code, "42501");
        assert.equal(await foto(cliente), antesSr);
      }
    },
  });
}

PROVAS.push({
  nome: "(7) RLS financeira: ex-admin com JWT velho vê 0 pedidos e 0 linhas do ledger alheios (sem erro) e segue vendo o próprio; DML alheio nega; admin atual vê e atualiza tudo; cliente só o seu; service_role igual; controle com a política antiga vaza",
  corpo: async (cliente) => {
    // Cada rebaixado é DONO de um pedido, com uma linha no ledger: o dono
    // legítimo continua vendo o seu (auth.uid() = user_id e
    // order_refunds_cliente_le não mudaram).
    const rebaixados = ["rebaixadoPerfil", "rebaixadoAuth", "rebaixadoAmbos", "soAuthSemPerfil"];
    for (const quem of rebaixados) {
      const p = await pedido(cliente, { status: "cancelled", userId: QUEM[quem].uid });
      await cliente.query(
        `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status)
         VALUES ($1, 1, 'lojista', 'recusado')`,
        [p.id],
      );
    }
    const totais = (
      await cliente.query(
        `SELECT (SELECT count(*) FROM public.marketplace_orders)::int AS pedidos,
                (SELECT count(*) FROM public.order_refunds)::int AS refunds`,
      )
    ).rows[0];
    assert.ok(totais.pedidos > rebaixados.length && totais.refunds > rebaixados.length);
    const proprios = async (uid) =>
      (
        await cliente.query(
          `SELECT (SELECT count(*) FROM public.marketplace_orders WHERE user_id = $1::uuid)::int AS pedidos,
                  (SELECT count(*) FROM public.order_refunds r JOIN public.marketplace_orders o ON o.id = r.order_id
                    WHERE o.user_id = $1::uuid)::int AS refunds`,
          [uid],
        )
      ).rows[0];

    // O que o PostgREST faria: SELECT puro nas duas tabelas, como o usuário.
    const CONTAGEM = `SELECT (SELECT count(*) FROM public.marketplace_orders)::int AS pedidos,
                             (SELECT count(*) FROM public.marketplace_orders
                               WHERE user_id IS DISTINCT FROM auth.uid())::int AS pedidos_alheios,
                             (SELECT count(*) FROM public.order_refunds)::int AS refunds`;
    const ver = async (quem) => {
      const r = await comoQuem(cliente, quem, CONTAGEM);
      assert.equal(r.ok, true, `SELECT como ${quem} quebrou: ${r.code} ${r.message}`);
      return r.linhas[0];
    };

    for (const quem of [...rebaixados, "cliente"]) {
      const v = await ver(quem);
      const meu = await proprios(QUEM[quem].uid);
      assert.equal(v.pedidos_alheios, 0, `${quem} vê pedido alheio`);
      assert.equal(v.pedidos, meu.pedidos, `${quem} não vê exatamente os próprios pedidos`);
      assert.ok(v.pedidos >= 1, `${quem} perdeu o próprio pedido`);
      assert.equal(v.refunds, meu.refunds, `${quem} vê linha do ledger alheia`);
    }
    for (const quem of rebaixados) {
      // DML direto em pedido alheio: UPDATE/DELETE acham 0 linhas; INSERT
      // é recusado pela política (WITH CHECK).
      const up = await comoQuem(
        cliente,
        quem,
        "UPDATE public.marketplace_orders SET notes = notes WHERE user_id IS DISTINCT FROM auth.uid()",
        [],
        { desfazer: true },
      );
      assert.equal(up.ok, true, `${quem}: ${up.message}`);
      assert.equal(up.linhasAfetadas, 0, `${quem} atualizou pedido alheio`);
      const del = await comoQuem(
        cliente,
        quem,
        "DELETE FROM public.marketplace_orders WHERE user_id IS DISTINCT FROM auth.uid()",
        [],
        { desfazer: true },
      );
      assert.equal(del.ok, true, `${quem}: ${del.message}`);
      assert.equal(del.linhasAfetadas, 0, `${quem} apagou pedido alheio`);
      const ins = await comoQuem(
        cliente,
        quem,
        `INSERT INTO public.marketplace_orders (customer_name, customer_data, total, subtotal)
         VALUES ('forjado', '{}'::jsonb, 1, 1)`,
        [],
        { desfazer: true },
      );
      assert.equal(ins.ok, false, `${quem} inseriu pedido`);
      assert.equal(ins.code, "42501");
      assert.match(ins.message, /row-level security/);
    }

    // Admin atual: vê tudo e atualiza pedido alheio.
    const adm = await ver("admin");
    assert.equal(adm.pedidos, totais.pedidos);
    assert.equal(adm.refunds, totais.refunds);
    const upAdm = await comoQuem(
      cliente,
      "admin",
      "UPDATE public.marketplace_orders SET notes = notes WHERE user_id IS DISTINCT FROM auth.uid()",
      [],
      { desfazer: true },
    );
    assert.equal(upAdm.ok, true, upAdm.message);
    assert.equal(upAdm.linhasAfetadas, totais.pedidos);

    const srNovo = await ver("service");

    // CONTROLE: com as políticas antigas (o rollback-manual, dentro de uma
    // transação desfeita), o MESMO ex-admin vê os pedidos e o ledger alheios.
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CAMINHO_ROLLBACK é constante do próprio teste (path.join de literais).
    const rollback = fs.readFileSync(CAMINHO_ROLLBACK, "utf8");
    for (const quem of ["rebaixadoPerfil", "rebaixadoAuth", "rebaixadoAmbos"]) {
      await cliente.query("BEGIN");
      try {
        await cliente.query(rollback);
        await cliente.query(`SET LOCAL ROLE ${QUEM[quem].papel}`);
        await cliente.query(
          "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
          [QUEM[quem].uid, QUEM[quem].jwt],
        );
        const v = (await cliente.query(CONTAGEM)).rows[0];
        assert.equal(v.pedidos, totais.pedidos, `CONTROLE (${quem}): a política antiga não vazou — a prova não mede a troca`);
        assert.equal(v.refunds, totais.refunds, `CONTROLE (${quem}): o ledger antigo não vazou`);
      } finally {
        await cliente.query("ROLLBACK");
      }
    }
    // service_role: o mesmo resultado com a política nova e a antiga.
    await cliente.query("BEGIN");
    try {
      await cliente.query(rollback);
      await cliente.query("SET LOCAL ROLE service_role");
      const srAntigo = (await cliente.query(CONTAGEM)).rows[0];
      assert.deepEqual(srNovo, srAntigo, "service_role mudou com a troca das políticas");
    } finally {
      await cliente.query("ROLLBACK");
    }
  },
});


// Estado inteiro que a migration e o rollback mexem: os corpos (seis RPCs e
// as duas funções novas) e as expressões das políticas.
async function estado(cliente) {
  const f = {};
  for (const a of [...GUARDADAS, ...FUNCOES_NOVAS]) f[a] = await catalogo(cliente, a);
  f.politicas = await politicas(cliente);
  return f;
}

PROVAS.push({
  nome: "(6) preflight: reaplicar por cima de si mesma não muda nada; corpo ou política divergente -> B1_BASELINE_DIVERGENT sem NENHUMA escrita",
  corpo: async (cliente) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CAMINHO_MIGRATION é constante do próprio teste (path.join de literais).
    const sql = fs.readFileSync(CAMINHO_MIGRATION, "utf8");
    const antes = await estado(cliente);
    await cliente.query("BEGIN");
    try {
      await cliente.query(sql);
      assert.deepEqual(await estado(cliente), antes, "reaplicar mudou alguma coisa");
    } finally {
      await cliente.query("ROLLBACK");
    }
    // Recusa SEM NENHUMA escrita: volta ao estado de antes da migration (o
    // próprio rollback-manual) e diverge UMA peça — a última função da lista
    // do preflight, ou a última política — e aplica: nada da migration pode
    // ficar (nem função nova, nem guarda nas RPCs que o preflight já tinha
    // aceitado, nem política trocada).
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CAMINHO_ROLLBACK é constante do próprio teste (path.join de literais).
    const rollback = fs.readFileSync(CAMINHO_ROLLBACK, "utf8");
    const divergencias = [
      [
        "corpo de registrar_pagamento_recebido",
        async () => {
          const def = (await catalogo(cliente, "public.registrar_pagamento_recebido(uuid,boolean)")).def;
          const divergente = def.replace("'Pedido não encontrado.'", "'Pedido nao encontrado (divergente).'");
          assert.notEqual(divergente, def);
          await cliente.query(divergente);
        },
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.registrar_pagamento_recebido/,
      ],
      [
        "política order_refunds_admin_all",
        () =>
          cliente.query(
            "ALTER POLICY order_refunds_admin_all ON public.order_refunds USING (public.is_admin() AND true) WITH CHECK (public.is_admin())",
          ),
        /B1_BASELINE_DIVERGENT: política order_refunds_admin_all/,
      ],
    ];
    for (const [rotulo, divergir, regex] of divergencias) {
      await cliente.query("BEGIN");
      try {
        await cliente.query(rollback);
        await divergir();
        const antesDeAplicar = await estado(cliente);
        await cliente.query("SAVEPOINT aplicar");
        await assert.rejects(cliente.query(sql), regex, rotulo);
        await cliente.query("ROLLBACK TO SAVEPOINT aplicar");
        assert.deepEqual(await estado(cliente), antesDeAplicar, `a recusa (${rotulo}) escreveu algo`);
        for (const a of FUNCOES_NOVAS) {
          assert.equal(await catalogo(cliente, a), null, `a recusa (${rotulo}) deixou ${a} criada`);
        }
      } finally {
        await cliente.query("ROLLBACK");
      }
    }
  },
});

PROVAS.push({
  nome: "(6) rollback-manual: corpos voltam ao md5 de antes, políticas à expressão exata de antes, ACL/SECURITY DEFINER/search_path iguais, as duas funções novas somem; reaplicar volta ao estado da migration; estado vivo divergente -> recusa sem NENHUMA escrita",
  corpo: async (cliente) => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CAMINHO_ROLLBACK é constante do próprio teste (path.join de literais).
    const rollback = fs.readFileSync(CAMINHO_ROLLBACK, "utf8");
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- CAMINHO_MIGRATION é constante do próprio teste (path.join de literais).
    const migration = fs.readFileSync(CAMINHO_MIGRATION, "utf8");
    const depoisDaMigration = await estado(cliente);
    await cliente.query("BEGIN");
    try {
      await cliente.query(rollback);
      for (const a of GUARDADAS) {
        const c = await catalogo(cliente, a);
        assert.equal(c.hash, HASH_ANTERIOR[a], `${a}: o rollback não voltou ao corpo anterior`);
        assert.ok(!c.def.includes("is_admin_atual"), `${a}: a guarda sobreviveu ao rollback`);
        assert.equal(c.acl, depoisDaMigration[a].acl, `${a}: ACL mudou`);
        assert.equal(c.prosecdef, depoisDaMigration[a].prosecdef);
        assert.equal(c.config, depoisDaMigration[a].config);
      }
      for (const a of FUNCOES_NOVAS) {
        assert.equal(await catalogo(cliente, a), null, `${a} sobreviveu ao rollback`);
      }
      const pol = await politicas(cliente);
      for (const [nome, [qual, checagem]] of Object.entries(POLITICAS_ANTES)) {
        assert.equal(pol[nome].qual, qual, `${nome}: USING não voltou`);
        assert.equal(pol[nome].checagem, checagem, `${nome}: WITH CHECK não voltou`);
        const depois = depoisDaMigration.politicas[nome];
        assert.equal(pol[nome].cmd, depois.cmd);
        assert.equal(pol[nome].papeis, depois.papeis);
        assert.equal(pol[nome].permissiva, depois.permissiva);
      }
      // A política do dono não foi tocada nem pela migration nem pelo rollback.
      assert.deepEqual(
        pol["order_refunds.order_refunds_cliente_le"],
        depoisDaMigration.politicas["order_refunds.order_refunds_cliente_le"],
      );
      // Rollback duas vezes: o preflight recusa (não há o que desfazer).
      await cliente.query("SAVEPOINT segundo");
      await assert.rejects(cliente.query(rollback), /B1_BASELINE_DIVERGENT/);
      await cliente.query("ROLLBACK TO SAVEPOINT segundo");
      // E a migration reaplica por cima do rollback, de volta ao mesmo estado.
      await cliente.query(migration);
      assert.deepEqual(await estado(cliente), depoisDaMigration, "reaplicar depois do rollback divergiu");
    } finally {
      await cliente.query("ROLLBACK");
    }
    // Rollback por cima de um estado vivo que NÃO é o desta migration (a
    // primeira RPC da lista; rls_admin_atual, a última função; e uma
    // política): recusa SEM NENHUMA escrita.
    const divergencias = [
      [
        "solicitar_estorno",
        async () => {
          const def = (await catalogo(cliente, "public.solicitar_estorno(uuid,numeric,text)")).def;
          const d = def.replace("'Pedido não encontrado.'", "'Pedido nao encontrado (divergente).'");
          assert.notEqual(d, def);
          await cliente.query(d);
        },
      ],
      [
        "rls_admin_atual",
        async () => {
          const def = (await catalogo(cliente, "public.rls_admin_atual()")).def;
          const d = def.replace("só devolve o boolean", "só devolve o boolean (divergente)");
          assert.notEqual(d, def);
          await cliente.query(d);
        },
      ],
      [
        "marketplace_orders_select_policy",
        () =>
          cliente.query(
            "ALTER POLICY marketplace_orders_select_policy ON public.marketplace_orders USING (((SELECT auth.uid()) = user_id))",
          ),
      ],
    ];
    for (const [rotulo, divergir] of divergencias) {
      await cliente.query("BEGIN");
      try {
        await divergir();
        const antesDoRollback = await estado(cliente);
        await cliente.query("SAVEPOINT reverter");
        await assert.rejects(cliente.query(rollback), /B1_BASELINE_DIVERGENT/, rotulo);
        await cliente.query("ROLLBACK TO SAVEPOINT reverter");
        assert.deepEqual(await estado(cliente), antesDoRollback, `rollback recusado (${rotulo}) escreveu algo`);
      } finally {
        await cliente.query("ROLLBACK");
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
        anexarAoSummary("Prova viva do admin atual nas RPCs de dinheiro (rpc-ci)", linhas.join("\n"));
        falhar("FALHOU", "Uma regra do admin atual foi quebrada — ver acima qual.");
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(`\n[admin-atual] ${PROVAS.length}/${PROVAS.length} provas passaram.`);
  anexarAoSummary(
    "Prova viva do admin atual nas RPCs de dinheiro (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
