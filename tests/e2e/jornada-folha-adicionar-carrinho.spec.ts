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
 * JORNADA da FOLHA DE ESCOLHA até o carrinho (peça 18, pedido do dono
 * 14/09 ~17:58, ditado por voz): escolher a opção na folha, escolher a
 * QUANTIDADE e tocar "Adicionar" tem que
 *
 *   1. FECHAR a folha sozinha depois do "Salvo!" (o dono revogou a decisão
 *      de 12/09 de nunca fechar);
 *   2. soltar o voo de bolinha SÓ QUANDO a folha já saiu (14/10/2026): com
 *      a folha aberta a bolinha boiava sobre o conteúdo dela e seguia para
 *      um carrinho que a própria folha cobre. Agora ela nasce da foto do
 *      CARD, que fica visível ao fundo — o MESMO mecanismo do caminho do
 *      card (triggerFlyingCartAnimation: o container `.cart-flyer-container`
 *      nasce no body e voa até #bottom-nav-cart, que "pula" no fim);
 *   3. chegar ao carrinho com a quantidade ESCOLHIDA (3, não 1).
 *
 * Por que E2E e não jsdom: o voo é geometria de verdade (getBoundingClientRect
 * de origem e alvo) e o gesto é de DEDO — a lição de 14/09: o que está
 * provado em mouse não está provado em toque. Por isso o teste roda DUAS
 * vezes: mouse e `hasTouch` + `touchscreen.tap` (padrão do
 * jornada-folha-clique-fora.spec.ts).
 */

type Page = import("@playwright/test").Page;

type RegistroDoVoo = {
  /** a bolinha (`.cart-flyer-container`) já entrou no body */
  nasceu: boolean;
  /** havia folha de escolha no DOM no instante em que ela nasceu */
  folhaNoDomAoNascer: boolean | null;
  /** o container saiu do body (o voo de 0,75 s terminou) */
  saiu: boolean;
  /** o carrinho da barra de baixo recebeu `cart-pop` (a bolinha chegou) */
  chegouNoCarrinho: boolean;
};

/**
 * A bolinha vive 0,75 s: consultar "está visível?" depois do fato pode perder
 * a janela. Este observador, plantado ANTES do toque, anota no próprio
 * navegador quando ela nasceu, se a folha ainda estava na tela nesse
 * instante, quando saiu e se o carrinho "pulou" no fim.
 */
async function vigiarVoo(page: Page) {
  await page.evaluate(() => {
    const registro: RegistroDoVoo = {
      nasceu: false,
      folhaNoDomAoNascer: null,
      saiu: false,
      chegouNoCarrinho: false,
    };
    (window as unknown as { __voo: RegistroDoVoo }).__voo = registro;
    const ehVoo = (no: Node) =>
      no instanceof HTMLElement &&
      no.classList.contains("cart-flyer-container");
    new MutationObserver((mudancas) => {
      for (const mudanca of mudancas) {
        for (const no of Array.from(mudanca.addedNodes)) {
          if (!ehVoo(no)) continue;
          registro.nasceu = true;
          registro.folhaNoDomAoNascer =
            document.querySelector('[data-slot="sheet-content"]') !== null;
        }
        for (const no of Array.from(mudanca.removedNodes)) {
          if (ehVoo(no)) registro.saiu = true;
        }
      }
    }).observe(document.body, { childList: true });
    const carrinho = document.getElementById("bottom-nav-cart");
    if (carrinho) {
      new MutationObserver(() => {
        if (carrinho.classList.contains("cart-pop")) {
          registro.chegouNoCarrinho = true;
        }
      }).observe(carrinho, { attributes: true, attributeFilter: ["class"] });
    }
  });
}

const lerVoo = (page: Page) =>
  page.evaluate(() => (window as unknown as { __voo: RegistroDoVoo }).__voo);

/**
 * O contrato do voo, na ordem em que a cliente vê: com a folha ABERTA
 * ("Salvando..." e "Salvo!") não existe bolinha; quando a folha SAI a bolinha
 * nasce, já sem folha no DOM, voa e termina no carrinho.
 */
async function exigirVooSoDepoisDaFolha(
  page: Page,
  folha: import("@playwright/test").Locator,
) {
  // Folha ainda aberta (o toque acabou de acontecer): nenhuma bolinha.
  await expect(folha).toBeVisible();
  await expect(page.locator(".cart-flyer-container")).toHaveCount(0);
  expect((await lerVoo(page)).nasceu).toBe(false);

  // A folha FECHA sozinha (batimento do "Salvo!" + deslizar para fora).
  await expect(folha).toHaveCount(0, { timeout: 10_000 });

  // Agora sim a bolinha: nasceu com a folha já fora do DOM, saiu ao fim do
  // voo e o carrinho da barra de baixo "pulou" ao recebê-la.
  await expect
    .poll(async () => (await lerVoo(page)).nasceu, { timeout: 5_000 })
    .toBe(true);
  await expect
    .poll(async () => await lerVoo(page), { timeout: 5_000 })
    .toMatchObject({
      folhaNoDomAoNascer: false,
      saiu: true,
      chegouNoCarrinho: true,
    });
}

async function escolherEAdicionar(page: Page) {
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

  // Adiciona — o VOO só nasce quando a folha SAI (a bolinha parte da foto do
  // CARD, não da folha): com a folha aberta não existe bolinha; depois que
  // ela fecha a bolinha nasce, voa e termina no carrinho da barra de baixo.
  await vigiarVoo(page);
  await page.getByRole("button", { name: /Adicionar/ }).click();
  await exigirVooSoDepoisDaFolha(page, folha);

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

    await vigiarVoo(page);
    await page.getByRole("button", { name: /Adicionar/ }).tap();
    await exigirVooSoDepoisDaFolha(page, folha);

    await expect(page.locator("#bottom-nav-cart")).toContainText("3");
    expect(page.url()).not.toContain("product-detail");
    await expect(page.getByText(PRODUTO_ROUPAS).first()).toBeVisible();

    expect(errosNoFim().erros).toEqual([]);
  });
});
