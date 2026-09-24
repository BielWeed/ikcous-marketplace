// @vitest-environment jsdom
//
// Relato do dono (24/09/2026, print da Home a ~375px): com carrinho ABAIXO da
// meta, o aviso dizia "Falta pouquinho pro Frete Grátis na ..." e "Adicione
// mais R$ 0,20 para garantir o frete ..." — as duas frases cortavam com
// reticências e o valor que falta sumia no fim. O aviso novo põe o valor NA
// frase principal, curta, e mostra o contexto do limite ("R$ 149,80 de
// R$ 150,00") numa barra de progresso acessível.
//
// jsdom não mede pixel: o teste prende o comportamento observável — o texto
// que a pessoa lê (frase curta com o valor que falta, contexto do limite) e
// o que o leitor de tela anuncia da barra. O encaixe a 375px se confere na
// inspeção visual, não por classe CSS.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: {
    freeShippingMin: 150,
    storeCity: "",
  } as Record<string, unknown>,
  cartTotal: 0,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: estado.cartTotal }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** `formatCurrency` (Intl) usa NBSP entre "R$" e o valor. */
function normalizar(texto: string | null | undefined): string {
  return (texto ?? "").split(String.fromCharCode(160)).join(" ");
}

describe("FreeShippingBlock — abaixo da meta: frase curta, valor legível, nada cortado (relato 24/09/2026)", () => {
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

  async function montar(meta: number, carrinho: number) {
    estado.config = { freeShippingMin: meta, storeCity: "" };
    estado.cartTotal = carrinho;
    const { FreeShippingBlock } = await import(
      "@/components/ui/custom/FreeShippingBlock"
    );
    await act(async () => {
      raiz.render(<FreeShippingBlock />);
    });
  }

  it("print do dono (R$ 149,80 de R$ 150,00): 'Faltam R$ 0,20 para o frete grátis' e o contexto do limite", async () => {
    await montar(150, 149.8);

    const titulo = normalizar(hospedeiro.querySelector("h3")?.textContent);
    expect(titulo).toBe("Faltam R$ 0,20 para o frete grátis");
    expect(normalizar(hospedeiro.textContent)).toContain(
      "R$ 149,80 de R$ 150,00",
    );
    // As frases antigas, que cortavam, não voltam.
    expect(hospedeiro.textContent).not.toContain("Falta pouquinho");
    expect(hospedeiro.textContent).not.toContain("Adicione mais");
  });

  it("valor alto (R$ 1.200,00 de R$ 1.999,90): a frase principal continua curta", async () => {
    await montar(1999.9, 1200);

    const titulo = normalizar(hospedeiro.querySelector("h3")?.textContent);
    expect(titulo).toBe("Faltam R$ 799,90 para o frete grátis");
    // Teto que cabe na coluna de texto a 375px (~259px a 13px).
    expect(titulo.length).toBeLessThanOrEqual(40);
    expect(normalizar(hospedeiro.textContent)).toContain(
      "R$ 1.200,00 de R$ 1.999,90",
    );
  });

  it("barra de progresso acessível: role, valor atual e texto do limite", async () => {
    await montar(150, 149.8);

    const barra = hospedeiro.querySelector('[role="progressbar"]');
    expect(barra).not.toBeNull();
    expect(barra?.getAttribute("aria-valuenow")).toBe("100");
    expect(normalizar(barra?.getAttribute("aria-valuetext"))).toBe(
      "R$ 149,80 de R$ 150,00",
    );
    expect(barra?.getAttribute("aria-label")).toBe(
      "Progresso para o frete grátis",
    );
  });

  it("meta atingida: sem barra de progresso, título de liberado sem cortar", async () => {
    await montar(150, 150);

    expect(hospedeiro.querySelector('[role="progressbar"]')).toBeNull();
    expect(hospedeiro.textContent).toContain("Frete Grátis Liberado!");
  });
});
