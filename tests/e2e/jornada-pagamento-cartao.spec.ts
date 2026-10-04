import { type Page, expect, test } from "@playwright/test";
import { exigirRedeSemImprevistos } from "./kit-jornadas";
import {
  DEVICE_ID_SIMULADO,
  MOTIVO_DA_RECUSA_SIMULADA,
  type SimuladorDePagamento,
  URL_DE_ORIGEM_IMPOSTORA,
  URL_DO_DESAFIO_3DS,
  URL_DO_SDK_MP,
  abrirLojaEFinalizar,
  esperarTelaAssentar,
  exigirCriacaoDoPedido,
  instalarPagamentoSimulado,
  respostaCartaoPago,
  respostaCartaoRecusado,
  respostaDesafio3ds,
  ultimoPedido,
} from "./pagamento-kit";

/**
 * JORNADAS DO CARTÃO PELO APP no navegador de verdade (04/10/2026), contra o
 * SIMULADOR do `pagamento-kit.ts`: o "banco", a edge `criar-pagamento` e o
 * Mercado Pago são dublês determinísticos — nada sai para a rede, e o que não
 * tem stub é negado e derruba o teste no `afterEach`.
 *
 * O que estas jornadas AFIRMAM: o que a TELA mostra para cada resposta e
 * QUANTAS vezes ela chama a edge e o banco, com o CORPO exato. O que NÃO
 * provam: a edge real, o banco real (RLS, RPC, webhook), o Brick real do
 * Mercado Pago (iframes, tokenização) nem o 3DS de um banco de verdade.
 */

test.afterEach(exigirRedeSemImprevistos);

/** O corpo EXATO que a tela manda para o cartão (CardData do dublê). */
function corpoDoCartao(orderId: string, token: string) {
  return {
    orderId,
    metodo: "cartao",
    token,
    paymentMethodId: "master",
    paymentTypeId: "credit_card",
    parcelas: 1,
    documento: { type: "CPF", number: "00000000191" },
    email: "cliente.jornada@exemplo.invalid",
    device_id: DEVICE_ID_SIMULADO,
  };
}

function exigirSdkSimulado(sim: SimuladorDePagamento) {
  // O Brick montou pelo carregador REAL do app (script do SDK pedido).
  expect(sim.terceirosAtendidos).toContain(URL_DO_SDK_MP);
}

/** Formulário do cartão montado e o Device ID já colhido (antes do toque). */
async function esperarFormularioDoCartao(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Finalize o pagamento" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("Pagamento com cartão")).toBeVisible();
  await expect(page.getByTestId("cartao-simulado-pagar")).toBeVisible({
    timeout: 30_000,
  });
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as { MP_DEVICE_SESSION_ID?: unknown }).MP_DEVICE_SESSION_ID,
      ),
    )
    .toBe(DEVICE_ID_SIMULADO);
}

test("cartão aprovado: UM envio à edge, e a confirmação só vem quando o banco vira pago", async ({
  page,
}) => {
  // 10 s é o intervalo da verificação periódica da tela (contrato do
  // CheckoutView); a jornada atravessa duas leituras.
  test.setTimeout(90_000);
  const sim = await instalarPagamentoSimulado(page);
  sim.responderPagamento = (corpo) =>
    corpo.metodo === "cartao"
      ? respostaCartaoPago(String(corpo.orderId))
      : { status: 500, corpo: { error: "método não previsto" } };

  const errosNoFim = await abrirLojaEFinalizar(page, "cartao");
  await esperarFormularioDoCartao(page);
  exigirCriacaoDoPedido(sim);
  const pedido = ultimoPedido(sim);
  // O cartão NUNCA cobra sozinho ao montar: zero POST antes do toque.
  expect(sim.chamadasDoPagamento).toEqual([]);

  await page.getByTestId("cartao-simulado-pagar").click();
  await expect(
    page.getByText("Pagamento aprovado! Confirmando seu pedido…"),
  ).toBeVisible();

  // A edge disse "pago", mas o banco ainda diz "aguardando": espera UMA
  // leitura da verificação periódica VOLTAR (com "aguardando") e a tela
  // assentar — e ela continua sem declarar o pedido confirmado.
  await page.waitForResponse(
    (r) =>
      r.url().includes("/rest/v1/marketplace_orders") &&
      r.url().includes("select=payment_status"),
    { timeout: 15_000 },
  );
  await esperarTelaAssentar(page);
  await expect(page.getByText("Pagamento Confirmado!")).toHaveCount(0);
  await expect(
    page.getByText("Pagamento aprovado! Confirmando seu pedido…"),
  ).toBeVisible();

  // O "webhook" confirma: o banco simulado passa a pago.
  sim.marcarPago(pedido.id);
  await expect(
    page.getByRole("heading", { name: "Pagamento Confirmado!" }),
  ).toBeVisible({ timeout: 15_000 });

  expect(sim.chamadasDoPagamento).toEqual([
    corpoDoCartao(pedido.id, "tok-simulado-1"),
  ]);
  expect(sim.contagemPorMetodo()).toEqual({ cartao: 1 });
  expect(sim.criacoesDePedido).toHaveLength(1);
  exigirSdkSimulado(sim);
  expect(errosNoFim().erros).toEqual([]);
});

test('cartão recusado → "Tentar outro cartão" → segundo cartão aprovado: dois envios, nunca ao mesmo tempo, PIX só depois da recusa', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sim = await instalarPagamentoSimulado(page);
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

  // A resposta da edge fica SEGURADA: a tela é olhada com o envio em voo.
  sim.portaoDaEdge.fechar();
  await page.getByTestId("cartao-simulado-pagar").click();
  await expect.poll(() => sim.portaoDaEdge.parados).toBe(1);
  await esperarTelaAssentar(page);
  await expect(pagarComPix).toHaveCount(0);
  expect(sim.contagemPorMetodo()).toEqual({ cartao: 1 });
  sim.portaoDaEdge.abrir();

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

  // Token de uso único: cada tentativa com o seu; nunca duas em voo.
  expect(sim.chamadasDoPagamento).toEqual([
    corpoDoCartao(pedido.id, "tok-simulado-1"),
    corpoDoCartao(pedido.id, "tok-simulado-2"),
  ]);
  expect(sim.contagemPorMetodo()).toEqual({ cartao: 2 });
  expect(sim.maximoDeCartoesEmVoo).toBe(1);
  expect(sim.criacoesDePedido).toHaveLength(1);
  exigirSdkSimulado(sim);
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
  const pedido = ultimoPedido(sim);
  await page.getByTestId("cartao-simulado-pagar").click();

  const quadro = page.getByTitle("Autenticação do seu banco");
  await expect(quadro).toBeVisible();
  await expect(quadro).toHaveAttribute("src", URL_DO_DESAFIO_3DS);
  const confirmando = page.getByText("Confirmando com o banco…");

  // Escuta do TESTE: prova que cada aviso CHEGOU à janela (ignorar é decisão
  // do app, não falta de entrega).
  await page.evaluate(() => {
    const lista: { origem: string; dados: unknown }[] = [];
    (window as unknown as { __recebidas: typeof lista }).__recebidas = lista;
    window.addEventListener("message", (evento) => {
      lista.push({ origem: evento.origin, dados: evento.data });
    });
  });
  const recebidas = () =>
    page.evaluate(
      () =>
        (
          window as unknown as {
            __recebidas: { origem: string; dados: unknown }[];
          }
        ).__recebidas,
    );

  // (a) "COMPLETE" vindo da PRÓPRIA página da loja: ignorado.
  await page.evaluate(() => {
    window.postMessage({ status: "COMPLETE" }, "*");
  });
  // (b) "COMPLETE" de um quadro cujo host IMITA o Mercado Pago, seguido de
  // uma SENTINELA do mesmo quadro (mesma fila de mensagens: quando ela chega,
  // o "COMPLETE" falso já passou pelo app).
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
  await quadroImpostor?.waitForLoadState("load");
  await quadroImpostor?.evaluate(() => {
    window.parent.postMessage({ status: "COMPLETE" }, "*");
    window.parent.postMessage({ sentinela: "impostor" }, "*");
  });
  await expect
    .poll(async () =>
      (await recebidas()).some(
        (m) => (m.dados as { sentinela?: string })?.sentinela === "impostor",
      ),
    )
    .toBe(true);
  await esperarTelaAssentar(page);
  const origemImpostora = new URL(URL_DE_ORIGEM_IMPOSTORA).origin;
  expect(await recebidas()).toEqual([
    { origem: "http://127.0.0.1:4173", dados: { status: "COMPLETE" } },
    { origem: origemImpostora, dados: { status: "COMPLETE" } },
    { origem: origemImpostora, dados: { sentinela: "impostor" } },
  ]);
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

  // A confirmação só CONSULTA: a chamada seguinte ao desafio é o `verificar`
  // do MESMO pedido (a cadência começa em 3 s) — nenhum cartão novo, nenhum
  // PIX.
  await expect
    .poll(() => sim.contarPagamentos("verificar"), { timeout: 15_000 })
    .toBe(1);
  expect(sim.chamadasDoPagamento).toEqual([
    corpoDoCartao(pedido.id, "tok-simulado-1"),
    { orderId: pedido.id, metodo: "verificar" },
  ]);
  expect(sim.terceirosAtendidos).toContain(URL_DO_DESAFIO_3DS);
  exigirSdkSimulado(sim);
  expect(errosNoFim().erros).toEqual([]);
});
