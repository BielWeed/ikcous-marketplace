import { type Locator, type Page, expect, test } from "@playwright/test";
import { ALTURA_DO_CABECALHO_DO_COMPUTADOR } from "../../src/components/desktop/medidas";
import {
  PRODUTO_ACESSORIOS,
  abrirLoja,
  exigirRedeSemImprevistos,
} from "./kit-jornadas";
import {
  WHATSAPP_FICTICIO,
  exigirCriacaoDoPedido,
  instalarPagamentoSimulado,
  respostaPixComQr,
  ultimoPedido,
} from "./pagamento-kit";

/**
 * JORNADA DO CHECKOUT NO COMPUTADOR (1280 x 720), até a tela do Pix.
 *
 * POR QUE EXISTE: desde a 1.5.188 o app tem desenho de computador (>= 1024 px:
 * cabeçalho fixo de 121 px no topo, resumo na coluna lateral, barra inferior do
 * celular escondida). O config das jornadas fixa 1023 px (a tela de "tablet
 * largo") para as jornadas antigas seguirem iguais — então NENHUMA jornada de
 * compra rodava a 1280 px, e um checkout quebrado no computador passaria em
 * silêncio. Esta é o alarme dessa lacuna.
 *
 * O QUE AFIRMA, a 1280 x 720: (1) a vitrine abre já no desenho de computador e
 * o produto entra no carrinho; (2) o carrinho mostra o resumo e o "Finalizar
 * Compra" da coluna lateral está ao alcance do clique, SEM barra inferior; (3)
 * o checkout leva ao Pix, e o "Finalizar pedido" e o "Copiar código Pix" estão
 * ao alcance.
 *
 * "AO ALCANCE" = rolando, se preciso, o botão cabe na janela, fica abaixo do
 * cabeçalho fixo e é o que o clique ATINGE no ponto central dele
 * (`elementFromPoint`) — não basta existir no DOM nem ter `boundingBox`: um
 * botão coberto pelo cabeçalho (ou por outra camada) tem as duas coisas e o
 * cliente não consegue tocar nele.
 *
 * O PAGAMENTO É SIMULADO (`pagamento-kit.ts`): banco, edge e Mercado Pago são
 * dublês, nada sai para a rede e nenhum dinheiro se move — o que o kit não
 * conhece derruba o teste no `afterEach`. NÃO prova a edge, o banco nem o
 * Mercado Pago reais; prova o que a TELA do computador faz.
 */

test.use({ viewport: { width: 1280, height: 720 } });

test.afterEach(exigirRedeSemImprevistos);

/**
 * Rola até o alvo (se preciso) e exige que ele esteja ao alcance do clique na
 * janela do computador. Devolve nada: falha com a medida na mensagem.
 */
async function exigirAoAlcance(alvo: Locator, nome: string): Promise<void> {
  await expect(alvo, `${nome}: visível`).toBeVisible({ timeout: 30_000 });
  await alvo.scrollIntoViewIfNeeded();
  // A barra do "Finalizar pedido" monta após 380 ms e entra deslizando por
  // ~250 ms: medir no meio do deslize daria vermelho falso. O clique de
  // ensaio (`trial`) só espera o botão ficar estável e receber eventos, sem
  // clicar. Se algo o cobre de verdade, a espera estoura e a medida abaixo
  // reporta o defeito com os números.
  await alvo.click({ trial: true, timeout: 5_000 }).catch(() => undefined);
  const medida = await alvo.evaluate((elemento) => {
    const caixa = elemento.getBoundingClientRect();
    const noCentro = document.elementFromPoint(
      caixa.x + caixa.width / 2,
      caixa.y + caixa.height / 2,
    );
    return {
      janela: { largura: innerWidth, altura: innerHeight },
      topo: caixa.top,
      base: caixa.bottom,
      esquerda: caixa.left,
      direita: caixa.right,
      altura: caixa.height,
      // O clique no centro cai no próprio botão (ou dentro dele).
      oCliqueAcertaNele: noCentro !== null && elemento.contains(noCentro),
    };
  });
  const detalhe = JSON.stringify(medida);
  expect(medida.janela, `${nome}: a janela tem de ser a de 1280 x 720`).toEqual(
    { largura: 1280, altura: 720 },
  );
  expect(medida.altura, `${nome}: com altura (${detalhe})`).toBeGreaterThan(0);
  expect(
    medida.topo,
    `${nome}: abaixo do cabeçalho fixo de ${ALTURA_DO_CABECALHO_DO_COMPUTADOR} px (${detalhe})`,
  ).toBeGreaterThanOrEqual(ALTURA_DO_CABECALHO_DO_COMPUTADOR);
  expect(
    medida.base,
    `${nome}: dentro da janela, embaixo (${detalhe})`,
  ).toBeLessThanOrEqual(medida.janela.altura);
  expect(
    medida.esquerda,
    `${nome}: dentro da janela, à esquerda (${detalhe})`,
  ).toBeGreaterThanOrEqual(0);
  expect(
    medida.direita,
    `${nome}: dentro da janela, à direita (${detalhe})`,
  ).toBeLessThanOrEqual(medida.janela.largura);
  expect(
    medida.oCliqueAcertaNele,
    `${nome}: o clique no centro acerta o botão, nada por cima (${detalhe})`,
  ).toBe(true);
}

/** A barra inferior do celular não existe no desenho de computador. */
async function exigirSemBarraInferiorDoCelular(page: Page): Promise<void> {
  await expect(
    page.getByRole("navigation", { name: "Navegação principal" }),
  ).toBeHidden();
}

test("COMPUTADOR 1280x720: da vitrine ao Pix, o botão de continuar fica ao alcance em cada passo e sem barra inferior", async ({
  page,
}) => {
  test.setTimeout(90_000);
  const sim = await instalarPagamentoSimulado(page);
  sim.responderPagamento = (corpo) =>
    corpo.metodo === "pix"
      ? respostaPixComQr(String(corpo.orderId))
      : { status: 500, corpo: { error: "método não previsto" } };

  const errosNoFim = await abrirLoja(page);

  // 1. Vitrine no desenho de computador: cabeçalho de topo no lugar da barra
  // inferior (se a largura caísse para o celular, esta jornada não provaria
  // nada — por isso o controle vem antes de tudo).
  await expect(
    page.getByRole("navigation", { name: "Navegação do computador" }),
  ).toBeVisible({ timeout: 30_000 });
  await exigirSemBarraInferiorDoCelular(page);

  // O Boné não tem variação: o botão do card adiciona direto ao carrinho.
  await page
    .locator("div.group")
    .filter({
      has: page.getByRole("button", { name: PRODUTO_ACESSORIOS, exact: true }),
    })
    .first()
    .getByTestId("product-card-action")
    .click();
  // O carrinho do cabeçalho passa a contar o item.
  const carrinhoDoCabecalho = page.getByRole("button", {
    name: "Carrinho, 1 item",
  });
  await expect(carrinhoDoCabecalho).toBeVisible({ timeout: 30_000 });

  // 2. Carrinho: o resumo está na coluna lateral e o "Finalizar Compra" dela
  // ao alcance. O rodapé fixo do celular não existe aqui.
  await carrinhoDoCabecalho.click();
  await expect(
    page.getByRole("heading", { name: "Resumo do Pedido" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("1 item selecionado")).toBeVisible();
  await expect(
    page
      .getByRole("tabpanel", { name: /Carrinho/ })
      .getByRole("heading", { name: PRODUTO_ACESSORIOS }),
  ).toBeVisible();
  await exigirSemBarraInferiorDoCelular(page);
  await expect(page.locator(".bottom-docked-navigation:visible")).toHaveCount(
    0,
  );
  const finalizarCompra = page.getByRole("button", {
    name: "Finalizar Compra",
  });
  await exigirAoAlcance(finalizarCompra, "Carrinho: Finalizar Compra");
  await expect(finalizarCompra).toBeEnabled();
  await finalizarCompra.click();

  // 3. Checkout: o perfil fixture não tem WhatsApp — número FICTÍCIO (sem ele
  // o "Finalizar pedido" fica apagado). Mesmos passos do kit de pagamento.
  await expect(page.getByText("Informe seu WhatsApp").first()).toBeVisible({
    timeout: 30_000,
  });
  await page.getByRole("button", { name: "Editar" }).first().click();
  await page
    .getByRole("textbox", { name: "WhatsApp para Contato" })
    .fill(WHATSAPP_FICTICIO);
  await expect(
    page.getByRole("region", { name: "Entrega e frete" }),
  ).toContainText("Entrega local", { timeout: 30_000 });

  const opcaoPix = page.getByRole("radio", { name: "Pagar agora com PIX" });
  await opcaoPix.click();
  await expect(opcaoPix).toHaveAttribute("aria-checked", "true");

  // O botão principal do checkout mora na coluna lateral do resumo.
  const finalizarPedido = page.getByRole("button", {
    name: "Finalizar pedido",
  });
  await expect(finalizarPedido).toBeEnabled({ timeout: 30_000 });
  await exigirAoAlcance(finalizarPedido, "Checkout: Finalizar pedido");
  await finalizarPedido.click();

  // 4. Pix: a tela de pagamento abre com o QR e a ação principal ("Copiar
  // código Pix") ao alcance. Não se copia nem se paga: o simulador só devolveu
  // a cobrança.
  await expect(
    page.getByRole("heading", { name: "Pagamento via Pix" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(page.getByAltText("QR code do Pix")).toBeVisible();
  await exigirAoAlcance(
    page.getByRole("button", { name: "Copiar código Pix" }),
    "Pix: Copiar código Pix",
  );
  await exigirSemBarraInferiorDoCelular(page);

  // Um pedido e uma cobrança Pix, simulados.
  exigirCriacaoDoPedido(sim);
  expect(sim.chamadasDoPagamento).toEqual([
    { orderId: ultimoPedido(sim).id, metodo: "pix" },
  ]);
  expect(errosNoFim().erros).toEqual([]);
});
