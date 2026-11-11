"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (MUTANTES, nomes
 * de cenário) ou do JSON da própria RPC no Postgres efêmero; nunca de entrada
 * de rede nem de terceiro. */

/**
 * PROVA VIVA DE VALOR (só teste; nenhum SQL de produção muda) do PRAZO LEGAL da
 * devolução, contado em DIAS DO CALENDÁRIO DE SÃO PAULO a partir da entrega, em
 * public.solicitar_devolucao e public.devolucao_elegibilidade (corpo vigente de
 * ambas: 20261175000000 + 20261199000000 para a elegibilidade; nenhuma
 * migration posterior as redefine), contra o Postgres EFÊMERO com as migrations
 * aplicadas do zero (rpc-ci).
 *
 * A guarda, no corpo vivo (v_dias = hoje_SP - dia_SP_da_entrega):
 *   vício (defeito, avaria, produto errado, peça faltando, diferente do anúncio):
 *       v_dias > prazo_vicio_dias  -> 'O prazo para reclamar de problema no produto terminou'
 *   senão online e v_dias <= prazo_arrependimento_dias -> 'arrependimento'
 *   senão aceita_troca e prazo_troca_dias > 0 e v_dias <= prazo_troca_dias -> 'troca'
 *   senão -> 'O prazo para devolução ou troca deste pedido terminou.'
 * A elegibilidade expõe a mesma conta em janelas.{arrependimento,troca,vicio},
 * prazos.{arrependimento,troca,vicio}_ate, dias_desde_entrega, pode e
 * motivo_bloqueio. ATENÇÃO (desenho, não defeito): `pode` só fica false depois
 * de TODAS as janelas, e a do vício é a mais longa (mínimo 30 dias): com 8 dias
 * a elegibilidade ainda diz pode=true (um defeito ainda cabe) enquanto
 * solicitar_devolucao recusa o motivo 'desisti' — por isso a recusa do prazo
 * de arrependimento é provada na solicitação, e `pode=false` aos 31 dias.
 *
 * Os números esperados vêm do JS: UMA leitura de "hoje em São Paulo" (now() é
 * constante dentro da transação, então as funções veem o mesmo dia e a prova
 * não é atravessada pela meia-noite), as entregas são instantes fixos
 * `<dia>T22:30:00-03:00` etc., e as datas esperadas são aritmética de
 * calendário em JS. A sessão é fixada em UTC (SET LOCAL TIME ZONE) para o cast
 * sem fuso errar de verdade — num banco já em São Paulo o mutante 'sem fuso'
 * sobreviveria sem esse passo.
 *
 * Como o cliente DONO de um pedido entregue (papel `authenticated`, auth.uid()
 * emulado pelo GUC app.rpc.user_id), cada tentativa num SAVEPOINT próprio, com
 * FOTO das tabelas antes/depois (devolucoes e devolucao_itens):
 *   C1  entregue há 7 dias às 22:30 BRT (= 01:30 UTC do dia seguinte), 'desisti':
 *       passa como arrependimento, prazo_ate = hoje, janela de arrependimento aberta
 *   C2  há 8 dias: 'desisti' é recusado com a mensagem do prazo; a elegibilidade
 *       fecha só a janela de arrependimento; 'defeito' no mesmo pedido ainda passa
 *   C3  'defeito' há 30 dias passa como vício (prazo_ate = hoje)
 *   C4  'defeito' há 31 dias é recusado ('reclamar de problema no produto
 *       terminou'); a elegibilidade fecha as 3 janelas, pode=false e o motivo
 *   C5  com troca aceita por 15 dias: 'tamanho_pequeno' em 15 passa como troca
 *   C6  em 16 é recusado; a janela de troca fecha
 *   C7  entregue às 23:50 BRT (02:50 UTC do dia seguinte): 7 dias passa com
 *       prazo_ate = hoje (e a prova confere que o cast sem fuso cairia no dia
 *       seguinte); 8 dias é recusado
 *   C8  CONTROLE ao meio-dia (mesmo dia em UTC e em SP): 7 passa, 8 recusa —
 *       tem de seguir verde sem a conversão de fuso
 * Toda recusa deixa as duas tabelas exatamente como estavam.
 *
 * MUTANTES: MUTANTE_R136C=<nome> troca UM trecho do corpo vivo (via
 * pg_get_functiondef, dentro da transação desfeita) e roda os casos; a
 * execução TEM de ficar vermelha, e vermelha nos casos que o nome promete.
 * Nome desconhecido é ERRO. Sem MUTANTE_R136C a execução é a prova normal.
 *
 * USO: CI_BANCO_EFEMERO=1 DATABASE_URL=postgres://… \
 *        node tests/banco/rodar-isolado.cjs tests/banco/o-prazo-da-devolucao-conta-dia-de-sao-paulo-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO =
  "Prova viva: o prazo da devolução conta o dia de São Paulo (rpc-ci)";
const F_SOLICITAR =
  "public.solicitar_devolucao(uuid, jsonb, text, text, text, text, text[])";
const F_ELEGIBILIDADE = "public.devolucao_elegibilidade(uuid)";

const U_CLIENTE = "c1360000-0000-4000-8000-0000000000a1";
const P_CAMISA = "c1360000-0000-4000-8000-0000000000b1";
const O_LOCAL = "c1360000-0000-4000-8000-0000000000c1";
const I_LOCAL = "c1360000-0000-4000-8000-0000000000d1";

const MSG_PRAZO = "O prazo para devolução ou troca deste pedido terminou.";
const MSG_PRAZO_VICIO =
  "O prazo para reclamar de problema no produto terminou (30 dias após a entrega).";

// ---------------------------------------------------------------- mutantes
// de/para são trechos EXATOS do corpo vivo (pg_get_functiondef); cada de tem
// de aparecer 1x na função indicada. `espera` = casos onde a prova TEM de ficar
// vermelha (e só neles).
const NOITE = ["C1", "C2", "C3", "C4", "C5", "C6", "C7"]; // todo caso que entrega à noite

const MUTANTES = {
  "solicitar-arrependimento-menor-que": {
    funcao: F_SOLICITAR,
    espera: ["C1", "C7", "C8"],
    de: "AND v_dias <= v_pol.prazo_arrependimento_dias THEN",
    para: "AND v_dias < v_pol.prazo_arrependimento_dias THEN",
  },
  "solicitar-sem-fuso-no-dia-da-entrega": {
    funcao: F_SOLICITAR,
    espera: NOITE,
    de: "v_entregue_dia := (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date;",
    para: "v_entregue_dia := (v_entregue)::date;",
  },
  "solicitar-sem-teto-do-vicio": {
    funcao: F_SOLICITAR,
    espera: ["C4"],
    de: "IF v_dias > v_pol.prazo_vicio_dias THEN",
    para: "IF false THEN",
  },
  "solicitar-vicio-recusa-no-ultimo-dia": {
    funcao: F_SOLICITAR,
    espera: ["C3"],
    de: "IF v_dias > v_pol.prazo_vicio_dias THEN",
    para: "IF v_dias >= v_pol.prazo_vicio_dias THEN",
  },
  "solicitar-sem-a-recusa-final-do-prazo": {
    funcao: F_SOLICITAR,
    espera: ["C2", "C6", "C7", "C8"],
    // O ELSE final deixa de recusar e cai como troca (um ELSE vazio daria
    // v_tipo NULL e outro erro; assim a chamada "passa" como o defeito real faria).
    de: "RAISE EXCEPTION 'O prazo para devolução ou troca deste pedido terminou.' USING ERRCODE = '22023';",
    para: "v_tipo := 'troca'; v_prazo := v_entregue_dia + v_pol.prazo_troca_dias;",
  },
  "solicitar-troca-menor-que": {
    funcao: F_SOLICITAR,
    espera: ["C5"],
    de: "AND v_dias <= v_pol.prazo_troca_dias THEN",
    para: "AND v_dias < v_pol.prazo_troca_dias THEN",
  },
  "elegibilidade-arrependimento-menor-que": {
    funcao: F_ELEGIBILIDADE,
    espera: ["C1", "C7", "C8"],
    de: "v_j_arrep := v_o.canal = 'online' AND v_dias <= v_pol.prazo_arrependimento_dias;",
    para: "v_j_arrep := v_o.canal = 'online' AND v_dias < v_pol.prazo_arrependimento_dias;",
  },
  "elegibilidade-troca-menor-que": {
    funcao: F_ELEGIBILIDADE,
    espera: ["C5"],
    de: "AND v_dias <= v_pol.prazo_troca_dias;",
    para: "AND v_dias < v_pol.prazo_troca_dias;",
  },
  "elegibilidade-sem-teto-do-vicio": {
    funcao: F_ELEGIBILIDADE,
    espera: ["C4"],
    de: "v_j_vicio := v_dias <= v_pol.prazo_vicio_dias;",
    para: "v_j_vicio := true;",
  },
  "elegibilidade-sem-a-recusa-do-prazo": {
    funcao: F_ELEGIBILIDADE,
    espera: ["C4"],
    de: "WHEN NOT (v_j_arrep OR v_j_troca OR v_j_vicio) THEN",
    para: "WHEN false THEN",
  },
  "elegibilidade-sem-fuso-nos-dias": {
    funcao: F_ELEGIBILIDADE,
    espera: NOITE,
    de: "v_dias := v_hoje - (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date;",
    para: "v_dias := v_hoje - (v_entregue)::date;",
  },
  "elegibilidade-sem-fuso-no-prazo-de-arrependimento": {
    funcao: F_ELEGIBILIDADE,
    espera: NOITE,
    de: "THEN (v_entregue AT TIME ZONE 'America/Sao_Paulo')::date + v_pol.prazo_arrependimento_dias END",
    para: "THEN (v_entregue)::date + v_pol.prazo_arrependimento_dias END",
  },
};

// ------------------------------------------------------------ datas (em JS)

let HOJE = ""; // "hoje em São Paulo" (YYYY-MM-DD): UMA leitura por execução

/** Soma `delta` dias ao dia `base` (YYYY-MM-DD): aritmética de calendário pura. */
function somaDias(base, delta) {
  const [a, m, d] = base.split("-").map(Number);
  const t = new Date(Date.UTC(a, m - 1, d));
  t.setUTCDate(t.getUTCDate() + delta);
  return t.toISOString().slice(0, 10);
}

/** O dia de calendário de SP em que a entrega aconteceu: `n` dias antes de hoje. */
const diaDaEntrega = (n) => somaDias(HOJE, -n);

/** Instante fixo `<dia> <hh:mm>` no relógio de São Paulo (UTC-03, sem horário de verão desde 2019). */
const instanteBRT = (dia, hhmm) => `${dia}T${hhmm}:00-03:00`;

// ------------------------------------------------------------------ semente

async function semear(c) {
  await c.query(
    `INSERT INTO auth.users (id, email, raw_app_meta_data)
     VALUES ($1, 'cliente@prazo136c.fixture.invalid', '{}'::jsonb) ON CONFLICT (id) DO NOTHING`,
    [U_CLIENTE],
  );
  await c.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, categoria)
     VALUES ($1, 'Camisa Prazo 136c', 40.00, 10, true, 'Camisas')`,
    [P_CAMISA],
  );
  // Entrega local, paga pelo app (mesmo molde do pedido O_LOCAL dos vizinhos).
  // A data de entrega e a política de cada caso são fixadas em cada caso.
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal,
        payment_method, payment_status, paid_at, gateway_payment_id)
     VALUES ($1, $2, 'Cliente Prazo 136c',
             '{"whatsapp":"5534999990000","shipping_option_id":"local-delivery"}'::jsonb,
             100, 80, 20, 'delivered', 'online', 'online', 'pago', now(), 'ORD-PRAZO-136C')`,
    [O_LOCAL, U_CLIENTE],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items
       (id, order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, $3, 'Camisa Prazo 136c', 2, 40)`,
    [I_LOCAL, O_LOCAL, P_CAMISA],
  );
}

/** Política desta rodada: arrependimento 7 (o piso legal), vício e troca por caso. */
async function fixarPolitica(c, { aceitaTroca, prazoTroca, prazoVicio }) {
  await c.query(
    `UPDATE public.politica_devolucao
        SET prazo_arrependimento_dias = 7,
            aceita_troca = $1, prazo_troca_dias = $2, prazo_vicio_dias = $3,
            aceita_vale = true, exige_fotos_vicio = false,
            categorias_sem_troca = '{}',
            metodos_locais = ARRAY['entrega_na_loja', 'coleta']
      WHERE id = 1`,
    [aceitaTroca, prazoTroca, prazoVicio],
  );
}

/**
 * Fixa a entrega do pedido: UMA linha 'delivered' no histórico, `n` dias de
 * calendário de SP antes de hoje, às `hhmm` do relógio de SP. Confere que o
 * banco enxerga exatamente esse relógio e esse instante (protege a premissa
 * do -03:00 e a de que nenhuma outra linha 'delivered' vence a nossa).
 */
async function entregarHa(c, n, hhmm) {
  const dia = diaDaEntrega(n);
  const inst = instanteBRT(dia, hhmm);
  await c.query(
    "DELETE FROM public.marketplace_order_history WHERE order_id = $1",
    [O_LOCAL],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, created_at)
     VALUES ($1, 'shipping', 'delivered', $2::timestamptz)`,
    [O_LOCAL, inst],
  );
  const r = await c.query(
    `SELECT to_char($1::timestamptz AT TIME ZONE 'America/Sao_Paulo', 'YYYY-MM-DD HH24:MI') AS relogio_sp,
            (extract(epoch FROM public.devolucao__entregue_em($2)) * 1000)::bigint AS entregue_ms`,
    [inst, O_LOCAL],
  );
  assert.strictEqual(
    r.rows[0].relogio_sp,
    `${dia} ${hhmm}`,
    "premissa: relógio de SP",
  );
  assert.strictEqual(
    Number(r.rows[0].entregue_ms),
    Date.parse(inst),
    "premissa: a entrega lida pela função é a que fixamos",
  );
  return { dia, inst, ms: Date.parse(inst) };
}

// ------------------------------------------------------------------ helpers

/** FOTO das tabelas: totais globais e as linhas do pedido (tipo, prazo e entrega incluídos). */
async function foto(c) {
  const r = await c.query(
    `SELECT (SELECT count(*)::int FROM public.devolucoes) AS devolucoes,
            (SELECT count(*)::int FROM public.devolucao_itens) AS itens,
            (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                        'id', d.id, 'tipo', d.tipo, 'prazo_ate', d.prazo_ate::text,
                        'entregue_ms', (extract(epoch FROM d.entregue_em) * 1000)::bigint)
                      ORDER BY d.id), '[]'::jsonb)
               FROM public.devolucoes d WHERE d.order_id = $1) AS do_pedido`,
    [O_LOCAL],
  );
  return r.rows[0];
}

/** Abre o papel do cliente dono (authenticated) com auth.uid() emulado. */
async function comoCliente(c) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, true)", [U_CLIENTE]);
  await c.query("SET LOCAL ROLE authenticated");
}

/**
 * Chama solicitar_devolucao como o cliente dono num SAVEPOINT próprio, com a
 * FOTO das tabelas antes e depois. Sempre desfaz: nenhuma tentativa vaza para a
 * seguinte. Devolve {ok, resultado|erro, antes, depois}.
 */
async function tentar(c, motivo, resolucao) {
  await c.query("SAVEPOINT tentativa136c");
  const antes = await foto(c);
  let saida;
  try {
    await comoCliente(c);
    const r = await c.query(
      "SELECT public.solicitar_devolucao($1::uuid, $2::jsonb, $3, NULL, $4, 'entrega_na_loja', '{}'::text[]) AS r",
      [
        O_LOCAL,
        JSON.stringify([{ order_item_id: I_LOCAL, quantidade: 1 }]),
        motivo,
        resolucao,
      ],
    );
    await c.query("RESET ROLE");
    saida = { ok: true, resultado: r.rows[0].r, antes };
    saida.depois = await foto(c);
  } catch (erro) {
    await c.query("ROLLBACK TO SAVEPOINT tentativa136c");
    await c.query("RESET ROLE");
    saida = { ok: false, erro, antes, depois: await foto(c) };
  } finally {
    // No caminho de sucesso o SAVEPOINT ainda existe: desfaz o que a chamada gravou.
    await c.query("ROLLBACK TO SAVEPOINT tentativa136c");
    await c.query("RELEASE SAVEPOINT tentativa136c");
  }
  return saida;
}

/** O que a ficha do cliente (devolucao_elegibilidade) diz deste pedido agora. */
async function elegibilidade(c) {
  await c.query("SAVEPOINT eleg136c");
  try {
    await comoCliente(c);
    const r = await c.query(
      "SELECT public.devolucao_elegibilidade($1::uuid) AS r",
      [O_LOCAL],
    );
    return r.rows[0].r;
  } finally {
    await c.query("ROLLBACK TO SAVEPOINT eleg136c");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT eleg136c");
  }
}

/** A tentativa TEM de ser recusada pela função (22023 + a mensagem dela) e não deixar rastro. */
function recusada(rotulo, t, mensagem) {
  assert.strictEqual(
    t.ok,
    false,
    `${rotulo}: a chamada devia ser RECUSADA, mas gravou — devolucoes ${t.antes.devolucoes} -> ${t.depois.devolucoes}, do pedido ${JSON.stringify(t.depois.do_pedido)}`,
  );
  assert.strictEqual(
    t.erro.message,
    mensagem,
    `${rotulo}: recusou, mas NÃO pela guarda do prazo (${t.erro.code}: ${t.erro.message})`,
  );
  assert.strictEqual(t.erro.code, "22023", `${rotulo}: código da recusa`);
  assert.deepStrictEqual(
    t.depois,
    t.antes,
    `${rotulo}: a recusa deixou rastro nas tabelas`,
  );
}

/** A tentativa TEM de passar: 1 devolução nova, do tipo e com o prazo/entrega esperados. */
function aceita(rotulo, t, { tipo, prazoAte, entregaMs }) {
  assert.strictEqual(
    t.ok,
    true,
    `${rotulo}: devia PASSAR e foi recusado: ${t.erro?.code}: ${t.erro?.message}`,
  );
  assert.strictEqual(t.resultado.tipo, tipo, `${rotulo}: tipo devolvido`);
  assert.strictEqual(
    t.depois.devolucoes,
    t.antes.devolucoes + 1,
    `${rotulo}: 1 devolução nova`,
  );
  assert.strictEqual(
    t.depois.itens,
    t.antes.itens + 1,
    `${rotulo}: 1 item novo`,
  );
  assert.strictEqual(t.depois.do_pedido.length, 1, `${rotulo}: 1 do pedido`);
  const d = t.depois.do_pedido[0];
  assert.strictEqual(d.tipo, tipo, `${rotulo}: tipo gravado`);
  assert.strictEqual(
    d.prazo_ate,
    prazoAte,
    `${rotulo}: prazo_ate gravado (dia de São Paulo)`,
  );
  assert.strictEqual(
    Number(d.entregue_ms),
    entregaMs,
    `${rotulo}: entrega gravada`,
  );
}

/**
 * Confere a ficha de elegibilidade contra números calculados em JS:
 * dias, janelas, os três prazos (`null` = sem prazo), `pode` e o motivo.
 */
function ficha(rotulo, e, esperado) {
  assert.strictEqual(
    e.dias_desde_entrega,
    esperado.n,
    `${rotulo}: dias_desde_entrega`,
  );
  assert.strictEqual(
    Date.parse(e.entregue_em),
    esperado.ms,
    `${rotulo}: entregue_em`,
  );
  assert.deepStrictEqual(e.janelas, esperado.janelas, `${rotulo}: janelas`);
  assert.deepStrictEqual(
    e.prazos,
    {
      arrependimento_ate: esperado.prazos.arrependimento,
      troca_ate: esperado.prazos.troca,
      vicio_ate: esperado.prazos.vicio,
    },
    `${rotulo}: prazos`,
  );
  assert.strictEqual(e.pode, esperado.pode, `${rotulo}: pode`);
  assert.strictEqual(
    e.motivo_bloqueio,
    esperado.motivo,
    `${rotulo}: motivo_bloqueio`,
  );
}

// ------------------------------------------------------------------- casos
// Política "sem troca": só arrependimento (7) e vício (30).
const SEM_TROCA = { aceitaTroca: false, prazoTroca: 0, prazoVicio: 30 };
// Política "troca em 15 dias".
const TROCA_15 = { aceitaTroca: true, prazoTroca: 15, prazoVicio: 30 };

const CASOS = [];

CASOS.push({
  id: "C1",
  nome: "C1: entregue há 7 dias às 22:30 BRT, 'desisti' -> passa como arrependimento, prazo_ate = hoje",
  corpo: async (c) => {
    await fixarPolitica(c, SEM_TROCA);
    const e = await entregarHa(c, 7, "22:30");
    ficha("[C1] ficha", await elegibilidade(c), {
      n: 7,
      ms: e.ms,
      janelas: { arrependimento: true, troca: false, vicio: true },
      prazos: { arrependimento: HOJE, troca: null, vicio: somaDias(HOJE, 23) },
      pode: true,
      motivo: null,
    });
    aceita("[C1] solicitar", await tentar(c, "desisti", "reembolso"), {
      tipo: "arrependimento",
      prazoAte: HOJE,
      entregaMs: e.ms,
    });
  },
});

CASOS.push({
  id: "C2",
  nome: "C2: há 8 dias, 'desisti' -> recusa do prazo; janela de arrependimento fechada; 'defeito' ainda passa",
  corpo: async (c) => {
    await fixarPolitica(c, SEM_TROCA);
    const e = await entregarHa(c, 8, "22:30");
    ficha("[C2] ficha", await elegibilidade(c), {
      n: 8,
      ms: e.ms,
      janelas: { arrependimento: false, troca: false, vicio: true },
      prazos: {
        arrependimento: somaDias(HOJE, -1),
        troca: null,
        vicio: somaDias(HOJE, 22),
      },
      pode: true, // o vício (30 dias) ainda está aberto: ver o cabeçalho
      motivo: null,
    });
    recusada("[C2] desisti", await tentar(c, "desisti", "vale"), MSG_PRAZO);
    aceita("[C2] defeito (controle)", await tentar(c, "defeito", "reembolso"), {
      tipo: "vicio",
      prazoAte: somaDias(HOJE, 22),
      entregaMs: e.ms,
    });
  },
});

CASOS.push({
  id: "C3",
  nome: "C3: 'defeito' há 30 dias (último dia do vício) -> passa, prazo_ate = hoje",
  corpo: async (c) => {
    await fixarPolitica(c, SEM_TROCA);
    const e = await entregarHa(c, 30, "22:30");
    ficha("[C3] ficha", await elegibilidade(c), {
      n: 30,
      ms: e.ms,
      janelas: { arrependimento: false, troca: false, vicio: true },
      prazos: {
        arrependimento: somaDias(HOJE, -23),
        troca: null,
        vicio: HOJE,
      },
      pode: true,
      motivo: null,
    });
    aceita("[C3] defeito", await tentar(c, "defeito", "reembolso"), {
      tipo: "vicio",
      prazoAte: HOJE,
      entregaMs: e.ms,
    });
  },
});

CASOS.push({
  id: "C4",
  nome: "C4: 'defeito' há 31 dias -> recusa do vício; as 3 janelas fecham e pode=false",
  corpo: async (c) => {
    await fixarPolitica(c, SEM_TROCA);
    const e = await entregarHa(c, 31, "22:30");
    ficha("[C4] ficha", await elegibilidade(c), {
      n: 31,
      ms: e.ms,
      janelas: { arrependimento: false, troca: false, vicio: false },
      prazos: {
        arrependimento: somaDias(HOJE, -24),
        troca: null,
        vicio: somaDias(HOJE, -1),
      },
      pode: false,
      motivo: MSG_PRAZO,
    });
    recusada(
      "[C4] defeito",
      await tentar(c, "defeito", "reembolso"),
      MSG_PRAZO_VICIO,
    );
  },
});

CASOS.push({
  id: "C5",
  nome: "C5: troca aceita por 15 dias, 'tamanho_pequeno' em 15 -> passa como troca, prazo_ate = hoje",
  corpo: async (c) => {
    await fixarPolitica(c, TROCA_15);
    const e = await entregarHa(c, 15, "22:30");
    ficha("[C5] ficha", await elegibilidade(c), {
      n: 15,
      ms: e.ms,
      janelas: { arrependimento: false, troca: true, vicio: true },
      prazos: {
        arrependimento: somaDias(HOJE, -8),
        troca: HOJE,
        vicio: somaDias(HOJE, 15),
      },
      pode: true,
      motivo: null,
    });
    aceita(
      "[C5] tamanho_pequeno",
      await tentar(c, "tamanho_pequeno", "troca"),
      {
        tipo: "troca",
        prazoAte: HOJE,
        entregaMs: e.ms,
      },
    );
  },
});

CASOS.push({
  id: "C6",
  nome: "C6: com troca por 15 dias, em 16 -> recusa do prazo; a janela de troca fecha",
  corpo: async (c) => {
    await fixarPolitica(c, TROCA_15);
    const e = await entregarHa(c, 16, "22:30");
    ficha("[C6] ficha", await elegibilidade(c), {
      n: 16,
      ms: e.ms,
      janelas: { arrependimento: false, troca: false, vicio: true },
      prazos: {
        arrependimento: somaDias(HOJE, -9),
        troca: somaDias(HOJE, -1),
        vicio: somaDias(HOJE, 14),
      },
      pode: true, // vício ainda aberto
      motivo: null,
    });
    recusada(
      "[C6] tamanho_pequeno",
      await tentar(c, "tamanho_pequeno", "troca"),
      MSG_PRAZO,
    );
  },
});

CASOS.push({
  id: "C7",
  nome: "C7: entregue às 23:50 BRT (02:50 UTC do dia seguinte): 7 dias passa com prazo_ate = hoje; 8 dias recusa",
  corpo: async (c) => {
    await fixarPolitica(c, SEM_TROCA);
    // 7 dias, 23:50: o dia de SP é hoje-7; em UTC já é hoje-6.
    const e7 = await entregarHa(c, 7, "23:50");
    const utc = (
      await c.query(
        "SELECT ($1::timestamptz)::date::text AS d, current_setting('TimeZone') AS tz",
        [e7.inst],
      )
    ).rows[0];
    assert.strictEqual(utc.tz, "UTC", "premissa: a sessão está em UTC");
    assert.strictEqual(
      utc.d,
      somaDias(e7.dia, 1),
      "premissa: sem fuso, a entrega das 23:50 BRT cairia no dia SEGUINTE",
    );
    ficha("[C7] ficha 7 dias", await elegibilidade(c), {
      n: 7,
      ms: e7.ms,
      janelas: { arrependimento: true, troca: false, vicio: true },
      prazos: { arrependimento: HOJE, troca: null, vicio: somaDias(HOJE, 23) },
      pode: true,
      motivo: null,
    });
    aceita("[C7] 7 dias", await tentar(c, "desisti", "reembolso"), {
      tipo: "arrependimento",
      prazoAte: HOJE,
      entregaMs: e7.ms,
    });
    // 8 dias, 23:50: em UTC seria o dia hoje-7 e passaria um dia a mais.
    const e8 = await entregarHa(c, 8, "23:50");
    ficha("[C7] ficha 8 dias", await elegibilidade(c), {
      n: 8,
      ms: e8.ms,
      janelas: { arrependimento: false, troca: false, vicio: true },
      prazos: {
        arrependimento: somaDias(HOJE, -1),
        troca: null,
        vicio: somaDias(HOJE, 22),
      },
      pode: true,
      motivo: null,
    });
    recusada("[C7] 8 dias", await tentar(c, "desisti", "vale"), MSG_PRAZO);
  },
});

CASOS.push({
  id: "C8",
  nome: "C8 (controle): entregue ao meio-dia BRT: 7 dias passa, 8 dias recusa (mesmo dia em UTC e em SP)",
  corpo: async (c) => {
    await fixarPolitica(c, SEM_TROCA);
    const e7 = await entregarHa(c, 7, "12:00");
    ficha("[C8] ficha 7 dias", await elegibilidade(c), {
      n: 7,
      ms: e7.ms,
      janelas: { arrependimento: true, troca: false, vicio: true },
      prazos: { arrependimento: HOJE, troca: null, vicio: somaDias(HOJE, 23) },
      pode: true,
      motivo: null,
    });
    aceita("[C8] 7 dias", await tentar(c, "desisti", "reembolso"), {
      tipo: "arrependimento",
      prazoAte: HOJE,
      entregaMs: e7.ms,
    });
    const e8 = await entregarHa(c, 8, "12:00");
    ficha("[C8] ficha 8 dias", await elegibilidade(c), {
      n: 8,
      ms: e8.ms,
      janelas: { arrependimento: false, troca: false, vicio: true },
      prazos: {
        arrependimento: somaDias(HOJE, -1),
        troca: null,
        vicio: somaDias(HOJE, 22),
      },
      pode: true,
      motivo: null,
    });
    recusada("[C8] 8 dias", await tentar(c, "desisti", "vale"), MSG_PRAZO);
  },
});

// ------------------------------------------------------------------ rodada

const corpoVivo = async (c, funcao) =>
  (
    await c.query("SELECT pg_get_functiondef($1::regprocedure) AS d", [funcao])
  ).rows[0].d.replace(/\r/g, "");

/** Aplica o mutante AO CORPO VIVO, dentro da transação aberta (some no ROLLBACK). */
async function aplicarMutante(c, nome) {
  const m = MUTANTES[nome];
  if (!m) {
    falhar(
      "ERRO",
      `MUTANTE_R136C='${nome}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
    );
  }
  const def = await corpoVivo(c, m.funcao);
  const ocorrencias = def.split(m.de).length - 1;
  assert.strictEqual(
    ocorrencias,
    1,
    `mutante ${nome}: o trecho tem de aparecer 1x no corpo vivo (achei ${ocorrencias}): ${JSON.stringify(m.de.slice(0, 80))}`,
  );
  const mutado = def.replace(m.de, () => m.para);
  assert.notStrictEqual(mutado, def, "mutante não alterou nada");
  await c.query(mutado);
  assert.strictEqual(
    await corpoVivo(c, m.funcao),
    mutado,
    "o banco não instalou exatamente o mutante",
  );
  return m;
}

/**
 * Uma transação só, SEMPRE desfeita: sessão em UTC, (mutante), semente, e cada
 * caso num SAVEPOINT. Devolve {passou:[ids], falhou:[{id, nome, erro}]}. Erro
 * que não é de asserção (SQL, conexão) sobe: é do teste, não do corpo.
 */
async function rodar(c, nomeMutante) {
  await c.query("BEGIN");
  try {
    // O cast `timestamptz::date` sem fuso usa o fuso da SESSÃO: fixa UTC para
    // a prova valer em qualquer banco (o do CI é UTC; o de um dev pode já ser SP).
    await c.query("SET LOCAL TIME ZONE 'UTC'");
    const mutante = nomeMutante ? await aplicarMutante(c, nomeMutante) : null;
    await semear(c);
    // UMA leitura do dia de SP: now() é constante na transação, as funções veem o mesmo.
    HOJE = (
      await c.query(
        "SELECT ((now() AT TIME ZONE 'America/Sao_Paulo')::date)::text AS hoje",
      )
    ).rows[0].hoje;
    const resultado = { mutante, passou: [], falhou: [] };
    for (const { id, nome, corpo } of CASOS) {
      await c.query("SAVEPOINT caso136c");
      try {
        await corpo(c);
        resultado.passou.push(id);
      } catch (erro) {
        if (erro?.code !== "ERR_ASSERTION") throw erro;
        resultado.falhou.push({ id, nome, erro });
      } finally {
        await c.query("ROLLBACK TO SAVEPOINT caso136c");
        await c.query("RELEASE SAVEPOINT caso136c");
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
  const nomeMutante = process.env.MUTANTE_R136C || "";
  if (nomeMutante && !MUTANTES[nomeMutante]) {
    falhar(
      "ERRO",
      `MUTANTE_R136C='${nomeMutante}' desconhecido. Nomes: ${Object.keys(MUTANTES).join(", ")}`,
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
          `o mutante ${nomeMutante} deixou TODOS os casos verdes: a prova não guarda esse trecho`,
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
          `o mutante ${nomeMutante} ficou vermelho em [${r.falhou.map((f) => f.id).join(", ")}], esperado exatamente [${r.mutante.espera.join(", ")}] (faltou [${faltou.join(", ")}], a mais [${demais.join(", ")}])`,
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
        "O prazo da devolução divergiu do dia de São Paulo — ver acima qual caso.",
      );
    }
    console.log(
      `\n[o-prazo-da-devolucao] ${CASOS.length}/${CASOS.length} casos passaram (hoje em SP: ${HOJE}).`,
    );
    anexarAoSummary(
      TITULO,
      `${CASOS.map((x) => `- ✅ ${x.nome}`).join("\n")}\n\n**${CASOS.length}/${CASOS.length} casos** contra as migrations aplicadas do zero.`,
    );
  } finally {
    await cliente.end().catch(() => {});
  }
}

main();
