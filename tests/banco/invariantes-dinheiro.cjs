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
      null,
      null,
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

// Loja fixture: frete sempre grátis (sentinela 0.01 zera o frete sem cotação
// nem opção de entrega) e cobertura nacional (nenhum portão de CEP). As
// colunas vão no INSERT e no UPDATE: só no DO UPDATE, a linha NOVA nasceria
// com o default (free_shipping_min=100) — medido no CI em 14/09.
async function garantirLojaFixture(cliente) {
  await cliente.query(
    `INSERT INTO public.store_config (id, free_shipping_min, shipping_coverage)
     VALUES (1, 0.01, 'national')
     ON CONFLICT (id) DO UPDATE
       SET free_shipping_min = EXCLUDED.free_shipping_min,
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
