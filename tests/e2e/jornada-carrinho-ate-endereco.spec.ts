import { expect, test } from "@playwright/test";
import { PRODUTO_ROUPAS, abrirLoja, instalarLojaFixtura } from "./kit-jornadas";

/**
 * JORNADA (c) do despacho: do carrinho até o passo de endereço — LEITURA
 * PURA. Nada de dado real é preenchido e nada é cobrado: a ficha fixture
 * desliga o pagamento online (`pagamentoOnline: false`) e o teste PARA no
 * passo de endereço, sem tocar em nenhum botão de confirmar/pagar.
 */
test("carrinho chega ao passo de endereço sem preencher nada e sem cobrar", async ({
  page,
}) => {
  await instalarLojaFixtura(page);
  const errosNoFim = await abrirLoja(page);

  // Adiciona pela FOLHA DE OPÇÕES do card (a peça de interface que o dono
  // viveu redesenhando): escolhe opções, o CTA da folha entrega ao carrinho.
  // O card da Camiseta aparece 2x na home (carrossel + catálogo); qualquer
  // cópia abre a MESMA folha — o que importa é NÃO ser o card do Boné,
  // que não tem variação e o CTA dele adiciona direto.
  const cardDaCamiseta = page
    .locator("div.group")
    .filter({
      has: page.getByRole("button", { name: PRODUTO_ROUPAS, exact: true }),
    })
    .first();
  await cardDaCamiseta.getByTestId("product-card-action").click();
  const folha = page.getByTestId("product-card-options-sheet");
  await expect(folha).toBeVisible();
  await expect(
    folha.getByRole("heading", { name: PRODUTO_ROUPAS }),
  ).toBeVisible();
  await folha.getByRole("button", { name: "M", exact: true }).click();
  await page.getByTestId("product-card-options-add").click();
  // A folha é modal: o cliente fecha pela alça antes de navegar (e o
  // Radix bloqueia o resto da página enquanto ela está aberta).
  await folha.getByTestId("product-card-options-handle").click();
  await expect(folha).toBeHidden();

  // Carrinho: o item está lá, com o total de leitura (nada é confirmado).
  const navegacao = page.getByRole("navigation", {
    name: "Navegação principal",
  });
  await navegacao.getByRole("button", { name: /Carrinho/ }).click();
  await expect(
    page.getByRole("button", { name: "Finalizar Compra" }),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page
      .getByRole("tabpanel", { name: /Carrinho/ })
      .getByRole("heading", { name: PRODUTO_ROUPAS }),
  ).toBeVisible();

  // Avança para o checkout e PARA no passo de endereço.
  await page.getByRole("button", { name: "Finalizar Compra" }).click();
  await expect(page.getByText("Endereço de Entrega").first()).toBeVisible({
    timeout: 30_000,
  });

  // Leitura pura: pagamento online desligado na loja fixture — o passo de
  // pagamento só pode oferecer "Na entrega". Nenhum campo é preenchido,
  // nenhum botão de confirmar/pagar é tocado, e a tela NUNCA vira pedido.
  await expect(page.getByText("Na entrega").first()).toBeVisible();
  await expect(page.getByText("Pedido confirmado")).toHaveCount(0);

  expect(errosNoFim().erros).toEqual([]);
});
