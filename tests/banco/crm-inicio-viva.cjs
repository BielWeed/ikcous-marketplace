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
 *   (e) Início: o lucro estimado conta o MÊS INTEIRO (20261390000000) e bate com o
 *       fin_dre do Financeiro; despesa prevista de outro mês não entra.
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
    // 20261199000000 (admin ATUAL): CRM e Início exigem o papel admin AGORA
    // em auth.users E em profiles — o admin da prova tem os dois.
    await cliente.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin CRM', 'admin')
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN],
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
      whatsapp: "+55 (34) 98888-7777",
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
      // Migration 20261183000000 (o CRM vê todo mundo): estes 2 aparecem
      // SEMPRE, mesmo com 0 — este fixture não tem ninguém sem conta
      // (em `profiles` só o admin, e staff não entra) nem identidade só com pedido não
      // pago (C2 já é comprador; "Na entrega" não tem chave nenhuma).
      pediu_nao_pagou: 0,
      nunca_comprou: 0,
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

// (e) O "Lucro estimado" do Início conta o MÊS INTEIRO, do dia 1 ao ÚLTIMO dia, igual ao "Mês atual" do
// Financeiro (fin_dre(inicioDoMes, fimDoMes), src/lib/financeiro.ts): a despesa PREVISTA com referência
// adiante no mês pesa já (decisão do sócio; migration 20261390000000). Antes o Início cortava em HOJE
// e divergia do Financeiro. Vendas, pedidos, ticket e os chips continuam até hoje.
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const CAT_ALUGUEL = "f2000000-0000-4000-8000-000000000020";

async function despesaPrevista(cliente, { valor, referencia, cancelada }) {
  await cliente.query(
    `INSERT INTO public.fin_lancamentos
       (tipo, status, valor, conta_id, categoria_id, descricao, forma_pagamento,
        data_competencia, data_vencimento, data_realizacao, origem, cancelado_em)
     VALUES ('saida', $1, $2, $3, $4, 'Despesa (e) do Início', 'dinheiro', $5, $5, NULL, 'manual', $6)`,
    [
      cancelada ? "cancelado" : "previsto",
      valor,
      CAIXA,
      CAT_ALUGUEL,
      referencia,
      cancelada ? new Date().toISOString() : null,
    ],
  );
}

// Oráculo INDEPENDENTE da função: o primeiro e o último dia do mês de `dia` (AAAA-MM-DD), calculados aqui.
function limitesDoMes(dia) {
  const [a, m] = dia.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  const ultimo = new Date(Date.UTC(a, m, 0)).getUTCDate();
  const proximo = m === 12 ? `${a + 1}-01-01` : `${a}-${pad(m + 1)}-01`;
  const anterior = new Date(Date.UTC(a, m - 1, 0)).toISOString().slice(0, 10);
  return {
    inicio: `${a}-${pad(m)}-01`,
    fim: `${a}-${pad(m)}-${pad(ultimo)}`,
    proximoMes: proximo,
    ultimoDoMesAnterior: anterior,
  };
}

// Roda UM cenário dentro de uma transação que SEMPRE desfaz. `hojeFalso` fixa o relógio da loja
// (fin__hoje) só dentro dela; null usa o relógio de verdade.
async function cenarioDoLucroDoMes(cliente, hojeFalso) {
  await cliente.query("BEGIN");
  try {
    await logar(cliente, U_ADMIN);
    if (hojeFalso)
      await cliente.query(
        `CREATE OR REPLACE FUNCTION public.fin__hoje() RETURNS date LANGUAGE sql STABLE
           SET search_path TO 'public' AS $$ SELECT DATE '${hojeFalso}' $$`,
      );
    const hoje = (await cliente.query("SELECT public.fin__hoje()::text AS d"))
      .rows[0].d;
    const mes = limitesDoMes(hoje);
    const lucroDoInicio = async () =>
      num(
        (await rpc(cliente, "SELECT public.painel_inicio() AS r")).mes
          .lucro_estimado,
      );
    const lucroDoFinanceiro = async (ini, fim) =>
      num(
        (await rpc(cliente, "SELECT public.fin_dre($1, $2) AS r", [ini, fim]))
          .lucro_liquido,
      );

    const antes = await lucroDoInicio();
    // Entra: previsto com referência no ÚLTIMO dia do mês (adiante de hoje, salvo no último dia).
    await despesaPrevista(cliente, { valor: 40, referencia: mes.fim });
    // Não entram: referência no mês anterior, no mês seguinte, e uma prevista CANCELADA no último dia.
    await despesaPrevista(cliente, {
      valor: 1000,
      referencia: mes.ultimoDoMesAnterior,
    });
    await despesaPrevista(cliente, {
      valor: 7000,
      referencia: mes.proximoMes,
    });
    await despesaPrevista(cliente, {
      valor: 500,
      referencia: mes.fim,
      cancelada: true,
    });

    const depois = await lucroDoInicio();
    const financeiro = await lucroDoFinanceiro(mes.inicio, mes.fim);
    const cortadoEmHoje = await lucroDoFinanceiro(mes.inicio, hoje);
    return { hoje, mes, antes, depois, financeiro, cortadoEmHoje };
  } finally {
    await cliente.query("ROLLBACK");
  }
}

PROVAS.push({
  nome: "(e) Início: o lucro estimado conta o mês inteiro (previsto no último dia entra; outro mês e cancelado não) e bate com o Financeiro",
  corpo: async (cliente) => {
    // Relógio de verdade + meses de 28, 29, 30 e 31 dias, virada de ano e o dia 1.
    for (const hojeFalso of [
      null,
      "2026-02-10",
      "2028-02-10",
      "2026-04-10",
      "2026-10-10",
      "2026-12-05",
      "2026-11-01",
      "2026-10-31",
    ]) {
      const r = await cenarioDoLucroDoMes(cliente, hojeFalso);
      const onde = `hoje=${r.hoje} (mês ${r.mes.inicio}..${r.mes.fim})`;
      assert.equal(
        r.depois,
        r.financeiro,
        `${onde}: o lucro do Início tem de ser o do Financeiro no mês inteiro`,
      );
      assert.equal(
        num(r.antes - r.depois),
        40,
        `${onde}: só a despesa prevista do último dia entra (nem mês anterior, nem seguinte, nem cancelada)`,
      );
      if (r.hoje < r.mes.fim)
        assert.notEqual(
          r.depois,
          r.cortadoEmHoje,
          `${onde}: o corte em hoje deixaria a despesa de fora`,
        );
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
