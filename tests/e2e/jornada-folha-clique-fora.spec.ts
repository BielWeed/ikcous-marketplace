import { expect, test } from "@playwright/test";
import {
  PRODUTO_ROUPAS,
  abrirLoja,
  exigirRedeSemImprevistos,
  instalarLojaFixtura,
} from "./kit-jornadas";

// Guarda de rede (kit das jornadas): requisição não prevista derruba o
// teste, com a lista na mensagem.
test.afterEach(exigirRedeSemImprevistos);

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

// O gesto do DONO (relato pós-1.33.1, lojas Savy e IKCOUS): DEDO no celular,
// não mouse. `hasTouch` + `touchscreen.tap` disparam a sequência de toque de
// verdade (pointer events com pointerType=touch + hit-test do navegador) — é
// o caminho que o guardião do sheet.tsx cobre com regras próprias.
test.describe("toque de dedo real", () => {
  test.use({ hasTouch: true });

  test("toque num atalho do fundo só fecha a folha; o segundo toque navega", async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await instalarLojaFixtura(page);
    const errosNoFim = await abrirLoja(page);
    const url = page.url();
    await page.getByRole("button", { name: "Escolher opções" }).first().tap();
    const folha = page.locator('[data-slot="sheet-content"]');
    await expect(folha).toBeVisible();
    // Desde 24/11/2026 a folha abre do FUNDO e cobre a barra de navegação:
    // tocar no Carrinho cairia DENTRO da folha. O alvo do gesto passa a ser um
    // atalho do cabeçalho (Notificações), que fica ACIMA da folha — coberto só
    // pelo véu, e é nele que o dedo do dono cai ao tocar "fora". A folha entra
    // deslizando por baixo; o gesto que este teste prova vem depois dela parada.
    let ultimoY = Number.NaN;
    await expect
      .poll(
        async () => {
          const y = (await folha.boundingBox())?.y;
          const parou = y !== undefined && y === ultimoY;
          ultimoY = y ?? Number.NaN;
          return parou;
        },
        { intervals: [150], timeout: 5_000 },
      )
      .toBe(true);
    // Por seletor CSS e não por papel: com o diálogo modal aberto o Radix marca
    // o resto da página como aria-hidden e `getByRole` deixaria de achá-lo.
    const atalho = page.locator('button[aria-label="Notificações"]');
    const alvo = await atalho.boundingBox();
    expect(alvo).not.toBeNull();
    const toqueX = alvo!.x + alvo!.width / 2;
    const toqueY = alvo!.y + alvo!.height / 2;
    // O atalho está acima da folha, e o que o dedo encontra ali é o VÉU (não
    // o botão): sem esta checagem o teste passaria mesmo se o véu sumisse.
    const alvoDoToque = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        return {
          noVeu: el?.closest('[data-slot="sheet-overlay"]') != null,
          naFolha: el?.closest('[data-slot="sheet-content"]') != null,
        };
      },
      [toqueX, toqueY],
    );
    expect(alvoDoToque).toEqual({ noVeu: true, naFolha: false });
    // Coordenadas reais: com o diálogo modal, a área externa não é alvo
    // acionável do Playwright, mas o gesto físico tem que fechar a camada.
    await page.touchscreen.tap(toqueX, toqueY);
    await expect(folha).toHaveCount(0);
    expect(page.url()).toBe(url);
    // Segundo toque no MESMO atalho, já sem folha: agora navega.
    await atalho.tap();
    await expect(page).toHaveURL(/\/notifications$/);
    expect(errosNoFim().erros).toEqual([]);
  });

  test("folha de opções: TOQUE fora SÓ fecha — o fundo não navega", async ({
    page,
  }) => {
    await instalarLojaFixtura(page);
    const errosNoFim = await abrirLoja(page);

    await page.getByRole("button", { name: "Escolher opções" }).first().click();
    const folha = page.locator('[data-slot="sheet-content"]');
    await expect(folha).toBeVisible();

    const tamanho = page.viewportSize() ?? { width: 1280, height: 720 };
    await page.touchscreen.tap(
      Math.round(tamanho.width / 2),
      Math.round(tamanho.height * 0.2),
    );

    await expect(folha).toHaveCount(0, { timeout: 10_000 });
    expect(page.url()).not.toContain("product-detail");
    await expect(page.getByText(PRODUTO_ROUPAS).first()).toBeVisible();

    expect(errosNoFim().erros).toEqual([]);
  });
});
