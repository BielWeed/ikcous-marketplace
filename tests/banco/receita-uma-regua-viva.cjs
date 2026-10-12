"use strict";
/* eslint-disable security/detect-object-injection --
 * Toda chave indexada aqui vem de constante do próprio teste (QUEM, CASOS,
 * nomes de régua) ou de uuid devolvido pelo Postgres efêmero; nunca de
 * entrada de rede nem de payload de terceiro. */

/**
 * PROVA VIVA DE CARACTERIZAÇÃO (Onda I do painel simples, item I2 — só
 * LEITURA, nenhuma migration): "receita do mês" é UMA régua ou três?
 *
 *   Início ......... painel_inicio() -> 'mes' ->> 'receita'
 *   CRM ............ crm_visao(início_do_mês, hoje) -> 'kpis' ->> 'receita'
 *                    e a soma de crm__vendas(now()) no mês (a fonte dos dois)
 *   Financeiro ..... fin_resumo(início_do_mês, hoje) -> 'por_canal'
 *                    (online + presencial) e 'entradas' / 'saidas'
 *
 * SEMENTE (tudo "agora", na MESMA transação: o now() fica parado, então a
 * semente cai no mês mesmo no dia 1 e nunca atravessa a meia-noite), pelos
 * caminhos de produção:
 *   1. online PIX 100 — pedido 'aguardando' + confirmar_pagamento('pago')
 *      como service_role;
 *   2. balcão 50 — registrar_venda_presencial como admin (nasce
 *      'delivered' + 'recebido_na_entrega', canal 'presencial');
 *   3. entrega paga na hora 30 — pedido canal 'online', forma 'cash',
 *      status 'delivered' (estado final INSERIDO: a esteira de status não é
 *      o que se mede aqui) + registrar_pagamento_recebido(true) como admin;
 *   4. PIX expirado 70 — 'aguardando' vencido + expirar_pedidos_vencidos()
 *      como service_role (sai 'cancelled' + 'expirado', sem paid_at);
 *   5. online pago e depois estornado 40 — confirmar_pagamento('pago') +
 *      registrar_estorno_manual como admin (payment_status 'estornado',
 *      estorno_manual_registrado_em = agora; o status do pedido NÃO muda, de
 *      propósito: a ÚNICA razão da exclusão no CRM é o 'estornado');
 *   6. pago depois de expirar 20 — 'aguardando' vencido + expirar + o
 *      pagamento chega: confirmar_pagamento('pago') -> 'pago_apos_expirar'
 *      com status 'cancelled' (20261195:242-248).
 *
 * PREVISÃO (lendo o código; a prova confirma ou desmente):
 *   Início = CRM = soma de crm__vendas = 180 (casos 1+2+3);
 *   Financeiro (vendas por canal) = 240 (inclui 5 e 6); entradas = 240;
 *   saídas = 40 (o estorno externo do caso 5).
 *
 * FORMA: CARACTERIZAÇÃO. Afirma a igualdade das réguas nos casos limpos e as
 * DUAS divergências conhecidas com o valor exato, imprimindo cada uma como
 * ACHADO; falha SÓ em divergência NÃO prevista. NÃO corrige nada.
 *   ACHADO A — venda estornada: fin__movimentos conta a venda 'estornado'
 *     como ENTRADA bruta, com a saída 'estorno_externo' separada
 *     (20261177:333-336 e :385-400); crm__vendas exclui 'estornado'
 *     (20261178:59).
 *   ACHADO B — pago depois de expirar: 'pago_apos_expirar' mantém o status
 *     'cancelled' (20261195:242-248; a expiração grava 'cancelled',
 *     20261186:191-195); crm__vendas exclui 'cancelled' (20261178:60); o
 *     Financeiro não filtra status.
 * Quarta régua, só como INFORMAÇÃO (impressa, nunca afirmada):
 *   get_admin_analytics_v2(90) -> 'month' ->> 'revenue' é janela MÓVEL de 30
 *   dias por created_at (20261199:1693-1698), não o mês do pagamento.
 *
 * Tudo roda numa transação DESFEITA no fim: nem o clone guarda a semente.
 *
 * USO: node tests/banco/rodar-isolado.cjs tests/banco/receita-uma-regua-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const TITULO = "Prova viva: a receita do mês é uma régua só? (rpc-ci)";

const U_ADMIN = "c2a00000-0000-4000-8000-000000000001";
const U_CLIENTE = "c2a00000-0000-4000-8000-000000000002";
const P_BALCAO = "c2aaaaaa-0000-4000-8000-000000000001";
const P_APP = "c2aaaaaa-0000-4000-8000-000000000002";

const claims = (uid, papel) =>
  JSON.stringify({
    sub: uid,
    role: "authenticated",
    app_metadata: papel ? { role: papel } : {},
  });

// papel do Postgres (o SET ROLE do PostgREST), login (o auth.uid() desta
// suíte lê app.rpc.user_id) e o JWT.
const QUEM = new Map(
  Object.entries({
    admin: {
      papel: "authenticated",
      uid: U_ADMIN,
      jwt: claims(U_ADMIN, "admin"),
    },
    // O webhook e o agendador chegam pela chave de serviço.
    service: {
      papel: "service_role",
      uid: "",
      jwt: JSON.stringify({ role: "service_role" }),
    },
  }),
);

const num = (v) => Math.round(Number(v) * 100) / 100;

/** Roda `sql` COMO `quem` dentro da transação aberta; erro vira {ok:false}. */
async function como(c, quem, sql, params = []) {
  const q = QUEM.get(quem);
  await c.query("SAVEPOINT sp_como");
  try {
    await c.query(`SET LOCAL ROLE ${q.papel}`);
    await c.query(
      "SELECT set_config('app.rpc.user_id', $1, true), set_config('request.jwt.claims', $2, true)",
      [q.uid, q.jwt],
    );
    const r = await c.query(sql, params);
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: true, rows: r.rows };
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT sp_como");
    await c.query("RESET ROLE");
    await c.query("RELEASE SAVEPOINT sp_como");
    return { ok: false, code: e.code, message: e.message };
  }
}

/** O mesmo, exigindo sucesso: devolve o `r` da primeira linha. */
async function exigir(c, quem, sql, params = []) {
  const r = await como(c, quem, sql, params);
  assert.ok(r.ok, `${sql.slice(0, 70)}… como ${quem} falhou: ${r.message}`);
  return r.rows[0].r;
}

let sequencia = 0;
/** Pedido do app pelo INSERT de checkout (estado de partida, não o final). */
async function pedidoDoApp(c, o) {
  sequencia += 1;
  const id = `c2accccc-0000-4000-8000-${String(sequencia).padStart(12, "0")}`;
  await c.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, gateway_payment_id, metodo_online, expires_at)
     VALUES ($1, $2, 'Cliente Receita', '{}'::jsonb, $3, $3, $4, 'online', $5, $6, $7, $8,
             CASE WHEN $6::text = 'aguardando' THEN now() + make_interval(mins => $9::int) END)`,
    [
      id,
      U_CLIENTE,
      o.total,
      o.status || "pending",
      o.forma || "online",
      o.paymentStatus === undefined ? "aguardando" : o.paymentStatus,
      o.gateway || null,
      o.forma && o.forma !== "online" ? null : "pix",
      // Reserva do PIX (só para 'aguardando'): vencida há 1 minuto (o now()
      // da transação é o mesmo da varredura) ou dentro dos 30 minutos.
      o.vencido ? -1 : 30,
    ],
  );
  await c.query(
    `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
     VALUES ($1, $2, 'Produto Receita', 1, $3)`,
    [id, P_APP, o.total],
  );
  return id;
}

/** As réguas, lidas como o painel lê (admin) e o ajudante do CRM (dono). */
async function reguas(c, periodo) {
  const { mes, hoje } = periodo;
  const inicio = await exigir(c, "admin", "SELECT public.painel_inicio() AS r");
  const crm = await exigir(
    c,
    "admin",
    "SELECT public.crm_visao($1::date, $2::date) AS r",
    [mes, hoje],
  );
  const fin = await exigir(
    c,
    "admin",
    "SELECT public.fin_resumo($1::date, $2::date) AS r",
    [mes, hoje],
  );
  // crm__vendas não tem EXECUTE para authenticated (20261178:136): é o
  // ajudante interno das duas RPCs acima, lido aqui pelo dono do banco.
  const somaCrmVendas = (
    await c.query(
      `SELECT COALESCE(sum(total), 0) AS s FROM public.crm__vendas(now())
        WHERE dia BETWEEN $1::date AND $2::date`,
      [mes, hoje],
    )
  ).rows[0].s;
  return {
    inicio: num(inicio.mes.receita),
    crm: num(crm.kpis.receita),
    crmVendas: num(somaCrmVendas),
    finOnline: num(fin.por_canal.online),
    finPresencial: num(fin.por_canal.presencial),
    finEntradas: num(fin.entradas),
    finSaidas: num(fin.saidas),
  };
}

/**
 * A 4ª régua é só INFORMAÇÃO: falha ou formato diferente de
 * get_admin_analytics_v2 (outra frente pode estar redefinindo o corpo) nunca
 * derruba a caracterização — devolve {motivo} em vez do valor.
 */
async function quartaRegua(c) {
  const r = await como(
    c,
    "admin",
    "SELECT public.get_admin_analytics_v2(90)::jsonb AS r",
  );
  if (!r.ok) return { motivo: `erro ${r.code}: ${r.message}` };
  const valor = Number(r.rows[0]?.r?.month?.revenue);
  if (!Number.isFinite(valor)) return { motivo: "sem month.revenue numérico" };
  return { valor: num(valor) };
}

const SE_CORRIGIDO =
  " — se os achados A/B foram corrigidos de propósito, atualize a previsão desta caracterização";

const delta = (depois, antes) =>
  Object.fromEntries(
    Object.keys(depois).map((k) => [k, num(depois[k] - antes[k])]),
  );

const PROVAS = [];

PROVAS.push({
  nome: "a receita do mês: Início = CRM nos casos limpos; o Financeiro diverge SÓ nos achados A e B",
  corpo: async (c) => {
    await c.query("BEGIN");
    try {
      await c.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES
           ($1, 'admin@receita.teste', '{"role":"admin"}'::jsonb),
           ($2, 'cliente@receita.teste', '{}'::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [U_ADMIN, U_CLIENTE],
      );
      // Admin ATUAL (20261197/20261199): o papel nas DUAS fontes.
      await c.query(
        `INSERT INTO public.profiles (id, full_name, role) VALUES ($1, 'Admin Receita', 'admin')
         ON CONFLICT (id) DO NOTHING`,
        [U_ADMIN],
      );
      await c.query(
        `INSERT INTO public.produtos (id, nome, preco_venda, custo, estoque, ativo)
         VALUES ($1, 'Balcão Receita', 50, 20, 10, true),
                ($2, 'App Receita', 10, 4, 100, true)`,
        [P_BALCAO, P_APP],
      );

      // O mês da loja (fuso de São Paulo), lido do mesmo ajudante que as RPCs
      // usam. fin__hoje não tem EXECUTE para authenticated: lido pelo dono.
      const periodo = (
        await c.query(
          `SELECT public.fin__hoje()::text AS hoje,
                  date_trunc('month', public.fin__hoje())::date::text AS mes`,
        )
      ).rows[0];

      const antes = await reguas(c, periodo);
      const quartaAntes = await quartaRegua(c);

      // ---- semente, pelos caminhos de produção ----
      // 1. online PIX 100: o webhook confirma.
      const o1 = await pedidoDoApp(c, { total: 100, gateway: "RECEITA-PIX-1" });
      assert.equal(
        await exigir(
          c,
          "service",
          "SELECT public.confirmar_pagamento($1::uuid, 'RECEITA-PIX-1', 'pago') AS r",
          [o1],
        ),
        "pago",
      );

      // 2. balcão 50: a única porta do PDV.
      const venda = await exigir(
        c,
        "admin",
        "SELECT public.registrar_venda_presencial($1::jsonb, 'cash') AS r",
        [
          JSON.stringify([
            { product_id: P_BALCAO, variant_id: null, quantity: 1 },
          ]),
        ],
      );
      const o2 = venda.order.id;

      // 3. entrega paga na hora 30: o lojista marca "recebi".
      const o3 = await pedidoDoApp(c, {
        total: 30,
        forma: "cash",
        status: "delivered",
        paymentStatus: null,
      });
      const recebido = await exigir(
        c,
        "admin",
        "SELECT public.registrar_pagamento_recebido($1::uuid, true) AS r",
        [o3],
      );
      assert.equal(recebido.payment_status, "recebido_na_entrega");

      // 4 e 6. dois PIX vencidos: a varredura do agendador expira os dois.
      const o4 = await pedidoDoApp(c, {
        total: 70,
        gateway: "RECEITA-PIX-4",
        vencido: true,
      });
      const o6 = await pedidoDoApp(c, {
        total: 20,
        gateway: "RECEITA-PIX-6",
        vencido: true,
      });
      const expirados = Number(
        await exigir(
          c,
          "service",
          "SELECT public.expirar_pedidos_vencidos() AS r",
        ),
      );
      assert.ok(
        expirados >= 2,
        `a varredura expirou ${expirados} pedido(s); esperava os 2 da semente`,
      );

      // 5. online pago e depois estornado 40: "Já devolvi" do lojista.
      const o5 = await pedidoDoApp(c, { total: 40, gateway: "RECEITA-PIX-5" });
      assert.equal(
        await exigir(
          c,
          "service",
          "SELECT public.confirmar_pagamento($1::uuid, 'RECEITA-PIX-5', 'pago') AS r",
          [o5],
        ),
        "pago",
      );
      const estorno = await exigir(
        c,
        "admin",
        "SELECT public.registrar_estorno_manual($1::uuid)::jsonb AS r",
        [o5],
      );
      assert.equal(estorno.payment_status, "estornado");

      // 6. o pagamento do PIX expirado chega depois.
      assert.equal(
        await exigir(
          c,
          "service",
          "SELECT public.confirmar_pagamento($1::uuid, 'RECEITA-PIX-6', 'pago') AS r",
          [o6],
        ),
        "pago_apos_expirar",
      );

      // ---- a semente ficou no estado que cada caso descreve ----
      const CASOS = [
        [o1, 100, "online", "pending", "pago"],
        [o2, 50, "presencial", "delivered", "recebido_na_entrega"],
        [o3, 30, "online", "delivered", "recebido_na_entrega"],
        [o4, 70, "online", "cancelled", "expirado"],
        [o5, 40, "online", "pending", "estornado"],
        [o6, 20, "online", "cancelled", "pago_apos_expirar"],
      ];
      const ids = CASOS.map(([id]) => id);
      const linhas = (
        await c.query(
          `SELECT id, total, canal, status, payment_status,
                  public.fin__dia(COALESCE(pagamento_recebido_em, paid_at)) = public.fin__hoje() AS pago_hoje,
                  estorno_manual_registrado_em IS NOT NULL AS estorno_carimbado
             FROM public.marketplace_orders WHERE id = ANY($1::uuid[])`,
          [ids],
        )
      ).rows;
      const porId = new Map(linhas.map((l) => [l.id, l]));
      for (const [id, total, canal, status, pagamento] of CASOS) {
        const l = porId.get(id);
        assert.ok(l, `pedido ${id} da semente sumiu`);
        assert.deepEqual(
          [num(l.total), l.canal, l.status, l.payment_status],
          [total, canal, status, pagamento],
          `estado do pedido de ${total}`,
        );
      }
      for (const id of [o1, o2, o3, o5, o6]) {
        assert.equal(porId.get(id).pago_hoje, true, `${id} pago hoje`);
      }
      assert.equal(porId.get(o4).pago_hoje, null, "o expirado nunca foi pago");
      assert.equal(porId.get(o5).estorno_carimbado, true);

      // ---- por pedido: quem entra em cada régua ----
      const { mes, hoje } = periodo;
      const noCrm = new Map(
        (
          await c.query(
            `SELECT order_id, total FROM public.crm__vendas(now())
              WHERE order_id = ANY($1::uuid[]) AND dia BETWEEN $2::date AND $3::date`,
            [ids, mes, hoje],
          )
        ).rows.map((r) => [r.order_id, num(r.total)]),
      );
      const movimentos = (
        await c.query(
          `SELECT pedido_id, origem, tipo, valor FROM public.fin__movimentos($2::date, $3::date)
            WHERE pedido_id = ANY($1::uuid[]) AND status = 'realizado'`,
          [ids, mes, hoje],
        )
      ).rows;
      const vendaNoFin = new Map(
        movimentos
          .filter((m) => m.origem.startsWith("venda_"))
          .map((m) => [m.pedido_id, num(m.valor)]),
      );
      const saidasNoFin = movimentos
        .filter((m) => m.tipo === "saida")
        .map((m) => [m.pedido_id, m.origem, num(m.valor)]);

      assert.deepEqual(
        [...noCrm.keys()].sort(),
        [o1, o2, o3].sort(),
        `DIVERGÊNCIA NÃO PREVISTA: crm__vendas devia conter só os casos 1, 2 e 3${SE_CORRIGIDO}`,
      );
      assert.deepEqual(
        [...vendaNoFin.keys()].sort(),
        [o1, o2, o3, o5, o6].sort(),
        `DIVERGÊNCIA NÃO PREVISTA: as vendas do Financeiro deviam ser os casos 1, 2, 3, 5 e 6${SE_CORRIGIDO}`,
      );
      for (const id of [o1, o2, o3]) {
        assert.equal(
          vendaNoFin.get(id),
          noCrm.get(id),
          `DIVERGÊNCIA NÃO PREVISTA: caso limpo ${id} com valor diferente${SE_CORRIGIDO}`,
        );
      }
      assert.deepEqual(
        saidasNoFin,
        [[o5, "estorno_externo", 40]],
        `DIVERGÊNCIA NÃO PREVISTA: a única saída devia ser o estorno externo do caso 5${SE_CORRIGIDO}`,
      );

      // ---- as réguas, por delta (o clone pode trazer pedidos de antes) ----
      const d = delta(await reguas(c, periodo), antes);
      const medido = {
        inicio: d.inicio,
        crm: d.crm,
        crmVendas: d.crmVendas,
        financeiroVendas: num(d.finOnline + d.finPresencial),
        financeiroOnline: d.finOnline,
        financeiroPresencial: d.finPresencial,
        financeiroEntradas: d.finEntradas,
        financeiroSaidas: d.finSaidas,
      };
      console.log(`    réguas medidas (delta): ${JSON.stringify(medido)}`);
      assert.deepEqual(
        medido,
        {
          inicio: 180,
          crm: 180,
          crmVendas: 180,
          financeiroVendas: 240,
          financeiroOnline: 190,
          financeiroPresencial: 50,
          financeiroEntradas: 240,
          financeiroSaidas: 40,
        },
        `DIVERGÊNCIA NÃO PREVISTA entre as réguas da receita${SE_CORRIGIDO}`,
      );

      // ---- os dois achados, com o valor exato ----
      const achadoA = vendaNoFin.get(o5);
      const achadoB = vendaNoFin.get(o6);
      assert.equal(
        num(medido.financeiroVendas - medido.inicio),
        num(achadoA + achadoB),
        `a diferença entre Financeiro e Início é exatamente A + B${SE_CORRIGIDO}`,
      );
      console.log(
        [
          `    ACHADO A — venda estornada (${achadoA}): entra bruta nas vendas do Financeiro`,
          `(fin__movimentos, 20261177:333-336) com a saída 'estorno_externo' de ${achadoA} separada`,
          "(:385-400); crm__vendas exclui 'estornado' (20261178:59) — fica fora do Início e do CRM.",
        ].join(" "),
      );
      console.log(
        [
          `    ACHADO B — pago depois de expirar (${achadoB}): 'pago_apos_expirar' com status 'cancelled'`,
          "(20261195:242-248); crm__vendas exclui 'cancelled' (20261178:60), o Financeiro não filtra",
          "status — entra nas vendas do Financeiro e fica fora do Início e do CRM.",
        ].join(" "),
      );
      const quartaDepois = await quartaRegua(c);
      const motivo = quartaAntes.motivo || quartaDepois.motivo;
      console.log(
        motivo
          ? `    INFORMAÇÃO — 4ª régua: indisponível (${motivo})`
          : [
              `    INFORMAÇÃO — 4ª régua: get_admin_analytics_v2(90).month.revenue variou ${num(quartaDepois.valor - quartaAntes.valor)}`,
              "(janela MÓVEL de 30 dias por created_at, 20261199:1693-1698 — não é o mês do pagamento).",
            ].join(" "),
      );
    } finally {
      await c.query("ROLLBACK");
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
        anexarAoSummary(TITULO, linhas.join("\n"));
        falhar(
          "FALHOU",
          "As réguas da receita divergiram de um jeito NÃO previsto — ver acima.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[receita-uma-regua] ${PROVAS.length}/${PROVAS.length} provas passaram (achados A e B impressos acima).`,
  );
  anexarAoSummary(
    TITULO,
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero. Achados A e B no log do passo.`,
  );
}

main();
