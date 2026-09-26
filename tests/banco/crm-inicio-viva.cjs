"use strict";

/**
 * PROVA VIVA da migration 20261178000000_o_crm_e_o_inicio_leem_a_loja.sql
 * (plano docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md,
 * tarefa 4) contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 *   (a) porta: só admin chama crm_visao, crm_clientes e painel_inicio.
 *   (b) RFM: quatro clientes montados para cair em quatro segmentos
 *       conhecidos (campeoes, novos, quase_dormindo, em_risco); o balcão sem
 *       conta com o WhatsApp de um cliente com conta vira o MESMO cliente.
 *   (c) KPIs: receita e pedidos do período × anterior, canais, compradores,
 *       novos, recompra, receita recorrente, LTV, receita em risco; pedido
 *       cancelado não conta.
 *   (d) Início: hoje × semana passada, o mês bate com o CRM do mesmo período,
 *       saldo = soma das contas, pendências.
 *
 * USO: node tests/banco/crm-inicio-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const U_ADMIN = "62222222-2222-2222-2222-222222222222";
const C1 = "61111111-1111-1111-1111-000000000001";
const C2 = "61111111-1111-1111-1111-000000000002";
const C4 = "61111111-1111-1111-1111-000000000004";
const WA_C2 = "5534988887777";
const WA_C3 = "5534911112222";
const P_BAIXO = "6aaaaaaa-0000-0000-0000-000000000001";

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId,
  ]);
}
async function rpc(cliente, sql, params = []) {
  return (await cliente.query(sql, params)).rows[0].r;
}
const num = (v) => Math.round(Number(v) * 10000) / 10000;

let contador = 0;
async function venda(cliente, o) {
  contador += 1;
  const quando = `now() - make_interval(days => ${Number(o.diasAtras)})`;
  await cliente.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, pagamento_recebido_em, created_at)
     VALUES ($1, $2, $3::jsonb, $4, $4, $5, $6, $7, $8,
             CASE WHEN $7 = 'online' THEN ${quando} END,
             CASE WHEN $7 <> 'online' THEN ${quando} END,
             ${quando})`,
    [
      o.userId || null,
      o.nome || `Cliente ${contador}`,
      JSON.stringify(o.whatsapp ? { whatsapp: o.whatsapp } : {}),
      o.total,
      o.status || "delivered",
      o.canal || "online",
      o.pagamento || "online",
      o.paymentStatus ||
        (o.pagamento && o.pagamento !== "online"
          ? "recebido_na_entrega"
          : "pago"),
    ],
  );
}

const PROVAS = [];
const estado = {};

PROVAS.push({
  nome: "(a)(b) porta de admin; RFM em quatro segmentos e o balcão vira o mesmo cliente pelo WhatsApp",
  corpo: async (cliente) => {
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
         ($1, 'admin@crm.teste', '{"role":"admin"}'::jsonb),
         ($2, 'c1@crm.teste', '{}'::jsonb), ($3, 'c2@crm.teste', '{}'::jsonb), ($4, 'c4@crm.teste', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN, C1, C2, C4],
    );
    // C1: 7 pedidos de 100 nos últimos 7 dias (hoje incluso) → campeoes
    for (let d = 0; d < 7; d += 1)
      await venda(cliente, {
        userId: C1,
        total: 100,
        diasAtras: d,
        status: d === 0 ? "processing" : "delivered",
      });
    // C1: pedido pago e cancelado — não conta
    await venda(cliente, {
      userId: C1,
      total: 999,
      diasAtras: 2,
      status: "cancelled",
    });
    // C2: 1 pedido pelo app (50, há 10 dias, com WhatsApp) + 1 no balcão só com o WhatsApp (30, há 5 dias) → novos
    await venda(cliente, {
      userId: C2,
      whatsapp: WA_C2,
      total: 50,
      diasAtras: 10,
    });
    await venda(cliente, {
      whatsapp: `+55 (34) 98888-7777`,
      total: 30,
      diasAtras: 5,
      canal: "presencial",
      pagamento: "cash",
    });
    // C3: só WhatsApp, 2 compras de 40 há ~100 dias no balcão → quase_dormindo
    await venda(cliente, {
      whatsapp: WA_C3,
      total: 40,
      diasAtras: 100,
      canal: "presencial",
      pagamento: "pix",
    });
    await venda(cliente, {
      whatsapp: WA_C3,
      total: 40,
      diasAtras: 101,
      canal: "presencial",
      pagamento: "pix",
    });
    // C4: 3 pedidos de 400 há ~300 dias → em_risco
    for (const d of [300, 301, 302])
      await venda(cliente, { userId: C4, total: 400, diasAtras: d });
    // Esteira: um pendente aguardando PIX (fora) e um novo para pagar na entrega (dentro)
    await venda(cliente, {
      userId: C2,
      total: 10,
      diasAtras: 0,
      status: "pending",
      paymentStatus: "aguardando",
    });
    await cliente.query(
      `INSERT INTO public.marketplace_orders (customer_name, customer_data, total, subtotal, status, canal, payment_method, created_at)
       VALUES ('Na entrega', '{}'::jsonb, 20, 20, 'new', 'online', 'cash', now() - interval '3 hours')`,
    );
    await cliente.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, estoque, estoque_minimo, ativo) VALUES ($1, 'Acabando', 10, 1, 3, true)`,
      [P_BAIXO],
    );

    await logar(cliente, C1);
    for (const sql of [
      "SELECT public.crm_visao(current_date - 29, current_date) AS r",
      "SELECT public.crm_clientes() AS r",
      "SELECT public.painel_inicio() AS r",
    ]) {
      await assert.rejects(() => rpc(cliente, sql), /Acesso negado/);
    }

    await logar(cliente, U_ADMIN);
    const lista = await rpc(cliente, "SELECT public.crm_clientes() AS r");
    assert.equal(
      lista.total,
      4,
      "o balcão com o WhatsApp do C2 não vira um quinto cliente",
    );
    const porChave = new Map(lista.clientes.map((c) => [c.chave, c]));
    assert.equal(porChave.get(C1).segmento, "campeoes");
    assert.equal(porChave.get(C1).pedidos, 7);
    assert.equal(porChave.get(C2).segmento, "novos");
    assert.equal(porChave.get(C2).pedidos, 2, "app + balcão do mesmo cliente");
    assert.equal(porChave.get(`wa:${WA_C3}`).segmento, "quase_dormindo");
    assert.equal(porChave.get(C4).segmento, "em_risco");
    assert.equal(lista.clientes[0].chave, C4, "ordenado por receita");

    const soRisco = await rpc(
      cliente,
      "SELECT public.crm_clientes('em_risco') AS r",
    );
    assert.deepEqual(
      soRisco.clientes.map((c) => c.chave),
      [C4],
    );
    const busca = await rpc(
      cliente,
      "SELECT public.crm_clientes(NULL, '1111-2222') AS r",
    );
    assert.deepEqual(
      busca.clientes.map((c) => c.chave),
      [`wa:${WA_C3}`],
      "busca pelo WhatsApp",
    );
  },
});

PROVAS.push({
  nome: "(c) KPIs do período × anterior, canais, recompra, recorrência, LTV e receita em risco",
  corpo: async (cliente) => {
    const visao = await rpc(
      cliente,
      "SELECT public.crm_visao(current_date - 29, current_date) AS r",
    );
    const k = visao.kpis;
    assert.equal(
      num(k.receita),
      780,
      "C1 700 + C2 50 + balcão 30; cancelado fora",
    );
    assert.equal(num(k.receita_anterior), 0);
    assert.equal(Number(k.pedidos), 9);
    assert.equal(Number(k.clientes_compradores), 2);
    assert.equal(Number(k.clientes_novos), 2);
    assert.equal(
      num(k.taxa_recompra),
      1,
      "os quatro clientes compraram 2+ vezes",
    );
    assert.equal(num(k.receita_recorrente_pct), num(630 / 780));
    assert.equal(num(k.ltv_medio), 515);
    assert.equal(num(k.receita_em_risco), 1200);
    const canais = Object.fromEntries(
      visao.canais.map((c) => [c.canal, num(c.receita)]),
    );
    assert.deepEqual(canais, { online: 750, presencial: 30 });
    const pipeline = Object.fromEntries(
      visao.pipeline.map((p) => [p.status, Number(p.quantidade)]),
    );
    assert.equal(pipeline.new, 1, "pagar na entrega entra na esteira");
    assert.equal(
      pipeline.pending,
      undefined,
      "PIX aguardando não é pedido para preparar",
    );
    assert.equal(
      visao.funil.visitas,
      null,
      "sem medição de visitas, nada inventado",
    );
    assert.equal(Number(visao.funil.pedidos_pagos), 8);
    const segmentos = Object.fromEntries(
      visao.segmentos.map((s) => [s.segmento, Number(s.clientes)]),
    );
    assert.deepEqual(segmentos, {
      campeoes: 1,
      novos: 1,
      quase_dormindo: 1,
      em_risco: 1,
    });
    estado.hojeReceita = 100;
  },
});

PROVAS.push({
  nome: "(d) Início: hoje, o mês igual ao CRM do mesmo período, saldo e pendências",
  corpo: async (cliente) => {
    const inicio = await rpc(cliente, "SELECT public.painel_inicio() AS r");
    assert.equal(num(inicio.hoje.receita), 100);
    assert.equal(num(inicio.hoje.online), 100);
    assert.equal(num(inicio.hoje.receita_semana_passada), 0);
    const mesCrm = await rpc(
      cliente,
      "SELECT public.crm_visao(date_trunc('month', public.fin__hoje())::date, public.fin__hoje()) AS r",
    );
    assert.equal(num(inicio.mes.receita), num(mesCrm.kpis.receita));
    assert.equal(Number(inicio.mes.pedidos), Number(mesCrm.kpis.pedidos));
    const contas = await rpc(cliente, "SELECT public.fin_contas_listar() AS r");
    assert.equal(
      num(inicio.saldo_total),
      num(
        contas.filter((c) => c.ativa).reduce((s, c) => s + Number(c.saldo), 0),
      ),
    );
    assert.equal(inicio.pendencias.caixa_aberto, false);
    assert.equal(Number(inicio.pendencias.devolucoes_abertas), 0);
    assert.ok(Number(inicio.pendencias.estoque_baixo) >= 1);
    assert.ok(
      Number(inicio.pendencias.pedidos_para_preparar) >= 2,
      "processing pago + novo na entrega",
    );
    assert.equal(inicio.serie_14d.length, 14);
    assert.equal(typeof Number(inicio.mes.lucro_estimado), "number");
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
          "Prova viva do CRM e do Início (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Uma regra do CRM/Início foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[crm-inicio] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva do CRM e do Início (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
