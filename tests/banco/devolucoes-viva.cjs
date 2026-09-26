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
