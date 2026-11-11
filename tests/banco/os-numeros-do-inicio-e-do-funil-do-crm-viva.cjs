"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, ids de
 * cenário) ou do JSON da própria RPC no Postgres efêmero; nunca de entrada de
 * rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) dos números que o
 * lojista lê para decidir: o FUNIL e a ESTEIRA do CRM (public.crm_visao, corpo
 * vigente desde 20261232000000_a_grade_do_crm_mede_a_recencia_do_mesmo_instante_da_lista.sql)
 * e o INÍCIO (public.painel_inicio, corpo vigente desde
 * 20261399300000_o_estorno_em_andamento_nao_e_conta_vencida.sql), contra o
 * Postgres EFÊMERO com as migrations aplicadas do zero (rpc-ci).
 *
 * A prova vizinha (crm-inicio-viva.cjs) só afirma pedidos_pagos, o tamanho da
 * série de 14 dias e a quantidade 'new' da esteira; nada olhava pedidos_criados,
 * carrinhos, a série dia a dia, hoje.pedidos, hoje.presencial, o ticket médio nem
 * o mais_antigo_em da esteira. Aqui cada um tem o seu cenário, com o número
 * esperado calculado FORA do SQL (no JS, a partir das vendas semeadas).
 *
 * RELÓGIO: a loja mede o dia pelo fuso de São Paulo (fin__hoje / fin__dia). Cada
 * cenário fixa "hoje" trocando fin__hoje (CREATE OR REPLACE dentro do SAVEPOINT do
 * cenário, desfeito junto), como a prova do lucro do mês faz. As vendas ficam em
 * 2025, no passado do relógio real (crm__vendas só enxerga pago_em <= agora). A
 * sessão roda em UTC (SET LOCAL TimeZone), como o PostgREST em produção: é o que
 * faz "o dia errado" aparecer quando alguém troca fin__dia(x) por x::date.
 *
 * CENÁRIOS (cada um num SAVEPOINT desfeito):
 *   F1-pedidos-criados   período de 3 dias. Online no período: um pago às 12h e
 *                        um aguardando às 23:30 de SP do último dia (já é o dia
 *                        seguinte em UTC); fora: venda de balcão do período e
 *                        online do dia anterior. pedidos_criados = 2 (nem 3 com o
 *                        balcão, nem 3 com o do dia anterior); pedidos_pagos = 1.
 *   F2-carrinhos         contas distintas: A pediu online (e mexeu no carrinho),
 *                        B só pediu online, H só mexeu no carrinho no período;
 *                        ficam FORA o visitante sem conta, a conta que só comprou
 *                        no balcão, a que pediu no dia anterior e o carrinho do
 *                        dia anterior. carrinhos = 3.
 *   I-hoje               hoje.pedidos, hoje.presencial (e online/receita) em hoje.
 *   I-serie              serie_14d = 14 pares exatos [dia, receita] de hoje-13 a
 *                        hoje (a venda das 23:30 de hoje-13 no dia certo, hoje-14
 *                        ausente, zeros nos dias sem venda).
 *   I-ticket-do-mes      mes.ticket_medio = soma / contagem do mês até hoje,
 *                        calculado fora do SQL (venda do mês anterior fora).
 *   I-crm-ticket         crm_visao.kpis.ticket_medio e canais[].ticket_medio.
 *   I-sem-vendas         sem nenhuma venda: ticket 0, série de 14 zeros, canais [].
 *   P-esteira            3 'processing' pagos (5, 2 e 0 dias) + pending recusado,
 *                        expirado e aguardando: processing.quantidade = 3,
 *                        mais_antigo_em = o de 5 dias, nenhum 'pending' na fila.
 *
 * MUTANTES: MUTANTE_R132C=<nome> troca UM trecho do corpo vivo (pg_get_functiondef,
 * dentro da transação desfeita) e roda os cenários; a execução TEM de ficar
 * vermelha, e vermelha EXATAMENTE nos cenários que o nome promete (os controles
 * ficam verdes). Nome desconhecido é ERRO. Sem MUTANTE_R132C a execução é a prova
 * normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/os-numeros-do-inicio-e-do-funil-do-crm-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO = "Prova viva: os números do Início e do funil do CRM (rpc-ci)";
const CRM = "public.crm_visao(date,date)";
const PAINEL = "public.painel_inicio()";

const U_ADMIN = "d0d13200-0000-4000-8000-0000000000a1";
const U_A = "d0d13200-0000-4000-8000-0000000000b1";
const U_B = "d0d13200-0000-4000-8000-0000000000b2";
const U_H = "d0d13200-0000-4000-8000-0000000000b3";
const U_E = "d0d13200-0000-4000-8000-0000000000b4";
const U_C = "d0d13200-0000-4000-8000-0000000000b5";
const U_F = "d0d13200-0000-4000-8000-0000000000b6";
const CONTAS = [U_A, U_B, U_H, U_E, U_C, U_F];

// "Hoje" de mentira: 17/09/2025 (o fuso da loja é -03:00 o ano todo). hoje-13 e
// hoje-14 caem no mesmo mês (setembro); hoje-20 cai em agosto.
const HOJE = "2025-09-17";
// Um dia bem longe de qualquer venda, para o cenário sem vendas.
const HOJE_VAZIO = "2025-02-12";

/** AAAA-MM-DD de `dia` + `n` dias (aritmética de data em UTC, sem fuso). */
function somaDias(dia, n) {
  const [a, m, d] = dia.split("-").map(Number);
  return new Date(Date.UTC(a, m - 1, d + n)).toISOString().slice(0, 10);
}
const em = (dia, hora) => `${dia}T${hora}-03:00`;
const num = (v) => Math.round(Number(v) * 10000) / 10000;

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada de tem de
// aparecer 1x. `espera` = os cenários EXATOS onde a prova TEM de ficar vermelha
// (e só eles: o resto, inclusive os controles, fica verde).
const MUTANTES = {
  "funil-pedidos-criados-sem-canal-online": {
    fn: CRM,
    espera: ["F1-pedidos-criados"],
    de: "o.canal = 'online' AND public.fin__dia(o.created_at) BETWEEN p_inicio AND p_fim)",
    para: "public.fin__dia(o.created_at) BETWEEN p_inicio AND p_fim)",
  },
  "funil-pedidos-criados-dia-em-utc": {
    fn: CRM,
    espera: ["F1-pedidos-criados"],
    de: "o.canal = 'online' AND public.fin__dia(o.created_at) BETWEEN p_inicio AND p_fim)",
    para: "o.canal = 'online' AND o.created_at::date BETWEEN p_inicio AND p_fim)",
  },
  "funil-carrinhos-sem-os-pedidos": {
    fn: CRM,
    espera: ["F2-carrinhos"],
    de: "WHERE o.canal = 'online' AND o.user_id IS NOT NULL",
    para: "WHERE false AND o.user_id IS NOT NULL",
  },
  "funil-carrinhos-conta-o-balcao": {
    fn: CRM,
    espera: ["F2-carrinhos"],
    de: "WHERE o.canal = 'online' AND o.user_id IS NOT NULL",
    para: "WHERE o.user_id IS NOT NULL",
  },
  "funil-carrinhos-sem-o-corte-do-dia-no-carrinho": {
    fn: CRM,
    espera: ["F2-carrinhos"],
    de: "WHERE public.fin__dia(ci.created_at) BETWEEN p_inicio AND p_fim",
    para: "WHERE true",
  },
  "inicio-serie-sem-o-filtro-do-dia": {
    fn: PAINEL,
    espera: ["I-serie"],
    de: "(SELECT sum(total) FROM v WHERE v.dia = d.dia::date)",
    para: "(SELECT sum(total) FROM v)",
  },
  "inicio-serie-comeca-em-hoje-12": {
    fn: PAINEL,
    espera: ["I-serie", "I-sem-vendas"],
    de: "generate_series((v_hoje - 13)::timestamp",
    para: "generate_series((v_hoje - 12)::timestamp",
  },
  "inicio-ticket-do-mes-soma-em-vez-de-media": {
    fn: PAINEL,
    espera: ["I-ticket-do-mes"],
    de: "'ticket_medio', (SELECT COALESCE(round(avg(total), 2), 0) FROM v",
    para: "'ticket_medio', (SELECT COALESCE(round(sum(total), 2), 0) FROM v",
  },
  "inicio-hoje-presencial-conta-o-online": {
    fn: PAINEL,
    espera: ["I-hoje"],
    de: "WHERE dia = v_hoje AND canal = 'presencial'",
    para: "WHERE dia = v_hoje AND canal = 'online'",
  },
  "inicio-hoje-pedidos-conta-tambem-ontem": {
    fn: PAINEL,
    espera: ["I-hoje"],
    de: "'pedidos', (SELECT count(*) FROM v WHERE dia = v_hoje),",
    para: "'pedidos', (SELECT count(*) FROM v WHERE dia >= v_hoje - 1),",
  },
  "crm-ticket-medio-soma-em-vez-de-media": {
    fn: CRM,
    espera: ["I-crm-ticket"],
    de: "'ticket_medio', (SELECT COALESCE(round(avg(total), 2), 0) FROM atual)",
    para: "'ticket_medio', (SELECT COALESCE(round(sum(total), 2), 0) FROM atual)",
  },
  "crm-ticket-do-canal-soma-em-vez-de-media": {
    fn: CRM,
    espera: ["I-crm-ticket"],
    de: "round(avg(total), 2) AS ticket",
    para: "round(sum(total), 2) AS ticket",
  },
  "esteira-mais-antigo-vira-o-mais-novo": {
    fn: CRM,
    espera: ["P-esteira"],
    de: "min(o.created_at) AS antigo",
    para: "max(o.created_at) AS antigo",
  },
  "esteira-sem-excluir-o-recusado": {
    fn: CRM,
    espera: ["P-esteira"],
    de: "NOT IN ('aguardando', 'expirado', 'recusado')",
    para: "NOT IN ('aguardando', 'expirado')",
  },
  "esteira-sem-excluir-o-expirado": {
    fn: CRM,
    espera: ["P-esteira"],
    de: "NOT IN ('aguardando', 'expirado', 'recusado')",
    para: "NOT IN ('aguardando', 'recusado')",
  },
  "esteira-sem-excluir-o-aguardando": {
    fn: CRM,
    espera: ["P-esteira"],
    de: "NOT IN ('aguardando', 'expirado', 'recusado')",
    para: "NOT IN ('expirado', 'recusado')",
  },
};

// ------------------------------------------------------------------ semente

/**
 * Pedido com status e pagamento à escolha, criado (e, se pago, pago) em `quando`.
 * Pago online grava paid_at; pago na loja (presencial) grava pagamento_recebido_em,
 * como a venda de balcão de verdade.
 */
async function pedido(c, o) {
  const canal = o.canal || "online";
  const pagamento = o.pagamento || (canal === "online" ? "online" : "cash");
  const pago = o.pago !== false;
  const paymentStatus =
    o.paymentStatus ||
    (pagamento === "online" ? "pago" : "recebido_na_entrega");
  await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, pagamento_recebido_em, created_at)
     VALUES ($1, 'Cliente 132c', '{}'::jsonb, $2, $2, $3, $4, $5, $6,
             CASE WHEN $8 AND $5 = 'online' THEN $7::timestamptz END,
             CASE WHEN $8 AND $5 <> 'online' THEN $7::timestamptz END,
             $7::timestamptz)`,
    [
      o.userId || null,
      o.total,
      o.status || "delivered",
      canal,
      pagamento,
      paymentStatus,
      o.quando,
      pago,
    ],
  );
}

async function carrinho(c, userId, quando, produto = "produto-132c") {
  await c.query(
    `INSERT INTO public.cart_items (user_id, product_id, variant_id, quantity, created_at)
     VALUES ($1, $2, '', 1, $3::timestamptz)`,
    [userId, produto, quando],
  );
}

/** Fixa "hoje" da loja (o fuso é -03:00 o ano todo). Some com o ROLLBACK TO SAVEPOINT. */
async function fixarHoje(c, hoje) {
  await c.query(
    `CREATE OR REPLACE FUNCTION public.fin__hoje() RETURNS date LANGUAGE sql STABLE
       SET search_path TO 'public' AS $$ SELECT DATE '${hoje}' $$`,
  );
  const lido = (await c.query("SELECT public.fin__hoje()::text AS d")).rows[0]
    .d;
  assert.strictEqual(lido, hoje, "o relógio da loja não ficou fixo");
}

async function visao(c, de, ate) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
  return (
    await c.query("SELECT public.crm_visao($1::date, $2::date) AS r", [de, ate])
  ).rows[0].r;
}

async function inicio(c) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [U_ADMIN]);
  return (await c.query("SELECT public.painel_inicio() AS r")).rows[0].r;
}

/**
 * As vendas do Início, em volta de HOJE. `total`, `dia` (relativo a hoje), `hora`
 * (SP), canal. A de hoje-13 às 23:30 é a que o UTC joga para o dia seguinte; a de
 * hoje-14 fica fora da série mas dentro do mês; a de hoje-20 é do mês anterior.
 */
const VENDAS_DO_INICIO = [
  { total: 100, rel: 0, hora: "12:00:00", canal: "online" },
  { total: 30, rel: 0, hora: "10:00:00", canal: "presencial" },
  { total: 50, rel: -1, hora: "12:00:00", canal: "online" },
  { total: 70, rel: -13, hora: "23:30:00", canal: "online" },
  { total: 200, rel: -14, hora: "12:00:00", canal: "online" },
  { total: 999, rel: -20, hora: "12:00:00", canal: "online" },
];

async function semearVendasDoInicio(c) {
  for (const v of VENDAS_DO_INICIO) {
    await pedido(c, {
      total: v.total,
      canal: v.canal,
      quando: em(somaDias(HOJE, v.rel), v.hora),
    });
  }
}

/** O dia (AAAA-MM-DD) de uma venda semeada, no relógio de SP (o dado já vem em SP). */
const diaDe = (v) => somaDias(HOJE, v.rel);
const MES_INICIO = `${HOJE.slice(0, 8)}01`;

/** Garante que a janela está VAZIA antes de semear: a prova mede só as suas linhas. */
async function exigirVazio(c, de, ate, motivo) {
  const v = await visao(c, de, ate);
  assert.strictEqual(
    Number(v.kpis.pedidos),
    0,
    `${motivo}: já há venda paga em ${de}..${ate} no clone`,
  );
  assert.strictEqual(
    Number(v.funil.pedidos_criados),
    0,
    `${motivo}: já há pedido online criado em ${de}..${ate} no clone`,
  );
}

// ---------------------------------------------------------------- cenários

const CENARIOS = [];

CENARIOS.push({
  id: "F1-pedidos-criados",
  nome: "F1-pedidos-criados: 2 pedidos online no período (um às 23:30 de SP do último dia), 1 de balcão e 1 online do dia anterior -> pedidos_criados = 2 e pedidos_pagos = 1",
  corpo: async (c) => {
    await fixarHoje(c, HOJE);
    const de = somaDias(HOJE, -2);
    await exigirVazio(c, somaDias(de, -1), HOJE, "F1");
    // Online no período: pago às 12h do primeiro dia e aguardando às 23:30 do último
    // (em UTC já é o dia seguinte).
    await pedido(c, { userId: U_A, total: 80, quando: em(de, "12:00:00") });
    await pedido(c, {
      userId: U_B,
      total: 60,
      status: "pending",
      paymentStatus: "aguardando",
      pago: false,
      quando: em(HOJE, "23:30:00"),
    });
    // Fora: balcão do período e online do dia anterior ao período.
    await pedido(c, {
      total: 25,
      canal: "presencial",
      quando: em(somaDias(de, 1), "12:00:00"),
    });
    await pedido(c, {
      userId: U_C,
      total: 40,
      quando: em(somaDias(de, -1), "12:00:00"),
    });
    const f = (await visao(c, de, HOJE)).funil;
    assert.strictEqual(
      Number(f.pedidos_criados),
      2,
      "[F1] só os 2 online do período contam (nem o balcão, nem o do dia anterior; o das 23:30 de SP é do último dia)",
    );
    assert.strictEqual(
      Number(f.pedidos_pagos),
      1,
      "[F1] só o online pago do período",
    );
  },
});

CENARIOS.push({
  id: "F2-carrinhos",
  nome: "F2-carrinhos: A (pediu e mexeu no carrinho), B (só pediu) e H (só carrinho) contam uma vez cada; visitante, só-balcão, pedido e carrinho do dia anterior ficam fora -> carrinhos = 3",
  corpo: async (c) => {
    await fixarHoje(c, HOJE);
    const de = somaDias(HOJE, -2);
    const antes = somaDias(de, -1);
    await exigirVazio(c, antes, HOJE, "F2");
    // Contam: A (pedido online + carrinho: uma vez só), B (só pedido), H (só carrinho).
    await pedido(c, { userId: U_A, total: 80, quando: em(de, "12:00:00") });
    await carrinho(c, U_A, em(de, "13:00:00"));
    await carrinho(c, U_A, em(de, "13:05:00"), "outro-produto-132c");
    await pedido(c, { userId: U_B, total: 60, quando: em(HOJE, "23:30:00") });
    await carrinho(c, U_H, em(somaDias(de, 1), "09:00:00"));
    // Fora: visitante sem conta (pedido online no período), conta que só comprou
    // no balcão, conta que pediu no dia anterior, carrinho do dia anterior.
    await pedido(c, { total: 45, quando: em(de, "15:00:00") });
    await pedido(c, {
      userId: U_E,
      total: 25,
      canal: "presencial",
      quando: em(de, "16:00:00"),
    });
    await pedido(c, { userId: U_C, total: 40, quando: em(antes, "12:00:00") });
    await carrinho(c, U_F, em(antes, "12:00:00"));
    const f = (await visao(c, de, HOJE)).funil;
    assert.strictEqual(
      Number(f.carrinhos),
      3,
      "[F2] contas distintas com carrinho ou pedido online no período (A uma vez só; visitante, só-balcão e dia anterior fora)",
    );
  },
});

CENARIOS.push({
  id: "I-hoje",
  nome: "I-hoje: hoje tem 1 online de 100 e 1 de balcão de 30 -> hoje.pedidos = 2, hoje.presencial = 30, hoje.online = 100, hoje.receita = 130",
  corpo: async (c) => {
    await fixarHoje(c, HOJE);
    await exigirVazio(c, somaDias(HOJE, -20), HOJE, "I-hoje");
    await semearVendasDoInicio(c);
    const h = (await inicio(c)).hoje;
    const deHoje = VENDAS_DO_INICIO.filter((v) => v.rel === 0);
    const soma = (lista) => lista.reduce((s, v) => s + v.total, 0);
    assert.strictEqual(
      Number(h.pedidos),
      deHoje.length,
      "[I-hoje] hoje.pedidos conta só as vendas de hoje (nem ontem, nem balcão de fora)",
    );
    assert.strictEqual(
      num(h.presencial),
      soma(deHoje.filter((v) => v.canal === "presencial")),
      "[I-hoje] hoje.presencial é só o balcão de hoje",
    );
    assert.strictEqual(
      num(h.online),
      soma(deHoje.filter((v) => v.canal === "online")),
      "[I-hoje] hoje.online é só o online de hoje",
    );
    assert.strictEqual(
      num(h.receita),
      soma(deHoje),
      "[I-hoje] hoje.receita é a soma de hoje",
    );
  },
});

CENARIOS.push({
  id: "I-serie",
  nome: "I-serie: serie_14d tem 14 pares [dia, receita] de hoje-13 a hoje; a venda das 23:30 de hoje-13 fica no dia certo, hoje-14 e o mês anterior ficam fora, dias sem venda valem 0",
  corpo: async (c) => {
    await fixarHoje(c, HOJE);
    await exigirVazio(c, somaDias(HOJE, -20), HOJE, "I-serie");
    await semearVendasDoInicio(c);
    const serie = (await inicio(c)).serie_14d;
    const esperado = [];
    for (let rel = -13; rel <= 0; rel += 1) {
      const dia = somaDias(HOJE, rel);
      esperado.push([
        dia,
        VENDAS_DO_INICIO.filter((v) => diaDe(v) === dia).reduce(
          (s, v) => s + v.total,
          0,
        ),
      ]);
    }
    assert.strictEqual(esperado.length, 14, "o oráculo tem 14 dias");
    assert.deepStrictEqual(
      serie.map((p) => [p.dia, num(p.receita)]),
      esperado,
      "[I-serie] 14 pares exatos, um por dia de SP, cada um só com as vendas daquele dia",
    );
    assert.ok(
      !serie.some((p) => p.dia === somaDias(HOJE, -14)),
      "[I-serie] hoje-14 não entra",
    );
  },
});

CENARIOS.push({
  id: "I-ticket-do-mes",
  nome: "I-ticket-do-mes: mes.ticket_medio = soma / contagem das vendas do mês até hoje (a do mês anterior fora)",
  corpo: async (c) => {
    await fixarHoje(c, HOJE);
    await exigirVazio(c, somaDias(HOJE, -20), HOJE, "I-ticket-do-mes");
    await semearVendasDoInicio(c);
    const doMes = VENDAS_DO_INICIO.filter(
      (v) => diaDe(v) >= MES_INICIO && diaDe(v) <= HOJE,
    );
    assert.ok(
      doMes.length >= 2 && doMes.length < VENDAS_DO_INICIO.length,
      "o oráculo tem de ter vendas dentro e fora do mês",
    );
    const esperado =
      Math.round(
        (doMes.reduce((s, v) => s + v.total, 0) / doMes.length) * 100,
      ) / 100;
    const mes = (await inicio(c)).mes;
    assert.strictEqual(
      num(mes.ticket_medio),
      esperado,
      "[I-ticket-do-mes] valor médio = soma / contagem do mês até hoje",
    );
    assert.strictEqual(
      Number(mes.pedidos),
      doMes.length,
      "[I-ticket-do-mes] mes.pedidos é a mesma contagem",
    );
  },
});

CENARIOS.push({
  id: "I-crm-ticket",
  nome: "I-crm-ticket: no período de 14 dias, crm_visao.kpis.ticket_medio e canais[].ticket_medio = soma / contagem calculada fora do SQL",
  corpo: async (c) => {
    await fixarHoje(c, HOJE);
    const de = somaDias(HOJE, -13);
    await exigirVazio(c, somaDias(HOJE, -20), HOJE, "I-crm-ticket");
    await semearVendasDoInicio(c);
    const doPeriodo = VENDAS_DO_INICIO.filter(
      (v) => diaDe(v) >= de && diaDe(v) <= HOJE,
    );
    const media = (lista) =>
      Math.round(
        (lista.reduce((s, v) => s + v.total, 0) / lista.length) * 100,
      ) / 100;
    const v = await visao(c, de, HOJE);
    assert.strictEqual(
      num(v.kpis.ticket_medio),
      media(doPeriodo),
      "[I-crm-ticket] kpis.ticket_medio é a média do período",
    );
    const porCanal = Object.fromEntries(
      v.canais.map((x) => [x.canal, num(x.ticket_medio)]),
    );
    assert.deepStrictEqual(
      porCanal,
      {
        online: media(doPeriodo.filter((x) => x.canal === "online")),
        presencial: media(doPeriodo.filter((x) => x.canal === "presencial")),
      },
      "[I-crm-ticket] canais[].ticket_medio é a média de cada canal",
    );
  },
});

CENARIOS.push({
  id: "I-sem-vendas",
  nome: "I-sem-vendas: sem nenhuma venda -> ticket 0 no Início e no CRM, série de 14 zeros, nenhum canal",
  corpo: async (c) => {
    await fixarHoje(c, HOJE_VAZIO);
    await exigirVazio(c, somaDias(HOJE_VAZIO, -40), HOJE_VAZIO, "I-sem-vendas");
    const i = await inicio(c);
    assert.strictEqual(num(i.mes.ticket_medio), 0, "[I-sem-vendas] ticket 0");
    assert.strictEqual(Number(i.hoje.pedidos), 0);
    assert.deepStrictEqual(
      i.serie_14d.map((p) => [p.dia, num(p.receita)]),
      Array.from({ length: 14 }, (_, k) => [somaDias(HOJE_VAZIO, k - 13), 0]),
      "[I-sem-vendas] 14 dias, todos zero",
    );
    const v = await visao(c, somaDias(HOJE_VAZIO, -13), HOJE_VAZIO);
    assert.strictEqual(num(v.kpis.ticket_medio), 0, "[I-sem-vendas] CRM 0");
    assert.deepStrictEqual(v.canais, [], "[I-sem-vendas] nenhum canal");
  },
});

CENARIOS.push({
  id: "P-esteira",
  nome: "P-esteira: 3 'processing' pagos (5, 2 e 0 dias) + pending recusado, expirado e aguardando -> processing.quantidade = 3, mais_antigo_em = o de 5 dias, nenhum 'pending' na fila",
  corpo: async (c) => {
    await fixarHoje(c, HOJE);
    // A esteira não tem corte de dia: a fila do clone tem de estar vazia.
    const antes = (await visao(c, somaDias(HOJE, -1), HOJE)).pipeline;
    assert.deepStrictEqual(antes, [], "P: a esteira do clone já tem pedido");
    const ha5 = em(somaDias(HOJE, -5), "10:00:00");
    for (const quando of [
      ha5,
      em(somaDias(HOJE, -2), "10:00:00"),
      em(HOJE, "10:00:00"),
    ]) {
      await pedido(c, { total: 70, status: "processing", quando });
    }
    // Os três 'pending' são MAIS ANTIGOS que todos os 'processing': se algum entrar
    // na fila, aparece uma linha 'pending'.
    for (const paymentStatus of ["recusado", "expirado", "aguardando"]) {
      await pedido(c, {
        total: 33,
        status: "pending",
        paymentStatus,
        pago: false,
        quando: em(somaDias(HOJE, -9), "10:00:00"),
      });
    }
    const fila = (await visao(c, somaDias(HOJE, -1), HOJE)).pipeline;
    assert.deepStrictEqual(
      fila.map((p) => p.status),
      ["processing"],
      "[P-esteira] só 'processing' na fila: pagamento recusado, expirado ou aguardando não é pedido para preparar",
    );
    assert.strictEqual(Number(fila[0].quantidade), 3, "[P-esteira] 3 pagos");
    assert.strictEqual(
      new Date(fila[0].mais_antigo_em).getTime(),
      new Date(ha5).getTime(),
      "[P-esteira] mais_antigo_em é o instante do pedido de 5 dias, não o mais recente",
    );
  },
});

// ------------------------------------------------------------------ rodada

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R132C='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const def = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [m.fn])
  ).rows[0].d.replace(/\r/g, "");
  const ocorrencias = def.split(m.de).length - 1;
  assert.strictEqual(
    ocorrencias,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo de ${m.fn} (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notStrictEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  const depois = (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [m.fn])
  ).rows[0].d.replace(/\r/g, "");
  assert.strictEqual(
    depois,
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: sessão em UTC, (mutante), admin e contas, e
 * cada cenário num SAVEPOINT. Devolve {passou:[ids], falhou:[{id, nome, erro}]}.
 * Erro que não é de asserção (SQL, conexão) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    // O PostgREST roda em UTC: sem isto, `created_at::date` dependeria do fuso desta sessão.
    await c.query("SET LOCAL TimeZone = 'UTC'");
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       SELECT u, 'u' || substr(u::text, 33) || '@numeros132c.fixture.invalid',
              CASE WHEN u = $1::uuid THEN '{"role":"admin"}'::jsonb ELSE '{}'::jsonb END
         FROM unnest($2::uuid[]) AS u
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN, [U_ADMIN, ...CONTAS]],
    );
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Numeros 132c', 'admin')
       ON CONFLICT (id) DO UPDATE SET role = 'admin'`,
      [U_ADMIN],
    );

    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id, nome, corpo } of CENARIOS) {
      await c.query("SAVEPOINT cenario");
      try {
        await corpo(c);
        resultado.passou.push(id);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id, nome, erro });
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT cenario");
        await c.query("RELEASE SAVEPOINT cenario");
      }
    }
    return resultado;
  } finally {
    await c.query("ROLLBACK");
  }
}

const linha = (e) =>
  `${e.message.split("\n")[0]} (visto ${JSON.stringify(e.actual)}, esperado ${JSON.stringify(e.expected)})`;

async function main() {
  const url = lerDatabaseUrlEfemera();
  const nomeMutante = process.env.MUTANTE_R132C || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R132C='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const cliente = new Client({ connectionString: url });
  try {
    await cliente.connect();
  } catch (erro) {
    falhar("INDETERMINADO", `Não conectei no banco efêmero: ${erro.message}`);
  }
  try {
    const r = await rodar(cliente, nomeMutante);
    for (const id of r.passou) console.log(`  PASSOU ${id}`);
    for (const f of r.falhou) {
      console.error(`  VERMELHO ${f.id}: ${linha(f.erro)}`);
    }

    if (nomeMutante) {
      console.log(
        `  MUTANTE ${nomeMutante}: vermelho em [${r.falhou.map((f) => f.id).join(", ")}], verde em [${r.passou.join(", ")}]`,
      );
      if (r.falhou.length === 0) {
        falhar(
          "SOBREVIVEU",
          `o mutante ${nomeMutante} deixou TODOS os cenários verdes: a prova não guarda esse trecho`,
        );
      }
      const faltou = r.mutante.espera.filter(
        (id) => !r.falhou.some((f) => f.id === id),
      );
      const demais = r.falhou
        .map((f) => f.id)
        .filter((id) => !r.mutante.espera.includes(id));
      if (faltou.length > 0 || demais.length > 0) {
        falhar(
          "ASSERCAO-ERRADA",
          `o mutante ${nomeMutante} ficou vermelho em lugar diferente do prometido: faltou [${faltou.join(", ")}], a mais [${demais.join(", ")}] (esperado ${r.mutante.espera.join(", ")})`,
        );
      }
      falhar(
        "VERMELHO",
        `mutante ${nomeMutante} pego, como esperado, em [${r.mutante.espera.join(", ")}]`,
      );
    }

    if (r.falhou.length > 0) {
      anexarAoSummary(
        TITULO,
        r.falhou
          .map(
            (f) => `- ❌ ${f.nome}\n  - \`${f.erro.message.split("\n")[0]}\``,
          )
          .join("\n"),
      );
      falhar(
        "FALHOU",
        "Um número do Início ou do funil do CRM saiu diferente do calculado fora do SQL — ver acima qual cenário.",
      );
    }
    console.log(
      `\n[os-numeros-do-inicio-e-do-funil] ${CENARIOS.length}/${CENARIOS.length} cenários passaram.`,
    );
    anexarAoSummary(
      TITULO,
      `${CENARIOS.map((x) => `- ✅ ${x.nome}`).join("\n")}\n\n**${CENARIOS.length}/${CENARIOS.length} cenários** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();
