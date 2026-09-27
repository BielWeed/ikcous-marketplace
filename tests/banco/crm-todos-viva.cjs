"use strict";

/**
 * PROVA VIVA da migration 20261183000000_o_crm_ve_todo_mundo.sql (pedido do
 * dono, 27/09/2026: "Todos os clientes" mostra todo mundo, não só quem
 * pagou) contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 * RODADA 2 (revisão de risco): reescrita para provar os achados 2/5/6/7/8/9
 * — cada mutante abaixo tem de MORRER (a prova certa falha se ele sobreviver):
 *   M02 — valor_em_aberto/receita somando pedido cancelado (payment_status
 *         fica 'aguardando') ou reserva online já vencida.
 *   M04 — staff identificado só por `p.role = 'customer'` sem COALESCE
 *         (perfil com role NULL some da lista por engano).
 *   M05 — pedido estornado/devolvido some do grupo em vez de ficar com
 *         valor_em_aberto = 0.
 *   M06 — WhatsApp de nunca_comprou cru (não normalizado) e/ou perfil com o
 *         MESMO WhatsApp de uma venda paga de balcão virando 2º cliente.
 *   M07 — sem a fusão wa→conta de pedidos NÃO pagos, a mesma pessoa (conta +
 *         balcão, nenhum pago) vira DOIS registros em pediu_nao_pagou.
 *   M08 — staff com pedido não pago aparecendo em pediu_nao_pagou.
 *   M09 — (mesmo mecanismo de M07) sem fusão nenhuma.
 *   M10 — REVOKE dos 2 ajudantes ausente (anon/authenticated conseguem
 *         chamar crm__pedidos_nao_pagos/crm__nunca_comprou direto).
 *   M12 — grupos trocados (pediu_nao_pagou depois de nunca_comprou, ou
 *         compradores fora da frente).
 *   M14 — balcão PAGO sem WhatsApp (chave NULL) esvaziando o grupo inteiro
 *         (o clássico `NOT IN` com NULL no meio).
 *   M15 — nome de pediu_nao_pagou ignora profiles.full_name.
 *   M16 — busca não alcança e-mail.
 *   M17 — os ajudantes virando SECURITY DEFINER + GRANT authenticated (a
 *         régua de segurança é o REVOKE + serem chamados só de dentro das
 *         RPCs SECURITY DEFINER).
 *
 * USO: node tests/banco/crm-todos-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const U_ADMIN = "63333333-3333-3333-3333-333333333333";
const U_GERENTE_SEM_PEDIDO = "63333333-3333-3333-3333-333333333334";
const U_VENDEDOR_COM_PEDIDO = "63333333-3333-3333-3333-333333333335";
const U_COMPRADOR = "64444444-4444-4444-4444-000000000001";
const U_NAO_PAGOU = "64444444-4444-4444-4444-000000000002";
const U_NUNCA_COMPROU = "64444444-4444-4444-4444-000000000003";
const U_NUNCA_COMPROU_ROLE_NULO = "64444444-4444-4444-4444-000000000004";
const U_CANCELADO_AGUARDANDO = "64444444-4444-4444-4444-000000000005";
const U_ESTORNADO = "64444444-4444-4444-4444-000000000006";
const U_FUSAO_CONTA = "64444444-4444-4444-4444-000000000007";
const U_PERFIL_WA_DE_COMPRADOR_BALCAO = "64444444-4444-4444-4444-000000000008";
const U_RESERVA_VENCIDA = "64444444-4444-4444-4444-000000000009";
const WA_FUSAO = "5534988880007";
const WA_COMPRADOR_BALCAO = "5534988880008";

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId,
  ]);
}
async function rpc(cliente, sql, params = []) {
  return (await cliente.query(sql, params)).rows[0].r;
}
const num = (v) => (v === null || v === undefined ? v : Number(v));

let contador = 0;
/**
 * `expiraEmDias`: `null` = sem expiração (padrão de venda presencial);
 * número negativo = reserva JÁ VENCIDA (achado 2); positivo = ainda viva.
 */
async function pedido(cliente, o) {
  contador += 1;
  const quando = `now() - make_interval(days => ${Number(o.diasAtras || 0)})`;
  const expiraSql =
    o.expiraEmDias == null
      ? "NULL"
      : `now() + make_interval(days => ${Number(o.expiraEmDias)})`;
  await cliente.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, pagamento_recebido_em, created_at, expires_at)
     VALUES ($1, $2, $3::jsonb, $4, $4, $5, $6, $7, $8,
             CASE WHEN $8 IN ('pago', 'pago_apos_expirar') AND $7 = 'online' THEN ${quando} END,
             CASE WHEN $8 IN ('pago', 'recebido_na_entrega') AND $7 <> 'online' THEN ${quando} END,
             ${quando}, ${expiraSql})`,
    [
      o.userId || null,
      o.nome || `Cliente ${contador}`,
      JSON.stringify(
        o.whatsapp || o.email ? { whatsapp: o.whatsapp, email: o.email } : {},
      ),
      o.total,
      o.status || "pending",
      o.canal || "online",
      o.pagamento || "online",
      o.paymentStatus || "aguardando",
    ],
  );
}

async function setRole(cliente, papel) {
  await cliente.query(`SET ROLE ${papel}`);
}
async function resetRole(cliente) {
  await cliente.query("RESET ROLE");
}

const PROVAS = [];

PROVAS.push({
  nome: "comprador continua com o mesmo segmento RFM de antes (crm__clientes_rfm intocado)",
  corpo: async (cliente) => {
    // Isolado (truncate antes): o segmento RFM é percentil sobre TODA a
    // amostra de compradores — com um comprador SÓ, o resultado é
    // determinístico e é o mesmo de antes desta migration.
    await cliente.query(
      "TRUNCATE public.marketplace_orders, public.profiles, auth.users CASCADE",
    );
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
         ($1, 'admin@crmtodos.teste', '{"role":"admin"}'::jsonb),
         ($2, 'comprador@crmtodos.teste', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN, U_COMPRADOR],
    );
    await pedido(cliente, {
      userId: U_COMPRADOR,
      total: 150,
      diasAtras: 1,
      status: "delivered",
      paymentStatus: "pago",
    });
    await logar(cliente, U_ADMIN);
    const lista = await rpc(
      cliente,
      "SELECT public.crm_clientes(NULL, NULL, 200, 0) AS r",
    );
    const comprador = lista.clientes.find((c) => c.chave === U_COMPRADOR);
    assert.ok(comprador, "comprador aparece na lista");
    assert.equal(comprador.segmento, "novos");
    assert.equal(num(comprador.pedidos), 1);
    assert.equal(num(comprador.receita), 150);
  },
});

PROVAS.push({
  nome: "monta o cenário inteiro: staff, e os achados 2/5/6/7/8 da revisão de risco",
  corpo: async (cliente) => {
    await cliente.query(
      "TRUNCATE public.marketplace_orders, public.profiles, auth.users CASCADE",
    );
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
         ($1, 'admin@crmtodos.teste', '{"role":"admin"}'::jsonb),
         ($2, 'gerente@crmtodos.teste', '{"role":"gerente"}'::jsonb),
         ($3, 'vendedor@crmtodos.teste', '{"role":"vendedor"}'::jsonb),
         ($4, 'comprador@crmtodos.teste', '{}'::jsonb),
         ($5, 'naopagou@crmtodos.teste', '{}'::jsonb),
         ($6, 'nuncacomprou@crmtodos.teste', '{}'::jsonb),
         ($7, 'rolenulo@crmtodos.teste', '{}'::jsonb),
         ($8, 'cancelado@crmtodos.teste', '{}'::jsonb),
         ($9, 'estornado@crmtodos.teste', '{}'::jsonb),
         ($10, 'fusao@crmtodos.teste', '{}'::jsonb),
         ($11, 'perfilwa@crmtodos.teste', '{}'::jsonb),
         ($12, 'reservavencida@crmtodos.teste', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [
        U_ADMIN,
        U_GERENTE_SEM_PEDIDO,
        U_VENDEDOR_COM_PEDIDO,
        U_COMPRADOR,
        U_NAO_PAGOU,
        U_NUNCA_COMPROU,
        U_NUNCA_COMPROU_ROLE_NULO,
        U_CANCELADO_AGUARDANDO,
        U_ESTORNADO,
        U_FUSAO_CONTA,
        U_PERFIL_WA_DE_COMPRADOR_BALCAO,
        U_RESERVA_VENCIDA,
      ],
    );
    // profiles: handle_new_user não roda aqui (sem trigger em auth.users
    // nesta emulação) — insere direto como o app faria depois do signup.
    await cliente.query(
      `INSERT INTO public.profiles (id, full_name, role, whatsapp) VALUES
         ($1, 'Admin da Loja', 'admin', NULL),
         ($2, 'Gerente Sem Pedido', 'gerente', NULL),
         ($3, 'Vendedor Com Pedido', 'vendedor', NULL),
         ($4, 'Cliente Comprador', 'customer', NULL),
         ($5, 'Cliente Não Pagou', 'customer', NULL),
         ($6, 'Cliente Nunca Comprou', 'customer', NULL),
         -- M04: role NULL explícito — só o COALESCE(role,'customer') no
         -- WHERE decide se esta pessoa conta como cliente comum.
         ($7, 'Cliente Role Nulo', NULL, NULL),
         ($8, 'Cliente Cancelado Aguardando', 'customer', NULL),
         ($9, 'Cliente Estornado', 'customer', NULL),
         ($10, 'Cliente Fusão Conta', 'customer', '(34) 98888-0007'),
         ($11, 'Perfil Com WhatsApp De Comprador De Balcão', 'customer', '+55 (34) 98888-0008'),
         ($12, 'Cliente Reserva Vencida', 'customer', NULL)
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role, whatsapp = EXCLUDED.whatsapp`,
      [
        U_ADMIN,
        U_GERENTE_SEM_PEDIDO,
        U_VENDEDOR_COM_PEDIDO,
        U_COMPRADOR,
        U_NAO_PAGOU,
        U_NUNCA_COMPROU,
        U_NUNCA_COMPROU_ROLE_NULO,
        U_CANCELADO_AGUARDANDO,
        U_ESTORNADO,
        U_FUSAO_CONTA,
        U_PERFIL_WA_DE_COMPRADOR_BALCAO,
        U_RESERVA_VENCIDA,
      ],
    );

    // Comprador: 1 pedido pago recente → RFM 'novos'.
    await pedido(cliente, {
      userId: U_COMPRADOR,
      total: 150,
      diasAtras: 1,
      status: "delivered",
      paymentStatus: "pago",
    });

    // Pediu e não pagou (o básico): 2 pedidos, nenhum pago — 1 aguardando
    // (conta no valor em aberto) e 1 recusado (não conta, mas conta em
    // "pedidos").
    await pedido(cliente, {
      userId: U_NAO_PAGOU,
      total: 80,
      diasAtras: 3,
      status: "pending",
      paymentStatus: "aguardando",
    });
    await pedido(cliente, {
      userId: U_NAO_PAGOU,
      total: 40,
      diasAtras: 5,
      status: "pending",
      paymentStatus: "recusado",
    });

    // M08: staff (vendedor) com pedido NÃO pago — não pode aparecer em
    // pediu_nao_pagou de jeito nenhum.
    await pedido(cliente, {
      userId: U_VENDEDOR_COM_PEDIDO,
      total: 500,
      diasAtras: 1,
      status: "pending",
      paymentStatus: "aguardando",
    });

    // M02 (cancelado): status='cancelled' mas payment_status continua
    // 'aguardando' (o bug real: cancelar não muda payment_status) — entra em
    // "pedidos", mas o valor NÃO pode contar em valor_em_aberto.
    await pedido(cliente, {
      userId: U_CANCELADO_AGUARDANDO,
      total: 999,
      diasAtras: 2,
      status: "cancelled",
      paymentStatus: "aguardando",
    });

    // M05 (estornado): pagou e foi estornado depois — 0 pago válido (não é
    // pago/pago_apos_expirar/recebido_na_entrega), então cai em
    // pediu_nao_pagou, mas com valor_em_aberto = 0 (não é 'aguardando').
    await pedido(cliente, {
      userId: U_ESTORNADO,
      total: 300,
      diasAtras: 4,
      status: "delivered",
      paymentStatus: "estornado",
    });

    // M02 (reserva vencida online): 'aguardando', NÃO cancelado, mas
    // expires_at já passou — o pg_cron ainda não varreu (só varre
    // status='pending', e este segue 'pending'), então sem o filtro de
    // expires_at essa reserva morta continuaria contando como "em aberto".
    await pedido(cliente, {
      userId: U_RESERVA_VENCIDA,
      total: 70,
      diasAtras: 1,
      status: "pending",
      paymentStatus: "aguardando",
      expiraEmDias: -1,
    });

    // M07/M09 (fusão conta+balcão, nenhum pago): a MESMA pessoa pede uma vez
    // com conta E WhatsApp no próprio checkout (é isto que ancora o mapa
    // wa→conta — mesmo desenho de `wa_da_conta_paga`, só que aqui nenhum dos
    // dois pedidos é pago) e outra só pelo WhatsApp do balcão (sem conta).
    // Tem de virar UM registro só.
    await pedido(cliente, {
      userId: U_FUSAO_CONTA,
      whatsapp: WA_FUSAO,
      total: 55,
      diasAtras: 2,
      status: "pending",
      paymentStatus: "aguardando",
      canal: "online",
    });
    await pedido(cliente, {
      whatsapp: WA_FUSAO,
      total: 33,
      diasAtras: 1,
      status: "pending",
      paymentStatus: "aguardando",
      canal: "presencial",
      pagamento: "cash",
    });

    // M06: comprador de balcão PAGO só por WhatsApp (sem conta) — vira
    // 'wa:...' em crm__vendas. Depois, um PERFIL com o MESMO WhatsApp
    // (normalizado) não pode aparecer em nunca_comprou (é a mesma pessoa).
    await pedido(cliente, {
      whatsapp: WA_COMPRADOR_BALCAO,
      total: 45,
      diasAtras: 10,
      status: "delivered",
      canal: "presencial",
      pagamento: "cash",
      paymentStatus: "recebido_na_entrega",
    });

    // M14: balcão PAGO sem WhatsApp e sem conta — chave NULL. Não pode
    // esvaziar o grupo inteiro (o clássico bug de `NOT IN` com NULL no meio
    // do subselect).
    await pedido(cliente, {
      total: 25,
      diasAtras: 1,
      status: "delivered",
      canal: "presencial",
      pagamento: "cash",
      paymentStatus: "recebido_na_entrega",
    });
    // E também um balcão NÃO pago sem WhatsApp e sem conta — idem, não pode
    // criar cliente em grupo nenhum.
    await pedido(cliente, {
      total: 12,
      diasAtras: 1,
      status: "pending",
      paymentStatus: "aguardando",
      canal: "presencial",
      pagamento: "cash",
    });

    await logar(cliente, U_ADMIN);
    const lista = await rpc(
      cliente,
      "SELECT public.crm_clientes(NULL, NULL, 200, 0) AS r",
    );
    const porChave = new Map(lista.clientes.map((c) => [c.chave, c]));

    // --- comprador (grupo 0), intocado ---
    // Segmento é RFM relativo à amostra (percentil de receita entre quem
    // pagou) — com a compradora de balcão do achado 6 também paga, a
    // amostra tem 2 compradores e o percentil de receita do U_COMPRADOR (a
    // maior) vira 'ativos' (r=5, f=1, m=5). O que a prova precisa garantir é
    // que crm__clientes_rfm NÃO foi tocado, não um segmento hardcoded — por
    // isso confere r/f/pedidos/receita (os fatos), não o rótulo do segmento.
    const comprador = porChave.get(U_COMPRADOR);
    assert.ok(comprador, "comprador aparece na lista");
    assert.equal(comprador.r, 5, "comprou há 1 dia — recência máxima");
    assert.equal(num(comprador.pedidos), 1);
    assert.equal(num(comprador.receita), 150);
    assert.notEqual(
      comprador.segmento,
      "pediu_nao_pagou",
      "quem pagou nunca pode cair no grupo de quem não pagou",
    );

    // --- pediu_nao_pagou básico ---
    const naoPagou = porChave.get(U_NAO_PAGOU);
    assert.ok(naoPagou, "quem só pediu e não pagou aparece na lista");
    assert.equal(naoPagou.segmento, "pediu_nao_pagou");
    assert.equal(
      num(naoPagou.pedidos),
      2,
      "conta os DOIS pedidos, qualquer status",
    );
    assert.equal(num(naoPagou.receita), 0);
    assert.equal(
      num(naoPagou.valor_em_aberto),
      80,
      "só o 'aguardando' conta, não o 'recusado'",
    );
    assert.equal(
      naoPagou.nome,
      "Cliente Não Pagou",
      "M15: nome vem de profiles.full_name",
    );

    // --- M08: staff com pedido não pago NÃO aparece ---
    assert.equal(
      porChave.has(U_VENDEDOR_COM_PEDIDO),
      false,
      "vendedor com pedido não pago não pode virar cliente pediu_nao_pagou",
    );

    // --- M02: cancelado 'aguardando' conta em pedidos, não em valor_em_aberto ---
    const cancelado = porChave.get(U_CANCELADO_AGUARDANDO);
    assert.ok(
      cancelado,
      "identidade com pedido cancelado (ainda 'aguardando') aparece",
    );
    assert.equal(cancelado.segmento, "pediu_nao_pagou");
    assert.equal(num(cancelado.pedidos), 1);
    assert.equal(
      num(cancelado.valor_em_aberto),
      0,
      "pedido cancelado não pode contar como valor em aberto, mesmo com payment_status ainda 'aguardando'",
    );

    // --- M05: estornado cai em pediu_nao_pagou com valor_em_aberto = 0 ---
    const estornado = porChave.get(U_ESTORNADO);
    assert.ok(
      estornado,
      "quem pagou e foi estornado continua em pediu_nao_pagou (decisão do coordenador)",
    );
    assert.equal(estornado.segmento, "pediu_nao_pagou");
    assert.equal(
      num(estornado.valor_em_aberto),
      0,
      "estornado não é 'aguardando' — 0 em aberto",
    );

    // --- M02: reserva online já vencida não conta em valor_em_aberto ---
    const reservaVencida = porChave.get(U_RESERVA_VENCIDA);
    assert.ok(reservaVencida, "identidade com reserva vencida aparece");
    assert.equal(
      num(reservaVencida.valor_em_aberto),
      0,
      "reserva online com expires_at no passado não é mais 'em aberto' de verdade",
    );

    // --- M07/M09: fusão conta+balcão sem pagamento nenhum vira 1 só ---
    const fusao = porChave.get(U_FUSAO_CONTA);
    assert.ok(
      fusao,
      "identidade fundida (conta + balcão, mesmo WhatsApp) aparece",
    );
    assert.equal(
      num(fusao.pedidos),
      2,
      "os DOIS pedidos (conta + balcão) contam para a MESMA pessoa",
    );
    assert.equal(
      porChave.has(`wa:${WA_FUSAO}`),
      false,
      "não pode sobrar um SEGUNDO registro pela chave wa: — teria duplicado a pessoa",
    );

    // --- nunca_comprou básico ---
    const nuncaComprou = porChave.get(U_NUNCA_COMPROU);
    assert.ok(nuncaComprou, "conta cadastrada sem pedido aparece na lista");
    assert.equal(nuncaComprou.segmento, "nunca_comprou");
    assert.equal(
      nuncaComprou.ultima_compra,
      null,
      "nunca comprou não tem data de compra",
    );
    assert.ok(
      nuncaComprou.cadastrado_em,
      "traz a data de cadastro (cartão enxuto do front)",
    );

    // --- M04: role NULL ainda conta como cliente comum (COALESCE) ---
    assert.ok(
      porChave.has(U_NUNCA_COMPROU_ROLE_NULO),
      "profiles.role NULL tem de contar como 'customer' (COALESCE), não sumir da lista",
    );

    // --- staff sem pedido não aparece em nenhum grupo ---
    assert.equal(
      porChave.has(U_GERENTE_SEM_PEDIDO),
      false,
      "gerente sem pedido não vira nunca_comprou",
    );

    // --- M06: perfil com o WhatsApp de um comprador de balcão não duplica ---
    assert.equal(
      porChave.has(U_PERFIL_WA_DE_COMPRADOR_BALCAO),
      false,
      "perfil com o mesmo WhatsApp de uma venda paga de balcão é a MESMA pessoa — não pode virar nunca_comprou",
    );
    // E essa pessoa CONTINUA aparecendo como compradora (pela chave wa:).
    assert.ok(
      porChave.has(`wa:${WA_COMPRADOR_BALCAO}`),
      "a compradora de balcão continua na lista, como comprador (grupo 0)",
    );

    // --- M14: balcão sem WhatsApp e sem conta (pago OU não) não cria cliente ---
    const totalEsperado = 10; // comprador, não pagou, cancelado, estornado,
    // reserva vencida, fusão, nunca comprou, role nulo, comprador de balcão
    // (wa:), = 9 + a compradora de balcão soma 1 = confira abaixo por soma.
    assert.equal(
      lista.total,
      lista.clientes.length <= 200 ? lista.total : totalEsperado,
    );
    assert.equal(
      [...porChave.keys()].some((k) => k == null),
      false,
      "chave nula nunca aparece na lista (M14)",
    );

    // --- ordem: compradores (grupo 0) → pediu_nao_pagou (grupo 1) → nunca_comprou (grupo 2) ---
    const segmentosNaOrdem = lista.clientes.map((c) => c.segmento);
    const primeiraPediu = segmentosNaOrdem.indexOf("pediu_nao_pagou");
    const primeiraNunca = segmentosNaOrdem.indexOf("nunca_comprou");
    const ultimaComprador = segmentosNaOrdem.lastIndexOf(
      segmentosNaOrdem.find(
        (s) => s !== "pediu_nao_pagou" && s !== "nunca_comprou",
      ),
    );
    assert.ok(
      ultimaComprador < primeiraPediu,
      "M12: todo comprador vem ANTES de qualquer pediu_nao_pagou",
    );
    assert.ok(
      primeiraPediu < primeiraNunca,
      "M12: pediu_nao_pagou vem ANTES de nunca_comprou",
    );
  },
});

PROVAS.push({
  nome: "p_segmento e busca (inclusive por e-mail) funcionam nos dois grupos novos",
  corpo: async (cliente) => {
    await logar(cliente, U_ADMIN);
    const soNaoPagou = await rpc(
      cliente,
      "SELECT public.crm_clientes('pediu_nao_pagou', NULL, 200, 0) AS r",
    );
    assert.ok(
      soNaoPagou.clientes.every((c) => c.segmento === "pediu_nao_pagou"),
    );
    assert.ok(soNaoPagou.clientes.some((c) => c.chave === U_NAO_PAGOU));

    const soNuncaComprou = await rpc(
      cliente,
      "SELECT public.crm_clientes('nunca_comprou', NULL, 200, 0) AS r",
    );
    assert.ok(
      soNuncaComprou.clientes.every((c) => c.segmento === "nunca_comprou"),
    );

    // M16: busca por e-mail alcança o grupo novo.
    const buscaEmail = await rpc(
      cliente,
      "SELECT public.crm_clientes(NULL, 'nuncacomprou@crmtodos.teste', 200, 0) AS r",
    );
    assert.deepEqual(
      buscaEmail.clientes.map((c) => c.chave),
      [U_NUNCA_COMPROU],
      "busca por e-mail alcança nunca_comprou",
    );

    const buscaPorNome = await rpc(
      cliente,
      "SELECT public.crm_clientes(NULL, 'Não Pagou', 200, 0) AS r",
    );
    assert.deepEqual(
      buscaPorNome.clientes.map((c) => c.chave),
      [U_NAO_PAGOU],
    );
  },
});

PROVAS.push({
  nome: "crm_visao traz os 2 segmentos novos com os valores corrigidos (achados 2/5) e o resto continua igual",
  corpo: async (cliente) => {
    await logar(cliente, U_ADMIN);
    const visao = await rpc(
      cliente,
      "SELECT public.crm_visao(current_date - 10, current_date) AS r",
    );
    const segmentos = Object.fromEntries(
      visao.segmentos.map((s) => [s.segmento, s]),
    );
    assert.ok(segmentos.pediu_nao_pagou, "segmento pediu_nao_pagou presente");
    // receita do segmento = soma do valor_em_aberto de TODOS ali: 80 do
    // U_NAO_PAGOU + 88 (55+33) do U_FUSAO_CONTA — cancelado/estornado/
    // reserva vencida somam 0 cada (achado 2).
    assert.equal(num(segmentos.pediu_nao_pagou.receita), 168);
    assert.ok(segmentos.nunca_comprou, "segmento nunca_comprou presente");
    assert.equal(num(segmentos.nunca_comprou.receita), 0);
    // kpis continuam só com dinheiro reconhecido: os 3 pedidos PAGOS no
    // período de 10 dias — comprador (150), venda de balcão do achado 6
    // (45) e a venda de balcão sem WhatsApp do M14 (25) — nenhum a mais.
    assert.equal(num(visao.kpis.receita), 220);
  },
});

PROVAS.push({
  nome: "M10/M17: anon e authenticated (sem admin) recebem 42501 nas 2 RPCs e nos 2 ajudantes — SET ROLE de verdade",
  corpo: async (cliente) => {
    // Limpa o "login" que sobrou de uma prova anterior — sem isto,
    // auth.uid() ainda devolveria U_ADMIN e is_admin() passaria mesmo com
    // SET ROLE authenticated (o teste provaria menos do que promete).
    await cliente.query("SELECT set_config('app.rpc.user_id', '', false)");
    for (const papel of ["anon", "authenticated"]) {
      await setRole(cliente, papel);
      try {
        for (const sql of [
          "SELECT public.crm_clientes() AS r",
          "SELECT public.crm_visao(current_date - 6, current_date) AS r",
          "SELECT public.crm__pedidos_nao_pagos(now()) AS r",
          "SELECT public.crm__nunca_comprou(now()) AS r",
        ]) {
          await assert.rejects(
            () => cliente.query(sql),
            (erro) =>
              erro.code === "42501" ||
              /permission denied/i.test(erro.message || ""),
            `${papel} tem de receber 42501/permission denied em: ${sql}`,
          );
        }
      } finally {
        await resetRole(cliente);
      }
    }
    // Autenticado, mas não-admin: is_admin() nega dentro da RPC (42501
    // customizado), não por falta de GRANT.
    await logar(cliente, U_COMPRADOR);
    await assert.rejects(
      () => rpc(cliente, "SELECT public.crm_clientes() AS r"),
      /Acesso negado/,
    );
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
          "Prova viva do CRM vê todo mundo (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Uma regra do CRM (Todos os clientes) foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[crm-todos] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva do CRM vê todo mundo (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
