// @vitest-environment jsdom
//
// Laudo caça-bugs Savy (30/08), achado 7: o carrinho pregava o frete de
// fábrica (R$ 15) no total ANTES de qualquer cotação — e o real podia ser
// R$ 18-55. Com `freteIndefinido`, a barra mostra "A calcular" no frete e,
// desde a caça de 06/11, TAMBÉM no Total (o checkout já não fecha total sem
// frete; o carrinho dizia "Total R$ 100,00" e o checkout, outro valor); com
// frete zero real, continua "GRÁTIS"; com preço cotado, continua o preço.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CartFooterSummary — frete indefinido é 'A calcular', nunca chute", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function montar(
    shipping: number | null,
    total: number | null,
    retiradaNaLoja = false,
  ) {
    const { CartFooterSummary } = await import(
      "@/components/ui/custom/CartFooterSummary"
    );
    await act(async () => {
      raiz.render(
        <CartFooterSummary
          cartCount={1}
          shipping={shipping}
          retiradaNaLoja={retiradaNaLoja}
          total={total}
          onNavigate={vi.fn()}
        />,
      );
    });
  }

  /** O elemento que está embaixo do rótulo "Total" (o portal mora no body). */
  function elementoDoTotal(): Element | null | undefined {
    const rotulo = Array.from(document.body.querySelectorAll("span")).find(
      (s) => s.textContent?.trim() === "Total",
    );
    expect(rotulo).toBeTruthy();
    return rotulo?.nextElementSibling;
  }

  function valorDoTotal(): string {
    return (elementoDoTotal()?.textContent ?? "")
      .replace(/\u00A0/g, " ")
      .trim();
  }

  it("frete null (total null): o Total diz 'A calcular' — nada de número fechado — e a linha do Frete também", async () => {
    await montar(null, null);

    // O componente renderiza via createPortal no document.body — o
    // hospedeiro fica vazio; o texto real mora no body.
    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(valorDoTotal()).toBe("A calcular");
    expect(texto).toContain("Frete A calcular");
    expect(texto).not.toMatch(/R\$\s?\d/);
    expect(texto).not.toContain("GRÁTIS");
  });

  it("a linha do Total NÃO some com 'A calcular': mesmo elemento e mesmas classes que com o frete pronto (a barra não pula)", async () => {
    await montar(null, null);
    const semFrete = elementoDoTotal();
    expect(semFrete?.tagName).toBe("P");
    const classesSemFrete = semFrete?.className;

    await montar(18.37, 118.37);
    const comFrete = elementoDoTotal();
    expect(comFrete?.tagName).toBe("P");
    // Só o texto troca; o tamanho da letra e a altura da linha são os mesmos.
    expect(comFrete?.className).toBe(classesSemFrete);
  });

  it("retirada na loja (frete zero conhecido): Total fechado e 'Retirada na loja'", async () => {
    await montar(0, 100, true);

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(valorDoTotal()).toBe("R$ 100,00");
    expect(texto).toContain("Retirada na loja");
    expect(texto).not.toContain("A calcular");
    expect(texto).not.toContain("GRÁTIS");
  });

  it("frete zero real continua 'GRÁTIS'", async () => {
    await montar(0, 100);

    // O componente renderiza via createPortal no document.body — o
    // hospedeiro fica vazio; o texto real mora no body.
    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(valorDoTotal()).toBe("R$ 100,00");
    expect(texto).toContain("GRÁTIS");
    expect(texto).not.toContain("A calcular");
  });

  it("frete cotado continua o preço", async () => {
    await montar(18.37, 118.37);

    // O componente renderiza via createPortal no document.body — o
    // hospedeiro fica vazio; o texto real mora no body.
    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain("R$ 18,37");
    expect(valorDoTotal()).toBe("R$ 118,37");
    expect(texto).not.toContain("A calcular");
  });
});
