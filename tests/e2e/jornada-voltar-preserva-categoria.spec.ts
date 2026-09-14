import { expect, test } from "@playwright/test";
import {
  CATEGORIA_ACESSORIOS,
  CATEGORIA_ROUPAS,
  PRODUTO_ACESSORIOS,
  PRODUTO_ROUPAS,
  abrirLoja,
  instalarLojaFixtura,
} from "./kit-jornadas";

/**
 * JORNADA (b) do despacho: escolher categoria, entrar no produto e VOLTAR —
 * a categoria sobrevive (classe de defeito Codex #459-#471). Voltar para a
 * home tem de restaurar o filtro pela URL (`/?category=…`, montado por
 * `caminhoDaHomeRef` em App.tsx) e a lista filtrada — não a home "de todas".
 */
test("voltar da tela do produto preserva a categoria escolhida", async ({
  page,
}) => {
  await instalarLojaFixtura(page);
  const errosNoFim = await abrirLoja(page);

  // Categoria escolhida na home.
  await page
    .getByRole("button", { name: `Selecionar categoria ${CATEGORIA_ROUPAS}` })
    .click();
  await expect(page).toHaveURL(/category=Roupas/);
  await expect(
    page.getByRole("button", { name: PRODUTO_ACESSORIOS, exact: true }),
  ).toHaveCount(0);

  // Entra no produto…
  await page.getByRole("button", { name: PRODUTO_ROUPAS, exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Adicionar ao Carrinho" }),
  ).toBeVisible({ timeout: 30_000 });

  // …e VOLTAR pelo histórico do navegador (popstate, o caminho que o app
  // trata em codex-fila-9): a categoria TEM de sobreviver.
  await page.goBack();
  await expect(page).toHaveURL(/category=Roupas/);
  await expect(
    page.getByRole("button", { name: PRODUTO_ROUPAS, exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: PRODUTO_ACESSORIOS, exact: true }),
  ).toHaveCount(0);

  // A lista volta a agir como lista filtrada: trocar de categoria ainda
  // funciona depois do vai-e-vem.
  await page
    .getByRole("button", {
      name: `Selecionar categoria ${CATEGORIA_ACESSORIOS}`,
    })
    .click();
  await expect(
    page.getByRole("button", { name: PRODUTO_ACESSORIOS, exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(/category=Acess%C3%B3rios/);

  expect(errosNoFim().erros).toEqual([]);
});
