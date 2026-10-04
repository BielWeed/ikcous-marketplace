import { type Page, expect, test } from "@playwright/test";
import { numeroDoPedido } from "../../src/lib/numero-do-pedido";
import { exigirRedeSemImprevistos } from "./kit-jornadas";
import {
  CODIGO_PIX_SIMULADO,
  abrirLojaEFinalizar,
  esperarTelaAssentar,
  exigirCriacaoDoPedido,
  instalarPagamentoSimulado,
  respostaIndisponivel503,
  respostaPixComQr,
  ultimoPedido,
} from "./pagamento-kit";

/**
 * JORNADAS DO PIX PELO APP no navegador de verdade (04/10/2026), contra o
 * SIMULADOR do `pagamento-kit.ts` (banco, edge `criar-pagamento` e Mercado
 * Pago são dublês; nada sai para a rede; o que não tem stub derruba o teste
 * no `afterEach`).
 *
 * AFIRMAM: o que a tela mostra (QR, copiar, erro passageiro, confirmação) e
 * quantas vezes ela cria pedido e cobrança, com o corpo exato. NÃO provam: a
 * edge real (a reconsulta da MESMA cobrança no "Tentar de novo" é contrato
 * DELA), o banco real (a chave de idempotência da RPC) nem o Mercado Pago
 * real.
 */

test.use({
  // O botão "Copiar código PIX" usa a área de transferência de verdade.
  permissions: ["clipboard-read", "clipboard-write"],
});

test.afterEach(exigirRedeSemImprevistos);

async function esperarQrDoPix(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Pagamento via Pix" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByAltText("QR code do PIX")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copiar código PIX" }),
  ).toBeVisible();
}

test("PIX: QR e copiar aparecem, e a confirmação vem quando o banco vira pago — uma cobrança só", async ({
  page,
}) => {
  // 10 s é o intervalo da verificação periódica da tela (contrato do
  // CheckoutView): a confirmação chega na leitura seguinte ao "pago".
  test.setTimeout(90_000);
  const sim = await instalarPagamentoSimulado(page);
  sim.responderPagamento = (corpo) =>
    corpo.metodo === "pix"
      ? respostaPixComQr(String(corpo.orderId))
      : { status: 500, corpo: { error: "método não previsto" } };

  const errosNoFim = await abrirLojaEFinalizar(page, "pix");
  await esperarQrDoPix(page);
  exigirCriacaoDoPedido(sim);
  const pedido = ultimoPedido(sim);
  expect(sim.chamadasDoPagamento).toEqual([
    { orderId: pedido.id, metodo: "pix" },
  ]);

  // Copiar: o código vai MESMO para a área de transferência.
  await page.getByRole("button", { name: "Copiar código PIX" }).click();
  await expect(
    page.getByRole("button", { name: "Copiado! Cole no app do seu banco" }),
  ).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
    CODIGO_PIX_SIMULADO,
  );

  // O "webhook" confirma: o banco simulado passa a pago e a verificação
  // periódica (o realtime do kit é mudo) troca o QR pela confirmação.
  sim.marcarPago(pedido.id);
  await expect(
    page.getByRole("heading", { name: "Pagamento Confirmado!" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByAltText("QR code do PIX")).toHaveCount(0);

  expect(sim.chamadasDoPagamento).toEqual([
    { orderId: pedido.id, metodo: "pix" },
  ]);
  expect(sim.contagemPorMetodo()).toEqual({ pix: 1 });
  expect(sim.criacoesDePedido).toHaveLength(1);
  expect(errosNoFim().erros).toEqual([]);
});

// CONTRATO da retomada na recarga (src/lib/pedido-pendente-do-checkout.ts +
// App.tsx): antes dela, recarregar a aba com o PIX pendente perdia o pedido
// (`checkoutRetomadaId` voltava a `null` e o cliente caía num checkout vazio,
// sem QR). Controle medido em 04/10/2026: no build de 4a882a7b (sem a
// retomada) esta jornada FALHA em "QR code do PIX" depois do reload; com a
// retomada, passa.
test(
  "PIX PENDENTE + recarregar a aba: retoma o MESMO pedido e o MESMO QR, lido do servidor, sem criar pedido nem cobrança nova",
  async ({ page }) => {
    test.setTimeout(90_000);
    const sim = await instalarPagamentoSimulado(page);
    // A edge simulada RECONSULTA: a mesma cobrança (mesmo paymentId e QR) para
    // o mesmo pedido, quantas vezes for perguntada — nunca uma segunda.
    const cobrancaPorPedido = new Map<
      string,
      ReturnType<typeof respostaPixComQr>
    >();
    sim.responderPagamento = (corpo) => {
      if (corpo.metodo !== "pix") {
        return { status: 500, corpo: { error: "método não previsto" } };
      }
      const orderId = String(corpo.orderId);
      const existente = cobrancaPorPedido.get(orderId);
      if (existente) return existente;
      const nova = respostaPixComQr(orderId);
      cobrancaPorPedido.set(orderId, nova);
      const pedido = sim.pedidos.get(orderId);
      if (pedido) {
        pedido.metodo_online = "pix";
        pedido.gateway_payment_id = (
          nova.corpo as { paymentId: string }
        ).paymentId;
      }
      return nova;
    };

    const errosNoFim = await abrirLojaEFinalizar(page, "pix");
    await esperarQrDoPix(page);
    exigirCriacaoDoPedido(sim);
    const pedido = ultimoPedido(sim);
    const qrAntes = await page
      .getByAltText("QR code do PIX")
      .getAttribute("src");

    // Marca da conversa com a edge ANTES de recarregar: o que vier depois dela
    // é a tela PERGUNTANDO ao servidor (o QR vem da edge, não de memória
    // do navegador).
    const antes = sim.chamadasDoPagamento.length;
    await page.reload();
    // Depois de recarregar: a MESMA tela de PIX do MESMO pedido.
    await esperarQrDoPix(page);
    await expect(
      page.getByText(`Pedido #${numeroDoPedido(pedido.id)}`),
    ).toBeVisible();
    expect(await page.getByAltText("QR code do PIX").getAttribute("src")).toBe(
      qrAntes,
    );
    await expect(page.getByText(CODIGO_PIX_SIMULADO)).toBeVisible();

    // Depois do reload a tela PERGUNTOU ao servidor, uma vez, pelo MESMO
    // pedido (nada de QR lembrado do lado do navegador).
    expect(sim.chamadasDoPagamento.slice(antes)).toEqual([
      { orderId: pedido.id, metodo: "pix" },
    ]);
    // 1 pedido, 0 criação nova; toda pergunta à edge é do MESMO pedido e
    // devolveu a MESMA cobrança.
    expect(sim.pedidos.size).toBe(1);
    expect(sim.criacoesDePedido).toHaveLength(1);
    expect(sim.chamadasDoPagamento.every((c) => c.orderId === pedido.id)).toBe(
      true,
    );
    expect(sim.contagemPorMetodo()).toEqual({
      pix: sim.chamadasDoPagamento.length,
    });
    expect(cobrancaPorPedido.size).toBe(1);
    expect(errosNoFim().erros).toEqual([]);
  },
);

test('PIX com 503 passageiro (terminal: true): a tela oferece "Tentar de novo" e a segunda chamada traz o QR', async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sim = await instalarPagamentoSimulado(page);
  sim.responderPagamento = (corpo) => {
    if (corpo.metodo !== "pix") {
      return { status: 500, corpo: { error: "método não previsto" } };
    }
    return sim.contarPagamentos("pix") === 1
      ? respostaIndisponivel503()
      : respostaPixComQr(String(corpo.orderId));
  };

  const errosNoFim = await abrirLojaEFinalizar(page, "pix");
  await expect(page.getByText("Pagamento indisponível.")).toBeVisible({
    timeout: 30_000,
  });
  const tentarDeNovo = page.getByRole("button", { name: "Tentar de novo" });
  await expect(tentarDeNovo).toBeVisible();
  // Erro na tela não repete sozinho: com a tela assentada, UMA chamada só.
  await esperarTelaAssentar(page);
  const pedido = ultimoPedido(sim);
  expect(sim.chamadasDoPagamento).toEqual([
    { orderId: pedido.id, metodo: "pix" },
  ]);

  await tentarDeNovo.click();
  await esperarQrDoPix(page);
  await expect(page.getByText("Pagamento indisponível.")).toHaveCount(0);

  expect(sim.chamadasDoPagamento).toEqual([
    { orderId: pedido.id, metodo: "pix" },
    { orderId: pedido.id, metodo: "pix" },
  ]);
  expect(sim.contagemPorMetodo()).toEqual({ pix: 2 });
  exigirCriacaoDoPedido(sim);
  expect(errosNoFim().erros).toEqual([]);
});

test.describe("clique duplo no Finalizar cria UM pedido só", () => {
  test("duplo clique do mouse com a criação em voo: uma chamada à RPC de criação e uma cobrança PIX", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const sim = await instalarPagamentoSimulado(page);
    sim.responderPagamento = (corpo) => respostaPixComQr(String(corpo.orderId));

    const errosNoFim = await abrirLojaEFinalizar(page, "pix", {
      semClicar: true,
    });
    // A resposta da criação fica SEGURADA: o segundo clique cai com a
    // primeira criação comprovadamente em voo.
    sim.portaoDaCriacao.fechar();
    await page.getByRole("button", { name: "Finalizar pedido" }).dblclick();
    await expect.poll(() => sim.portaoDaCriacao.parados).toBe(1);
    await esperarTelaAssentar(page);
    expect(sim.criacoesDePedido).toHaveLength(1);
    sim.portaoDaCriacao.abrir();

    await esperarQrDoPix(page);
    exigirCriacaoDoPedido(sim);
    expect(sim.chamadasDoPagamento).toEqual([
      { orderId: ultimoPedido(sim).id, metodo: "pix" },
    ]);
    expect(errosNoFim().erros).toEqual([]);
  });

  test("dois cliques no MESMO tique (antes de o React redesenhar o botão): ainda uma chamada só", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const sim = await instalarPagamentoSimulado(page);
    sim.responderPagamento = (corpo) => respostaPixComQr(String(corpo.orderId));

    // O clique é disparado à mão, duas vezes, dentro da mesma tarefa do
    // navegador — o botão ainda está habilitado no segundo, e só a trava
    // síncrona do envio segura.
    const errosNoFim = await abrirLojaEFinalizar(page, "pix", {
      semClicar: true,
    });
    sim.portaoDaCriacao.fechar();
    const botaoHabilitadoEmCadaClique = await page
      .getByRole("button", { name: "Finalizar pedido" })
      .evaluate((botao: HTMLButtonElement) => {
        // Controle: os DOIS cliques chegam ao botão ainda HABILITADO — o
        // segundo não é barrado pelo `disabled`, só pela trava do envio.
        const habilitado: boolean[] = [];
        const anotar = (evento: Event) => {
          if (evento.target === botao || botao.contains(evento.target as Node))
            habilitado.push(!botao.disabled);
        };
        document.addEventListener("click", anotar, true);
        botao.click();
        botao.click();
        document.removeEventListener("click", anotar, true);
        return habilitado;
      });
    expect(botaoHabilitadoEmCadaClique).toEqual([true, true]);
    await expect.poll(() => sim.portaoDaCriacao.parados).toBe(1);
    await esperarTelaAssentar(page);
    expect(sim.criacoesDePedido).toHaveLength(1);
    sim.portaoDaCriacao.abrir();

    await esperarQrDoPix(page);
    exigirCriacaoDoPedido(sim);
    expect(sim.chamadasDoPagamento).toEqual([
      { orderId: ultimoPedido(sim).id, metodo: "pix" },
    ]);
    expect(errosNoFim().erros).toEqual([]);
  });
});
