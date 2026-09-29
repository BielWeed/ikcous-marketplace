"use strict";

/**
 * PROVAS DE COMPORTAMENTO das funções que guardam DINHEIRO — o contrato que
 * o CI passa a travar (frente CI-CONTRATO-DINHEIRO, workflow rpc-ci.yml):
 *
 *   (a) CUPOM: usage_limit nunca fica negativo; a vaga não volta duas vezes
 *       para o mesmo pedido (varredura idempotente) e volta depois do PIX
 *       morto, não no cancelamento.
 *   (b) CANCELAMENTO DUPLO: cancelar pedido duas vezes não devolve estoque
 *       nem abre estorno em dobro — e a segunda tentativa do dono do pedido
 *       é recusada com exceção.
 *   (c) RESOLVER_LOJA: só resolve host ATIVO da frota, com a chave certa;
 *       comparação de host sem sensibilidade a maiúscula.
 *
 * Tudo contra o Postgres EFÊMERO do job (migrations aplicadas do zero pelo
 * aplicar-migrations.cjs). Dinheiro aqui é dado de FIXTURE — uuids fixos,
 * valores inventados, nenhum dado de cliente. A suíte para na primeira
 * prova que falhar: falha de invariante de dinheiro é vermelho honesto.
 *
 * USO: node tests/banco/invariantes-dinheiro.cjs
 */

const assert = require("node:assert");
const { Client } = require("pg");
const {
  falhar,
  lerDatabaseUrlEfemera,
  anexarAoSummary,
} = require("./efemero.cjs");

// ---- Fixtures determinísticos (uuids fixos, nunca gerados por round-trip) --
const U_CLIENTE = "11111111-1111-1111-1111-111111111111";
const U_ADMIN = "22222222-2222-2222-2222-222222222222";
const P_PRODUTO_A = "aaaaaaaa-0000-0000-0000-000000000001";
const P_PRODUTO_B = "aaaaaaaa-0000-0000-0000-000000000002";
const CHAVE_FROTA = "ci-dinheiro-chave-teste";

// Venda no balcão (prova (d)): um produto SEM variação e um COM variação
// ativa — é o par mínimo que expõe a baixa XOR (variante OU produto, nunca os
// dois). A chave de idempotência é fixa de propósito: é ela que a prova
// repete para exigir o MESMO pedido de volta.
const P_BALCAO_SIMPLES = "aaaaaaaa-0000-0000-0000-000000000003";
const P_BALCAO_COM_VARIACAO = "aaaaaaaa-0000-0000-0000-000000000004";
const V_BALCAO_VARIACAO = "bbbbbbbb-0000-0000-0000-000000000001";
const CHAVE_BALCAO = "dddddddd-0000-0000-0000-000000000001";
// Segundo balconista e chave de um pedido da VITRINE: é com esses dois que a
// guarda de idempotência do balcão (canal + vendedor, nunca user_id) se prova.
const U_ADMIN_2 = "22222222-2222-2222-2222-222222222223";
const CHAVE_DA_VITRINE = "dddddddd-0000-0000-0000-000000000002";

// ---- Helpers de sessão ------------------------------------------------------
// auth.uid() do provisionar.cjs lê este GUC — é o "login" da prova.
async function logar(cliente, userId) {
  await cliente.query("SELECT set_config('app.rpc.user_id', $1, false)", [
    userId,
  ]);
}

async function criarPedido(cliente, { produtos, cupom, total }) {
  const itens = produtos.map((p) => ({
    product_id: p.id,
    variant_id: null,
    quantity: p.quantidade,
  }));
  const resultado = await cliente.query(
    `SELECT public.create_marketplace_order_v24(
        $1::jsonb, $2::numeric, $3::numeric, $4::text, $5::uuid,
        $6::text, $7::text, $8::text, $9::text, $10::jsonb,
        $11::text, $12::text, $13::uuid
      ) AS id`,
    [
      JSON.stringify(itens),
      total,
      0,
      "pix",
      null,
      cupom || null,
      "Cliente de Prova",
      "5539000000000",
      null,
      JSON.stringify({ cep: "38500-000", rua: "Rua da Prova", numero: "1" }),
      "38500-000",
      "local-delivery",
      null,
    ],
  );
  return resultado.rows[0].id;
}

async function cancelar(cliente, orderId, novoStatus = "cancelled") {
  return cliente.query(
    "SELECT public.update_order_status_atomic($1::uuid, $2::text)",
    [orderId, novoStatus],
  );
}

async function valorUnico(cliente, sql, params = []) {
  const resultado = await cliente.query(sql, params);
  return resultado.rows[0][Object.keys(resultado.rows[0])[0]];
}

// Loja fixture: frete sempre grátis (sentinela 0.01) e cobertura nacional
// (nenhum portão de CEP). A regra do frete × pagamento (migration
// 20261168000000) exige OPÇÃO de entrega escolhida — criarPedido manda
// 'local-delivery' com CEP de entrega local —, o que exige origem e faixa
// local configuradas na loja. As colunas vão no INSERT e no UPDATE: só no
// DO UPDATE, a linha NOVA nasceria com o default (free_shipping_min=100) —
// medido no CI em 14/09.
async function garantirLojaFixture(cliente) {
  await cliente.query(
    `INSERT INTO public.store_config
       (id, origin_cep, local_cep_range, free_shipping_min, shipping_coverage)
     VALUES (1, '38500-000', '38500000-38505000', 0.01, 'national')
     ON CONFLICT (id) DO UPDATE
       SET origin_cep = EXCLUDED.origin_cep,
           local_cep_range = EXCLUDED.local_cep_range,
           free_shipping_min = EXCLUDED.free_shipping_min,
           shipping_coverage = EXCLUDED.shipping_coverage`,
  );
}

// ---- Provas -----------------------------------------------------------------
const PROVAS = [];

// (a) CUPOM — limite não fica negativo e a vaga não volta em dobro.
PROVAS.push({
  nome: "(a) cupom: limite não fica negativo e não devolve duas vezes no mesmo pedido",
  corpo: async (cliente) => {
    await garantirLojaFixture(cliente);
    await cliente.query(
      `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
       VALUES ($1, 'Produto Prova Cupom', 30.00, 50.00, 10, true, false)`,
      [P_PRODUTO_A],
    );
    await cliente.query(
      `INSERT INTO public.coupons (code, type, value, min_purchase, usage_limit, usage_count, active)
       VALUES ('CICUPOM10', 'fixed', 10.00, 0, 1, 0, true)`,
    );
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'cliente@prova.teste', '{}'::jsonb)`,
      [U_CLIENTE],
    );

    await logar(cliente, U_CLIENTE);
    const pedidoId = await criarPedido(cliente, {
      produtos: [{ id: P_PRODUTO_A, quantidade: 2 }],
      cupom: "CICUPOM10",
      total: "90.00",
    });
    assert.ok(
      /^[0-9a-f-]{36}$/i.test(pedidoId),
      "pedido com cupom deve nascer",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT usage_count FROM public.coupons WHERE code = 'CICUPOM10'",
      ),
      1,
      "criar pedido deve consumir a vaga do cupom",
    );

    // Cancelamento NÃO devolve a vaga (Rodada 4: só a varredura devolve).
    await cancelar(cliente, pedidoId);
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT usage_count FROM public.coupons WHERE code = 'CICUPOM10'",
      ),
      1,
      "cancelamento não pode devolver a vaga do cupom",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_PRODUTO_A],
      ),
      10,
      "cancelamento devolve o estoque",
    );

    // PIX morto (fixture envelhece o pedido) — 1ª varredura devolve UMA vez.
    await cliente.query(
      "UPDATE public.marketplace_orders SET expires_at = now() - interval '25 hours' WHERE id = $1",
      [pedidoId],
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT public.devolver_cupons_de_pedidos_mortos()",
      ),
      1,
      "1ª varredura devolve a vaga de exatamente um pedido",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT usage_count FROM public.coupons WHERE code = 'CICUPOM10'",
      ),
      0,
      "vaga devolvida: usage_count volta a zero",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT coupon_usage_returned FROM public.marketplace_orders WHERE id = $1",
        [pedidoId],
      ),
      true,
      "o fato fica registrado no pedido",
    );

    // 2ª varredura: nada a fazer — é aqui que o dobro morria.
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT public.devolver_cupons_de_pedidos_mortos()",
      ),
      0,
      "2ª varredura não devolve de novo",
    );
    const contagemFinal = Number(
      await valorUnico(
        cliente,
        "SELECT usage_count FROM public.coupons WHERE code = 'CICUPOM10'",
      ),
    );
    assert.ok(contagemFinal >= 0, "usage_limit nunca fica negativo");
    assert.equal(
      contagemFinal,
      0,
      "usage_count permanece zero após revarredura",
    );

    // A vaga devolvida é usável de novo: nasce pedido 2 com o mesmo cupom.
    const segundoPedido = await criarPedido(cliente, {
      produtos: [{ id: P_PRODUTO_A, quantidade: 1 }],
      cupom: "CICUPOM10",
      total: "40.00",
    });
    assert.ok(
      /^[0-9a-f-]{36}$/i.test(segundoPedido),
      "vaga devolvida deve aceitar novo pedido",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT usage_count FROM public.coupons WHERE code = 'CICUPOM10'",
      ),
      1,
      "novo pedido consome a vaga devolvida",
    );
  },
});

// (b) CANCELAMENTO DUPLO — estoque e estorno não dobram; re-cancelamento do
// dono do pedido é recusado.
PROVAS.push({
  nome: "(b) cancelamento duplo: não devolve estoque/estorno em dobro e recusa a 2ª do dono",
  corpo: async (cliente) => {
    await garantirLojaFixture(cliente);
    await cliente.query(
      `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
       VALUES ($1, 'Produto Prova Cancelamento', 30.00, 50.00, 10, true, false)`,
      [P_PRODUTO_B],
    );
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'cliente@prova.teste', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_CLIENTE],
    );
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin@prova.teste', '{"role":"admin"}'::jsonb)`,
      [U_ADMIN],
    );

    await logar(cliente, U_CLIENTE);
    const pedidoId = await criarPedido(cliente, {
      produtos: [{ id: P_PRODUTO_B, quantidade: 2 }],
      cupom: null,
      total: "100.00",
    });
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_PRODUTO_B],
      ),
      8,
      "criar pedido debita o estoque",
    );

    // Fixture de pagamento: pedido PAGO, cancelado antes do envio — é o
    // caso que nasce com linha de estorno no ledger (2026110000000).
    await cliente.query(
      `UPDATE public.marketplace_orders
          SET payment_status = 'pago', paid_at = now()
        WHERE id = $1`,
      [pedidoId],
    );

    await cancelar(cliente, pedidoId);
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_PRODUTO_B],
      ),
      10,
      "1º cancelamento devolve o estoque uma vez",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT count(*) FROM public.order_refunds WHERE order_id = $1",
        [pedidoId],
      ),
      1,
      "pedido pago cancelado abre exatamente um estorno",
    );

    // 2º cancelamento pelo DONO do pedido: recusado com exceção.
    await assert.rejects(
      () => cancelar(cliente, pedidoId),
      /não pode mais ser cancelado/i,
      "re-cancelamento pelo dono deve ser recusado",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_PRODUTO_B],
      ),
      10,
      "recusa não mexe no estoque",
    );

    // Cancelamento repetido pelo ADMIN atravessa os guardas de papel: os
    // fatos registrados (carimbo de estoque, estorno existente) é que
    // impedem o dobro.
    await logar(cliente, U_ADMIN);
    await cancelar(cliente, pedidoId);
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_PRODUTO_B],
      ),
      10,
      "re-cancelamento do admin não devolve estoque em dobro",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT count(*) FROM public.order_refunds WHERE order_id = $1",
        [pedidoId],
      ),
      1,
      "re-cancelamento do admin não abre estorno em dobro",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT status FROM public.marketplace_orders WHERE id = $1",
        [pedidoId],
      ),
      "cancelled",
      "pedido permanece cancelado",
    );
    await logar(cliente, U_CLIENTE);
  },
});

// (c) RESOLVER_LOJA — só host ativo, com a chave certa.
PROVAS.push({
  nome: "(c) resolver_loja: só resolve host ativo, com a chave certa",
  corpo: async (cliente) => {
    await cliente.query(
      `INSERT INTO public.frota_segredo (id, hash)
       VALUES (1, extensions.crypt($1, extensions.gen_salt('bf')))
       ON CONFLICT (id) DO UPDATE SET hash = EXCLUDED.hash`,
      [CHAVE_FROTA],
    );
    await cliente.query(
      `INSERT INTO public.frota_lojas (id, nome, dominio_publico, project_ref, supabase_url, publishable_key, ativa)
       VALUES
         ('loja-viva', 'Loja Viva da Prova', 'loja-viva.lojas.teste', 'refviva', 'https://refviva.supabase.co', 'pk_viva', true),
         ('loja-morta', 'Loja Morta da Prova', 'loja-morta.lojas.teste', 'refmorta', 'https://refmorta.supabase.co', 'pk_morta', false)
       ON CONFLICT (id) DO NOTHING`,
    );

    const viva = await cliente.query(
      "SELECT * FROM public.resolver_loja($1, $2)",
      ["LOJA-VIVA.LOJAS.TESTE", CHAVE_FROTA],
    );
    assert.equal(
      viva.rows.length,
      1,
      "host ativo resolve (sem sensibilidade a maiúscula)",
    );
    assert.equal(viva.rows[0].id, "loja-viva", "resolve a loja certa");

    const morta = await cliente.query(
      "SELECT * FROM public.resolver_loja($1, $2)",
      ["loja-morta.lojas.teste", CHAVE_FROTA],
    );
    assert.equal(morta.rows.length, 0, "host inativo não resolve");

    const chaveErrada = await cliente.query(
      "SELECT * FROM public.resolver_loja($1, $2)",
      ["loja-viva.lojas.teste", "chave-errada-de-propósito"],
    );
    assert.equal(chaveErrada.rows.length, 0, "chave errada não resolve nada");
  },
});

// (d) VENDA PRESENCIAL — o dinheiro do balcão sai do BANCO, a baixa é XOR, a
// chave repetida devolve o mesmo pedido e o cancelamento entra no caminho de
// sempre. Sem esta prova, a RPC poderia debitar estoque nos dois lugares,
// aceitar preço do chamador ou nascer sem histórico, e tudo isso aplicaria
// verde (a prova estática só lê o texto do arquivo).
PROVAS.push({
  nome: "(d) venda presencial: preço do banco, baixa XOR, idempotência, histórico e recusa sem admin",
  corpo: async (cliente) => {
    await garantirLojaFixture(cliente);

    // (a) Sementes: um produto simples (estoque 10) e um com variação ativa
    // (stock_increment 5, price_override 7.50 — DIFERENTE do preco_venda do
    // pai, que é o que prova de onde o preço do item saiu).
    await cliente.query(
      `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
       VALUES ($1, 'Produto Balcão Simples', 10.00, 25.00, 10, true, false)`,
      [P_BALCAO_SIMPLES],
    );
    await cliente.query(
      `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
       VALUES ($1, 'Produto Balcão Com Variação', 4.00, 99.00, 7, true, false)`,
      [P_BALCAO_COM_VARIACAO],
    );
    await cliente.query(
      `INSERT INTO public.product_variants (id, product_id, name, value, stock_increment, price_override, active)
       VALUES ($1, $2, 'Tamanho', 'PP', 5, 7.50, true)`,
      [V_BALCAO_VARIACAO, P_BALCAO_COM_VARIACAO],
    );
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'cliente@prova.teste', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_CLIENTE],
    );
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin@prova.teste', '{"role":"admin"}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN],
    );
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'admin2@prova.teste', '{"role":"admin"}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_ADMIN_2],
    );
    // Um pedido da VITRINE carimbado com uma chave conhecida: é o controle
    // negativo da guarda de idempotência (canal diferente).
    await cliente.query(
      `INSERT INTO public.marketplace_orders
         (customer_name, customer_data, total, subtotal, status, canal, idempotency_key)
       VALUES ('Pedido da Vitrine', '{}'::jsonb, 10.00, 10.00, 'pending', 'online', $1)`,
      [CHAVE_DA_VITRINE],
    );

    const vender = (itens, extras = {}) =>
      cliente.query(
        `SELECT public.registrar_venda_presencial(
            $1::jsonb, $2::text, $3::uuid, $4::text, $5::text,
            $6::numeric, $7::text, $8::uuid
          ) AS venda`,
        [
          JSON.stringify(itens),
          extras.pagamento || "cash",
          extras.clienteUserId || null,
          extras.clienteNome || null,
          extras.whatsapp || null,
          extras.desconto === undefined ? 0 : extras.desconto,
          extras.observacao === undefined ? null : extras.observacao,
          extras.chave === undefined ? null : extras.chave,
        ],
      );

    // (b) Quem não é da loja não registra venda — o gate é a PRIMEIRA coisa.
    await logar(cliente, U_CLIENTE);
    await assert.rejects(
      () => vender([{ product_id: P_BALCAO_SIMPLES, quantity: 2 }]),
      /Acesso negado/,
      "cliente comum não pode registrar venda no balcão",
    );

    // (c) A venda do admin nasce inteira.
    await logar(cliente, U_ADMIN);
    const primeira = (
      await vender([{ product_id: P_BALCAO_SIMPLES, quantity: 2 }], {
        chave: CHAVE_BALCAO,
      })
    ).rows[0].venda;
    assert.equal(primeira.ja_existia, false, "a primeira venda não existia");
    const pedidoSimples = primeira.order.id;
    assert.ok(
      /^[0-9a-f-]{36}$/i.test(pedidoSimples),
      "a venda de balcão devolve o pedido que nasceu",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_BALCAO_SIMPLES],
      ),
      8,
      "a venda de balcão debita o estoque do produto",
    );
    const cabecalho = (
      await cliente.query(
        `SELECT canal, status, payment_status, shipping, expires_at,
                vendedor_id, pagamento_recebido_por, pagamento_recebido_em, total, subtotal
           FROM public.marketplace_orders WHERE id = $1`,
        [pedidoSimples],
      )
    ).rows[0];
    assert.equal(cabecalho.canal, "presencial", "canal do balcão");
    assert.equal(cabecalho.status, "delivered", "venda de balcão já saiu");
    assert.equal(
      cabecalho.payment_status,
      "recebido_na_entrega",
      "o dinheiro do balcão é recebido na mão (D1: sem oitavo valor)",
    );
    assert.equal(Number(cabecalho.shipping), 0, "balcão não tem frete");
    assert.equal(
      cabecalho.expires_at,
      null,
      "expires_at é da reserva do PIX — venda de balcão não reserva nada",
    );
    assert.equal(cabecalho.vendedor_id, U_ADMIN, "vendedor_id é auth.uid()");
    assert.equal(
      cabecalho.pagamento_recebido_por,
      U_ADMIN,
      "quem recebeu é auth.uid()",
    );
    assert.ok(
      cabecalho.pagamento_recebido_em instanceof Date,
      "o recebimento é carimbado na hora",
    );

    // (d) O total é 2 × preco_venda do BANCO — não há como o chamador mandar
    // preço, total ou subtotal (não existe parâmetro para isso).
    assert.equal(Number(cabecalho.subtotal), 50, "subtotal = 2 × 25,00");
    assert.equal(Number(cabecalho.total), 50, "total = subtotal - desconto");

    // (e) A MESMA chave devolve o MESMO pedido, sem segunda baixa de estoque
    // nem segundo item.
    const repetida = (
      await vender([{ product_id: P_BALCAO_SIMPLES, quantity: 2 }], {
        chave: CHAVE_BALCAO,
      })
    ).rows[0].venda;
    assert.equal(repetida.ja_existia, true, "a repetição diz que já existia");
    assert.equal(
      repetida.order.id,
      pedidoSimples,
      "a repetição devolve o MESMO pedido",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_BALCAO_SIMPLES],
      ),
      8,
      "a repetição não debita estoque de novo",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT count(*) FROM public.marketplace_order_items WHERE order_id = $1",
        [pedidoSimples],
      ),
      1,
      "a repetição não grava item de novo",
    );

    // (e-bis) Chave já usada por pedido de OUTRO CANAL ou de OUTRO VENDEDOR é
    // recusada com 23505 — nunca devolvida. É esta guarda que separa a
    // idempotência do balcão da guarda da v23 (que casa por `user_id`, o
    // CLIENTE, e aqui devolveria pedido alheio).
    const chaveRecusada = (erro) =>
      erro.code === "23505" &&
      /já foi usada por outro pedido/.test(erro.message);
    await assert.rejects(
      () =>
        vender([{ product_id: P_BALCAO_SIMPLES, quantity: 1 }], {
          chave: CHAVE_DA_VITRINE,
        }),
      chaveRecusada,
      "chave de pedido da vitrine não vira venda de balcão",
    );
    await logar(cliente, U_ADMIN_2);
    await assert.rejects(
      () =>
        vender([{ product_id: P_BALCAO_SIMPLES, quantity: 1 }], {
          chave: CHAVE_BALCAO,
        }),
      chaveRecusada,
      "a chave de um balconista não devolve o pedido dele para outro",
    );
    await logar(cliente, U_ADMIN);
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_BALCAO_SIMPLES],
      ),
      8,
      "as duas recusas de chave não mexeram no estoque",
    );

    // (f) Baixa XOR: a variação debita stock_increment e NÃO toca no estoque
    // do produto pai; o preço do item é o price_override.
    const daVariacao = (
      await vender([
        {
          product_id: P_BALCAO_COM_VARIACAO,
          variant_id: V_BALCAO_VARIACAO,
          quantity: 1,
        },
      ])
    ).rows[0].venda;
    const pedidoVariacao = daVariacao.order.id;
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT stock_increment FROM public.product_variants WHERE id = $1",
        [V_BALCAO_VARIACAO],
      ),
      4,
      "a venda da variação debita a variação",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_BALCAO_COM_VARIACAO],
      ),
      7,
      "a venda da variação NÃO debita o produto pai (baixa XOR)",
    );
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT price FROM public.marketplace_order_items WHERE order_id = $1",
          [pedidoVariacao],
        ),
      ),
      7.5,
      "o item gravou o price_override da variação, não o preco_venda do pai",
    );

    // (g) Os DOIS históricos, um de cada.
    assert.equal(
      await valorUnico(
        cliente,
        `SELECT count(*) FROM public.marketplace_order_history
          WHERE order_id = $1 AND old_status IS NULL AND new_status = 'delivered'`,
        [pedidoSimples],
      ),
      1,
      "uma linha de histórico de status (NULL → delivered)",
    );
    assert.equal(
      await valorUnico(
        cliente,
        `SELECT count(*) FROM public.marketplace_order_payment_history
          WHERE order_id = $1 AND acao = 'recebido'
            AND payment_status_depois = 'recebido_na_entrega'`,
        [pedidoSimples],
      ),
      1,
      "uma linha de histórico de pagamento (recebido)",
    );

    // (h) Desconto: maior que o subtotal é erro de digitação, não
    // arredondamento (falha FECHADA); e desconto sem motivo não passa (D4).
    await assert.rejects(
      () =>
        vender([{ product_id: P_BALCAO_SIMPLES, quantity: 1 }], {
          desconto: 999,
          observacao: "promoção do dia",
        }),
      /desconto não pode ser maior/i,
      "desconto maior que o subtotal é recusado",
    );
    await assert.rejects(
      () =>
        vender([{ product_id: P_BALCAO_SIMPLES, quantity: 1 }], {
          desconto: 5,
        }),
      /motivo do desconto/i,
      "desconto sem motivo é recusado",
    );

    // (i) Estoque insuficiente derruba a venda INTEIRA — nada de pedido sem
    // baixa nem baixa sem pedido.
    await assert.rejects(
      () => vender([{ product_id: P_BALCAO_SIMPLES, quantity: 999 }]),
      /Estoque insuficiente/i,
      "venda além do estoque é recusada",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_BALCAO_SIMPLES],
      ),
      8,
      "a recusa não deixou estoque debitado pela metade",
    );

    // (j) A venda de balcão entra no MESMO caminho de cancelamento do resto
    // do app: devolve o estoque uma vez, e só uma.
    await cancelar(cliente, pedidoSimples);
    await cancelar(cliente, pedidoVariacao);
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_BALCAO_SIMPLES],
      ),
      10,
      "cancelar a venda de balcão devolve o estoque do produto",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT stock_increment FROM public.product_variants WHERE id = $1",
        [V_BALCAO_VARIACAO],
      ),
      5,
      "cancelar a venda de balcão devolve o estoque da variação",
    );
    await cancelar(cliente, pedidoSimples);
    await cancelar(cliente, pedidoVariacao);
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT estoque FROM public.produtos WHERE id = $1",
        [P_BALCAO_SIMPLES],
      ),
      10,
      "o 2º cancelamento não devolve estoque em dobro",
    );
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT stock_increment FROM public.product_variants WHERE id = $1",
        [V_BALCAO_VARIACAO],
      ),
      5,
      "o 2º cancelamento não devolve a variação em dobro",
    );
    await logar(cliente, U_CLIENTE);
  },
});

// (e) RETIRADA NA LOJA (migration 20261169000000, release 1.5.3): o id
// 'store-pickup' nasce com frete ZERO e o retrato do endereço da loja SÓ
// quando os três requisitos valem (chave habilitada em
// enabled_shipping_methods + store_address não vazio + CEP de entrega
// local). Faltando qualquer um — ou com o id fora da forma canônica — a RPC
// recusa com a frase já classificada pelo front. A entrega local continua
// cobrando a taxa da loja. Endereço da loja é FICTÍCIO (fixture).
const P_RETIRADA = "aaaaaaaa-0000-0000-0000-000000000005";
const ENDERECO_FICTICIO_DA_LOJA = "Rua Fictícia da Prova, 100 — Centro";

async function criarPedidoComFrete(
  cliente,
  { rpc, opcao, total, metodo, cep, frete = 0 },
) {
  const itens = [{ product_id: P_RETIRADA, variant_id: null, quantity: 1 }];
  const resultado = await cliente.query(
    `SELECT public.${rpc}(
        $1::jsonb, $2::numeric, $3::numeric, $4::text, $5::uuid,
        $6::text, $7::text, $8::text, $9::text, $10::jsonb,
        $11::text, $12::text, $13::uuid
      ) AS id`,
    [
      JSON.stringify(itens),
      total,
      frete,
      metodo,
      null,
      null,
      "Cliente de Prova Retirada",
      "5539000000000",
      null,
      JSON.stringify({ cep, rua: "Rua da Prova", numero: "1" }),
      cep,
      opcao,
      null,
    ],
  );
  return resultado.rows[0].id;
}

async function configurarRetirada(cliente, { metodos, endereco, gratis }) {
  await cliente.query(
    `UPDATE public.store_config
        SET enabled_shipping_methods = $1::text[],
            store_address = $2,
            free_shipping_min = $3,
            local_delivery_fee = 10
      WHERE id = 1`,
    [metodos, endereco, gratis],
  );
}

PROVAS.push({
  nome: "(e) retirada na loja: frete zero só com os três requisitos; recusa sem eles; entrega local intacta",
  corpo: async (cliente) => {
    await garantirLojaFixture(cliente);
    await cliente.query(
      `INSERT INTO public.produtos (id, nome, custo, preco_venda, estoque, ativo, frete_gratis)
       VALUES ($1, 'Produto Prova Retirada', 20.00, 50.00, 100, true, false)`,
      [P_RETIRADA],
    );
    await cliente.query(
      `INSERT INTO auth.users (id, email, raw_app_meta_data)
       VALUES ($1, 'cliente@prova.teste', '{}'::jsonb)
       ON CONFLICT (id) DO NOTHING`,
      [U_CLIENTE],
    );
    await logar(cliente, U_CLIENTE);

    // Grátis DESLIGADO (0) e taxa local 10: a retirada tem de sair 0 por
    // ELA, não pelo preset.
    await configurarRetirada(cliente, {
      metodos: ["sedex", "pac", "store-pickup"],
      endereco: ENDERECO_FICTICIO_DA_LOJA,
      gratis: 0,
    });

    const pedidoV24 = await criarPedidoComFrete(cliente, {
      rpc: "create_marketplace_order_v24",
      opcao: "store-pickup",
      total: "50.00",
      metodo: "pix",
      cep: "38500-000",
    });
    const linhaV24 = (
      await cliente.query(
        `SELECT total, subtotal, shipping,
                customer_data->>'shipping_option_id' AS opcao,
                customer_data->>'pickup_address' AS retirada
           FROM public.marketplace_orders WHERE id = $1`,
        [pedidoV24],
      )
    ).rows[0];
    assert.equal(Number(linhaV24.shipping), 0, "retirada nasce com frete 0");
    assert.equal(
      Number(linhaV24.total),
      Number(linhaV24.subtotal),
      "total = subtotal na retirada",
    );
    assert.equal(linhaV24.opcao, "store-pickup");
    assert.equal(
      linhaV24.retirada,
      ENDERECO_FICTICIO_DA_LOJA,
      "o pedido guarda o retrato do endereço da loja",
    );

    // v23 (pagamento na entrega) aceita a retirada com dinheiro — mesmas
    // regras da entrega local.
    const pedidoV23 = await criarPedidoComFrete(cliente, {
      rpc: "create_marketplace_order_v23",
      opcao: "store-pickup",
      total: "50.00",
      metodo: "cash",
      cep: "38500-000",
    });
    assert.equal(
      Number(
        await valorUnico(
          cliente,
          "SELECT shipping FROM public.marketplace_orders WHERE id = $1",
          [pedidoV23],
        ),
      ),
      0,
      "v23 + dinheiro + retirada: frete 0",
    );

    // Entrega local intacta: cobra a taxa, sem pickup_address.
    const pedidoLocal = await criarPedidoComFrete(cliente, {
      rpc: "create_marketplace_order_v24",
      opcao: "local-delivery",
      total: "60.00",
      metodo: "pix",
      cep: "38500-000",
      frete: 10,
    });
    const linhaLocal = (
      await cliente.query(
        `SELECT shipping, customer_data ? 'pickup_address' AS tem_retirada
           FROM public.marketplace_orders WHERE id = $1`,
        [pedidoLocal],
      )
    ).rows[0];
    assert.equal(Number(linhaLocal.shipping), 10, "entrega local cobra 10");
    assert.equal(linhaLocal.tem_retirada, false);

    const recusa = async (rotulo, pedido, padrao) => {
      await assert.rejects(
        () => criarPedidoComFrete(cliente, pedido),
        padrao,
        rotulo,
      );
    };
    const base = {
      rpc: "create_marketplace_order_v24",
      opcao: "store-pickup",
      total: "50.00",
      metodo: "pix",
      cep: "38500-000",
    };

    await recusa(
      "fora da área local",
      { ...base, cep: "01000-000" },
      /Entrega local não disponível para o CEP informado/,
    );
    await recusa(
      "id com espaço de sobra",
      { ...base, opcao: " store-pickup" },
      /Opção de entrega inválida/,
    );

    await configurarRetirada(cliente, {
      metodos: ["sedex", "pac"],
      endereco: ENDERECO_FICTICIO_DA_LOJA,
      gratis: 0,
    });
    await recusa("método desligado", base, /Opção de entrega inválida/);

    await configurarRetirada(cliente, {
      metodos: ["sedex", null],
      endereco: ENDERECO_FICTICIO_DA_LOJA,
      gratis: 0,
    });
    await recusa(
      "array com NULL não habilita (fail-closed)",
      base,
      /Opção de entrega inválida/,
    );

    await configurarRetirada(cliente, {
      metodos: null,
      endereco: ENDERECO_FICTICIO_DA_LOJA,
      gratis: 0,
    });
    await recusa("métodos NULL", base, /Opção de entrega inválida/);

    await configurarRetirada(cliente, {
      metodos: ["store-pickup"],
      endereco: null,
      gratis: 0,
    });
    await recusa("sem endereço da loja", base, /Opção de entrega inválida/);

    await configurarRetirada(cliente, {
      metodos: ["store-pickup"],
      endereco: "   ",
      gratis: 0,
    });
    await recusa("endereço só com espaços", base, /Opção de entrega inválida/);

    // Grátis LIGADO não fura os requisitos: sem a chave, a retirada continua
    // recusada ANTES do ramo do frete grátis.
    await configurarRetirada(cliente, {
      metodos: ["sedex"],
      endereco: ENDERECO_FICTICIO_DA_LOJA,
      gratis: 0.01,
    });
    await recusa(
      "grátis ligado não substitui a habilitação",
      base,
      /Opção de entrega inválida/,
    );

    // E com a chave, grátis ligado: nasce com frete 0 e o retrato sem os
    // espaços das pontas.
    await configurarRetirada(cliente, {
      metodos: ["store-pickup"],
      endereco: `  ${ENDERECO_FICTICIO_DA_LOJA}  `,
      gratis: 0.01,
    });
    const pedidoGratis = await criarPedidoComFrete(cliente, base);
    assert.equal(
      await valorUnico(
        cliente,
        "SELECT customer_data->>'pickup_address' FROM public.marketplace_orders WHERE id = $1",
        [pedidoGratis],
      ),
      ENDERECO_FICTICIO_DA_LOJA,
      "o retrato vai sem os espaços das pontas",
    );

    // Devolve a loja ao estado das outras provas.
    await configurarRetirada(cliente, {
      metodos: ["sedex", "pac"],
      endereco: null,
      gratis: 0.01,
    });
  },
});

// ---- Orquestração ------------------------------------------------------------
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
          "Provas de contrato do dinheiro (rpc-ci)",
          linhas.join("\n"),
        );
        falhar(
          "FALHOU",
          "Uma invariante de DINHEIRO foi quebrada — ver acima qual.",
        );
      }
    }
  } finally {
    await cliente.end().catch(() => {});
  }

  console.log(
    `\n[invariantes] ${PROVAS.length}/${PROVAS.length} provas passaram.`,
  );
  anexarAoSummary(
    "Provas de contrato do dinheiro (rpc-ci)",
    `${linhas.join("\n")}\n\n**${PROVAS.length}/${PROVAS.length} invariantes provadas** contra as migrations aplicadas do zero.`,
  );
}

main();
