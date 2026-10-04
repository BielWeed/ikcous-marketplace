import { type Page, expect, test } from "@playwright/test";
import {
  CODIGO_PIX_SIMULADO,
  type SimuladorDePagamento,
  abrirLojaEFinalizar,
  instalarPagamentoSimulado,
  respostaIndisponivel503,
  respostaPixComQr,
  ultimoPedido,
} from "./pagamento-kit";

/**
 * JORNADAS DO PIX PELO APP no navegador de verdade (04/10/2026), contra o
 * SIMULADOR do `pagamento-kit.ts` (banco, edge `criar-pagamento` e Mercado
 * Pago são dublês; nada sai para a rede).
 *
 * AFIRMAM: o que a tela mostra (QR, copiar, erro passageiro, confirmação) e
 * quantas vezes ela cria pedido e cobrança. NÃO provam: a edge real (a
 * reconsulta da MESMA cobrança no "Tentar de novo" é contrato DELA), o banco
 * real (a chave de idempotência da RPC) nem o Mercado Pago real.
 */

test.use({
  serviceWorkers: "block",
  // O botão "Copiar código PIX" usa a área de transferência de verdade.
  permissions: ["clipboard-read", "clipboard-write"],
});

function exigirNadaNaoPrevisto(sim: SimuladorDePagamento) {
  expect(sim.naoPrevistas, "requisição a origem não prevista").toEqual([]);
}

async function esperarQrDoPix(page: Page) {
  await expect(
    page.getByRole("heading", { name: "Pagamento via Pix" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByAltText("QR code do PIX")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copiar código PIX" }),
  ).toBeVisible();
}

test("PIX: QR e copiar aparecem, a confirmação vem quando o banco vira pago, e recarregar a página não cobra de novo", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sim = await instalarPagamentoSimulado(page);
  sim.responderPagamento = (corpo) =>
    corpo.metodo === "pix"
      ? respostaPixComQr(String(corpo.orderId))
      : { status: 500, corpo: { error: "método não previsto" } };

  const errosNoFim = await abrirLojaEFinalizar(page, "pix");
  await esperarQrDoPix(page);
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
  // periódica (10 s; o realtime do kit é mudo) troca o QR pela confirmação.
  sim.marcarPago(pedido.id);
  await expect(
    page.getByRole("heading", { name: "Pagamento Confirmado!" }),
  ).toBeVisible({ timeout: 15_000 });
  await expect(page.getByAltText("QR code do PIX")).toHaveCount(0);

  // Recarregar a aba: nenhum pedido novo, nenhuma cobrança nova. (O que a
  // tela mostra depois do recarregar NÃO é afirmado aqui — ver o relatório
  // da frente: o checkout volta vazio e a retomada é por Meus pedidos.)
  await page.reload();
  await expect(page.locator("#root")).not.toBeEmpty({ timeout: 30_000 });
  await page.waitForTimeout(2_000);
  expect(sim.contarPagamentos("pix")).toBe(1);
  expect(sim.contarPagamentos("cartao")).toBe(0);
  expect(sim.criacoesDePedido).toHaveLength(1);

  exigirNadaNaoPrevisto(sim);
  expect(errosNoFim().erros).toEqual([]);
});

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
  // Erro na tela não repete sozinho: uma chamada só até o toque.
  await page.waitForTimeout(1_000);
  expect(sim.contarPagamentos("pix")).toBe(1);

  await tentarDeNovo.click();
  await esperarQrDoPix(page);
  await expect(page.getByText("Pagamento indisponível.")).toHaveCount(0);

  const pedido = ultimoPedido(sim);
  expect(sim.chamadasDoPagamento).toEqual([
    { orderId: pedido.id, metodo: "pix" },
    { orderId: pedido.id, metodo: "pix" },
  ]);
  expect(sim.criacoesDePedido).toHaveLength(1);
  exigirNadaNaoPrevisto(sim);
  expect(errosNoFim().erros).toEqual([]);
});

test.describe("clique duplo no Finalizar cria UM pedido só", () => {
  // A criação demora (1,5 s) para o segundo clique cair com a primeira em voo.
  const ATRASO_DA_CRIACAO_MS = 1_500;

  test("duplo clique do mouse: uma chamada à RPC de criação e uma cobrança PIX", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const sim = await instalarPagamentoSimulado(page);
    sim.atrasoDaCriacaoMs = ATRASO_DA_CRIACAO_MS;
    sim.responderPagamento = (corpo) => respostaPixComQr(String(corpo.orderId));

    const errosNoFim = await abrirLojaEFinalizar(page, "pix", {
      cliqueDuplo: true,
    });
    await esperarQrDoPix(page);

    expect(sim.criacoesDePedido.map((c) => c.rpc)).toEqual([
      "create_marketplace_order_v24",
    ]);
    expect(sim.contarPagamentos("pix")).toBe(1);
    exigirNadaNaoPrevisto(sim);
    expect(errosNoFim().erros).toEqual([]);
  });

  test("dois cliques no MESMO tique (antes de o React redesenhar o botão): ainda uma chamada só", async ({
    page,
  }) => {
    test.setTimeout(90_000);
    const sim = await instalarPagamentoSimulado(page);
    sim.atrasoDaCriacaoMs = ATRASO_DA_CRIACAO_MS;
    sim.responderPagamento = (corpo) => respostaPixComQr(String(corpo.orderId));

    // `abrirLojaEFinalizar` com um clique só NÃO serve aqui: o clique é
    // disparado à mão, duas vezes, dentro da mesma tarefa do navegador —
    // o botão ainda está habilitado no segundo, e só a trava síncrona do
    // envio segura.
    const errosNoFim = await abrirLojaEFinalizar(page, "pix", {
      semClicar: true,
    });
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
    await esperarQrDoPix(page);

    expect(sim.criacoesDePedido.map((c) => c.rpc)).toEqual([
      "create_marketplace_order_v24",
    ]);
    expect(sim.contarPagamentos("pix")).toBe(1);
    exigirNadaNaoPrevisto(sim);
    expect(errosNoFim().erros).toEqual([]);
  });
});
