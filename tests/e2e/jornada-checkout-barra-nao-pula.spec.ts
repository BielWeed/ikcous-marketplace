import { type Page, devices, expect, test } from "@playwright/test";
import {
  PRODUTO_ACESSORIOS,
  abrirLoja,
  enderecosFixtura,
  exigirRedeSemImprevistos,
  instalarLojaFixtura,
  instalarSessaoClienteFixtura,
  linhaConfig,
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
 * `calculate-shipping` responde atrasada (o frete fica "cotando" tempo
 * suficiente para a medida), e a jornada afirma que a ALTURA DA BARRA e o
 * valor de `--customer-footer-height` são IGUAIS com o frete cotando e depois
 * de pronto.
 *
 * Larguras e cupom (revisão Opus, mesmo dia): a primeira versão do texto da
 * espera ("Calculando…" com ícone) quebrava a linha Entrega abaixo de 360px
 * (a barra pulava 14px) e, com cupom, ficava 2px mais alta em telas largas.
 * Por isso a jornada roda a 320px (o menor celular, onde o CSS deixa a linha
 * quebrar: `src/index.css`, `.checkout-delivery`) e a 390px, cada uma SEM e
 * COM cupom aplicado (a linha "Desconto" aumenta a barra).
 *
 * Cliente logado FALSO, endereços, cotação e cupom inventados (kit); nada é
 * gravado nem cobrado.
 */

test.use({ ...devices["Pixel 5"], viewport: { width: 390, height: 844 } });

/** Folga larga de propósito: a medida "cotando" acontece com o cupom já
 * aplicado, e a própria jornada confere que ainda estava cotando. */
const ATRASO_DA_EDGE_DE_FRETE_MS = 3000;

const CASOS = [
  { largura: 320, comCupom: false },
  { largura: 320, comCupom: true },
  { largura: 390, comCupom: false },
  { largura: 390, comCupom: true },
] as const;

async function prepararCheckout(page: Page, comCupom: boolean) {
  await instalarLojaFixtura(page);
  await instalarSessaoClienteFixtura(page, {
    enderecos: enderecosFixtura(1),
  });
  // A conta fixture não tem CPF guardado: a RPC real `get_my_cpf` devolve
  // `text|null`, aqui `null` (igual ao `pagamento-kit.ts`). Sem isto a guarda de
  // rede do kit reprova a chamada que a tela do checkout faz.
  await page.route("**/rest/v1/rpc/get_my_cpf", async (rota) => {
    await rota.fulfill({
      status: 200,
      headers: { "content-type": "application/json" },
      body: "null",
    });
  });
  // Registradas DEPOIS das rotas do kit: o Playwright roda a última primeiro, e
  // o `fallback()` devolve a resposta ao stub do próprio kit.
  await page.route("**/functions/v1/calculate-shipping", async (rota) => {
    await new Promise((resolver) =>
      setTimeout(resolver, ATRASO_DA_EDGE_DE_FRETE_MS),
    );
    await rota.fallback();
  });
  if (comCupom) {
    // A loja das jornadas nasce com cupons desligados: liga-os (só na leitura
    // pública da configuração) e responde a validação do cupom fictício.
    await page.route("**/rest/v1/v_store_config*", async (rota) => {
      await rota.fulfill({
        status: 200,
        headers: { "content-type": "application/json" },
        body: JSON.stringify([{ ...linhaConfig(), enable_coupons: true }]),
      });
    });
    await page.route(
      "**/rest/v1/rpc/validate_coupon_secure_v2",
      async (rota) => {
        await rota.fulfill({
          status: 200,
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            is_valid: true,
            discount_value: 5,
            error_message: null,
          }),
        });
      },
    );
  }
  return abrirLoja(page);
}

for (const { largura, comCupom } of CASOS) {
  test(`${largura}px ${comCupom ? "COM" : "SEM"} cupom: a barra de baixo tem a mesma altura (e o mesmo espaço reservado) com o frete cotando e depois de pronto`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: largura, height: 844 });
    const errosNoFim = await prepararCheckout(page, comCupom);

    // Boné no carrinho, e o carrinho já com o frete cotado: assim o checkout
    // monta a calculadora de novo e espera a edge confirmar a cotação.
    await page
      .locator("div.group")
      .filter({
        has: page.getByRole("button", {
          name: PRODUTO_ACESSORIOS,
          exact: true,
        }),
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
    await expect(valores).toContainText("Calculando", { timeout: 15_000 });

    if (comCupom) {
      // A linha "Desconto" entra na barra (ela a deixa mais alta, igual nos
      // dois estados do frete).
      // Desde o redesenho (22/10/2026) o campo do código fica atrás do link
      // "Tenho um código de cupom"; a validação e a barra são as de sempre.
      const abrirCampo = page.getByRole("button", {
        name: "Tenho um código de cupom",
      });
      await abrirCampo.click();
      await expect(abrirCampo).toHaveAttribute("aria-expanded", "true");
      await page.getByLabel("Tem um código de cupom?").fill("JORNADA5");
      await page.getByRole("button", { name: "Aplicar", exact: true }).click();
      await expect(valores).toContainText("Desconto", { timeout: 15_000 });
    }

    const medir = async () => {
      await esperarTelaAssentar(page);
      return page.evaluate(() => {
        const barraDoBotao = Array.from(
          document.querySelectorAll<HTMLElement>(".bottom-docked-navigation"),
        ).find((e) => e.querySelector('button[aria-label="Finalizar pedido"]'));
        const linhaEntrega =
          barraDoBotao?.querySelector<HTMLElement>(".checkout-delivery");
        return {
          alturaDaBarra: barraDoBotao?.getBoundingClientRect().height ?? -1,
          alturaDaLinhaEntrega:
            linhaEntrega?.getBoundingClientRect().height ?? -1,
          espacoReservado: getComputedStyle(
            document.documentElement,
          ).getPropertyValue("--customer-footer-height"),
          // A medida só vale "cotando" se ainda estava cotando NO INSTANTE
          // dela (o texto cinza da linha Entrega, não o aviso escondido).
          aindaCalculando: !!linhaEntrega?.innerText.includes("Calculando"),
          temDesconto: !!barraDoBotao?.innerText.includes("Desconto"),
        };
      });
    };

    // COTANDO: o texto cinza está na linha Entrega e o botão segue apagado.
    await expect(botao).toBeDisabled();
    const cotando = await medir();
    expect(
      cotando.aindaCalculando,
      "a medida 'cotando' tem de ser feita ainda cotando",
    ).toBe(true);
    expect(cotando.temDesconto).toBe(comCupom);

    // PRONTO: o frete local de R$ 10 chega e o texto da espera sai.
    await expect(valores).not.toContainText("Calculando", { timeout: 30_000 });
    await expect(valores).toContainText("R$ 10,00");
    const pronto = await medir();
    expect(pronto.aindaCalculando).toBe(false);
    expect(pronto.temDesconto).toBe(comCupom);

    expect(cotando.alturaDaBarra).toBeGreaterThan(0);
    // A linha Entrega não quebra (16px) em nenhum dos dois estados.
    expect(pronto.alturaDaLinhaEntrega).toBe(cotando.alturaDaLinhaEntrega);
    expect(pronto.alturaDaBarra).toBe(cotando.alturaDaBarra);
    expect(cotando.espacoReservado).not.toBe("");
    expect(pronto.espacoReservado).toBe(cotando.espacoReservado);

    expect(errosNoFim().erros).toEqual([]);
  });
}
