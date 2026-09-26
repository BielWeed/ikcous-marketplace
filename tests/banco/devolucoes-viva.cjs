"use strict";

/**
 * PROVA VIVA da migration 20261175000000_a_devolucao_nasce_no_pedido.sql
 * (plano docs/superpowers/plans/2026-09-26-painel-cartao-e-devolucoes.md,
 * tarefa 1) contra o Postgres EFÊMERO com as migrations aplicadas do zero.
 *
 * O que fica provado, chamando as RPCs de verdade:
 *   (a) elegibilidade: só o dono vê; pedido não entregue não pode; métodos
 *       por modalidade (local x nacional x balcão).
 *   (b) o TIPO sai do servidor: arrependimento (online, até 7 dias), troca
 *       (fora do arrependimento, reembolso recusado), vício (fotos
 *       obrigatórias, só da própria pasta).
 *   (c) quantidade e duplicidade: uma devolução aberta por pedido; não
 *       devolve mais que o comprado.
 *   (d) máquina de estados do lojista: gate de admin, recusa exige motivo,
 *       recebida só depois de aprovada, conclusão só depois de recebida.
 *   (e) dinheiro: reembolso de pedido pago pelo app abre linha no ledger
 *       order_refunds com trava de saldo (inclui frete de ida quando o
 *       pedido volta inteiro); pedido pago no balcão vira reembolso manual.
 *   (f) estoque: reestoca por item, só o que a inspeção mandou, uma vez só.
 *   (g) RLS: o cliente só enxerga a própria devolução; aviso ao cliente nasce.
 *   (h) política: prazo abaixo da lei é recusado; só admin salva.
 *
 * Tudo com uuids fixos e valores de fixture. Para na primeira prova que
 * falhar.
 *
 * USO: node tests/banco/devolucoes-viva.cjs  (depois de provisionar.cjs e
 * aplicar-migrations.cjs, como no rpc-ci.yml)
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

const U_CLIENTE = "31111111-1111-1111-1111-111111111111";
const U_OUTRO = "31111111-1111-1111-1111-111111111112";
const U_ADMIN = "32222222-2222-2222-2222-222222222222";
const P_CAMISA = "3aaaaaaa-0000-0000-0000-000000000001";
const P_VESTIDO = "3aaaaaaa-0000-0000-0000-000000000002";
const V_VESTIDO_P = "3bbbbbbb-0000-0000-0000-000000000001";
const O_LOCAL = "3ccccccc-0000-0000-0000-000000000001";
const O_NACIONAL = "3ccccccc-0000-0000-0000-000000000002";
const O_BALCAO = "3ccccccc-0000-0000-0000-000000000003";
const O_A_CAMINHO = "3ccccccc-0000-0000-0000-000000000004";
const I_LOCAL = "3ddddddd-0000-0000-0000-000000000001";
const I_NACIONAL = "3ddddddd-0000-0000-0000-000000000002";
const I_BALCAO = "3ddddddd-0000-0000-0000-000000000003";
const I_A_CAMINHO = "3ddddddd-0000-0000-0000-000000000004";

async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId,
  ]);
}

async function valorUnico(cliente, sql, params = []) {
  const resultado = await cliente.query(sql, params);
  return resultado.rows[0][Object.keys(resultado.rows[0])[0]];
}

async function rpc(cliente, sql, params = []) {
  const resultado = await cliente.query(sql, params);
  return resultado.rows[0].r;
}

async function semear(cliente) {
  await cliente.query(
    `INSERT INTO public.store_config (id, origin_cep) VALUES (1, '38500-000')
     ON CONFLICT (id) DO NOTHING`,
  );
  for (const [id, email, meta] of [
    [U_CLIENTE, "cliente@devolucao.teste", "{}"],
    [U_OUTRO, "outro@devolucao.teste", "{}"],
    [U_ADMIN, "admin@devolucao.teste", '{"role":"admin"}'],
  ]) {
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [id, email, meta],
    );
  }
  await cliente.query(
    `INSERT INTO public.produtos (id, nome, preco_venda, estoque, ativo, categoria)
     VALUES ($1, 'Camisa de Prova', 40.00, 10, true, 'Camisas'),
            ($2, 'Vestido de Prova', 90.00, 3, true, 'Íntimos')`,
    [P_CAMISA, P_VESTIDO],
  );
  await cliente.query(
    `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, active)
     VALUES ($1, $2, 'Tamanho', 'P', 4, true)`,
    [V_VESTIDO_P, P_VESTIDO],
  );

  const pedido = async (id, o) => {
    await cliente.query(
      `INSERT INTO public.marketplace_orders
         (id, user_id, customer_name, customer_data, total, subtotal, shipping, status, canal,
          payment_method, payment_status, paid_at, pagamento_recebido_em, gateway_payment_id,
          shipping_label_id)
       VALUES ($1, $2, 'Cliente de Prova', $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        id,
        o.userId,
        JSON.stringify(o.customerData),
        o.total,
        o.subtotal,
        o.shipping,
        o.status,
        o.canal,
        o.paymentMethod,
        o.paymentStatus,
        o.paidAt || null,
        o.recebidoEm || null,
        o.gateway || null,
        o.label || null,
      ],
    );
    await cliente.query(
      `INSERT INTO public.marketplace_order_items
         (id, order_id, product_id, variant_id, product_name, quantity, price)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [o.itemId, id, o.productId, o.variantId || null, o.nome, o.qtd, o.preco],
    );
    if (o.entregueHaDias !== undefined) {
      await cliente.query(
        `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, created_at)
         VALUES ($1, 'shipping', 'delivered', now() - make_interval(days => $2::int))`,
        [id, o.entregueHaDias],
      );
    }
  };

  // Entrega local, paga pelo app, entregue há 2 dias: 2 x 40 + 20 de frete.
  await pedido(O_LOCAL, {
    userId: U_CLIENTE,
    customerData: {
      whatsapp: "5534999990000",
      shipping_option_id: "local-delivery",
    },
    total: 100,
    subtotal: 80,
    shipping: 20,
    status: "delivered",
    canal: "online",
    paymentMethod: "online",
    paymentStatus: "pago",
    paidAt: new Date(),
    gateway: "ORD-PROVA-1",
    itemId: I_LOCAL,
    productId: P_CAMISA,
    nome: "Camisa de Prova",
    qtd: 2,
    preco: 40,
    entregueHaDias: 2,
  });
  // Nacional (Melhor Envio, com etiqueta de ida), entregue há 20 dias.
  await pedido(O_NACIONAL, {
    userId: U_CLIENTE,
    customerData: {
      whatsapp: "5534999990000",
      shipping_option_id: "melhor-envio-1",
    },
    total: 105,
    subtotal: 90,
    shipping: 15,
    status: "delivered",
    canal: "online",
    paymentMethod: "online",
    paymentStatus: "pago",
    paidAt: new Date(),
    gateway: "ORD-PROVA-2",
    label: "ME-PROVA-2",
    itemId: I_NACIONAL,
    productId: P_VESTIDO,
    variantId: V_VESTIDO_P,
    nome: "Vestido de Prova",
    qtd: 1,
    preco: 90,
    entregueHaDias: 20,
  });
  // Balcão, pago em dinheiro, hoje.
  await pedido(O_BALCAO, {
    userId: U_CLIENTE,
    customerData: { whatsapp: "5534999990000", canal: "presencial" },
    total: 60,
    subtotal: 60,
    shipping: 0,
    status: "delivered",
    canal: "presencial",
    paymentMethod: "cash",
    paymentStatus: "recebido_na_entrega",
    recebidoEm: new Date(),
    itemId: I_BALCAO,
    productId: P_CAMISA,
    nome: "Camisa de Prova",
    qtd: 2,
    preco: 30,
    entregueHaDias: 0,
  });
  // Ainda a caminho.
  await pedido(O_A_CAMINHO, {
    userId: U_CLIENTE,
    customerData: { shipping_option_id: "local-delivery" },
    total: 40,
    subtotal: 40,
    shipping: 0,
    status: "shipping",
    canal: "online",
    paymentMethod: "online",
    paymentStatus: "pago",
    paidAt: new Date(),
    gateway: "ORD-PROVA-4",
    itemId: I_A_CAMINHO,
    productId: P_CAMISA,
    nome: "Camisa de Prova",
    qtd: 1,
    preco: 40,
  });
}

const elegibilidade = (cliente, orderId) =>
  rpc(cliente, "SELECT public.devolucao_elegibilidade($1::uuid) AS r", [
    orderId,
  ]);

const solicitar = (
  cliente,
  orderId,
  itens,
  motivo,
  resolucao,
  metodo,
  fotos = [],
) =>
  rpc(
    cliente,
    "SELECT public.solicitar_devolucao($1::uuid, $2::jsonb, $3, NULL, $4, $5, $6::text[]) AS r",
    [orderId, JSON.stringify(itens), motivo, resolucao, metodo, fotos],
  );

const PROVAS = [];
const estado = {};

PROVAS.push({
  nome: "(a) elegibilidade: dono vê, estranho não; não entregue não pode; métodos por modalidade",
  corpo: async (cliente) => {
    await semear(cliente);

    await logar(cliente, U_OUTRO);
    await assert.rejects(
      () => elegibilidade(cliente, O_LOCAL),
      /Pedido não encontrado/,
    );

    await logar(cliente, U_CLIENTE);
    const local = await elegibilidade(cliente, O_LOCAL);
    assert.equal(local.pode, true);
    assert.equal(local.modalidade, "local");
    assert.deepEqual(local.metodos, ["entrega_na_loja", "coleta"]);
    assert.equal(local.janelas.arrependimento, true);
    assert.equal(local.itens[0].disponivel, 2);

    const nacional = await elegibilidade(cliente, O_NACIONAL);
    assert.equal(nacional.modalidade, "nacional");
    assert.deepEqual(nacional.metodos, ["etiqueta_reversa", "envio_proprio"]);
    assert.equal(nacional.janelas.arrependimento, false, "20 dias > 7");
    assert.equal(nacional.janelas.troca, true, "20 dias <= 30");

    const balcao = await elegibilidade(cliente, O_BALCAO);
    assert.equal(balcao.modalidade, "local");
    assert.deepEqual(
      balcao.metodos,
      ["entrega_na_loja"],
      "balcão não tem coleta",
    );
    assert.equal(
      balcao.janelas.arrependimento,
      false,
      "compra na loja física não tem art. 49",
    );

    const aCaminho = await elegibilidade(cliente, O_A_CAMINHO);
    assert.equal(aCaminho.pode, false);
    assert.match(aCaminho.motivo_bloqueio, /depois que o pedido for entregue/);
  },
});

PROVAS.push({
  nome: "(b)(c) tipo decidido no servidor, fotos da própria pasta, quantidade e uma aberta por pedido",
  corpo: async (cliente) => {
    await logar(cliente, U_CLIENTE);
    // Vício sem foto é recusado (política exige).
    await assert.rejects(
      () =>
        solicitar(
          cliente,
          O_LOCAL,
          [{ order_item_id: I_LOCAL, quantidade: 1 }],
          "defeito",
          "reembolso",
          "entrega_na_loja",
        ),
      /ao menos uma foto/,
    );
    // Foto fora da pasta do cliente é recusada.
    await assert.rejects(
      () =>
        solicitar(
          cliente,
          O_LOCAL,
          [{ order_item_id: I_LOCAL, quantidade: 1 }],
          "defeito",
          "reembolso",
          "entrega_na_loja",
          [`${U_OUTRO}/${O_LOCAL}/foto.jpg`],
        ),
      /Foto inválida/,
    );
    // Mais do que o comprado.
    await assert.rejects(
      () =>
        solicitar(
          cliente,
          O_LOCAL,
          [{ order_item_id: I_LOCAL, quantidade: 3 }],
          "tamanho_grande",
          "reembolso",
          "entrega_na_loja",
        ),
      /Quantidade indisponível/,
    );
    // Método que não existe para o pedido.
    await assert.rejects(
      () =>
        solicitar(
          cliente,
          O_LOCAL,
          [{ order_item_id: I_LOCAL, quantidade: 1 }],
          "tamanho_grande",
          "reembolso",
          "etiqueta_reversa",
        ),
      /forma de devolver/,
    );

    // Arrependimento parcial: sem frete de ida.
    const parcial = await solicitar(
      cliente,
      O_LOCAL,
      [{ order_item_id: I_LOCAL, quantidade: 1 }],
      "tamanho_grande",
      "reembolso",
      "entrega_na_loja",
    );
    assert.equal(parcial.tipo, "arrependimento");
    assert.match(parcial.protocolo, /^DV\d{6}-[0-9A-F]{5}$/);
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT valor_frete_ida FROM public.devolucoes WHERE id = $1",
          [parcial.id],
        ),
      ),
      0,
    );
    // Segunda aberta no mesmo pedido: recusada.
    await assert.rejects(
      () =>
        solicitar(
          cliente,
          O_LOCAL,
          [{ order_item_id: I_LOCAL, quantidade: 1 }],
          "desisti",
          "reembolso",
          "entrega_na_loja",
        ),
      /em andamento/,
    );
    // O cliente cancela e pede o pedido inteiro: agora o frete de ida volta.
    const cancelada = await rpc(
      cliente,
      "SELECT public.cancelar_devolucao($1::uuid) AS r",
      [parcial.id],
    );
    assert.equal(cancelada.status, "cancelada");
    const inteira = await solicitar(
      cliente,
      O_LOCAL,
      [{ order_item_id: I_LOCAL, quantidade: 2 }],
      "nao_gostei",
      "reembolso",
      "coleta",
    );
    assert.equal(inteira.tipo, "arrependimento");
    const linha = (
      await cliente.query(
        "SELECT valor_itens, valor_frete_ida, modalidade FROM public.devolucoes WHERE id = $1",
        [inteira.id],
      )
    ).rows[0];
    assert.equal(Number(linha.valor_itens), 80);
    assert.equal(
      Number(linha.valor_frete_ida),
      20,
      "pedido inteiro no arrependimento devolve o frete",
    );
    assert.equal(linha.modalidade, "local");
    estado.devolucaoLocal = inteira.id;

    // Nacional fora do arrependimento: reembolso recusado, troca aceita.
    await assert.rejects(
      () =>
        solicitar(
          cliente,
          O_NACIONAL,
          [{ order_item_id: I_NACIONAL, quantidade: 1 }],
          "tamanho_pequeno",
          "reembolso",
          "envio_proprio",
        ),
      /troca ou vale-troca/,
    );
    // Categoria sem troca (política) barra só a troca.
    await logar(cliente, U_ADMIN);
    await rpc(
      cliente,
      `SELECT public.salvar_politica_de_devolucao('{"categorias_sem_troca":["íntimos"]}'::jsonb) AS r`,
    );
    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      () =>
        solicitar(
          cliente,
          O_NACIONAL,
          [{ order_item_id: I_NACIONAL, quantidade: 1 }],
          "tamanho_pequeno",
          "troca",
          "envio_proprio",
        ),
      /não aceita troca/,
    );
    await logar(cliente, U_ADMIN);
    await rpc(
      cliente,
      `SELECT public.salvar_politica_de_devolucao('{"categorias_sem_troca":[]}'::jsonb) AS r`,
    );
    await logar(cliente, U_CLIENTE);
    const troca = await solicitar(
      cliente,
      O_NACIONAL,
      [{ order_item_id: I_NACIONAL, quantidade: 1 }],
      "tamanho_pequeno",
      "troca",
      "envio_proprio",
    );
    assert.equal(troca.tipo, "troca");
    estado.devolucaoNacional = troca.id;

    // Vício no balcão, com foto da própria pasta.
    const vicio = await solicitar(
      cliente,
      O_BALCAO,
      [{ order_item_id: I_BALCAO, quantidade: 1 }],
      "defeito",
      "reembolso",
      "entrega_na_loja",
      [`${U_CLIENTE}/${O_BALCAO}/costura.jpg`],
    );
    assert.equal(vicio.tipo, "vicio");
    estado.devolucaoBalcao = vicio.id;
  },
});

PROVAS.push({
  nome: "(d)(e)(f) lojista: gate, recusa com motivo, estados, reembolso no ledger com trava e reestoque único",
  corpo: async (cliente) => {
    const idLocal = estado.devolucaoLocal;
    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_decidir($1::uuid, true) AS r",
          [idLocal],
        ),
      /Acesso negado/,
    );

    await logar(cliente, U_ADMIN);
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_decidir($1::uuid, false, '  ') AS r",
          [idLocal],
        ),
      /motivo da recusa/,
    );
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', '[]'::jsonb) AS r",
          [idLocal],
        ),
      /depois de receber/,
    );
    const aprovada = await rpc(
      cliente,
      "SELECT public.admin_devolucao_decidir($1::uuid, true, 'Coletamos amanhã à tarde.', now() + interval '1 day') AS r",
      [idLocal],
    );
    assert.equal(aprovada.status, "aprovada");
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT count(*) FROM public.notificacoes WHERE usuario_id = $1 AND dados->>'devolucao_id' = $2",
          [U_CLIENTE, idLocal],
        ),
      ),
      1,
      "o cliente recebe o aviso da aprovação",
    );
    const recebida = await rpc(
      cliente,
      "SELECT public.admin_devolucao_registrar($1::uuid, 'recebida') AS r",
      [idLocal],
    );
    assert.equal(recebida.status, "recebida");

    const itemId = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [idLocal],
    );
    const estoqueAntes = Number(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_CAMISA],
      ),
    );
    // Reembolso acima do saldo do pedido é recusado.
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb, 150) AS r",
          [
            idLocal,
            JSON.stringify([
              { item_id: itemId, condicao: "nova", reestocar: true },
            ]),
          ],
        ),
      /passa do que ainda pode ser devolvido/,
    );
    const concluida = await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
      [
        idLocal,
        JSON.stringify([
          { item_id: itemId, condicao: "nova", reestocar: true },
        ]),
      ],
    );
    assert.equal(concluida.status, "concluida");
    assert.equal(
      Number(concluida.valor_reembolso),
      100,
      "80 dos itens + 20 do frete de ida",
    );
    assert.equal(concluida.reembolso_manual, false);
    assert.ok(concluida.refund_id, "pedido pago pelo app abre linha no ledger");
    const refund = (
      await cliente.query(
        "SELECT amount, status, solicitado_por FROM public.order_refunds WHERE id = $1",
        [concluida.refund_id],
      )
    ).rows[0];
    assert.equal(Number(refund.amount), 100);
    assert.equal(refund.status, "solicitado");
    assert.equal(refund.solicitado_por, "lojista");
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT estoque FROM public.produtos WHERE id = $1",
          [P_CAMISA],
        ),
      ),
      estoqueAntes + 2,
    );
    // Concluir de novo: recusado, e o estoque não volta duas vezes.
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
          [
            idLocal,
            JSON.stringify([
              { item_id: itemId, condicao: "nova", reestocar: true },
            ]),
          ],
        ),
      /depois de receber/,
    );
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT estoque FROM public.produtos WHERE id = $1",
          [P_CAMISA],
        ),
      ),
      estoqueAntes + 2,
    );

    // Troca nacional: cliente informa o rastreio, loja recebe, item usado não reestoca.
    const idNacional = estado.devolucaoNacional;
    await rpc(
      cliente,
      "SELECT public.admin_devolucao_decidir($1::uuid, true) AS r",
      [idNacional],
    );
    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.informar_envio_devolucao($1::uuid, 'x') AS r",
          [idNacional],
        ),
      /Código de rastreio inválido/,
    );
    const enviada = await rpc(
      cliente,
      "SELECT public.informar_envio_devolucao($1::uuid, 'qb123456789br') AS r",
      [idNacional],
    );
    assert.equal(enviada.status, "em_transito");
    await logar(cliente, U_ADMIN);
    await rpc(
      cliente,
      "SELECT public.admin_devolucao_registrar($1::uuid, 'recebida') AS r",
      [idNacional],
    );
    const itemNacional = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [idNacional],
    );
    const variacaoAntes = Number(
      await valorUnico(
        cliente,
        "SELECT stock_increment FROM public.product_variants WHERE id = $1",
        [V_VESTIDO_P],
      ),
    );
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
          [
            idNacional,
            JSON.stringify([
              { item_id: itemNacional, condicao: "usada", reestocar: false },
            ]),
          ],
        ),
      /não gera reembolso/,
    );
    const trocaConcluida = await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'troca', $2::jsonb) AS r",
      [
        idNacional,
        JSON.stringify([
          { item_id: itemNacional, condicao: "usada", reestocar: false },
        ]),
      ],
    );
    assert.equal(trocaConcluida.refund_id, null);
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT stock_increment FROM public.product_variants WHERE id = $1",
          [V_VESTIDO_P],
        ),
      ),
      variacaoAntes,
      "item usado não volta para a prateleira",
    );

    // Balcão pago em dinheiro: reembolso manual, com trava pelo total.
    const idBalcao = estado.devolucaoBalcao;
    await rpc(
      cliente,
      "SELECT public.admin_devolucao_decidir($1::uuid, true) AS r",
      [idBalcao],
    );
    await rpc(
      cliente,
      "SELECT public.admin_devolucao_registrar($1::uuid, 'recebida') AS r",
      [idBalcao],
    );
    const itemBalcao = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [idBalcao],
    );
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb, 61) AS r",
          [
            idBalcao,
            JSON.stringify([
              { item_id: itemBalcao, condicao: "danificada", reestocar: false },
            ]),
          ],
        ),
      /passa do valor pago/,
    );
    const manual = await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
      [
        idBalcao,
        JSON.stringify([
          { item_id: itemBalcao, condicao: "danificada", reestocar: false },
        ]),
      ],
    );
    assert.equal(manual.reembolso_manual, true);
    assert.equal(manual.refund_id, null, "balcão não passa pelo Mercado Pago");
    assert.equal(Number(manual.valor_reembolso), 30);
  },
});

PROVAS.push({
  nome: "(g)(h) RLS: cliente só lê o que é seu; política recusa prazo abaixo da lei e cliente não salva",
  corpo: async (cliente) => {
    await cliente.query("BEGIN");
    try {
      await logar(cliente, U_OUTRO);
      await cliente.query("SET LOCAL ROLE authenticated");
      assert.equal(
        Number(
          await valorUnico(cliente, "SELECT count(*) FROM public.devolucoes"),
        ),
        0,
      );
      await cliente.query("RESET ROLE");
      await logar(cliente, U_CLIENTE);
      await cliente.query("SET LOCAL ROLE authenticated");
      assert.equal(
        Number(
          await valorUnico(cliente, "SELECT count(*) FROM public.devolucoes"),
        ),
        4,
      );
      await assert.rejects(
        () =>
          cliente.query("UPDATE public.devolucoes SET status = 'concluida'"),
        /permission denied/,
      );
    } finally {
      await cliente.query("ROLLBACK");
    }

    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      () =>
        rpc(
          cliente,
          `SELECT public.salvar_politica_de_devolucao('{"prazo_troca_dias":0}'::jsonb) AS r`,
        ),
      /Acesso negado/,
    );
    await logar(cliente, U_ADMIN);
    await assert.rejects(
      () =>
        rpc(
          cliente,
          `SELECT public.salvar_politica_de_devolucao('{"prazo_arrependimento_dias":5}'::jsonb) AS r`,
        ),
      /check constraint/,
    );
    const salva = await rpc(
      cliente,
      `SELECT public.salvar_politica_de_devolucao('{"prazo_troca_dias":15,"aceita_vale":false}'::jsonb) AS r`,
    );
    assert.equal(salva.prazo_troca_dias, 15);
    assert.equal(
      salva.prazo_arrependimento_dias,
      7,
      "campo ausente fica como estava",
    );
    assert.equal(salva.aceita_vale, false);
  },
});

// ---------------------------------------------------------------------------
// Achados da revisão de risco de 26/09/2026 (migrations 75/76/77 nunca
// aplicadas em produção — corrigidas em vez de remendadas por cima).
// ---------------------------------------------------------------------------

/** Pedido customizado para os cenários abaixo (cupom, prazo, estoque já devolvido). */
async function pedidoCustom(cliente, id, o) {
  await cliente.query(
    `INSERT INTO public.marketplace_orders
       (id, user_id, customer_name, customer_data, total, subtotal, discount, shipping, status, canal,
        payment_method, payment_status, paid_at, pagamento_recebido_em, gateway_payment_id, stock_returned_at)
     VALUES ($1, $2, 'Cliente de Prova', $3::jsonb, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
    [
      id,
      o.userId,
      JSON.stringify(
        o.customerData || {
          whatsapp: "5534999990000",
          shipping_option_id: "local-delivery",
        },
      ),
      o.total,
      o.subtotal,
      o.discount || 0,
      o.shipping || 0,
      o.status || "delivered",
      o.canal || "online",
      o.paymentMethod,
      o.paymentStatus,
      o.paidAt || null,
      o.recebidoEm || null,
      o.gateway || null,
      o.stockReturnedAt || null,
    ],
  );
  await cliente.query(
    `INSERT INTO public.marketplace_order_items (id, order_id, product_id, variant_id, product_name, quantity, price)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [
      o.itemId,
      id,
      o.productId,
      o.variantId || null,
      o.nome || "Item de Prova",
      o.qtd,
      o.preco,
    ],
  );
  if (o.entregueHaDias !== undefined) {
    await cliente.query(
      `INSERT INTO public.marketplace_order_history (order_id, old_status, new_status, created_at)
       VALUES ($1, 'shipping', 'delivered', now() - make_interval(days => $2::int))`,
      [id, o.entregueHaDias],
    );
  }
}

async function ateRecebida(cliente, devolucaoId) {
  await logar(cliente, U_ADMIN);
  await rpc(
    cliente,
    "SELECT public.admin_devolucao_decidir($1::uuid, true) AS r",
    [devolucaoId],
  );
  await rpc(
    cliente,
    "SELECT public.admin_devolucao_registrar($1::uuid, 'recebida') AS r",
    [devolucaoId],
  );
}

const O_CUPOM = "3eeeeeee-0000-0000-0000-000000000001";
const I_CUPOM = "3fffffff-0000-0000-0000-000000000001";
const O_CUPOM_INTEIRO = "3eeeeeee-0000-0000-0000-000000000002";
const I_CUPOM_INTEIRO = "3fffffff-0000-0000-0000-000000000002";
const O_180 = "3eeeeeee-0000-0000-0000-000000000003";
const I_180 = "3fffffff-0000-0000-0000-000000000003";
const O_REEMITIR = "3eeeeeee-0000-0000-0000-000000000004";
const I_REEMITIR = "3fffffff-0000-0000-0000-000000000004";
const O_SEM_PAGAMENTO = "3eeeeeee-0000-0000-0000-000000000005";
const I_SEM_PAGAMENTO = "3fffffff-0000-0000-0000-000000000005";
const O_SEM_HISTORICO = "3eeeeeee-0000-0000-0000-000000000006";
const I_SEM_HISTORICO = "3fffffff-0000-0000-0000-000000000006";
const O_H = "3eeeeeee-0000-0000-0000-000000000007";
const I_H = "3fffffff-0000-0000-0000-000000000007";
const O_MUTANTE = "3eeeeeee-0000-0000-0000-000000000008";
const I_MUTANTE = "3fffffff-0000-0000-0000-000000000008";
const O_RESTANTE = "3eeeeeee-0000-0000-0000-000000000009";
const I_RESTANTE = "3fffffff-0000-0000-0000-000000000009";
const O_JA_ESTORNADO_PARTE = "3eeeeeee-0000-0000-0000-00000000000a";
const I_JA_ESTORNADO_PARTE = "3fffffff-0000-0000-0000-00000000000a";
const O_ARREDONDA = "3eeeeeee-0000-0000-0000-00000000000b";
const I_ARREDONDA = "3fffffff-0000-0000-0000-00000000000b";
const O_H_PAGTO = "3eeeeeee-0000-0000-0000-00000000000c";
const I_H_PAGTO = "3fffffff-0000-0000-0000-00000000000c";
const O_REEMITIR_RECEBIDA = "3eeeeeee-0000-0000-0000-00000000000d";
const I_REEMITIR_RECEBIDA = "3fffffff-0000-0000-0000-00000000000d";
const O_REEMITIR_SALDO = "3eeeeeee-0000-0000-0000-00000000000e";
const I_REEMITIR_SALDO_A = "3fffffff-0000-0000-0000-00000000000e";
const I_REEMITIR_SALDO_B = "3fffffff-0000-0000-0000-00000000000f";

PROVAS.push({
  nome: "(A) reembolso default rateia o cupom do pedido e não passa do disponível",
  corpo: async (cliente) => {
    // 2 unidades de 100, cupom -100, frete 20 -> pago 120 (cenário exato do achado A).
    await pedidoCustom(cliente, O_CUPOM, {
      userId: U_CLIENTE,
      total: 120,
      subtotal: 200,
      discount: 100,
      shipping: 20,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-A-1",
      itemId: I_CUPOM,
      productId: P_CAMISA,
      qtd: 2,
      preco: 100,
      entregueHaDias: 2,
    });
    await logar(cliente, U_CLIENTE);
    const parcial = await solicitar(
      cliente,
      O_CUPOM,
      [{ order_item_id: I_CUPOM, quantidade: 1 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    const valorUnitario = Number(
      await valorUnico(
        cliente,
        "SELECT valor_unitario FROM public.devolucao_itens WHERE devolucao_id = $1",
        [parcial.id],
      ),
    );
    assert.equal(
      valorUnitario,
      50,
      "snapshot rateado: 100 * (200-100)/200 = 50, não o preço cheio",
    );
    await ateRecebida(cliente, parcial.id);
    const itemId = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [parcial.id],
    );
    const concluida = await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
      [
        parcial.id,
        JSON.stringify([
          { item_id: itemId, condicao: "nova", reestocar: true },
        ]),
      ],
    );
    assert.equal(
      Number(concluida.valor_reembolso),
      50,
      "reembolso proporcional (não 100, o preço cheio de 1 unidade)",
    );

    // Devolução do pedido INTEIRO: default é CAPADO em 120 (disponível), não
    // recusado por tentar devolver 220 (2 x 100 + frete, preço cheio).
    await pedidoCustom(cliente, O_CUPOM_INTEIRO, {
      userId: U_CLIENTE,
      total: 120,
      subtotal: 200,
      discount: 100,
      shipping: 20,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-A-2",
      itemId: I_CUPOM_INTEIRO,
      productId: P_CAMISA,
      qtd: 2,
      preco: 100,
      entregueHaDias: 2,
    });
    await logar(cliente, U_CLIENTE);
    const inteira = await solicitar(
      cliente,
      O_CUPOM_INTEIRO,
      [{ order_item_id: I_CUPOM_INTEIRO, quantidade: 2 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    await ateRecebida(cliente, inteira.id);
    const itemInteira = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [inteira.id],
    );
    const concluidaInteira = await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
      [
        inteira.id,
        JSON.stringify([
          { item_id: itemInteira, condicao: "nova", reestocar: true },
        ]),
      ],
    );
    assert.equal(
      Number(concluidaInteira.valor_reembolso),
      120,
      "capado no disponível (100 dos itens rateados + 20 de frete), nunca 220",
    );

    // (mutante A_cap_default) o disponível pode ficar MENOR que o default
    // calculado (valor_itens + frete) por um motivo diferente do cupom: um
    // reembolso PARCIAL já CONFIRMADO (valor_estornado) do mesmo pedido.
    // Sem o LEAST(...), o default (100) passaria batido dos 40 disponíveis.
    await pedidoCustom(cliente, O_JA_ESTORNADO_PARTE, {
      userId: U_CLIENTE,
      total: 100,
      subtotal: 100,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-A-3",
      itemId: I_JA_ESTORNADO_PARTE,
      productId: P_CAMISA,
      qtd: 1,
      preco: 100,
      entregueHaDias: 2,
    });
    // Simula um reembolso PARCIAL já confirmado pelo Mercado Pago fora desta
    // devolução (concluir_estorno somaria em valor_estornado; aqui só o fato).
    await cliente.query(
      "UPDATE public.marketplace_orders SET valor_estornado = 60 WHERE id = $1",
      [O_JA_ESTORNADO_PARTE],
    );
    await logar(cliente, U_CLIENTE);
    const devJaEstornado = await solicitar(
      cliente,
      O_JA_ESTORNADO_PARTE,
      [{ order_item_id: I_JA_ESTORNADO_PARTE, quantidade: 1 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    await ateRecebida(cliente, devJaEstornado.id);
    const itemJaEstornado = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [devJaEstornado.id],
    );
    const concluidaJaEstornado = await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
      [
        devJaEstornado.id,
        JSON.stringify([
          { item_id: itemJaEstornado, condicao: "nova", reestocar: true },
        ]),
      ],
    );
    assert.equal(
      Number(concluidaJaEstornado.valor_reembolso),
      40,
      "achado A (mutante cap_default): capa em 40 (100 - 60 já estornados), não tenta devolver 100",
    );

    // (mutante A_trava_arred) rateio por UNIDADE arredondado pode somar 1
    // centavo acima do que o pedido cobrou pelos itens: 3 un. x 10, cupom
    // 10 (fator 0,6667) -> 6,67 x 3 = 20,01, mas só 20,00 foi pago pelos
    // itens. Um único pedido de devolução com as 3 unidades tem de travar
    // em 20,00.
    await pedidoCustom(cliente, O_ARREDONDA, {
      userId: U_CLIENTE,
      total: 35,
      subtotal: 30,
      discount: 10,
      shipping: 15,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-A-4",
      itemId: I_ARREDONDA,
      productId: P_CAMISA,
      qtd: 3,
      preco: 10,
      entregueHaDias: 2,
    });
    await logar(cliente, U_CLIENTE);
    const devArredonda = await solicitar(
      cliente,
      O_ARREDONDA,
      [{ order_item_id: I_ARREDONDA, quantidade: 3 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    const valorItensArredonda = Number(
      await valorUnico(
        cliente,
        "SELECT valor_itens FROM public.devolucoes WHERE id = $1",
        [devArredonda.id],
      ),
    );
    assert.equal(
      valorItensArredonda,
      20,
      "achado A (mutante trava_arred): 6,67 x 3 = 20,01 sem a trava; travado em 20,00 (o que os itens de fato custaram com o cupom)",
    );
  },
});

PROVAS.push({
  nome: "(B)(M) payment_status NULL e entrega sem histórico são RECUSADOS, não liberados",
  corpo: async (cliente) => {
    // "Ainda não" do admin: pedido delivered, payment_status NULL (nunca confirmado).
    await pedidoCustom(cliente, O_SEM_PAGAMENTO, {
      userId: U_CLIENTE,
      total: 80,
      subtotal: 80,
      paymentMethod: "cash",
      paymentStatus: null,
      itemId: I_SEM_PAGAMENTO,
      productId: P_CAMISA,
      qtd: 1,
      preco: 80,
      entregueHaDias: 2,
    });
    await logar(cliente, U_CLIENTE);
    const el = await elegibilidade(cliente, O_SEM_PAGAMENTO);
    assert.equal(el.pode, false, "payment_status NULL não pode devolver");
    assert.match(el.motivo_bloqueio, /não tem pagamento a devolver/);
    await assert.rejects(
      () =>
        solicitar(
          cliente,
          O_SEM_PAGAMENTO,
          [{ order_item_id: I_SEM_PAGAMENTO, quantidade: 1 }],
          "desisti",
          "reembolso",
          "entrega_na_loja",
        ),
      /não tem pagamento a devolver/,
    );

    // Pedido 'delivered' sem linha 'delivered' no histórico (legado): sem
    // fallback para updated_at, fica sem data de entrega -> "fale com a loja".
    await pedidoCustom(cliente, O_SEM_HISTORICO, {
      userId: U_CLIENTE,
      total: 40,
      subtotal: 40,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-M-1",
      itemId: I_SEM_HISTORICO,
      productId: P_CAMISA,
      qtd: 1,
      preco: 40,
      // sem entregueHaDias: nenhuma linha em marketplace_order_history.
    });
    const elM = await elegibilidade(cliente, O_SEM_HISTORICO);
    assert.equal(elM.pode, false);
    assert.match(elM.motivo_bloqueio, /Fale com a loja/);
    await assert.rejects(
      () =>
        solicitar(
          cliente,
          O_SEM_HISTORICO,
          [{ order_item_id: I_SEM_HISTORICO, quantidade: 1 }],
          "desisti",
          "reembolso",
          "entrega_na_loja",
        ),
      /Fale com a loja/,
    );
  },
});

PROVAS.push({
  nome: "(G) pagamento com mais de 180 dias vira manual; admin_devolucao_reemitir_reembolso reabre o recusado",
  corpo: async (cliente) => {
    await pedidoCustom(cliente, O_180, {
      userId: U_CLIENTE,
      total: 100,
      subtotal: 100,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(Date.now() - 200 * 86400000),
      gateway: "ORD-G-1",
      itemId: I_180,
      productId: P_CAMISA,
      qtd: 1,
      preco: 100,
      entregueHaDias: 2,
    });
    await logar(cliente, U_CLIENTE);
    const d = await solicitar(
      cliente,
      O_180,
      [{ order_item_id: I_180, quantidade: 1 }],
      "defeito",
      "reembolso",
      "entrega_na_loja",
      [`${U_CLIENTE}/${O_180}/foto.jpg`],
    );
    await ateRecebida(cliente, d.id);
    const item = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [d.id],
    );
    const concluida = await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
      [
        d.id,
        JSON.stringify([{ item_id: item, condicao: "nova", reestocar: true }]),
      ],
    );
    assert.equal(
      concluida.reembolso_manual,
      true,
      "pagamento >180 dias: caminho manual (o MP recusaria)",
    );
    assert.equal(concluida.refund_id, null);
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT count(*) FROM public.order_refunds WHERE order_id = $1",
          [O_180],
        ),
      ),
      0,
      "nenhuma linha nasceu em order_refunds para o MP recusar depois",
    );

    // admin_devolucao_reemitir_reembolso: cenário do achado G onde a linha
    // NASCE (pedido recente) e o EXECUTOR recusa depois.
    await pedidoCustom(cliente, O_REEMITIR, {
      userId: U_CLIENTE,
      total: 90,
      subtotal: 90,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-G-2",
      itemId: I_REEMITIR,
      productId: P_CAMISA,
      qtd: 1,
      preco: 90,
      entregueHaDias: 2,
    });
    await logar(cliente, U_CLIENTE);
    const d2 = await solicitar(
      cliente,
      O_REEMITIR,
      [{ order_item_id: I_REEMITIR, quantidade: 1 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    await ateRecebida(cliente, d2.id);
    const item2 = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [d2.id],
    );
    const concluida2 = await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
      [
        d2.id,
        JSON.stringify([{ item_id: item2, condicao: "nova", reestocar: true }]),
      ],
    );
    assert.ok(
      concluida2.refund_id,
      "pedido recente: caminho automático abre a linha",
    );

    await logar(cliente, U_ADMIN);
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_reemitir_reembolso($1::uuid, false) AS r",
          [d2.id],
        ),
      /não foi recusado/,
      "não há o que reemitir enquanto a linha não foi recusada",
    );

    // O executor recusou (simulado: só o STATUS muda, quem grava é a edge).
    await cliente.query(
      "UPDATE public.order_refunds SET status = 'recusado', ultimo_erro = 'pagamento com mais de 180 dias' WHERE id = $1",
      [concluida2.refund_id],
    );
    const reemitido = await rpc(
      cliente,
      "SELECT public.admin_devolucao_reemitir_reembolso($1::uuid, false) AS r",
      [d2.id],
    );
    assert.ok(reemitido.refund_id, "nova linha nasce");
    assert.notEqual(
      reemitido.refund_id,
      concluida2.refund_id,
      "refund_id troca para a linha nova",
    );
    const refundAntigo = (
      await cliente.query(
        "SELECT status FROM public.order_refunds WHERE id = $1",
        [concluida2.refund_id],
      )
    ).rows[0];
    assert.equal(refundAntigo.status, "recusado", "a linha recusada não some");

    // Reemitir de novo (a nova linha está 'solicitado', não recusada): recusado.
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_reemitir_reembolso($1::uuid, false) AS r",
          [d2.id],
        ),
      /não foi recusado/,
    );

    // p_manual = true registra como manual, sem depender do MP de novo.
    await cliente.query(
      "UPDATE public.order_refunds SET status = 'recusado' WHERE id = $1",
      [reemitido.refund_id],
    );
    const manual = await rpc(
      cliente,
      "SELECT public.admin_devolucao_reemitir_reembolso($1::uuid, true) AS r",
      [d2.id],
    );
    assert.equal(manual.reembolso_manual, true);
    assert.equal(manual.refund_id, null);

    // (mutante G_reemitir_so_concluida) reemitir só vale para devolução
    // CONCLUÍDA com reembolso — não para uma ainda 'recebida'.
    await pedidoCustom(cliente, O_REEMITIR_RECEBIDA, {
      userId: U_CLIENTE,
      total: 70,
      subtotal: 70,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-G-3",
      itemId: I_REEMITIR_RECEBIDA,
      productId: P_CAMISA,
      qtd: 1,
      preco: 70,
      entregueHaDias: 2,
    });
    await logar(cliente, U_CLIENTE);
    const dRecebida = await solicitar(
      cliente,
      O_REEMITIR_RECEBIDA,
      [{ order_item_id: I_REEMITIR_RECEBIDA, quantidade: 1 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    await ateRecebida(cliente, dRecebida.id);
    await logar(cliente, U_ADMIN);
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_reemitir_reembolso($1::uuid, false) AS r",
          [dRecebida.id],
        ),
      /concluída com reembolso pode reemitir/,
    );

    // (mutante G_reemitir_saldo) a trava de saldo vale também na REEMISSÃO —
    // pedido com 2 itens, um já resolvido manualmente (achado 3) deixa só
    // parte do disponível para a reemissão do outro.
    await pedidoCustom(cliente, O_REEMITIR_SALDO, {
      userId: U_CLIENTE,
      total: 100,
      subtotal: 100,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-G-4",
      itemId: I_REEMITIR_SALDO_A,
      productId: P_CAMISA,
      qtd: 1,
      preco: 40,
      entregueHaDias: 2,
    });
    await cliente.query(
      `INSERT INTO public.marketplace_order_items (id, order_id, product_id, product_name, quantity, price)
       VALUES ($1, $2, $3, 'Camisa de Prova', 1, 60)`,
      [I_REEMITIR_SALDO_B, O_REEMITIR_SALDO, P_CAMISA],
    );
    await logar(cliente, U_CLIENTE);
    // Item A (40): recusado -> manual (achado 3 consome 40 do disponível).
    const dA = await solicitar(
      cliente,
      O_REEMITIR_SALDO,
      [{ order_item_id: I_REEMITIR_SALDO_A, quantidade: 1 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    await ateRecebida(cliente, dA.id);
    const itemA = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [dA.id],
    );
    const concluidaA = await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
      [dA.id, JSON.stringify([{ item_id: itemA, condicao: "nova", reestocar: true }])],
    );
    await cliente.query(
      "UPDATE public.order_refunds SET status = 'recusado' WHERE id = $1",
      [concluidaA.refund_id],
    );
    await logar(cliente, U_ADMIN);
    await rpc(
      cliente,
      "SELECT public.admin_devolucao_reemitir_reembolso($1::uuid, true) AS r",
      [dA.id],
    );
    // Item B (60): recusado; disponível restante = 100 - 40 (manual de A) = 60.
    await logar(cliente, U_CLIENTE);
    const dB = await solicitar(
      cliente,
      O_REEMITIR_SALDO,
      [{ order_item_id: I_REEMITIR_SALDO_B, quantidade: 1 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    await ateRecebida(cliente, dB.id);
    const itemB = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [dB.id],
    );
    const concluidaB = await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb, $3::numeric) AS r",
      [dB.id, JSON.stringify([{ item_id: itemB, condicao: "nova", reestocar: true }]), 60],
    );
    await cliente.query(
      "UPDATE public.order_refunds SET status = 'recusado' WHERE id = $1",
      [concluidaB.refund_id],
    );
    // Uma TERCEIRA linha em voo (simula outro pedido de estorno pendente do
    // mesmo pedido) consome o que sobrou: disponível = 100 - 40 (manual de
    // A) - 30 (em voo) = 30, menor que os 60 que a devolução B quer reemitir.
    await cliente.query(
      `INSERT INTO public.order_refunds (order_id, amount, motivo, solicitado_por, status)
       VALUES ($1, 30, 'outro pedido de estorno em andamento', 'lojista', 'solicitado')`,
      [O_REEMITIR_SALDO],
    );
    await logar(cliente, U_ADMIN);
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_reemitir_reembolso($1::uuid, false) AS r",
          [dB.id],
        ),
      /passa do que ainda pode ser devolvido/,
      "achado 3 + mutante G_reemitir_saldo: 60 não cabe em 30 de disponível (40 manual de A + 30 em voo já consomem 70 dos 100)",
    );
  },
});

PROVAS.push({
  nome: "(H)(4) conclusão revalida o pedido: cancelado/estornado travam; estoque já devolvido só desliga o reestoque",
  corpo: async (cliente) => {
    await pedidoCustom(cliente, O_H, {
      userId: U_CLIENTE,
      total: 100,
      subtotal: 100,
      paymentMethod: "cash",
      paymentStatus: "recebido_na_entrega",
      recebidoEm: new Date(),
      itemId: I_H,
      productId: P_CAMISA,
      qtd: 1,
      preco: 100,
      entregueHaDias: 0,
    });
    await logar(cliente, U_CLIENTE);
    const d = await solicitar(
      cliente,
      O_H,
      [{ order_item_id: I_H, quantidade: 1 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    await ateRecebida(cliente, d.id);
    const item = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [d.id],
    );

    // O admin cancela o pedido (venda de balcão) e registra o estorno fora do
    // app ENQUANTO a devolução está 'recebida' — exatamente o achado H.
    await cliente.query(
      "UPDATE public.marketplace_orders SET status = 'cancelled' WHERE id = $1",
      [O_H],
    );
    await logar(cliente, U_ADMIN);
    await rpc(cliente, "SELECT public.registrar_estorno_manual($1::uuid)", [
      O_H,
    ]);

    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
          [
            d.id,
            JSON.stringify([
              { item_id: item, condicao: "nova", reestocar: true },
            ]),
          ],
        ),
      /não está mais entregue/,
      "pedido cancelado: a conclusão recusa mesmo com a devolução 'recebida'",
    );

    // (mutante H_concluir_pagto) o pedido pode continuar 'delivered' e ainda
    // assim não ter mais pagamento a devolver — isola a guarda de
    // payment_status da guarda de status testada acima.
    await pedidoCustom(cliente, O_H_PAGTO, {
      userId: U_CLIENTE,
      total: 90,
      subtotal: 90,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-H-3",
      itemId: I_H_PAGTO,
      productId: P_CAMISA,
      qtd: 1,
      preco: 90,
      entregueHaDias: 2,
    });
    await logar(cliente, U_CLIENTE);
    const dPagto = await solicitar(
      cliente,
      O_H_PAGTO,
      [{ order_item_id: I_H_PAGTO, quantidade: 1 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    await ateRecebida(cliente, dPagto.id);
    // payment_status muda por outro caminho (ex.: webhook de estorno direto
    // no MP) SEM cancelar o pedido — status continua 'delivered'.
    await cliente.query(
      "UPDATE public.marketplace_orders SET payment_status = 'estornado' WHERE id = $1",
      [O_H_PAGTO],
    );
    const itemPagto = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [dPagto.id],
    );
    await logar(cliente, U_ADMIN);
    await assert.rejects(
      () =>
        rpc(
          cliente,
          "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
          [
            dPagto.id,
            JSON.stringify([
              { item_id: itemPagto, condicao: "nova", reestocar: true },
            ]),
          ],
        ),
      /não tem pagamento registrado/,
      "'delivered' continua, mas payment_status saiu da lista de permissão",
    );

    // Achado 4 (rodada 2): stock_returned_at NÃO bloqueia mais a conclusão
    // inteira (a política P1 — pago após expirar, honrado — reativa pedido
    // expirado até 'delivered' de verdade, e o carimbo nunca some). A
    // conclusão segue normal; só o REESTOQUE desliga à força, mesmo que o
    // admin peça reestocar=true — crédito duplicado seria o achado C de novo.
    await pedidoCustom(cliente, O_MUTANTE, {
      userId: U_CLIENTE,
      total: 50,
      subtotal: 50,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-H-2",
      itemId: I_MUTANTE,
      productId: P_CAMISA,
      qtd: 1,
      preco: 50,
      entregueHaDias: 1,
    });
    await logar(cliente, U_CLIENTE);
    const d2 = await solicitar(
      cliente,
      O_MUTANTE,
      [{ order_item_id: I_MUTANTE, quantidade: 1 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    await ateRecebida(cliente, d2.id);
    await cliente.query(
      "UPDATE public.marketplace_orders SET stock_returned_at = now() WHERE id = $1",
      [O_MUTANTE],
    );
    const item2 = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [d2.id],
    );
    const estoqueAntesMutante = Number(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_CAMISA],
      ),
    );
    const concluidaMutante = await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
      [
        d2.id,
        JSON.stringify([
          { item_id: item2, condicao: "nova", reestocar: true },
        ]),
      ],
    );
    assert.equal(
      concluidaMutante.status,
      "concluida",
      "achado 4: stock_returned_at não bloqueia mais a conclusão",
    );
    assert.equal(
      concluidaMutante.reestocados,
      0,
      "achado 4: reestoque desligado à força quando stock_returned_at já está preenchido",
    );
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT estoque FROM public.produtos WHERE id = $1",
          [P_CAMISA],
        ),
      ),
      estoqueAntesMutante,
      "estoque não muda: crédito duplicado seria o achado C de novo",
    );
  },
});

PROVAS.push({
  nome: "(gap 1)(gap 2) item repetido na conclusão não dobra o reestoque; segunda devolução só pega o restante",
  corpo: async (cliente) => {
    await pedidoCustom(cliente, O_RESTANTE, {
      userId: U_CLIENTE,
      total: 200,
      subtotal: 200,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-GAP-1",
      itemId: I_RESTANTE,
      productId: P_CAMISA,
      qtd: 2,
      preco: 100,
      entregueHaDias: 1,
    });
    await logar(cliente, U_CLIENTE);
    // Uma unidade primeiro.
    const primeira = await solicitar(
      cliente,
      O_RESTANTE,
      [{ order_item_id: I_RESTANTE, quantidade: 1 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    await ateRecebida(cliente, primeira.id);
    const itemPrimeira = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [primeira.id],
    );

    // (gap 1) o mesmo item_id duas vezes no p_itens não credita 2x.
    const estoqueAntes = Number(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_CAMISA],
      ),
    );
    await logar(cliente, U_ADMIN);
    await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
      [
        primeira.id,
        JSON.stringify([
          { item_id: itemPrimeira, condicao: "nova", reestocar: true },
          { item_id: itemPrimeira, condicao: "nova", reestocar: true },
        ]),
      ],
    );
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT estoque FROM public.produtos WHERE id = $1",
          [P_CAMISA],
        ),
      ),
      estoqueAntes + 1,
      "item repetido em p_itens credita 1 unidade, não 2",
    );

    // (gap 2) segunda devolução do MESMO item de pedido só pode pegar o
    // restante (1 de 2 já foi; pedir 2 de novo é recusado, pedir 1 passa).
    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      () =>
        solicitar(
          cliente,
          O_RESTANTE,
          [{ order_item_id: I_RESTANTE, quantidade: 2 }],
          "tamanho_grande",
          "reembolso",
          "entrega_na_loja",
        ),
      /Quantidade indisponível/,
      "só resta 1 unidade — pedir 2 é recusado",
    );
    const segunda = await solicitar(
      cliente,
      O_RESTANTE,
      [{ order_item_id: I_RESTANTE, quantidade: 1 }],
      "tamanho_grande",
      "reembolso",
      "entrega_na_loja",
    );
    assert.ok(segunda.id, "a unidade restante ainda pode ser devolvida");
  },
});

const O_DEVOLVE_CANCELA = "3eeeeeee-0000-0000-0000-000000000010";
const I_DEVOLVE_CANCELA = "3fffffff-0000-0000-0000-000000000010";

PROVAS.push({
  nome: "(C) devolver_estoque desconta o que a devolução já repôs (conclui -> cancela)",
  corpo: async (cliente) => {
    await pedidoCustom(cliente, O_DEVOLVE_CANCELA, {
      userId: U_CLIENTE,
      total: 200,
      subtotal: 200,
      paymentMethod: "online",
      paymentStatus: "pago",
      paidAt: new Date(),
      gateway: "ORD-C-1",
      itemId: I_DEVOLVE_CANCELA,
      productId: P_CAMISA,
      qtd: 2,
      preco: 100,
      entregueHaDias: 2,
    });
    const estoqueAntes = Number(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_CAMISA],
      ),
    );
    await logar(cliente, U_CLIENTE);
    // Devolução de 1 das 2 unidades, concluída com reestoque — o pedido
    // continua 'delivered' (a devolução não muda o status do pedido).
    const d = await solicitar(
      cliente,
      O_DEVOLVE_CANCELA,
      [{ order_item_id: I_DEVOLVE_CANCELA, quantidade: 1 }],
      "desisti",
      "reembolso",
      "entrega_na_loja",
    );
    await ateRecebida(cliente, d.id);
    const item = await valorUnico(
      cliente,
      "SELECT id FROM public.devolucao_itens WHERE devolucao_id = $1",
      [d.id],
    );
    await rpc(
      cliente,
      "SELECT public.admin_devolucao_concluir($1::uuid, 'reembolso', $2::jsonb) AS r",
      [d.id, JSON.stringify([{ item_id: item, condicao: "nova", reestocar: true }])],
    );
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT estoque FROM public.produtos WHERE id = $1",
          [P_CAMISA],
        ),
      ),
      estoqueAntes + 1,
      "1 unidade reestocada pela devolução",
    );

    // Agora o admin CANCELA o pedido 'delivered' — dispara devolver_estoque.
    // Sem o desconto do achado C, creditaria as 2 unidades de novo (a
    // unidade já devolvida vira fantasma: +3 no total, não +2).
    await logar(cliente, U_ADMIN);
    await rpc(
      cliente,
      "SELECT public.update_order_status_atomic($1::uuid, 'cancelled', 'cliente devolveu o resto', false) AS r",
      [O_DEVOLVE_CANCELA],
    );
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT estoque FROM public.produtos WHERE id = $1",
          [P_CAMISA],
        ),
      ),
      estoqueAntes + 2,
      "achado C (mutante C_devolver_estoque): devolver_estoque credita só a unidade que faltava (2 no total, nunca 3)",
    );
  },
});

PROVAS.push({
  nome: "(storage) a policy de INSERT do bucket 'devolucoes' recusa gravar na pasta de outro usuário",
  corpo: async (cliente) => {
    const ESTRANHO = "31111111-1111-1111-1111-111111111199";
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data) VALUES ($1, $2, '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [ESTRANHO, "estranho@devolucao.teste"],
    );
    await cliente.query("BEGIN");
    try {
      await logar(cliente, ESTRANHO);
      await cliente.query("SET LOCAL ROLE authenticated");
      // Grava na PRÓPRIA pasta: passa.
      await cliente.query(
        `INSERT INTO storage.objects (bucket_id, name, owner)
         VALUES ('devolucoes', $1::text || '/foto.jpg', $2::uuid)`,
        [ESTRANHO, ESTRANHO],
      );
      // Grava na pasta de OUTRO cliente: a policy recusa (achado do mutante
      // storage_insert — sem o split_part(name,'/',1) = auth.uid(), qualquer
      // autenticado grava foto na pasta de qualquer um).
      await assert.rejects(
        () =>
          cliente.query(
            `INSERT INTO storage.objects (bucket_id, name, owner)
             VALUES ('devolucoes', $1::text || '/foto-alheia.jpg', $2::uuid)`,
            [U_CLIENTE, ESTRANHO],
          ),
        /permission denied|new row violates row-level security/,
      );
    } finally {
      await cliente.query("ROLLBACK");
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
          "Prova viva das devoluções (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Uma regra da devolução foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }

  console.log(
    `\n[devolucoes] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Prova viva das devoluções (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} provas** contra as migrations aplicadas do zero.`,
  );
}

main();
