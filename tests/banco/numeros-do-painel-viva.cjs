"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste ou do catálogo do
 * Postgres efêmero; nunca de entrada de rede nem de terceiro. */

/**
 * PROVA VIVA das migrations 20261227000000_o_crm_compara_o_que_e_comparavel.sql
 * (public.crm_visao) e 20261228000000_o_inicio_compara_ate_a_mesma_hora.sql
 * (public.painel_inicio) contra o Postgres EFÊMERO com as migrations aplicadas
 * do zero (rpc-ci). Os números que o lojista lê todo dia:
 *
 *   (1) "Taxa de devolução" do CRM: embaixo as vendas PAGAS no período
 *       (inclusive as que depois foram estornadas/canceladas), em cima só as
 *       devoluções DESSAS vendas. Vendas de R$ 100: devolução parcial de R$ 30
 *       com 2 vendas = 15%; +R$ 70 no mesmo pedido = 50%; 3 vendas com 2
 *       devolvidas = 66,7%; pagar, cancelar e estornar por inteiro = 100% (e
 *       nunca mais); o caso sem venda = 0. Devolução de venda de OUTRO período
 *       não entra; reembolso manual de devolução entra; dado impossível (ledger
 *       + manual acima do total) fica limitado ao total do pedido.
 *   (2) "Vendas pagas hoje" do Início e "vs. ontem"/"vs. N dias antes" do CRM:
 *       a base de comparação para na MESMA hora de agora. O "agora" não é
 *       injetado (a função usa now()): as vendas são montadas em volta do now()
 *       REAL do banco (120 s antes e 120 s depois do corte), com a guarda de
 *       esperar quando o relógio de São Paulo está a menos de 3 min da virada
 *       do dia (aí "120 s antes/depois" cairia em outro dia).
 *   (3) CONTROLES e MUTANTES: o corpo antigo (o rollback-manual aplicado numa
 *       transação desfeita) dá os números errados; cada guarda tirada do corpo
 *       novo (mutante) deixa a prova correspondente vermelha.
 *   (4) a porta: cliente comum recusado com 42501; o formato do JSON (chaves)
 *       é o mesmo do corpo antigo; a ACL, os atributos e o dono ficam iguais;
 *       reaplicar 2x é o mesmo que 1x; preflight com corpo divergente recusa
 *       sem escrever; o rollback devolve o md5 antigo e o segundo rollback
 *       recusa; nenhuma linha de pedido muda.
 *
 * Toda prova que mexe em corpo de função roda numa transação DESFEITA no fim.
 * NUMEROS_SO=comportamento roda só os itens (1) e (2) — usado para ver o
 * vermelho do corpo antigo antes da migration existir; NUMEROS_TODAS=1 não
 * para na primeira que falhar (mostra todas as vermelhas de uma vez).
 *
 * A SUCESSORA 20261232 (a grade do CRM) redefine crm_visao por cima da 20261227 na árvore inteira, e esta
 * prova é da 20261227: antes de tudo ela leva o crm_visao ao corpo da 27 pelo rollback-manual da 32 (que
 * aceita o corpo da 32 ou o da 27; o clone é descartável). A prova da 32 é
 * tests/banco/a-grade-do-crm-mede-a-recencia-viva.cjs.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/numeros-do-painel-viva.cjs
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

const DIR_MIGRATIONS = path.join(
  __dirname,
  "..",
  "..",
  "supabase",
  "migrations",
);
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho montado de literais do próprio teste.
const ler = (nome) => fs.readFileSync(path.join(DIR_MIGRATIONS, nome), "utf8");
const NOME_C = "20261227000000_o_crm_compara_o_que_e_comparavel.sql";
const NOME_P = "20261228000000_o_inicio_compara_ate_a_mesma_hora.sql";
const NOME_32 =
  "20261232000000_a_grade_do_crm_mede_a_recencia_do_mesmo_instante_da_lista.sql";
const SO_COMPORTAMENTO = process.env.NUMEROS_SO === "comportamento";

const CRM = "public.crm_visao(date,date)";
const PAINEL = "public.painel_inicio()";

const U_ADMIN = "d0d00000-0000-4000-8000-000000000001";
const U_CLIENTE = "d0d00000-0000-4000-8000-000000000002";

const num = (v) => Math.round(Number(v) * 10000) / 10000;

async function logar(c, uid) {
  await c.query("SELECT set_config('app.rpc.user_id', $1, false)", [uid]);
}

/** Pedido pago (ou como o `opcoes` mandar). Devolve o id. */
async function pedido(c, o) {
  const r = await c.query(
    `INSERT INTO public.marketplace_orders
       (user_id, customer_name, customer_data, total, subtotal, status, canal, payment_method,
        payment_status, paid_at, pagamento_recebido_em, created_at)
     VALUES ($1, 'Cliente numeros', '{}'::jsonb, $2, $2, $3, $4, $5, $6,
             CASE WHEN $5 = 'online' THEN $7::timestamptz END,
             CASE WHEN $5 <> 'online' THEN $7::timestamptz END,
             $7::timestamptz)
     RETURNING id`,
    [
      null,
      o.total,
      o.status || "delivered",
      o.canal || "online",
      o.pagamento || "online",
      o.paymentStatus || "pago",
      o.quando,
    ],
  );
  return r.rows[0].id;
}

/**
 * Devolução de dinheiro pelo CAMINHO REAL: linha no ledger e `concluir_estorno`
 * (a única que soma `valor_estornado` e vira o pedido 'estornado' ao alcançar o
 * total). `quando` é o instante em que a devolução foi concluída.
 */
async function devolver(c, orderId, valor, quando) {
  const l = await c.query(
    `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status)
     VALUES ($1, $2, 'lojista', 'solicitado') RETURNING id`,
    [orderId, valor],
  );
  await c.query(
    "SELECT public.concluir_estorno($1::uuid, 'mp-' || $1::text, 'approved', 'accredited')",
    [l.rows[0].id],
  );
  await c.query(
    "UPDATE public.order_refunds SET concluido_em = $2::timestamptz WHERE id = $1",
    [l.rows[0].id, quando],
  );
}

let protocolo = 0;
/** Reembolso MANUAL de devolução concluída (dinheiro devolvido na mão). */
async function devolucaoManual(c, orderId, valor, quando) {
  protocolo += 1;
  await c.query(
    `INSERT INTO public.devolucoes
       (protocolo, order_id, user_id, tipo, motivo, resolucao_desejada, resolucao_final, modalidade,
        metodo_retorno, status, valor_itens, valor_reembolso, reembolso_manual, prazo_ate, politica,
        concluida_em)
     VALUES ($1, $2, $3, 'arrependimento', 'desisti', 'reembolso', 'reembolso', 'local',
             'entrega_na_loja', 'concluida', $4, $4, true, current_date, '{}'::jsonb, $5::timestamptz)`,
    [`NUM-${protocolo}`, orderId, U_CLIENTE, valor, quando],
  );
}

async function taxa(c, de, ate) {
  await logar(c, U_ADMIN);
  const r = await c.query("SELECT public.crm_visao($1::date, $2::date) AS r", [
    de,
    ate,
  ]);
  return num(r.rows[0].r.kpis.taxa_devolucao);
}

async function crm(c, de, ate) {
  await logar(c, U_ADMIN);
  return (
    await c.query("SELECT public.crm_visao($1::date, $2::date) AS r", [de, ate])
  ).rows[0].r;
}

async function inicio(c) {
  await logar(c, U_ADMIN);
  return (await c.query("SELECT public.painel_inicio() AS r")).rows[0].r;
}

async function catalogo(c, assinatura) {
  const r = await c.query(
    `SELECT md5(replace(prosrc, E'\\r', '')) AS hash, prosecdef,
            coalesce(array_to_string(proconfig, ','), '') AS proconfig,
            coalesce(proacl::text, '') AS proacl, provolatile::text AS volatil,
            proowner::regrole::text AS dono
       FROM pg_proc WHERE oid = to_regprocedure($1)`,
    [assinatura],
  );
  return r.rows[0] || null;
}

/** Os caminhos de chave de um JSON (formato), sem os valores. */
function formato(v, prefixo = "") {
  if (Array.isArray(v))
    return v.length ? formato(v[0], `${prefixo}[]`) : [`${prefixo}[]`];
  if (v && typeof v === "object")
    return Object.keys(v)
      .sort()
      .flatMap((k) => formato(v[k], `${prefixo}.${k}`));
  return [prefixo];
}

// 21h de São Paulo = meia-noite em UTC (o fuso da loja é -03:00 o ano todo).
const SP_MEIA_NOITE_UTC = 21 * 3600;
const FOLGA_DA_VIRADA = 300;

/**
 * O relógio de São Paulo precisa estar longe de DUAS viradas: a do dia de SP
 * (as vendas de "120 s antes / depois do corte" têm de cair no mesmo dia da
 * base) e a de 21h de SP, que é a virada do dia em UTC (a venda da noite de
 * `vendaDaNoite` só discrimina o corte em UTC enquanto o corte de agora
 * estiver inteiro de um lado dela). Devolve os segundos de SP de agora.
 */
async function esperarJanelaSegura(c) {
  for (;;) {
    const s = Number(
      (
        await c.query(
          "SELECT extract(epoch FROM (now() AT TIME ZONE 'America/Sao_Paulo')::time) AS s",
        )
      ).rows[0].s,
    );
    let espera = 0;
    let motivo = "";
    if (s < 200) {
      espera = 200 - s;
      motivo = "da virada do dia de SP";
    } else if (s > 86400 - 200) {
      espera = 86400 - s + 200;
      motivo = "da virada do dia de SP";
    } else if (Math.abs(s - SP_MEIA_NOITE_UTC) < FOLGA_DA_VIRADA) {
      espera = SP_MEIA_NOITE_UTC + FOLGA_DA_VIRADA - s;
      motivo = "da meia-noite em UTC (21h de SP)";
    }
    if (espera === 0) return s;
    console.log(
      `    relógio de SP perto ${motivo}: esperando ${Math.ceil(espera)} s`,
    );
    await new Promise((resolve) => setTimeout(resolve, espera * 1000));
  }
}

/**
 * A venda que só o corte INTEIRO em UTC (v_hora e pago_em em UTC) trata errado.
 * Em UTC a hora do dia anda 3 h na frente da de SP: comparar as duas horas em
 * UTC só difere da comparação em SP quando UMA delas passa da meia-noite de UTC
 * (21h de SP) e a outra não. Então a venda fica do OUTRO lado dessa virada em
 * relação ao corte de agora, e do mesmo lado de SP do que o corpo certo decide:
 *   - antes das 21h de SP (o normal): venda às 23h, DEPOIS do corte de SP, e o
 *     corpo certo a deixa de fora; o corte em UTC a põe dentro (23h de SP são
 *     02h em UTC, antes da hora UTC do corte, que é pelo menos 03h);
 *   - depois das 21h de SP: venda às 20h, ANTES do corte de SP, e o corpo certo
 *     a põe dentro; o corte em UTC a deixa fora (20h de SP são 23h em UTC,
 *     depois da hora UTC do corte, que já virou o dia).
 * `entra` diz o que o corpo certo faz com ela (decidido uma vez por rodada).
 */
async function escolherANoite(c) {
  const s = await esperarJanelaSegura(c);
  fx.noite =
    s > SP_MEIA_NOITE_UTC
      ? { hora: "20:00", entra: true }
      : { hora: "23:00", entra: false };
}

/** Venda paga numa hora fixa de SP, `dias` atrás de hoje (o dia de SP, nunca o de UTC). */
async function vendaDaNoite(c, dias, total) {
  const r = await c.query(
    "SELECT (((public.fin__hoje() - $1::int) + $2::time) AT TIME ZONE 'America/Sao_Paulo') AS t",
    [dias, fx.noite.hora],
  );
  return pedido(c, { total, quando: r.rows[0].t });
}

// Valores da venda da noite: ontem e semana passada, distintos para saber qual vazou.
const NOITE_ONTEM = 40;
const NOITE_SEMANA = 70;
const entra = (v) => (fx.noite.entra ? v : 0);

/** Instante do banco deslocado em segundos e dias (para as vendas de "mesma hora"). */
async function instante(c, dias, segundos) {
  const r = await c.query(
    "SELECT (now() - make_interval(days => $1) + make_interval(secs => $2))::timestamptz AS t",
    [dias, segundos],
  );
  return r.rows[0].t;
}

// Cada cenário da taxa vive no SEU dia (2025, bem longe de hoje), para um não
// enxergar o outro; o fuso da loja é -03:00 o ano todo.
const D = (dia) => `2025-03-${dia}`;
const AS_12H = (dia) => `${D(dia)}T12:00:00-03:00`;

const PROVAS = [];
const fx = {};

PROVAS.push({
  nome: "(0) fixtures: admin atual e cliente comum; formato e atributos do corpo ANTIGO guardados para comparar",
  corpo: async (c) => {
    await c.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
         ($1, 'admin@numeros.teste', '{"role":"admin"}'::jsonb),
         ($2, 'cliente@numeros.teste', '{}'::jsonb)`,
      [U_ADMIN, U_CLIENTE],
    );
    // 20261199000000 (admin ATUAL): o painel exige o papel admin AGORA em
    // auth.users E em profiles — o admin da prova tem os dois.
    await c.query(
      `INSERT INTO public.profiles (id, full_name, role) VALUES
         ($1, 'Admin Numeros', 'admin'), ($2, 'Cliente Numeros', 'customer')`,
      [U_ADMIN, U_CLIENTE],
    );
  },
});

PROVAS.push({
  nome: "(1a) taxa de devolução: 2 vendas de R$ 100, devolução parcial de R$ 30 = 15%; +R$ 70 no mesmo pedido (vira 'estornado') = 50%",
  corpo: async (c) => {
    const a = await pedido(c, { total: 100, quando: AS_12H("10") });
    await pedido(c, { total: 100, quando: AS_12H("10") });
    assert.equal(await taxa(c, D("10"), D("10")), 0, "sem devolução, 0");
    await devolver(c, a, 30, AS_12H("10"));
    assert.equal(await taxa(c, D("10"), D("10")), 0.15, "30 de 200");
    await devolver(c, a, 70, AS_12H("10"));
    const st = await c.query(
      "SELECT payment_status FROM public.marketplace_orders WHERE id = $1",
      [a],
    );
    assert.equal(
      st.rows[0].payment_status,
      "estornado",
      "o pedido inteiro voltou",
    );
    assert.equal(
      await taxa(c, D("10"), D("10")),
      0.5,
      "o pedido estornado CONTINUA na turma: 100 de 200 (antes: 100% de 1 venda)",
    );
  },
});

PROVAS.push({
  nome: "(1b) 3 vendas, 2 devolvidas por inteiro = 66,7% (antes: 200%)",
  corpo: async (c) => {
    const a = await pedido(c, { total: 100, quando: AS_12H("11") });
    const b = await pedido(c, { total: 100, quando: AS_12H("11") });
    await pedido(c, { total: 100, quando: AS_12H("11") });
    await devolver(c, a, 100, AS_12H("11"));
    await devolver(c, b, 100, AS_12H("11"));
    assert.equal(await taxa(c, D("11"), D("11")), 0.6667);
  },
});

PROVAS.push({
  nome: "(1c) pagar, CANCELAR e estornar por inteiro = 100% de 1 pedido (antes: 0%, o denominador sumia); nunca passa de 100%",
  corpo: async (c) => {
    const a = await pedido(c, { total: 100, quando: AS_12H("12") });
    await c.query(
      "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
      [a],
    );
    await devolver(c, a, 100, AS_12H("12"));
    assert.equal(await taxa(c, D("12"), D("12")), 1);
    // e uma venda boa do mesmo dia dilui, sem passar de 100%
    await pedido(c, { total: 300, quando: AS_12H("12") });
    assert.equal(await taxa(c, D("12"), D("12")), 0.25, "100 de 400");
  },
});

PROVAS.push({
  nome: "(1d) BORDA — sem venda no período: 0, sem dividir por zero; só pedido NÃO pago também não entra",
  corpo: async (c) => {
    assert.equal(await taxa(c, D("20"), D("20")), 0, "dia vazio");
    await pedido(c, {
      total: 100,
      quando: AS_12H("21"),
      status: "pending",
      paymentStatus: "aguardando",
    });
    assert.equal(await taxa(c, D("21"), D("21")), 0, "só PIX aguardando");
  },
});

PROVAS.push({
  nome: "(1e) BORDA — a devolução entra no período da VENDA: devolução de venda de outro período não conta; venda do período devolvida DEPOIS conta",
  corpo: async (c) => {
    // venda de fevereiro devolvida por inteiro em 30/03: não entra na taxa de 30/03
    const antiga = await pedido(c, {
      total: 100,
      quando: "2025-02-01T12:00:00-03:00",
    });
    await devolver(c, antiga, 100, AS_12H("30"));
    await pedido(c, { total: 100, quando: AS_12H("30") });
    assert.equal(
      await taxa(c, D("30"), D("30")),
      0,
      "a devolução de fevereiro não pesa em 30/03",
    );
    // venda de 31/03 devolvida só em abril: pesa na taxa de 31/03
    const tardia = await pedido(c, { total: 100, quando: AS_12H("31") });
    await devolver(c, tardia, 40, "2025-04-15T12:00:00-03:00");
    assert.equal(await taxa(c, D("31"), D("31")), 0.4);
  },
});

PROVAS.push({
  nome: "(1f) reembolso MANUAL de devolução entra (25 de 100 = 25%); dado impossível (ledger 80 + manual 60 num pedido de 100) fica no total = 100%; 'estornado' sem linha de ledger (anulada no balcão) = 100%",
  corpo: async (c) => {
    const m = await pedido(c, { total: 100, quando: AS_12H("13") });
    await devolucaoManual(c, m, 25, AS_12H("13"));
    assert.equal(await taxa(c, D("13"), D("13")), 0.25);

    const impossivel = await pedido(c, { total: 100, quando: AS_12H("14") });
    await c.query(
      `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, concluido_em)
       VALUES ($1, 80, 'sistema', 'concluido', $2::timestamptz)`,
      [impossivel, AS_12H("14")],
    );
    await devolucaoManual(c, impossivel, 60, AS_12H("14"));
    assert.equal(
      await taxa(c, D("14"), D("14")),
      1,
      "80 + 60 > 100: limitado ao total",
    );

    await pedido(c, {
      total: 100,
      quando: AS_12H("15"),
      status: "cancelled",
      canal: "presencial",
      pagamento: "cash",
      paymentStatus: "estornado",
    });
    assert.equal(await taxa(c, D("15"), D("15")), 1, "venda anulada no ato");
  },
});

// ---- item 2: a mesma hora ----

PROVAS.push({
  nome: "(2a) Início: semana passada R$ 100 antes da hora de agora e R$ 200 depois; hoje R$ 100 = base 100 (chip 0%), não 300 (-66,7%); a venda da noite (23h de SP) fica de fora, e o corte inteiro em UTC a traria",
  corpo: async (c) => {
    await escolherANoite(c);
    fx.a = await instante(c, 7, -120);
    // semana passada: 100 ANTES do corte, 200 DEPOIS (ainda não tinha acontecido nesta hora)
    await pedido(c, { total: 100, quando: fx.a });
    await pedido(c, { total: 200, quando: await instante(c, 7, 120) });
    // outro dia (oito dias atrás): nunca entra na base
    await pedido(c, { total: 500, quando: await instante(c, 8, 0) });
    // ontem: A' antes do corte, B' depois (para o CRM "Hoje")
    await pedido(c, { total: 100, quando: await instante(c, 1, -120) });
    await pedido(c, { total: 200, quando: await instante(c, 1, 120) });
    // hoje, há um minuto
    await pedido(c, { total: 100, quando: await instante(c, 0, -60) });
    // a venda da NOITE (fuso): ontem e na semana passada, do outro lado da virada de UTC
    await vendaDaNoite(c, 1, NOITE_ONTEM);
    await vendaDaNoite(c, 7, NOITE_SEMANA);

    const r = await inicio(c);
    assert.equal(num(r.hoje.receita), 100, "hoje");
    assert.equal(
      num(r.hoje.receita_semana_passada),
      100 + entra(NOITE_SEMANA),
      "a base da semana passada para na mesma hora, no relógio de SP (antes: o dia inteiro; em UTC: a venda da noite entra ou sai errada)",
    );
    assert.equal(
      num(r.hoje.receita) - num(r.hoje.receita_semana_passada),
      -entra(NOITE_SEMANA),
      "chip 0% (a venda da noite só pesa quando o corpo certo a põe dentro)",
    );
  },
});

PROVAS.push({
  nome: "(2b) CRM 'Hoje': o ontem para na mesma hora (anterior = 100, 1 pedido); 7 dias terminando hoje corta só o ÚLTIMO dia do anterior (100 + 500 do dia -8); período que NÃO termina hoje não corta (nada muda); a venda da noite (23h de SP) fica de fora do corte, e o corte inteiro em UTC a traria",
  corpo: async (c) => {
    const hoje = (await c.query("SELECT public.fin__hoje()::text AS d")).rows[0]
      .d;
    const dia = async (menos) =>
      (await c.query("SELECT ($1::date - $2::int)::text AS d", [hoje, menos]))
        .rows[0].d;

    const k = (await crm(c, hoje, hoje)).kpis;
    assert.equal(num(k.receita), 100, "hoje");
    assert.equal(
      num(k.receita_anterior),
      100 + entra(NOITE_ONTEM),
      "ontem até a mesma hora, no relógio de SP (antes: o dia inteiro)",
    );
    assert.equal(Number(k.pedidos_anterior), fx.noite.entra ? 2 : 1);
    assert.equal(
      num(k.ticket_medio_anterior),
      num((100 + entra(NOITE_ONTEM)) / (fx.noite.entra ? 2 : 1)),
    );

    // 7 dias: [hoje-6, hoje]; anterior [hoje-13, hoje-7] — o último dia (hoje-7) corta; o dia -8 inteiro
    const sete = (await crm(c, await dia(6), hoje)).kpis;
    assert.equal(
      num(sete.receita_anterior),
      600 + entra(NOITE_SEMANA),
      "100 (até a hora) + 500 (dia -8, inteiro); a venda da noite do dia -7 só entra se o corpo certo a põe antes do corte",
    );
    assert.equal(Number(sete.pedidos_anterior), fx.noite.entra ? 3 : 2);

    // CONTROLE: [hoje-6, hoje-1] NÃO termina hoje: o anterior [hoje-12, hoje-7] vai inteiro
    const naoHoje = (await crm(c, await dia(6), await dia(1))).kpis;
    assert.equal(
      num(naoHoje.receita_anterior),
      800 + NOITE_SEMANA,
      "100 + 200 + a venda da noite do dia -7 e 500 do dia -8: sem corte",
    );
    assert.equal(Number(naoHoje.pedidos_anterior), 4);
  },
});

// ---- itens 3 e 4: controles, mutantes e a migration ----

async function montarCorpos() {
  const mc = ler(NOME_C);
  const mp = ler(NOME_P);
  const rbc = ler(`rollback-manual-${NOME_C}`);
  const rbp = ler(`rollback-manual-${NOME_P}`);
  const pares = (sql, assinatura) => {
    const i = sql.indexOf(`('${assinatura}', '`);
    const m = /^\('[^']*', '([0-9a-f]{32})', '([0-9a-f]{32})'\)/.exec(
      sql.slice(i),
    );
    assert.ok(m, `o preflight não cita os dois hashes de ${assinatura}`);
    return { vigente: m[1], desta: m[2] };
  };
  fx.migC = mc;
  fx.migP = mp;
  fx.rbC = rbc;
  fx.rbP = rbp;
  fx.hC = pares(mc, CRM);
  fx.hP = pares(mp, PAINEL);
  // o statement CREATE OR REPLACE (para os mutantes)
  const stmt = (sql) => {
    const ini = sql.indexOf("CREATE OR REPLACE FUNCTION");
    const fim = sql.indexOf("\n$$;", ini) + "\n$$;".length;
    return sql.slice(ini, fim);
  };
  fx.stmtC = stmt(mc);
  fx.stmtP = stmt(mp);
}

/** Roda `fn` com o `sql` aplicado numa transação que SEMPRE é desfeita. */
async function numaTransacao(c, sqls, fn) {
  await c.query("BEGIN");
  try {
    for (const sql of sqls) await c.query(sql);
    return await fn();
  } finally {
    await c.query("ROLLBACK");
  }
}

/** A prova `prova` PRECISA falhar com o corpo mutado: senão, o mutante sobreviveu. */
async function mataMutante(c, nome, sqls, prova) {
  let passou = false;
  try {
    await numaTransacao(c, sqls, prova);
    passou = true;
  } catch (e) {
    if (e instanceof assert.AssertionError) {
      console.log(
        `    mutante morto: ${nome} (a prova viu ${e.actual}, o certo é ${e.expected})`,
      );
      return;
    }
    throw e;
  }
  assert.ok(!passou, `MUTANTE SOBREVIVEU: ${nome}`);
}

function mutar(stmt, de, para) {
  const n = stmt.split(de).length - 1;
  assert.equal(
    n,
    1,
    `o trecho do mutante tem de aparecer 1x (achei ${n}): ${de.slice(0, 50)}`,
  );
  return stmt.replace(de, () => para);
}

const HORA_SP =
  "v_hora time := (now() AT TIME ZONE 'America/Sao_Paulo')::time;";
const HORA_UTC = "v_hora time := (now() AT TIME ZONE 'UTC')::time;";
/** Corpo com o corte INTEIRO em UTC: o relógio de agora e o da venda no mesmo fuso errado. */
function emUtcInteiro(stmt, comparacaoSp, comparacaoUtc) {
  return mutar(mutar(stmt, HORA_SP, HORA_UTC), comparacaoSp, comparacaoUtc);
}

// as provas do comportamento, reexecutáveis sobre os dados já montados
const prova1a = async (c) => {
  assert.equal(await taxa(c, D("10"), D("10")), 0.5);
};
const prova1b = async (c) => {
  assert.equal(await taxa(c, D("11"), D("11")), 0.6667);
};
const prova1c = async (c) => {
  assert.equal(await taxa(c, D("12"), D("12")), 0.25);
};
const prova1f = async (c) => {
  assert.equal(await taxa(c, D("13"), D("13")), 0.25);
  assert.equal(await taxa(c, D("14"), D("14")), 1);
  assert.equal(await taxa(c, D("15"), D("15")), 1);
};
const prova1e = async (c) => {
  assert.equal(await taxa(c, D("30"), D("30")), 0);
  assert.equal(await taxa(c, D("31"), D("31")), 0.4);
};
const prova2a = async (c) => {
  assert.equal(
    num((await inicio(c)).hoje.receita_semana_passada),
    100 + entra(NOITE_SEMANA),
  );
};
const prova2b = async (c) => {
  const hoje = (await c.query("SELECT public.fin__hoje()::text AS d")).rows[0]
    .d;
  const k = (await crm(c, hoje, hoje)).kpis;
  assert.equal(num(k.receita_anterior), 100 + entra(NOITE_ONTEM));
  const d6 = (await c.query("SELECT ($1::date - 6)::text AS d", [hoje])).rows[0]
    .d;
  const d1 = (await c.query("SELECT ($1::date - 1)::text AS d", [hoje])).rows[0]
    .d;
  assert.equal(
    num((await crm(c, d6, hoje)).kpis.receita_anterior),
    600 + entra(NOITE_SEMANA),
  );
  assert.equal(
    num((await crm(c, d6, d1)).kpis.receita_anterior),
    800 + NOITE_SEMANA,
  );
};

PROVAS.push({
  nome: "(3) CONTROLE: o corpo ANTIGO (rollback-manual numa transação desfeita) erra os números — taxa > 100%, ontem inteiro, semana passada inteira",
  corpo: async (c) => {
    await montarCorpos();
    await numaTransacao(c, [fx.rbC, fx.rbP], async () => {
      assert.equal((await catalogo(c, CRM)).hash, fx.hC.vigente);
      assert.equal((await catalogo(c, PAINEL)).hash, fx.hP.vigente);
      // as taxas do cenário 1b ("3 vendas, 2 devolvidas") e 1a(2): o defeito medido
      assert.equal(await taxa(c, D("11"), D("11")), 2, "antes: 200%");
      assert.equal(
        await taxa(c, D("10"), D("10")),
        1,
        "antes: 100% de 1 venda",
      );
      assert.equal(
        await taxa(c, D("12"), D("12")),
        0.3333,
        "antes: ver o denominador sem a venda cancelada",
      );
      const k = (
        await crm(
          c,
          (
            await c.query("SELECT public.fin__hoje()::text AS d")
          ).rows[0].d,
          (
            await c.query("SELECT public.fin__hoje()::text AS d")
          ).rows[0].d,
        )
      ).kpis;
      assert.equal(
        num(k.receita_anterior),
        300 + NOITE_ONTEM,
        "antes: o ontem INTEIRO (com a venda da noite)",
      );
      assert.equal(
        num((await inicio(c)).hoje.receita_semana_passada),
        300 + NOITE_SEMANA,
        "antes: o dia inteiro (com a venda da noite)",
      );
    });
    // e fora da transação o corpo é o novo
    assert.equal((await catalogo(c, CRM)).hash, fx.hC.desta);
    assert.equal((await catalogo(c, PAINEL)).hash, fx.hP.desta);
  },
});

PROVAS.push({
  nome: "(3b) MUTANTES do CRM: cada guarda tirada do corpo novo deixa a prova correspondente vermelha",
  corpo: async (c) => {
    const s = fx.stmtC;
    const m = (nome, de, para, prova) =>
      mataMutante(c, nome, [mutar(s, de, para)], () => prova(c));
    await m(
      "turma sem 'estornado' (o pedido devolvido por inteiro sai do denominador)",
      "'recebido_na_entrega', 'estornado')",
      "'recebido_na_entrega')",
      prova1a,
    );
    await m(
      "sem o ramo 'estornado = total' (venda anulada sem linha de ledger)",
      "CASE WHEN t.payment_status = 'estornado' THEN t.total\n                ELSE LEAST(",
      "CASE WHEN false THEN t.total\n                ELSE LEAST(",
      prova1f,
    );
    await m(
      "sem o LEAST (soma do ledger com o manual passa do total)",
      "ELSE LEAST(t.total,\n",
      "ELSE (t.total * 0 + 1) * (\n",
      prova1f,
    );
    await m(
      "sem o reembolso manual de devolução",
      "AND d.status = 'concluida' AND d.reembolso_manual), 0))\n           END AS valor",
      "AND d.status = 'concluida' AND d.reembolso_manual AND false), 0))\n           END AS valor",
      prova1f,
    );
    await m(
      "turma sem o pedido cancelado (o denominador volta a perder a venda paga e estornada)",
      "       AND COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL\n",
      "       AND COALESCE(o.pagamento_recebido_em, o.paid_at) IS NOT NULL\n       AND o.status NOT IN ('cancelled', 'returned')\n",
      prova1c,
    );
    await m(
      "turma pelo mês errado (conta só vendas do dia seguinte)",
      "BETWEEN p_inicio AND p_fim\n  ), devolvido AS (",
      "BETWEEN p_inicio + 1 AND p_fim + 1\n  ), devolvido AS (",
      prova1b,
    );
    await m(
      "turma pelo dia da DEVOLUÇÃO (a devolução de outro período pesa)",
      "AND public.fin__dia(COALESCE(o.pagamento_recebido_em, o.paid_at)) BETWEEN p_inicio AND p_fim\n  ), devolvido AS (",
      "AND public.fin__dia(COALESCE(o.pagamento_recebido_em, o.paid_at)) BETWEEN p_inicio AND p_fim\n       OR o.id IN (SELECT r.order_id FROM public.order_refunds r WHERE public.fin__dia(r.concluido_em) BETWEEN p_inicio AND p_fim)\n  ), devolvido AS (",
      prova1e,
    );
    await m(
      "sem o corte da mesma hora no anterior",
      "OR (v.pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)",
      "OR true)",
      prova2b,
    );
    await m(
      "corte em TODO período (não só no que termina hoje)",
      "AND (p_fim <> v_hoje OR v.dia < v_ant_fim",
      "AND (false OR v.dia < v_ant_fim",
      prova2b,
    );
    await m(
      "corte no fuso errado (UTC)",
      "OR (v.pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)",
      "OR (v.pago_em AT TIME ZONE 'UTC')::time <= v_hora)",
      prova2b,
    );
    await mataMutante(
      c,
      "corte INTEIRO em UTC (v_hora e pago_em em UTC: só discrimina a venda da noite, depois das 21h de São Paulo)",
      [
        emUtcInteiro(
          s,
          "OR (v.pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)",
          "OR (v.pago_em AT TIME ZONE 'UTC')::time <= v_hora)",
        ),
      ],
      () => prova2b(c),
    );
    await m(
      "corte estrito (< em vez de <=, exclui a venda na própria hora)",
      "OR (v.pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)",
      "OR (v.pago_em AT TIME ZONE 'America/Sao_Paulo')::time < v_hora - interval '10 minutes')",
      prova2b,
    );
  },
});

PROVAS.push({
  nome: "(3c) MUTANTES do Início: sem o corte, no fuso errado, ou cortando o dia errado",
  corpo: async (c) => {
    const s = fx.stmtP;
    const alvo =
      "AND (pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora)";
    await mataMutante(c, "sem o corte", [mutar(s, alvo, "AND true)")], () =>
      prova2a(c),
    );
    await mataMutante(
      c,
      "corte no fuso errado (UTC)",
      [mutar(s, alvo, "AND (pago_em AT TIME ZONE 'UTC')::time <= v_hora)")],
      () => prova2a(c),
    );
    await mataMutante(
      c,
      "corte INTEIRO em UTC (v_hora e pago_em em UTC: só discrimina a venda da noite, depois das 21h de São Paulo)",
      [
        emUtcInteiro(
          s,
          alvo,
          "AND (pago_em AT TIME ZONE 'UTC')::time <= v_hora)",
        ),
      ],
      () => prova2a(c),
    );
    await mataMutante(
      c,
      "corte no dia errado (hoje - 8)",
      [mutar(s, "WHERE dia = v_hoje - 7\n", "WHERE dia = v_hoje - 8\n")],
      () => prova2a(c),
    );
    await mataMutante(
      c,
      "corte cedo demais (10 min a menos: a venda de 2 min antes sai da base)",
      [
        mutar(
          s,
          alvo,
          "AND (pago_em AT TIME ZONE 'America/Sao_Paulo')::time <= v_hora - interval '10 minutes')",
        ),
      ],
      () => prova2a(c),
    );
  },
});

PROVAS.push({
  nome: "(4a) a porta: cliente comum recusado com 42501 nas duas funções; anon sem EXECUTE; o corpo vivo é o que o preflight declara",
  corpo: async (c) => {
    assert.equal((await catalogo(c, CRM)).hash, fx.hC.desta);
    assert.equal((await catalogo(c, PAINEL)).hash, fx.hP.desta);
    await logar(c, U_CLIENTE);
    for (const sql of [
      "SELECT public.crm_visao(current_date, current_date)",
      "SELECT public.painel_inicio()",
    ])
      await assert.rejects(
        c.query(sql),
        (e) => e.code === "42501" && /Acesso negado/.test(e.message),
      );
    for (const ass of [CRM, PAINEL]) {
      const r = await c.query(
        `SELECT has_function_privilege('anon', to_regprocedure($1), 'EXECUTE') AS anon,
                has_function_privilege('authenticated', to_regprocedure($1), 'EXECUTE') AS auth`,
        [ass],
      );
      assert.deepEqual(r.rows[0], { anon: false, auth: true }, ass);
    }
  },
});

PROVAS.push({
  nome: "(4b) o FORMATO do JSON é o mesmo do corpo antigo; ACL, atributos e dono iguais; nenhuma linha de pedido muda",
  corpo: async (c) => {
    const hoje = (await c.query("SELECT public.fin__hoje()::text AS d")).rows[0]
      .d;
    const contagem = async () =>
      (
        await c.query(
          "SELECT count(*)::int AS n, coalesce(sum(total), 0)::text AS t, coalesce(sum(valor_estornado), 0)::text AS e FROM public.marketplace_orders",
        )
      ).rows[0];
    const antesLinhas = await contagem();
    const novo = {
      crm: formato(await crm(c, hoje, hoje)),
      inicio: formato(await inicio(c)),
      catC: await catalogo(c, CRM),
      catP: await catalogo(c, PAINEL),
    };
    const antigo = await numaTransacao(c, [fx.rbC, fx.rbP], async () => ({
      crm: formato(await crm(c, hoje, hoje)),
      inicio: formato(await inicio(c)),
      catC: await catalogo(c, CRM),
      catP: await catalogo(c, PAINEL),
    }));
    assert.deepEqual(novo.crm, antigo.crm, "crm_visao mudou de formato");
    assert.deepEqual(
      novo.inicio,
      antigo.inicio,
      "painel_inicio mudou de formato",
    );
    for (const [n, a] of [
      [novo.catC, antigo.catC],
      [novo.catP, antigo.catP],
    ]) {
      const { hash: _h1, ...resto1 } = n;
      const { hash: _h2, ...resto2 } = a;
      assert.deepEqual(resto1, resto2, "atributo, ACL ou dono mudou");
      assert.notEqual(n.hash, a.hash);
    }
    assert.deepEqual(
      await contagem(),
      antesLinhas,
      "uma linha de pedido mudou",
    );
  },
});

PROVAS.push({
  nome: "(4c) reaplicar as migrations 2x deixa a impressão digital igual; aplicar do corpo antigo, desfazer e aplicar de novo volta idêntico",
  corpo: async (c) => {
    const digital = async () =>
      Object.fromEntries(
        (
          await c.query(
            `SELECT p.oid::regprocedure::text AS k,
                    concat_ws(' | ', md5(replace(p.prosrc, chr(13), '')), coalesce(p.proacl::text, ''),
                              p.prosecdef::text, coalesce(array_to_string(p.proconfig, ','), ''),
                              p.provolatile::text, p.proowner::regrole::text) AS v
               FROM pg_proc p WHERE p.pronamespace = 'public'::regnamespace`,
          )
        ).rows.map((l) => [l.k, l.v]),
      );
    const antes = await digital();
    await numaTransacao(c, [fx.migC, fx.migC, fx.migP, fx.migP], async () => {
      assert.deepEqual(await digital(), antes, "reaplicar mudou alguma coisa");
    });
    await numaTransacao(c, [fx.rbP, fx.rbC, fx.migC, fx.migP], async () => {
      assert.deepEqual(
        await digital(),
        antes,
        "aplicar, desfazer e aplicar não voltou idêntico",
      );
    });
  },
});

PROVAS.push({
  nome: "(4d) preflight: corpo vivo divergente recusa (B1_BASELINE_DIVERGENT) sem escrever; o 2o rollback recusa; ACL diferente recusa",
  corpo: async (c) => {
    await c.query("BEGIN");
    try {
      // 1. corpo divergente (um comentário a mais): a migration recusa e nada muda
      const def = (
        await c.query("SELECT pg_get_functiondef(to_regprocedure($1)) AS d", [
          CRM,
        ])
      ).rows[0].d;
      const divergente = def.replace("DECLARE", "DECLARE\n  -- divergente");
      assert.notEqual(divergente, def);
      await c.query(divergente);
      const hashDivergente = (await catalogo(c, CRM)).hash;
      assert.notEqual(hashDivergente, fx.hC.desta);
      await c.query("SAVEPOINT a");
      await assert.rejects(
        c.query(fx.migC),
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.crm_visao/,
      );
      await c.query("ROLLBACK TO SAVEPOINT a");
      assert.equal(
        (await catalogo(c, CRM)).hash,
        hashDivergente,
        "a recusa escreveu",
      );

      // 2. o rollback sobre corpo que não é o desta migration recusa também
      await assert.rejects(
        c.query(fx.rbC),
        /B1_BASELINE_DIVERGENT: corpo vivo de public\.crm_visao/,
      );
      await c.query("ROLLBACK TO SAVEPOINT a");
    } finally {
      await c.query("ROLLBACK");
    }
    await c.query("BEGIN");
    try {
      // 3. o segundo rollback (já no corpo antigo) recusa, nas duas
      await c.query(fx.rbP);
      await c.query(fx.rbC);
      assert.equal((await catalogo(c, PAINEL)).hash, fx.hP.vigente);
      assert.equal((await catalogo(c, CRM)).hash, fx.hC.vigente);
      await c.query("SAVEPOINT b");
      await assert.rejects(c.query(fx.rbC), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT b");
      await assert.rejects(c.query(fx.rbP), /B1_BASELINE_DIVERGENT/);
      await c.query("ROLLBACK TO SAVEPOINT b");
      // 4. ACL aberta para PUBLIC: a migration recusa antes de escrever
      await c.query(
        "GRANT EXECUTE ON FUNCTION public.painel_inicio() TO PUBLIC",
      );
      await assert.rejects(
        c.query(fx.migP),
        /B1_BASELINE_DIVERGENT: ACL de public\.painel_inicio/,
      );
      await c.query("ROLLBACK TO SAVEPOINT b");
    } finally {
      await c.query("ROLLBACK");
    }
    assert.equal(
      (await catalogo(c, CRM)).hash,
      fx.hC.desta,
      "o banco da prova mudou",
    );
    assert.equal(
      (await catalogo(c, PAINEL)).hash,
      fx.hP.desta,
      "o banco da prova mudou",
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
  // A sucessora da 27 (a 32) pode estar no ar: o corpo desta prova é o da 27.
  await cliente.query(ler(`rollback-manual-${NOME_32}`));
  const linhas = [];
  let falhas = 0;
  const provas = SO_COMPORTAMENTO
    ? PROVAS.filter((p) => /^\((0|1[a-f]|2[ab])\)/.test(p.nome))
    : PROVAS;
  try {
    for (const { nome, corpo } of provas) {
      try {
        await corpo(cliente);
        console.log(`  PASSOU ${nome}`);
        linhas.push(`- ✅ ${nome}`);
      } catch (erro) {
        console.error(`  FALHOU ${nome}`);
        console.error(`    ${erro.message}`);
        linhas.push(`- ❌ ${nome}\n  - \`${erro.message}\``);
        if (process.env.NUMEROS_TODAS === "1") {
          falhas += 1;
          continue;
        }
        anexarAoSummary(
          "Prova viva dos números do painel (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Um número do painel deixou de comparar o que é comparável — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  if (falhas > 0)
    falhar("FALHOU", `${falhas} prova(s) falharam (NUMEROS_TODAS=1).`);
  console.log(
    `\n[numeros-do-painel] ${provas.length}/${provas.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva dos números do painel (rpc-ci)",
    `${linhas.join("\n")}\n\n**${provas.length}/${provas.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
