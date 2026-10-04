import { type Page, expect, test } from "@playwright/test";
import {
  MOTIVO_DA_RECUSA_SIMULADA,
  type SimuladorDePagamento,
  URL_DE_ORIGEM_IMPOSTORA,
  URL_DO_DESAFIO_3DS,
  URL_DO_SDK_MP,
  abrirLojaEFinalizar,
  instalarPagamentoSimulado,
  respostaCartaoPago,
  respostaCartaoRecusado,
  respostaDesafio3ds,
  ultimoPedido,
} from "./pagamento-kit";

/**
 * JORNADAS DO CARTÃO PELO APP no navegador de verdade (04/10/2026), contra o
 * SIMULADOR do `pagamento-kit.ts`: o "banco", a edge `criar-pagamento` e o
 * Mercado Pago são dublês determinísticos — nada sai para a rede (a guarda
 * do kit aborta e registra o imprevisto, e cada jornada exige a lista vazia).
 *
 * O que estas jornadas AFIRMAM: o que a TELA mostra para cada resposta e
 * QUANTAS vezes ela chama a edge e o banco. O que NÃO provam: a edge real, o
 * banco real (RLS, RPC, webhook), o Brick real do Mercado Pago (iframes,
 * tokenização) nem o 3DS de um banco de verdade.
 */

test.use({ serviceWorkers: "block" });

/** Leituras da verificação periódica (10 s) do CheckoutView. */
function leiturasDaVerificacao(sim: SimuladorDePagamento): number {
  return sim.leiturasDePedido.filter((l) =>
    l.select.startsWith("payment_status"),
  ).length;
}

function exigirNadaNaoPrevisto(sim: SimuladorDePagamento) {
  expect(sim.naoPrevistas, "requisição a origem não prevista").toEqual([]);
  // O Brick montou pelo carregador REAL do app (script do SDK pedido).
  expect(sim.terceirosAtendidos).toContain(URL_DO_SDK_MP);
}

async function esperarFormularioDoCartao(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Finalize o pagamento" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Pagamento com cartão")).toBeVisible();
  await expect(page.getByTestId("cartao-simulado-pagar")).toBeVisible({
    timeout: 30_000,
  });
}

test("cartão aprovado: UM envio à edge, e a confirmação só vem quando o banco vira pago", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sim = await instalarPagamentoSimulado(page);
  sim.responderPagamento = (corpo) =>
    corpo.metodo === "cartao"
      ? respostaCartaoPago(String(corpo.orderId))
      : { status: 500, corpo: { error: "método não previsto" } };

  const errosNoFim = await abrirLojaEFinalizar(page, "cartao");
  await esperarFormularioDoCartao(page);
  expect(sim.criacoesDePedido.map((c) => c.rpc)).toEqual([
    "create_marketplace_order_v24",
  ]);
  const pedido = ultimoPedido(sim);
  // O cartão NUNCA cobra sozinho ao montar: zero POST antes do toque.
  expect(sim.chamadasDoPagamento).toEqual([]);

  await page.getByTestId("cartao-simulado-pagar").click();
  await expect(
    page.getByText("Pagamento aprovado! Confirmando seu pedido…"),
  ).toBeVisible();

  // A edge disse "pago", mas o banco ainda diz "aguardando": a tela NÃO
  // declara o pedido confirmado. Espera uma leitura da verificação periódica
  // passar com o banco ainda aguardando.
  await expect
    .poll(() => leiturasDaVerificacao(sim), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);
  await expect(page.getByText("Pagamento Confirmado!")).toHaveCount(0);

  // O "webhook" confirma: o banco simulado passa a pago.
  sim.marcarPago(pedido.id);
  await expect(
    page.getByRole("heading", { name: "Pagamento Confirmado!" }),
  ).toBeVisible({ timeout: 15_000 });

  expect(sim.contarPagamentos("cartao")).toBe(1);
  expect(sim.contarPagamentos("pix")).toBe(0);
  const [envio] = sim.chamadasDoPagamento;
  expect(envio).toMatchObject({
    orderId: pedido.id,
    metodo: "cartao",
    token: "tok-simulado-1",
    paymentMethodId: "master",
    paymentTypeId: "credit_card",
    parcelas: 1,
    documento: { type: "CPF", number: "00000000191" },
  });
  exigirNadaNaoPrevisto(sim);
  expect(errosNoFim().erros).toEqual([]);
});

test('cartão recusado → "Tentar outro cartão" → segundo cartão aprovado: dois envios, nunca ao mesmo tempo, PIX só depois da recusa', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sim = await instalarPagamentoSimulado(page);
  // Resposta lenta o bastante para a tela ser OLHADA com o envio em voo.
  sim.atrasoDaEdgeMs = 800;
  sim.responderPagamento = (corpo) => {
    if (corpo.metodo !== "cartao") {
      return { status: 500, corpo: { error: "método não previsto" } };
    }
    return sim.contarPagamentos("cartao") === 1
      ? respostaCartaoRecusado()
      : respostaCartaoPago(String(corpo.orderId));
  };
  const pagarComPix = page.getByRole("button", { name: "Pagar com PIX" });

  const errosNoFim = await abrirLojaEFinalizar(page, "cartao");
  await esperarFormularioDoCartao(page);
  const pedido = ultimoPedido(sim);
  // Formulário aberto: nenhum PIX oferecido.
  await expect(pagarComPix).toHaveCount(0);

  await page.getByTestId("cartao-simulado-pagar").click();
  // Envio em voo (a edge ainda não respondeu): continua sem PIX.
  await expect.poll(() => sim.contarPagamentos("cartao")).toBe(1);
  await expect(pagarComPix).toHaveCount(0);

  // A recusa: o motivo, "Tentar outro cartão" e — só AGORA — "Pagar com PIX".
  await expect(page.getByText(MOTIVO_DA_RECUSA_SIMULADA)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Tentar outro cartão" }),
  ).toBeVisible();
  await expect(pagarComPix).toBeVisible();

  await page.getByRole("button", { name: "Tentar outro cartão" }).click();
  // Formulário NOVO (o Brick é recriado do zero) e o PIX sai de cena.
  await expect(page.getByTestId("cartao-simulado-pagar")).toBeVisible();
  await expect(pagarComPix).toHaveCount(0);
  expect(
    await page.evaluate(
      () =>
        (window as unknown as { __mpSimulado: { criados: number } })
          .__mpSimulado.criados,
    ),
  ).toBe(2);

  await page.getByTestId("cartao-simulado-pagar").click();
  await expect(
    page.getByText("Pagamento aprovado! Confirmando seu pedido…"),
  ).toBeVisible();
  sim.marcarPago(pedido.id);
  await expect(
    page.getByRole("heading", { name: "Pagamento Confirmado!" }),
  ).toBeVisible({ timeout: 15_000 });

  expect(sim.contarPagamentos("cartao")).toBe(2);
  expect(sim.maximoDeCartoesEmVoo).toBe(1);
  expect(sim.contarPagamentos("pix")).toBe(0);
  // Token de uso único: cada tentativa com o seu.
  expect(sim.chamadasDoPagamento.map((c) => c.token)).toEqual([
    "tok-simulado-1",
    "tok-simulado-2",
  ]);
  expect(sim.criacoesDePedido).toHaveLength(1);
  exigirNadaNaoPrevisto(sim);
  expect(errosNoFim().erros).toEqual([]);
});

test('3DS: o desafio do Mercado Pago abre no quadro, só o aviso vindo do Mercado Pago avança para "Confirmando com o banco"', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sim = await instalarPagamentoSimulado(page);
  const ORDER_DO_DESAFIO = "order-3ds-simulada-01";
  sim.responderPagamento = (corpo) => {
    if (corpo.metodo === "cartao") return respostaDesafio3ds(ORDER_DO_DESAFIO);
    if (corpo.metodo === "verificar") {
      // A consulta sem cobrança: o desafio segue aberto no banco.
      return {
        status: 200,
        corpo: { verificacao: "desafio3ds", paymentId: ORDER_DO_DESAFIO },
      };
    }
    return { status: 500, corpo: { error: "método não previsto" } };
  };

  const errosNoFim = await abrirLojaEFinalizar(page, "cartao");
  await esperarFormularioDoCartao(page);
  await page.getByTestId("cartao-simulado-pagar").click();

  const quadro = page.getByTitle("Autenticação do seu banco");
  await expect(quadro).toBeVisible();
  await expect(quadro).toHaveAttribute("src", URL_DO_DESAFIO_3DS);
  const confirmando = page.getByText("Confirmando com o banco…");

  // (a) "COMPLETE" vindo da PRÓPRIA página da loja: ignorado.
  await page.evaluate(() => {
    window.postMessage({ status: "COMPLETE" }, "*");
  });
  // (b) "COMPLETE" de um quadro cujo host IMITA o Mercado Pago: ignorado.
  await page.evaluate((url) => {
    const impostor = document.createElement("iframe");
    impostor.id = "quadro-impostor-e2e";
    impostor.src = url;
    document.body.appendChild(impostor);
  }, URL_DE_ORIGEM_IMPOSTORA);
  await expect
    .poll(() => page.frames().some((f) => f.url() === URL_DE_ORIGEM_IMPOSTORA))
    .toBe(true);
  const quadroImpostor = page
    .frames()
    .find((f) => f.url() === URL_DE_ORIGEM_IMPOSTORA);
  await quadroImpostor?.evaluate(() => {
    window.parent.postMessage({ status: "COMPLETE" }, "*");
  });
  // Dá tempo de um evento ignorado virar tela (não vira).
  await page.waitForTimeout(500);
  await expect(quadro).toBeVisible();
  await expect(confirmando).toHaveCount(0);
  await page.evaluate(() =>
    document.getElementById("quadro-impostor-e2e")?.remove(),
  );

  // (c) "COMPLETE" do quadro do desafio (origem do Mercado Pago): avança.
  const quadroDoDesafio = page
    .frames()
    .find((f) => f.url() === URL_DO_DESAFIO_3DS);
  expect(quadroDoDesafio, "o quadro do desafio carregou").toBeDefined();
  await quadroDoDesafio?.evaluate(() => {
    window.parent.postMessage({ status: "COMPLETE" }, "*");
  });
  await expect(confirmando).toBeVisible();
  await expect(quadro).toHaveCount(0);

  // A confirmação só CONSULTA (metodo "verificar"): nenhum cartão novo,
  // nenhum PIX criado sozinho.
  await expect
    .poll(() => sim.contarPagamentos("verificar"), { timeout: 15_000 })
    .toBeGreaterThanOrEqual(1);
  expect(sim.contarPagamentos("cartao")).toBe(1);
  expect(sim.contarPagamentos("pix")).toBe(0);
  expect(sim.terceirosAtendidos).toContain(URL_DO_DESAFIO_3DS);
  exigirNadaNaoPrevisto(sim);
  expect(errosNoFim().erros).toEqual([]);
});
