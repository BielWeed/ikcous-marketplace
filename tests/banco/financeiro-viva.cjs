"use strict";

/**
 * PROVA VIVA da migration 20261177000000_o_financeiro_da_loja_nasce.sql
 * (plano docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md,
 * tarefa 3) contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 *   (a) porta: só admin lê/escreve; authenticated não escreve nas tabelas.
 *   (b) o dinheiro mora na fonte: vendas (app, entrega, balcão), estornos
 *       concluídos, estorno pendente (previsto) e estorno feito fora do app
 *       aparecem no extrato, cada um na conta da forma de pagamento; pedido
 *       aguardando não aparece.
 *   (c) saldos por conta batem com a soma dos movimentos desde o saldo inicial.
 *   (d) lançamentos: parcelas somam o total, baixa, cancelamento com motivo,
 *       categoria que não combina, data futura e edição de realizado recusadas.
 *   (e) caixa da loja: abertura ajusta o sistema ao contado; venda em dinheiro,
 *       sangria e fechamento com quebra; saldo final = contado; caixa fechado
 *       não se reescreve.
 *   (f) DRE: receita por canal, deduções, CMV e a identidade do lucro.
 *   (g) assinatura: só leitura para o admin; o app não escreve.
 *
 * USO: node tests/banco/financeiro-viva.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const U_CLIENTE = "51111111-1111-1111-1111-111111111111";
const U_ADMIN = "52222222-2222-2222-2222-222222222222";
const P_A = "5aaaaaaa-0000-0000-0000-000000000001";
const P_B = "5aaaaaaa-0000-0000-0000-000000000002";
const CAIXA = "f1000000-0000-4000-8000-000000000001";
const BANCO = "f1000000-0000-4000-8000-000000000002";
const MP = "f1000000-0000-4000-8000-000000000003";
const CAT_ALUGUEL = "f2000000-0000-4000-8000-000000000020";
const CAT_SISTEMAS = "f2000000-0000-4000-8000-000000000024";
const CAT_OUTRAS_RECEITAS = "f2000000-0000-4000-8000-000000000002";

const O = (n) => `5ccccccc-0000-0000-0000-00000000000${n}`;

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId,
  ]);
}
async function rpc(cliente, sql, params = []) {
  return (await cliente.query(sql, params)).rows[0].r;
}
const num = (v) => Math.round(Number(v) * 100) / 100;

async function pedido(cliente, id, o) {
  await cliente.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, status, canal,
        payment_method, payment_status, paid_at, pagamento_recebido_em, metodo_online, valor_estornado, updated_at)
     VALUES ($1, $2, $3, '{}'::jsonb, $4, $4, $5, $6, $7, $8, $9, $10, $11, $12, COALESCE($9, $10, now()))`,
    [
      id,
      U_CLIENTE,
      o.nome || "Cliente Fin",
      o.total,
      o.status || "delivered",
      o.canal || "online",
      o.pagamento,
      o.paymentStatus,
      o.paidAt || null,
      o.recebidoEm || null,
      o.metodoOnline || null,
      o.valorEstornado || 0,
    ],
  );
  for (const item of o.itens || []) {
    await cliente.query(
      `INSERT INTO public.marketplace_order_items (order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, 'Item', $3, $4)`,
      [id, item.produto, item.qtd, item.preco],
    );
  }
}

const PROVAS = [];
const estado = {};

PROVAS.push({
  nome: "(a)(b) porta de admin; o extrato lê as fontes e põe cada venda na conta da forma",
  corpo: async (cliente) => {
    for (const [id, meta] of [
      [U_CLIENTE, "{}"],
      [U_ADMIN, '{"role":"admin"}'],
    ]) {
      await cliente.query(
        `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1::uuid, $1::text || '@fin.teste', $2::jsonb)
         ON CONFLICT (id) DO NOTHING`,
        [id, meta],
      );
    }
    await cliente.query(
      `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, custo)
       VALUES ($1, 'Produto A', 50, 100, true, 20), ($2, 'Produto B', 30, 100, true, 10)`,
      [P_A, P_B],
    );
    const agora = new Date();
    const ontem = new Date(Date.now() - 86_400_000);
    // O1 app no crédito 100 (2 x A) · O2 balcão dinheiro 30 (1 x B) · O3 entrega PIX 40
    await pedido(cliente, O(1), {
      total: 100,
      pagamento: "online",
      paymentStatus: "pago",
      paidAt: agora,
      metodoOnline: "credito",
      status: "processing",
      itens: [{ produto: P_A, qtd: 2, preco: 50 }],
    });
    await pedido(cliente, O(2), {
      total: 30,
      pagamento: "cash",
      paymentStatus: "recebido_na_entrega",
      recebidoEm: ontem,
      canal: "presencial",
      itens: [{ produto: P_B, qtd: 1, preco: 30 }],
    });
    await pedido(cliente, O(3), {
      total: 40,
      pagamento: "pix",
      paymentStatus: "recebido_na_entrega",
      recebidoEm: ontem,
    });
    // O4 app 60 com estorno concluído de 20 · O5 app 50 com estorno pendente de 10
    await pedido(cliente, O(4), {
      total: 60,
      pagamento: "online",
      paymentStatus: "pago",
      paidAt: ontem,
      valorEstornado: 20,
    });
    await pedido(cliente, O(5), {
      total: 50,
      pagamento: "online",
      paymentStatus: "pago",
      paidAt: ontem,
    });
    await cliente.query(
      `INSERT INTO public.order_refunds (order_id, amount, solicitado_por, status, concluido_em)
       VALUES ($1, 20, 'lojista', 'concluido', now()), ($2, 10, 'lojista', 'solicitado', NULL)`,
      [O(4), O(5)],
    );
    // O6 app 25 estornado fora do app · O7 aguardando (não conta)
    await pedido(cliente, O(6), {
      total: 25,
      pagamento: "online",
      paymentStatus: "estornado",
      paidAt: ontem,
      status: "cancelled",
    });
    await pedido(cliente, O(7), {
      total: 999,
      pagamento: "online",
      paymentStatus: "aguardando",
      status: "pending",
    });

    const hoje = (await cliente.query("SELECT public.fin__hoje() AS d")).rows[0]
      .d;
    estado.hoje = hoje.toISOString().slice(0, 10);
    estado.inicio = new Date(hoje.getTime() - 30 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      () =>
        rpc(cliente, "SELECT public.fin_resumo($1, $2) AS r", [
          estado.inicio,
          estado.hoje,
        ]),
      /Acesso negado/,
    );
    await cliente.query("BEGIN");
    try {
      await cliente.query("SET LOCAL ROLE authenticated");
      assert.equal(
        Number(
          (await cliente.query("SELECT count(*) AS n FROM public.fin_contas"))
            .rows[0].n,
        ),
        0,
      );
      await assert.rejects(
        () =>
          cliente.query(
            `INSERT INTO public.fin_lancamentos (tipo, status, valor, conta_id, categoria_id, descricao, data_competencia, data_realizacao) VALUES ('entrada','realizado',1,$1,$2,'x',current_date,current_date)`,
            [CAIXA, CAT_OUTRAS_RECEITAS],
          ),
        /permission denied/,
      );
    } finally {
      await cliente.query("ROLLBACK");
    }

    await logar(cliente, U_ADMIN);
    // Saldo inicial zero desde 30 dias atrás nas três contas (conta tudo acima).
    for (const conta of [CAIXA, BANCO, MP]) {
      await rpc(cliente, "SELECT public.fin_conta_salvar($1::jsonb) AS r", [
        JSON.stringify({
          id: conta,
          saldo_inicial: 0,
          saldo_inicial_em: estado.inicio,
        }),
      ]);
    }
    await assert.rejects(
      () =>
        rpc(cliente, "SELECT public.fin_conta_salvar($1::jsonb) AS r", [
          JSON.stringify({ id: MP, ativa: false }),
        ]),
      /não podem ser desativadas/,
    );

    const extrato = await rpc(
      cliente,
      "SELECT public.fin_extrato($1, $2) AS r",
      [estado.inicio, estado.hoje],
    );
    const porId = Object.fromEntries(extrato.map((m) => [m.id, m]));
    assert.equal(porId[`pedido:${O(1)}`].conta_id, MP);
    assert.equal(porId[`pedido:${O(1)}`].forma_pagamento, "credito");
    assert.equal(porId[`pedido:${O(1)}`].origem, "venda_online");
    assert.equal(porId[`pedido:${O(2)}`].conta_id, CAIXA);
    assert.equal(porId[`pedido:${O(2)}`].origem, "venda_balcao");
    assert.equal(porId[`pedido:${O(3)}`].conta_id, BANCO);
    assert.equal(porId[`pedido:${O(3)}`].origem, "venda_entrega");
    assert.equal(
      porId[`pedido:${O(7)}`],
      undefined,
      "pedido aguardando não é dinheiro",
    );
    const estornos = extrato.filter((m) => m.origem === "estorno");
    assert.deepEqual(estornos.map((m) => [m.status, num(m.valor)]).sort(), [
      ["previsto", 10],
      ["realizado", 20],
    ]);
    assert.equal(num(porId[`estorno_externo:${O(6)}`].valor), 25);
    assert.equal(
      extrato.every((m) => m.editavel === false),
      true,
      "derivado não se edita",
    );
  },
});

PROVAS.push({
  nome: "(c)(d) saldos batem; parcelas, baixa, cancelamento e recusas dos lançamentos",
  corpo: async (cliente) => {
    const saldo = async (conta) =>
      num(
        (await rpc(cliente, "SELECT public.fin_contas_listar() AS r")).find(
          (c) => c.id === conta,
        ).saldo,
      );
    // MP: 100 + 60 + 50 + 25 − 20 (estorno) − 25 (externo) = 190 · Caixa 30 · Banco 40
    assert.equal(await saldo(MP), 190);
    assert.equal(await saldo(CAIXA), 30);
    assert.equal(await saldo(BANCO), 40);

    await rpc(cliente, "SELECT public.fin_lancamento_salvar($1::jsonb) AS r", [
      JSON.stringify({
        tipo: "saida",
        valor: 30,
        conta_id: BANCO,
        categoria_id: CAT_ALUGUEL,
        descricao: "Aluguel",
        status: "realizado",
        forma_pagamento: "pix",
      }),
    ]);
    assert.equal(await saldo(BANCO), 10);

    const parcelado = await rpc(
      cliente,
      "SELECT public.fin_lancamento_salvar($1::jsonb) AS r",
      [
        JSON.stringify({
          tipo: "saida",
          valor: 100,
          conta_id: BANCO,
          categoria_id: CAT_SISTEMAS,
          descricao: "Sistema",
          status: "previsto",
          parcelas: 3,
          data_vencimento: estado.hoje,
        }),
      ],
    );
    assert.equal(parcelado.ids.length, 3);
    const parcelas = (
      await cliente.query(
        "SELECT valor, parcela FROM public.fin_lancamentos WHERE id = ANY($1::uuid[]) ORDER BY parcela",
        [parcelado.ids],
      )
    ).rows.map((r) => num(r.valor));
    assert.deepEqual(
      parcelas,
      [33.33, 33.33, 33.34],
      "as parcelas somam o total, o resto na última",
    );
    const aPagar = await rpc(
      cliente,
      "SELECT public.fin_previstos('saida') AS r",
    );
    assert.equal(aPagar.filter((m) => m.origem === "manual").length, 3);
    assert.equal(
      aPagar.filter((m) => m.origem === "estorno").length,
      1,
      "estorno pendente é saída prevista",
    );

    await rpc(cliente, "SELECT public.fin_lancamento_baixar($1::uuid) AS r", [
      parcelado.ids[0],
    ]);
    assert.equal(await saldo(BANCO), num(10 - 33.33));
    await assert.rejects(
      () =>
        rpc(cliente, "SELECT public.fin_lancamento_baixar($1::uuid) AS r", [
          parcelado.ids[0],
        ]),
      /já foi baixado/,
    );
    await assert.rejects(
      () =>
        rpc(cliente, "SELECT public.fin_lancamento_salvar($1::jsonb) AS r", [
          JSON.stringify({
            id: parcelado.ids[0],
            tipo: "saida",
            valor: 1,
            conta_id: BANCO,
            categoria_id: CAT_SISTEMAS,
            descricao: "x",
            status: "realizado",
          }),
        ]),
      /cancele e lance de novo/,
    );
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.fin_lancamento_cancelar($1::uuid, ' ') AS r",
          [parcelado.ids[0]],
        ),
      /Diga por que/,
    );
    await rpc(
      cliente,
      "SELECT public.fin_lancamento_cancelar($1::uuid, 'lançado em dobro') AS r",
      [parcelado.ids[0]],
    );
    assert.equal(await saldo(BANCO), 10, "cancelado sai do saldo");

    await assert.rejects(
      () =>
        rpc(cliente, "SELECT public.fin_lancamento_salvar($1::jsonb) AS r", [
          JSON.stringify({
            tipo: "entrada",
            valor: 5,
            conta_id: BANCO,
            categoria_id: CAT_ALUGUEL,
            descricao: "x",
          }),
        ]),
      /não combina/,
    );
    await assert.rejects(
      () =>
        rpc(cliente, "SELECT public.fin_lancamento_salvar($1::jsonb) AS r", [
          JSON.stringify({
            tipo: "saida",
            valor: 5,
            conta_id: BANCO,
            categoria_id: CAT_ALUGUEL,
            descricao: "x",
            status: "realizado",
            data_realizacao: "2999-01-01",
          }),
        ]),
      /no futuro/,
    );
    await assert.rejects(
      () =>
        rpc(cliente, "SELECT public.fin_lancamento_salvar($1::jsonb) AS r", [
          JSON.stringify({
            tipo: "transferencia",
            valor: 5,
            conta_id: BANCO,
            conta_destino_id: BANCO,
            descricao: "x",
          }),
        ]),
      /destino/,
    );
  },
});

PROVAS.push({
  nome: "(e) caixa: abertura ajusta ao contado, venda em dinheiro, sangria, quebra no fechamento",
  corpo: async (cliente) => {
    const saldoCaixa = async () =>
      num(
        (await rpc(cliente, "SELECT public.fin_contas_listar() AS r")).find(
          (c) => c.id === CAIXA,
        ).saldo,
      );
    await rpc(cliente, "SELECT public.fin_caixa_abrir(50) AS r");
    assert.equal(
      await saldoCaixa(),
      50,
      "o contado manda: +20 de sobra ajustado na abertura",
    );
    await assert.rejects(
      () => rpc(cliente, "SELECT public.fin_caixa_abrir(10) AS r"),
      /já está aberto/,
    );
    let atual = await rpc(cliente, "SELECT public.fin_caixa_atual() AS r");
    assert.equal(num(atual.esperado), 50);

    // Venda em dinheiro no balcão durante o caixa aberto.
    await pedido(cliente, O(8), {
      total: 15,
      pagamento: "cash",
      paymentStatus: "recebido_na_entrega",
      recebidoEm: new Date(),
      canal: "presencial",
      itens: [{ produto: P_B, qtd: 1, preco: 15 }],
    });
    atual = await rpc(cliente, "SELECT public.fin_caixa_atual() AS r");
    assert.equal(num(atual.vendas_dinheiro), 15);
    assert.equal(num(atual.esperado), 65);

    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.fin_caixa_movimentar('sangria', 100, NULL) AS r",
        ),
      /maior que o dinheiro esperado/,
    );
    await rpc(
      cliente,
      "SELECT public.fin_caixa_movimentar('sangria', 40, 'Depósito no banco') AS r",
    );
    atual = await rpc(cliente, "SELECT public.fin_caixa_atual() AS r");
    assert.equal(num(atual.esperado), 25);
    assert.equal(atual.movimentos.length, 1);
    const sangriaId = atual.movimentos[0].id;

    const fechado = await rpc(
      cliente,
      "SELECT public.fin_caixa_fechar(20, 'faltou troco') AS r",
    );
    assert.equal(num(fechado.esperado), 25);
    assert.equal(num(fechado.diferenca), -5);
    assert.equal(await saldoCaixa(), 20, "saldo do caixa = o que foi contado");
    assert.equal(
      await rpc(cliente, "SELECT public.fin_caixa_atual() AS r"),
      null,
    );
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.fin_lancamento_cancelar($1::uuid, 'teste') AS r",
          [sangriaId],
        ),
      /caixa já fechado/,
    );
    const historico = await rpc(
      cliente,
      "SELECT public.fin_caixa_historico() AS r",
    );
    assert.equal(historico[0].status, "fechado");
    assert.equal(num(historico[0].diferenca), -5);
  },
});

PROVAS.push({
  nome: "(f)(g) DRE por canal com CMV e a identidade do lucro; assinatura só leitura",
  corpo: async (cliente) => {
    const dre = await rpc(cliente, "SELECT public.fin_dre($1, $2) AS r", [
      estado.inicio,
      estado.hoje,
    ]);
    // Online: 100 + 40 (entrega PIX) + 60 + 50 + 25 = 275 · Balcão: 30 + 15 = 45
    assert.equal(num(dre.receita_online), 275);
    assert.equal(num(dre.receita_balcao), 45);
    // Deduções: estorno 20 + fora do app 25 (o pendente de 10 não pesa ainda)
    assert.equal(num(dre.deducoes), 45);
    // CMV: 2 x 20 (O1) + 1 x 10 (O2) + 1 x 10 (O8)
    assert.equal(num(dre.cmv), 60);
    assert.equal(dre.cmv_estimado, true);
    // Aluguel 30; a parcela de sistema do mês foi cancelada e as outras duas
    // têm competência nos meses seguintes.
    assert.equal(num(dre.despesas_fixas), 30);
    const linhas = Object.fromEntries(
      dre.linhas.map((l) => [l.categoria, num(l.valor)]),
    );
    assert.equal(linhas["Vendas pelo app"], 275);
    assert.equal(linhas["Vendas na loja física"], 45);
    assert.equal(linhas["Custo das mercadorias vendidas"], 60);
    assert.equal(linhas["Aluguel e condomínio"], 30);
    const identidade = num(
      Number(dre.receita_liquida) -
        Number(dre.cmv) -
        Number(dre.custos_variaveis) -
        Number(dre.despesas_fixas) +
        Number(dre.resultado_financeiro),
    );
    assert.equal(num(dre.lucro_liquido), identidade);
    // Achado E (revisão de 26/09/2026): o ajuste da ABERTURA (+20, contado x
    // sistema) vai para categoria `fora_dre` — não é lucro, é troco que já
    // existia fora do fluxo da loja. Só a Quebra do FECHAMENTO (-5, um
    // resultado real do dia) pesa no resultado_financeiro.
    assert.equal(
      num(dre.resultado_financeiro),
      -5,
      "só a quebra de 5 no fechamento pesa; a sobra de 20 na abertura é fora_dre",
    );
    assert.equal(
      linhas["Ajuste de saldo na abertura do caixa (sobra)"],
      undefined,
      "achado E: o ajuste de abertura não aparece nas linhas da DRE",
    );

    const resumo = await rpc(cliente, "SELECT public.fin_resumo($1, $2) AS r", [
      estado.inicio,
      estado.hoje,
    ]);
    assert.equal(num(resumo.por_canal.presencial), 45);
    assert.equal(resumo.caixa_aberto, null);
    assert.equal(resumo.serie.length, 31);

    assert.equal(
      await rpc(cliente, "SELECT public.assinatura_da_loja_ler() AS r"),
      null,
    );
    await cliente.query(
      `INSERT INTO public.assinatura_da_loja (id, plano, status, valor_mensal, proxima_cobranca_em)
       VALUES (1, 'Profissional', 'ativa', 149.90, current_date + 10)`,
    );
    const assinatura = await rpc(
      cliente,
      "SELECT public.assinatura_da_loja_ler() AS r",
    );
    assert.equal(assinatura.plano, "Profissional");
    assert.equal(assinatura.status, "ativa");
    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      () => rpc(cliente, "SELECT public.assinatura_da_loja_ler() AS r"),
      /Acesso negado/,
    );
    await cliente.query("BEGIN");
    try {
      await logar(cliente, U_ADMIN);
      await cliente.query("SET LOCAL ROLE authenticated");
      await assert.rejects(
        () =>
          cliente.query(
            "UPDATE public.assinatura_da_loja SET status = 'ativa'",
          ),
        /permission denied/,
      );
    } finally {
      await cliente.query("ROLLBACK");
    }
  },
});

// ---------------------------------------------------------------------------
// Achados da revisão de risco de 26/09/2026 (migrations 75/76/77 nunca
// aplicadas em produção — corrigidas em vez de remendadas por cima).
// ---------------------------------------------------------------------------
PROVAS.push({
  nome: "(D) gaveta desconta o estorno externo (venda em dinheiro cancelada + 'Já devolvi')",
  corpo: async (cliente) => {
    await logar(cliente, U_ADMIN);
    await rpc(cliente, "SELECT public.fin_caixa_abrir(0) AS r");
    let atual = await rpc(cliente, "SELECT public.fin_caixa_atual() AS r");
    assert.equal(
      num(atual.esperado),
      0,
      "caixa recém-aberto, sem venda nenhuma",
    );

    const O_D = "5ddddddd-0000-0000-0000-000000000001";
    await pedido(cliente, O_D, {
      total: 100,
      pagamento: "cash",
      paymentStatus: "recebido_na_entrega",
      recebidoEm: new Date(),
      canal: "presencial",
    });
    atual = await rpc(cliente, "SELECT public.fin_caixa_atual() AS r");
    assert.equal(num(atual.vendas_dinheiro), 100);
    assert.equal(num(atual.esperado), 100, "100 entraram na gaveta");

    // Pedido cancelado + "Já devolvi" (registrar_estorno_manual): o mesmo
    // dinheiro sai da gaveta pela mesma via.
    await cliente.query(
      "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
      [O_D],
    );
    await rpc(
      cliente,
      "SELECT public.registrar_estorno_manual($1::uuid) AS r",
      [O_D],
    );
    atual = await rpc(cliente, "SELECT public.fin_caixa_atual() AS r");
    assert.equal(
      num(atual.estornos_externos_dinheiro),
      100,
      "achado D: o estorno externo agora aparece na gaveta",
    );
    assert.equal(
      num(atual.esperado),
      0,
      "achado D: 100 entraram e 100 saíram — a gaveta esperada volta a 0, não fica em 100",
    );

    const fechado = await rpc(
      cliente,
      "SELECT public.fin_caixa_fechar(0, 'sem sobra nem quebra') AS r",
    );
    assert.equal(num(fechado.diferenca), 0, "sem quebra fantasma");
  },
});

PROVAS.push({
  nome: "(F) estorno_manual_registrado_em data o estorno externo — não o updated_at, que qualquer edição move",
  corpo: async (cliente) => {
    const O_F = "5ddddddd-0000-0000-0000-000000000002";
    const antigo = new Date(Date.now() - 40 * 86_400_000);
    await pedido(cliente, O_F, {
      total: 60,
      pagamento: "online",
      paymentStatus: "pago",
      paidAt: antigo,
      status: "cancelled",
    });
    // Uma edição qualquer do pedido DEPOIS do estorno: se a data viesse de
    // updated_at, isto empurraria o movimento para hoje.
    await logar(cliente, U_ADMIN);
    await rpc(
      cliente,
      "SELECT public.registrar_estorno_manual($1::uuid) AS r",
      [O_F],
    );
    const registradoEm = (
      await cliente.query(
        "SELECT estorno_manual_registrado_em FROM public.marketplace_orders WHERE id = $1",
        [O_F],
      )
    ).rows[0].estorno_manual_registrado_em;
    assert.ok(registradoEm, "o carimbo nasce no registro do estorno");
    await cliente.query(
      "UPDATE public.marketplace_orders SET customer_name = 'Nome corrigido' WHERE id = $1",
      [O_F],
    );
    const mov = (
      await cliente.query(
        "SELECT data FROM public.fin__movimentos(NULL, NULL) WHERE id = $1",
        [`estorno_externo:${O_F}`],
      )
    ).rows[0];
    // fin__dia() de novo (não .toISOString() no lado do JS): o carimbo é
    // comparado no mesmo fuso que a função usa (America/Sao_Paulo), sem
    // risco de virar o dia perto da meia-noite UTC.
    const dataEsperada = (
      await cliente.query("SELECT public.fin__dia($1::timestamptz) AS d", [
        registradoEm,
      ])
    ).rows[0].d;
    assert.equal(
      mov.data.toISOString().slice(0, 10),
      dataEsperada.toISOString().slice(0, 10),
      "achado F: a data é a do carimbo do estorno, não a de uma edição posterior do pedido",
    );
  },
});

PROVAS.push({
  nome: "(K) CMV exclui pedido cujo estoque já voltou inteiro (stock_returned_at)",
  corpo: async (cliente) => {
    // Delta, não total absoluto: o período [estado.inicio, estado.hoje] já
    // carrega CMV de pedidos de PROVAS anteriores (a mesma régua da prova
    // (f)(g)) — o que importa aqui é o quanto O_K muda o número.
    const periodo = async () =>
      num(
        (
          await rpc(cliente, "SELECT public.fin_dre($1, $2) AS r", [
            estado.inicio,
            estado.hoje,
          ])
        ).cmv,
      );
    const cmvAntes = await periodo();

    const O_K = "5ddddddd-0000-0000-0000-000000000003";
    await pedido(cliente, O_K, {
      total: 50,
      pagamento: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      itens: [{ produto: P_A, qtd: 1, preco: 50 }],
    });
    assert.equal(
      num((await periodo()) - cmvAntes),
      20,
      "O_K entra no CMV: 1 x 20 (custo do Produto A)",
    );

    await cliente.query(
      "UPDATE public.marketplace_orders SET status = 'cancelled', stock_returned_at = now() WHERE id = $1",
      [O_K],
    );
    assert.equal(
      num((await periodo()) - cmvAntes),
      0,
      "achado K: estoque de volta por inteiro — a mercadoria não custou nada à loja",
    );
  },
});

PROVAS.push({
  nome: "(gap 4) fin_dre recusa período invertido ou maior que 400 dias",
  corpo: async (cliente) => {
    await assert.rejects(
      () =>
        rpc(cliente, "SELECT public.fin_dre($1, $2) AS r", [
          estado.hoje,
          estado.inicio,
        ]),
      /Período inválido/,
      "fim antes do início",
    );
    const longeDemais = new Date(
      new Date(estado.inicio).getTime() - 401 * 86_400_000,
    )
      .toISOString()
      .slice(0, 10);
    await assert.rejects(
      () =>
        rpc(cliente, "SELECT public.fin_dre($1, $2) AS r", [
          longeDemais,
          estado.hoje,
        ]),
      /Período inválido/,
      "mais de 400 dias",
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
        anexarAoSummary("Prova viva do Financeiro (rpc-ci)", linhas.join("\n"));
        falhar(
          "FALHOU",
          "Uma regra do Financeiro foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }
  console.log(
    `\n[financeiro] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva do Financeiro (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
