// @vitest-environment jsdom
//
// Laudo caça-bugs Savy (30/08), achado 7: o carrinho pregava o frete de
// fábrica (R$ 15) no total ANTES de qualquer cotação — e o real podia ser
// R$ 18-55. Com `freteIndefinido`, a barra mostra "A calcular" e o total
// sem frete; com frete zero real, continua "GRÁTIS"; com preço cotado,
// continua o preço.
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

  async function montar(shipping: number | null, total: number) {
    const { CartFooterSummary } = await import(
      "@/components/ui/custom/CartFooterSummary"
    );
    await act(async () => {
      raiz.render(
        <CartFooterSummary
          cartCount={1}
          shipping={shipping}
          total={total}
          onNavigate={vi.fn()}
        />,
      );
    });
  }

  it("frete null mostra 'A calcular' e o total sem o chute", async () => {
    await montar(null, 100);

    // O componente renderiza via createPortal no document.body — o
    // hospedeiro fica vazio; o texto real mora no body.
    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain("A calcular");
    expect(texto).toContain("R$ 100,00");
    expect(texto).not.toContain("GRÁTIS");
  });

  it("frete zero real continua 'GRÁTIS'", async () => {
    await montar(0, 100);

    // O componente renderiza via createPortal no document.body — o
    // hospedeiro fica vazio; o texto real mora no body.
    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain("GRÁTIS");
    expect(texto).not.toContain("A calcular");
  });

  it("frete cotado continua o preço", async () => {
    await montar(18.37, 118.37);

    // O componente renderiza via createPortal no document.body — o
    // hospedeiro fica vazio; o texto real mora no body.
    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).toContain("R$ 18,37");
    expect(texto).toContain("R$ 118,37");
    expect(texto).not.toContain("A calcular");
  });
});
