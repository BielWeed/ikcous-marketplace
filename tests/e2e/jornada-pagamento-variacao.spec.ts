import { expect, test } from "@playwright/test";
import { exigirRedeSemImprevistos } from "./kit-jornadas";
import {
  TOTAL_DA_CAMISETA_NA_TELA,
  abrirLojaEFinalizar,
  exigirTotalNaTela,
  instalarPagamentoSimulado,
  respostaPixComQr,
  ultimoPedido,
} from "./pagamento-kit";

/**
 * JORNADA DA VARIAÇÃO ESCOLHIDA ATÉ O PEDIDO (25/11/2026, auditoria de leitura
 * das jornadas): a Camiseta tem variação obrigatória (P e M), e as jornadas de
 * pagamento só usavam o Boné (sem variação) — o `variant_id` que o app manda à
 * RPC de criação do pedido nunca era conferido. Aqui o cliente escolhe o
 * tamanho M na folha de opções, vai ao checkout e paga com PIX; o corpo
 * enviado ao "banco" simulado TEM de carregar a variação M (e não a P, nem
 * `null`), o preço da Camiseta (R$ 50) e o mesmo frete local (R$ 10).
 *
 * Mesma guarda dos outros kits de pagamento: tudo é simulado, nada sai para a
 * rede, e o que não tem stub derruba o teste no `afterEach`. Não prova a RPC
 * real: prova o que a TELA manda e mostra.
 */

test.afterEach(exigirRedeSemImprevistos);

test("Camiseta tamanho M: o pedido nasce com a variação M, o total certo e o PIX mostra o mesmo valor", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sim = await instalarPagamentoSimulado(page);
  sim.responderPagamento = (corpo) =>
    corpo.metodo === "pix"
      ? respostaPixComQr(String(corpo.orderId))
      : { status: 500, corpo: { error: "método não previsto" } };

  const errosNoFim = await abrirLojaEFinalizar(page, "pix", {
    produto: "camiseta-m",
  });
  await expect(
    page.getByRole("heading", { name: "Pagamento via Pix" }),
  ).toBeVisible({ timeout: 30_000 });
  await exigirTotalNaTela(page, "Pagamento via Pix", TOTAL_DA_CAMISETA_NA_TELA);

  // UMA criação, com a variação M (id da variação, nunca o texto "M"), a
  // quantidade 1 e o total R$ 50 + R$ 10 de frete.
  expect(sim.criacoesDePedido).toEqual([
    {
      rpc: "create_marketplace_order_v24",
      corpo: {
        p_items: [
          {
            product_id: "jornada-produto-roupas",
            variant_id: "jornada-variante-m",
            quantity: 1,
          },
        ],
        p_total_amount: 60,
        p_shipping_cost: 10,
        p_payment_method: "online",
        p_address_id: "00000000-0000-4000-8000-0000000ad000",
        p_coupon_code: null,
        p_customer_name: "Cliente das Jornadas",
        p_customer_phone: "(34) 99999-0000",
        // O app anota a variação escolhida na observação, em texto.
        p_observation:
          "Camiseta das Jornadas: Tamanho: M\n\nFrete Escolhido: Entrega local (Prazo: 1 dia)",
        p_address_data: null,
        p_destination_cep: "38500-000",
        p_shipping_option_id: "local-delivery",
        p_idempotency_key: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        ),
      },
    },
  ]);
  const pedido = ultimoPedido(sim);
  expect(sim.chamadasDoPagamento).toEqual([
    { orderId: pedido.id, metodo: "pix" },
  ]);
  expect(errosNoFim().erros).toEqual([]);
});
