import { expect, test } from "@playwright/test";
import { PRODUTO_ROUPAS, abrirLoja, instalarLojaFixtura } from "./kit-jornadas";

/**
 * JORNADA da FOLHA DE ESCOLHA até o carrinho (peça 18, pedido do dono
 * 14/09 ~17:58, ditado por voz): escolher a opção na folha, escolher a
 * QUANTIDADE e tocar "Adicionar" tem que
 *
 *   1. disparar o MESMO voo de bolinha do caminho do card
 *      (triggerFlyingCartAnimation — o container `.cart-flyer-container`
 *      nasce no body e voa até #bottom-nav-cart);
 *   2. FECHAR a folha sozinha depois do "Salvo!" (o dono revogou a decisão
 *      de 12/09 de nunca fechar);
 *   3. chegar ao carrinho com a quantidade ESCOLHIDA (3, não 1).
 *
 * Por que E2E e não jsdom: o voo é geometria de verdade (getBoundingClientRect
 * de origem e alvo) e o gesto é de DEDO — a lição de 14/09: o que está
 * provado em mouse não está provado em toque. Por isso o teste roda DUAS
 * vezes: mouse e `hasTouch` + `touchscreen.tap` (padrão do
 * jornada-folha-clique-fora.spec.ts).
 */

async function escolherEAdicionar(page: import("@playwright/test").Page) {
  const errosNoFim = await abrirLoja(page);

  // Abre a folha de opções pelo CARD (produto com variação obrigatória).
  await page.getByRole("button", { name: "Escolher opções" }).first().click();
  const folha = page.locator('[data-slot="sheet-content"]');
  await expect(folha).toBeVisible();

  // Escolhe a opção "P" (chip da folha).
  await folha.getByRole("button", { name: "P", exact: true }).click();

  // Sobe a quantidade para 3 com o seletor da folha (+ duas vezes).
  const mais = folha.getByRole("button", { name: "Aumentar quantidade" });
  await mais.click();
  await mais.click();

  // Adiciona — e o VOO nasce na hora: container do mesmo mecanismo do
  // caminho do card, no body, voando até o carrinho da barra de baixo.
  await page.getByRole("button", { name: /Adicionar/ }).click();
  await expect(page.locator(".cart-flyer-container")).toBeVisible();

  // A folha FECHA sozinha (batimento do "Salvo!" + deslizar para fora).
  await expect(folha).toHaveCount(0, { timeout: 10_000 });

  // A quantidade ESCOLHIDA chegou ao carrinho: o badge do carrinho da
  // barra de baixo soma 3.
  await expect(page.locator("#bottom-nav-cart")).toContainText("3");

  // O fecho pós-adicionar não navega: a vitrine continua no lugar.
  expect(page.url()).not.toContain("product-detail");
  await expect(page.getByText(PRODUTO_ROUPAS).first()).toBeVisible();

  expect(errosNoFim().erros).toEqual([]);
}

test("folha de opções: adicionar voa até o carrinho, fecha a folha e entrega a quantidade", async ({
  page,
}) => {
  await instalarLojaFixtura(page);
  await escolherEAdicionar(page);
});

test.describe("toque de dedo real", () => {
  test.use({ hasTouch: true });

  test("folha de opções com DEDO: adicionar voa, fecha e entrega a quantidade", async ({
    page,
  }) => {
    await instalarLojaFixtura(page);
    const errosNoFim = await abrirLoja(page);

    await page.getByRole("button", { name: "Escolher opções" }).first().tap();
    const folha = page.locator('[data-slot="sheet-content"]');
    await expect(folha).toBeVisible();

    await folha.getByRole("button", { name: "P", exact: true }).tap();
    const mais = folha.getByRole("button", { name: "Aumentar quantidade" });
    await mais.tap();
    await mais.tap();

    await page.getByRole("button", { name: /Adicionar/ }).tap();
    await expect(page.locator(".cart-flyer-container")).toBeVisible();

    await expect(folha).toHaveCount(0, { timeout: 10_000 });
    await expect(page.locator("#bottom-nav-cart")).toContainText("3");
    expect(page.url()).not.toContain("product-detail");
    await expect(page.getByText(PRODUTO_ROUPAS).first()).toBeVisible();

    expect(errosNoFim().erros).toEqual([]);
  });
});
