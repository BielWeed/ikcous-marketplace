// @vitest-environment jsdom
//
// Relato do dono (12/09/2026, print da Home no celular): com o carrinho
// VAZIO, a descrição abaixo do título "Frete Grátis" não cabia na tela —
// "Ganhe frete grátis em compras a..." cortava com reticências. A saída
// pedida é ENCURTAR o texto (não quebrar linha, não diminuir fonte, não dar
// scroll): uma frase curta que continue dizendo a partir de qual valor o
// frete fica grátis, e que caiba mesmo com valor alto (ex.: R$ 1.999,90).
//
// Este teste prende o comprimento da frase, não o layout (jsdom não mede
// pixel): a frase nova tem um teto de caracteres bem abaixo do texto antigo,
// em qualquer valor de meta — é isso que garante caber numa tela de 360px.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Estado mutável POR TESTE — vi.mock é içado, então os mocks leem este
// objeto (vi.hoisted), e cada teste o reescreve antes de montar.
const estado = vi.hoisted(() => ({
  config: {
    freeShippingMin: 0,
    storeCity: "",
  },
  cartTotal: 0,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: estado.cartTotal }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// tests/front/frete-v2-presets-contrato.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("FreeShippingBlock — carrinho vazio: a descrição cabe na tela (relato 12/09/2026)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.config = { freeShippingMin: 0, storeCity: "" };
    estado.cartTotal = 0;
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

  async function montar(freeShippingMin: number) {
    estado.config = { freeShippingMin, storeCity: "" };
    estado.cartTotal = 0;
    const { FreeShippingBlock } = await import(
      "@/components/ui/custom/FreeShippingBlock"
    );
    await act(async () => {
      raiz.render(<FreeShippingBlock />);
    });
    const paragrafo = hospedeiro.querySelector("p");
    // `formatCurrency` (Intl) usa NBSP entre "R$" e o valor — trocado por
    // espaço comum para comparar com literal, mesmo padrão de
    // tests/front/frete-v2-presets-contrato.test.tsx (lá via regex; aqui via
    // split/join para não acender o aviso de RegExp não-literal do eslint).
    return (paragrafo?.textContent ?? "")
      .split(String.fromCharCode(160))
      .join(" ");
  }

  it("valor comum (R$ 89,90): frase curta, sem o texto antigo que cortava", async () => {
    const texto = await montar(89.9);

    // O texto antigo, que o dono reportou cortado no print, não pode voltar.
    expect(texto).not.toBe("Ganhe frete grátis em compras acima de R$ 89,90.");
    // Segue dizendo a MESMA coisa útil: a partir de qual valor é grátis.
    expect(texto).toContain("R$ 89,90");
    expect(texto.length).toBeLessThanOrEqual(40);
  });

  it("valor alto (R$ 1.999,90): mesmo com número longo, a frase continua curta", async () => {
    const texto = await montar(1999.9);

    expect(texto).toContain("R$ 1.999,90");
    // O texto antigo com este valor tinha 53 caracteres — bem acima do que
    // cabe numa tela de 360px. A frase nova tem um teto fixo, não cresce
    // proporcional ao tamanho do valor formatado.
    expect(texto.length).toBeLessThanOrEqual(48);
  });
});
