"use strict";

/**
 * PROVA VIVA da migration 20261183000000_o_crm_ve_todo_mundo.sql (pedido do
 * dono, 27/09/2026: "Todos os clientes" mostra todo mundo, não só quem
 * pagou) contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 *   (a) comprador continua no MESMO segmento RFM de antes (a mudança não
 *       toca crm__clientes_rfm nem o grupo 0 da união).
 *   (b) identidade com pedido criado e NENHUM pago vira `pediu_nao_pagou`,
 *       com `valor_em_aberto` = soma dos `aguardando` e `pedidos` = TODOS os
 *       pedidos daquela identidade (qualquer status).
 *   (c) conta cadastrada sem pedido nenhum vira `nunca_comprou`.
 *   (d) admin/gerente/vendedor NUNCA aparecem em `nunca_comprou` mesmo sem
 *       pedido nenhum.
 *   (e) balcão sem WhatsApp e sem conta não cria cliente nenhum (nem em
 *       `pediu_nao_pagou`) — não há chave para amarrar o registro.
 *   (f) `p_segmento` e busca (nome/e-mail/WhatsApp) funcionam nos dois
 *       grupos novos.
 *   (g) `crm_visao` traz os dois segmentos novos (mesmo com 0, quando for o
 *       caso) e o resto (kpis/canais/formas/funil/pipeline) continua
 *       calculado só a partir de quem pagou.
 *   (h) porta: anon/authenticated sem admin recebem 42501 nas duas RPCs.
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
const U_GERENTE = "63333333-3333-3333-3333-333333333334";
const U_COMPRADOR = "64444444-4444-4444-4444-000000000001";
const U_NAO_PAGOU = "64444444-4444-4444-4444-000000000002";
const U_NUNCA_COMPROU = "64444444-4444-4444-4444-000000000003";

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
async function pedido(cliente, o) {
  contador += 1;
  const quando = `now() - make_interval(days => ${Number(o.diasAtras || 0)})`;
  await cliente.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, pagamento_recebido_em, created_at)
     VALUES ($1, $2, $3::jsonb, $4, $4, $5, $6, $7, $8,
             CASE WHEN $8 IN ('pago', 'pago_apos_expirar') AND $7 = 'online' THEN ${quando} END,
             CASE WHEN $8 IN ('pago', 'recebido_na_entrega') AND $7 <> 'online' THEN ${quando} END,
             ${quando})`,
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

const PROVAS = [];

PROVAS.push({
  nome: "(a)-(e) monta as identidades: comprador, pediu-e-não-pagou, nunca-comprou, staff sem pedido e balcão sem WhatsApp",
  corpo: async (cliente) => {
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
         ($1, 'admin@crmtodos.teste', '{"role":"admin"}'::jsonb),
         ($2, 'gerente@crmtodos.teste', '{}'::jsonb),
         ($3, 'comprador@crmtodos.teste', '{}'::jsonb),
         ($4, 'naopagou@crmtodos.teste', '{}'::jsonb),
         ($5, 'nuncacomprou@crmtodos.teste', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN, U_GERENTE, U_COMPRADOR, U_NAO_PAGOU, U_NUNCA_COMPROU],
    );
    // profiles: handle_new_user não roda aqui (sem trigger em auth.users
    // nesta emulação) — insere direto como o app faria depois do signup.
    await cliente.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Admin da Loja', 'admin'),
         ($2, 'Gerente Sem Pedido', 'gerente'),
         ($3, 'Cliente Comprador', 'customer'),
         ($4, 'Cliente Não Pagou', 'customer'),
         ($5, 'Cliente Nunca Comprou', 'customer')
       ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, role = EXCLUDED.role`,
      [U_ADMIN, U_GERENTE, U_COMPRADOR, U_NAO_PAGOU, U_NUNCA_COMPROU],
    );

    // Comprador: 1 pedido pago recente → RFM 'novos' (r=5, pouca frequência).
    await pedido(cliente, {
      userId: U_COMPRADOR,
      total: 150,
      diasAtras: 1,
      status: "delivered",
      paymentStatus: "pago",
    });

    // Pediu e não pagou: 2 pedidos, nenhum pago — 1 aguardando (conta como
    // valor em aberto) e 1 recusado (não conta no valor em aberto, mas
    // conta em "pedidos").
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

    // Nunca comprou: só o cadastro, nenhum pedido (U_NUNCA_COMPROU já tem
    // profile acima, sem INSERT em marketplace_orders).

    // Staff sem pedido nenhum: NÃO pode virar "nunca_comprou".
    // (U_GERENTE já tem profile role='gerente' acima, sem pedido.)

    // Balcão sem WhatsApp e sem conta, não pago: sem chave nenhuma — não
    // pode criar cliente em grupo nenhum.
    await pedido(cliente, {
      total: 25,
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

    // (a) comprador no segmento RFM de sempre, grupo 0 (crm__clientes_rfm intocado).
    const comprador = porChave.get(U_COMPRADOR);
    assert.ok(comprador, "comprador aparece na lista");
    assert.equal(comprador.segmento, "novos");
    assert.equal(num(comprador.pedidos), 1);
    assert.equal(num(comprador.receita), 150);

    // (b) pediu e não pagou.
    const naoPagou = porChave.get(U_NAO_PAGOU);
    assert.ok(naoPagou, "quem só pediu e não pagou aparece na lista");
    assert.equal(naoPagou.segmento, "pediu_nao_pagou");
    assert.equal(
      num(naoPagou.pedidos),
      2,
      "conta os DOIS pedidos, qualquer status",
    );
    assert.equal(num(naoPagou.receita), 0, "receita fixa em 0 — nada foi pago");
    assert.equal(
      num(naoPagou.valor_em_aberto),
      80,
      "só o pedido 'aguardando' conta como valor em aberto, não o 'recusado'",
    );
    assert.equal(
      naoPagou.ultima_compra !== null,
      true,
      "carrega a data do pedido mais recente",
    );

    // (c) nunca comprou.
    const nuncaComprou = porChave.get(U_NUNCA_COMPROU);
    assert.ok(nuncaComprou, "conta cadastrada sem pedido aparece na lista");
    assert.equal(nuncaComprou.segmento, "nunca_comprou");
    assert.equal(num(nuncaComprou.pedidos), 0);
    assert.equal(num(nuncaComprou.receita), 0);
    assert.equal(
      nuncaComprou.ultima_compra,
      null,
      "nunca comprou não tem data de compra",
    );
    assert.equal(nuncaComprou.nome, "Cliente Nunca Comprou");

    // (d) staff sem pedido não entra em nunca_comprou (nem em grupo nenhum).
    assert.equal(
      porChave.has(U_GERENTE),
      false,
      "gerente sem pedido não vira cliente 'nunca comprou'",
    );

    // (e) balcão sem WhatsApp e sem conta não some em algum grupo — ele
    // simplesmente não pode aparecer, porque não existe chave para ele.
    const totalAntesDoBalcaoSemChave = 3; // comprador + não pagou + nunca comprou
    assert.equal(
      lista.total,
      totalAntesDoBalcaoSemChave,
      "o pedido de balcão sem WhatsApp não cria um 4º cliente",
    );
  },
});

PROVAS.push({
  nome: "(f) p_segmento e busca funcionam nos dois grupos novos",
  corpo: async (cliente) => {
    await logar(cliente, U_ADMIN);
    const soNaoPagou = await rpc(
      cliente,
      "SELECT public.crm_clientes('pediu_nao_pagou', NULL, 200, 0) AS r",
    );
    assert.deepEqual(
      soNaoPagou.clientes.map((c) => c.chave),
      [U_NAO_PAGOU],
    );
    const soNuncaComprou = await rpc(
      cliente,
      "SELECT public.crm_clientes('nunca_comprou', NULL, 200, 0) AS r",
    );
    assert.deepEqual(
      soNuncaComprou.clientes.map((c) => c.chave),
      [U_NUNCA_COMPROU],
    );
    const buscaPorNome = await rpc(
      cliente,
      "SELECT public.crm_clientes(NULL, 'Nunca Comprou', 200, 0) AS r",
    );
    assert.deepEqual(
      buscaPorNome.clientes.map((c) => c.chave),
      [U_NUNCA_COMPROU],
      "busca por nome alcança o grupo nunca_comprou",
    );
  },
});

PROVAS.push({
  nome: "(g) crm_visao traz os 2 segmentos novos; o resto continua só com dinheiro reconhecido",
  corpo: async (cliente) => {
    await logar(cliente, U_ADMIN);
    const visao = await rpc(
      cliente,
      "SELECT public.crm_visao(current_date - 6, current_date) AS r",
    );
    const segmentos = Object.fromEntries(
      visao.segmentos.map((s) => [s.segmento, s]),
    );
    assert.ok(segmentos.pediu_nao_pagou, "segmento pediu_nao_pagou presente");
    assert.equal(num(segmentos.pediu_nao_pagou.clientes), 1);
    assert.equal(
      num(segmentos.pediu_nao_pagou.receita),
      80,
      "receita do segmento pediu_nao_pagou é o valor em aberto somado",
    );
    assert.ok(segmentos.nunca_comprou, "segmento nunca_comprou presente");
    assert.equal(num(segmentos.nunca_comprou.clientes), 1);
    assert.equal(num(segmentos.nunca_comprou.receita), 0);
    // kpis continuam só com dinheiro reconhecido: só o pedido pago do
    // comprador (150) entra na receita do período.
    assert.equal(num(visao.kpis.receita), 150);
    assert.equal(num(visao.kpis.clientes_compradores), 1);
  },
});

PROVAS.push({
  nome: "(h) anon/authenticated sem admin recebem 42501 nas duas RPCs",
  corpo: async (cliente) => {
    await logar(cliente, U_COMPRADOR);
    for (const sql of [
      "SELECT public.crm_clientes() AS r",
      "SELECT public.crm_visao(current_date - 6, current_date) AS r",
    ]) {
      await assert.rejects(() => rpc(cliente, sql), /Acesso negado/);
    }
    await cliente.query("SELECT set_config('app.rpc.user_id', '', false)");
    for (const sql of [
      "SELECT public.crm_clientes() AS r",
      "SELECT public.crm_visao(current_date - 6, current_date) AS r",
    ]) {
      await assert.rejects(() => rpc(cliente, sql), /Acesso negado/);
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
