import { devices, expect, test } from "@playwright/test";
import {
  PRODUTO_ACESSORIOS,
  abrirLoja,
  enderecosFixtura,
  exigirRedeSemImprevistos,
  instalarLojaFixtura,
  instalarSessaoClienteFixtura,
} from "./kit-jornadas";
import { esperarTelaAssentar } from "./pagamento-kit";

// Guarda de rede (kit das jornadas): requisição não prevista derruba o
// teste, com a lista na mensagem.
test.afterEach(exigirRedeSemImprevistos);

/**
 * JORNADA "A BARRA DE BAIXO DO CHECKOUT NÃO PULA COM O FRETE" NO CELULAR
 * (22/10/2026, relato do dono no celular real): ao abrir "Finalizar pedido",
 * a barra fixa subia para mostrar uma linha vermelha "Calculando o frete…" e
 * encolhia quando o frete ficava pronto — a página pulava junto, porque a
 * altura da barra é o espaço reservado no fim da página
 * (`--customer-footer-height`, `src/lib/medir-rodape-cliente.ts`).
 *
 * O jsdom não faz layout: só o navegador de verdade mede. A edge
 * `calculate-shipping` responde 1,5 s atrasada (o frete fica "cotando" tempo
 * suficiente para a medida), e a jornada afirma que a ALTURA DA BARRA e o
 * valor de `--customer-footer-height` são IGUAIS com o frete cotando e depois
 * de pronto. Cliente logado FALSO, endereços e cotação inventados (kit);
 * nada é gravado nem cobrado.
 */

test.use({ ...devices["Pixel 5"], viewport: { width: 390, height: 844 } });

const ATRASO_DA_EDGE_DE_FRETE_MS = 1500;

test("a barra de baixo tem a mesma altura (e o mesmo espaço reservado) com o frete cotando e depois de pronto", async ({
  page,
}) => {
  await instalarLojaFixtura(page);
  await instalarSessaoClienteFixtura(page, {
    enderecos: enderecosFixtura(1),
  });
  // Registrada DEPOIS das rotas do kit: o Playwright roda a última primeiro, e
  // o `fallback()` devolve a resposta ao stub de cotação do próprio kit.
  await page.route("**/functions/v1/calculate-shipping", async (rota) => {
    await new Promise((resolver) =>
      setTimeout(resolver, ATRASO_DA_EDGE_DE_FRETE_MS),
    );
    await rota.fallback();
  });
  const errosNoFim = await abrirLoja(page);

  // Boné no carrinho, e o carrinho já com o frete cotado: assim o checkout
  // monta a calculadora de novo e espera a edge confirmar a cotação.
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
  await expect(page.getByText("Entrega local").first()).toBeVisible({
    timeout: 30_000,
  });
  // No celular o rodapé fixo do carrinho diz só "Finalizar".
  await page.getByRole("button", { name: /^Finalizar/ }).click();

  const botao = page.getByRole("button", { name: "Finalizar pedido" });
  const barra = page
    .locator(".bottom-docked-navigation")
    .filter({ has: botao });
  const valores = barra.getByRole("group", { name: "Valores do pedido" });
  await expect(botao).toBeVisible({ timeout: 30_000 });

  const medir = async () => {
    await esperarTelaAssentar(page);
    return page.evaluate(() => {
      const barraDoBotao = Array.from(
        document.querySelectorAll<HTMLElement>(".bottom-docked-navigation"),
      ).find((e) => e.querySelector('button[aria-label="Finalizar pedido"]'));
      return {
        alturaDaBarra: barraDoBotao?.getBoundingClientRect().height ?? -1,
        espacoReservado: getComputedStyle(
          document.documentElement,
        ).getPropertyValue("--customer-footer-height"),
      };
    });
  };

  // COTANDO: o texto cinza está na linha Entrega e o botão segue apagado.
  await expect(valores).toContainText("Calculando…", { timeout: 15_000 });
  await expect(botao).toBeDisabled();
  const cotando = await medir();

  // PRONTO: o frete local de R$ 10 chega e o texto da espera sai.
  await expect(valores).not.toContainText("Calculando…", { timeout: 30_000 });
  await expect(valores).toContainText("R$ 10,00");
  const pronto = await medir();

  expect(cotando.alturaDaBarra).toBeGreaterThan(0);
  expect(pronto.alturaDaBarra).toBe(cotando.alturaDaBarra);
  expect(cotando.espacoReservado).not.toBe("");
  expect(pronto.espacoReservado).toBe(cotando.espacoReservado);

  expect(errosNoFim().erros).toEqual([]);
});
