import { expect, test } from "@playwright/test";
import { PRODUTO_ROUPAS, abrirLoja, instalarLojaFixtura } from "./kit-jornadas";

/**
 * JORNADA do GUARDIÃO do clique pós-fecho (relato do dono, 14/09): abrir a
 * folha de escolha de opções do CARD da vitrine e clicar FORA dela tem que
 * SÓ fechar a folha — JAMAIS navegar para a tela completa do produto.
 *
 * Por que E2E e não jsdom: o PADRAO-TESTES-OVERLAY é honesto — jsdom não faz
 * hit-test nem simula o browser; o atravessamento real ("o click do gesto
 * cai no que ficou por baixo e o onClick do card navega") só se prova com
 * mouse de verdade (pointer events completos + hit-test do navegador), que
 * é o que o `page.mouse.click` dispara aqui.
 *
 * Prova dupla: a URL NÃO muda (sem navegação para product-detail) e a folha
 * sai do documento (o fecho aconteceu).
 */
test("folha de opções: clicar fora SÓ fecha — o fundo não navega", async ({
  page,
}) => {
  await instalarLojaFixtura(page);
  const errosNoFim = await abrirLoja(page);

  // Abre a folha de opções pelo CARD (produto com variação obrigatória).
  await page.getByRole("button", { name: "Escolher opções" }).first().click();
  const folha = page.locator('[data-slot="sheet-content"]');
  await expect(folha).toBeVisible();

  // Gesto humano FORA da folha: mouse real no terço superior da tela — o véu
  // cobre tudo ali (z-130 acima do header z-100), é exatamente onde o dono
  // clicou. `page.mouse.click` dispara pointerdown/pointerup/click completos
  // e o hit-test do navegador decide o alvo — sem simulação.
  const tamanho = page.viewportSize() ?? { width: 1280, height: 720 };
  await page.mouse.click(
    Math.round(tamanho.width / 2),
    Math.round(tamanho.height * 0.2),
  );

  // O fecho aconteceu...
  await expect(folha).toHaveCount(0, { timeout: 10_000 });
  // ...e o fundo NÃO navegou para a tela completa do produto (o defeito).
  expect(page.url()).not.toContain("product-detail");
  // O catálogo continua na tela (a vitrine não saiu do lugar).
  await expect(page.getByText(PRODUTO_ROUPAS).first()).toBeVisible();

  expect(errosNoFim().erros).toEqual([]);
});
