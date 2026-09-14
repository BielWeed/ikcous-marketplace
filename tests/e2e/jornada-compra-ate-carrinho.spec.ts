import { expect, test } from "@playwright/test";
import {
  CATEGORIA_ROUPAS,
  PRODUTO_ACESSORIOS,
  PRODUTO_ROUPAS,
  abrirLoja,
  instalarLojaFixtura,
} from "./kit-jornadas";

/**
 * JORNADA (a) do despacho: home → categoria → produto → adicionar ao
 * carrinho. Prova no navegador de verdade o caminho que o cliente faz, com
 * catálogo sintético (nada de dado real, nada de rede externa).
 */
test("compra: categoria filtra, tela do produto abre e o item chega ao carrinho", async ({
  page,
}) => {
  await instalarLojaFixtura(page);
  const errosNoFim = await abrirLoja(page);

  // 1. Home → categoria: o chip filtra o catálogo de verdade.
  await page
    .getByRole("button", { name: `Selecionar categoria ${CATEGORIA_ROUPAS}` })
    .click();
  await expect(page.getByText(PRODUTO_ROUPAS).first()).toBeVisible();
  // O produto da OUTRA categoria sai da lista (o nome no card é um botão).
  await expect(
    page.getByRole("button", { name: PRODUTO_ACESSORIOS, exact: true }),
  ).toHaveCount(0);
  await expect(page).toHaveURL(/category=Roupas/);

  // 2. Categoria → produto: entrar na tela do produto pelo nome no card.
  await page.getByRole("button", { name: PRODUTO_ROUPAS, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Adicionar ao Carrinho" }),
  ).toBeVisible({ timeout: 30_000 });

  // 3. Produto: escolher a variação obrigatória — a tela recusa comprar sem
  // escolher (tests/front/card-nao-deixa-comprar-sem-escolher-a-variacao).
  await page.getByRole("button", { name: "M (5 un.)" }).click();
  await page.getByRole("button", { name: "Adicionar ao Carrinho" }).click();

  // 4. Item no carrinho, pela navegação de baixo (como o cliente faz).
  const navegacao = page.getByRole("navigation", {
    name: "Navegação principal",
  });
  await navegacao.getByRole("button", { name: /Carrinho/ }).click();
  await expect(
    page.getByRole("button", { name: "Finalizar Compra" }),
  ).toBeVisible({ timeout: 30_000 });
  // O item está no painel do carrinho (a home oculta no DOM não engana o
  // papel acessível do painel).
  await expect(
    page
      .getByRole("tabpanel", { name: /Carrinho/ })
      .getByRole("heading", { name: PRODUTO_ROUPAS }),
  ).toBeVisible();

  expect(errosNoFim().erros).toEqual([]);
});
