import { expect, test } from "@playwright/test";
import {
  PRODUTO_ACESSORIOS,
  abrirLoja,
  exigirRedeSemImprevistos,
} from "./kit-jornadas";
import { instalarPagamentoSimulado } from "./pagamento-kit";

test.use({ viewport: { width: 375, height: 812 } });
test.afterEach(exigirRedeSemImprevistos);

test("símbolo Pix tem pelo menos 24 px e cabe na opção de pagamento no celular", async ({
  page,
}) => {
  await instalarPagamentoSimulado(page);
  await abrirLoja(page);
  await page
    .locator("div.group")
    .filter({
      has: page.getByRole("button", { name: PRODUTO_ACESSORIOS, exact: true }),
    })
    .first()
    .getByTestId("product-card-action")
    .click();
  await page
    .getByRole("navigation", { name: "Navegação principal" })
    .getByRole("button", { name: /Carrinho/ })
    .click();
  await page.getByRole("button", { name: "Finalizar Compra" }).click();
  await expect(
    page.getByRole("region", { name: "Entrega e frete" }),
  ).toContainText("Entrega local", { timeout: 30_000 });
  expect(await page.evaluate(() => innerWidth)).toBe(375);

  for (const nome of ["Pagar agora com PIX", "Pix na Entrega"]) {
    const opcao = page.getByRole("radio", { name: nome });
    const glifo = opcao.locator("svg[fill='currentColor']");
    await expect(glifo).toBeVisible();
    const svg = await glifo.boundingBox();
    const desenho = await glifo.locator("path").boundingBox();
    const cartao = await opcao.evaluate(({ clientWidth, scrollWidth }) => ({
      clientWidth,
      scrollWidth,
    }));

    console.log(nome, {
      svg: svg?.width,
      desenho: desenho?.width,
      ...cartao,
    });
    expect(svg?.width).toBeGreaterThanOrEqual(24);
    expect(desenho?.width).toBeGreaterThanOrEqual(24);
    expect(cartao.scrollWidth).toBeLessThanOrEqual(cartao.clientWidth);
  }
});
