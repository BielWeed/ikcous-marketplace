// @vitest-environment jsdom
//
// Ponto do defeito, medido em ShippingCalculator.tsx (calculateShipping,
// ramo `catch`): quando a cotação de frete falha, o COMPRADOR lia o
// `err.message` cru — que aqui é sempre a frase fixa em inglês que o SDK
// `@supabase/functions-js` usa para uma resposta HTTP fora de 2xx ("Edge
// Function returned a non-2xx status code", confirmado em
// node_modules/@supabase/functions-js/dist/main/types.js:75) — direto no
// `<span>{error}</span>` da tela.
//
// Modelo estrutural copiado de
// shipping-calculator-sem-preco-inventado.test.tsx: mesmo dublê de
// `@/lib/supabase` (só `functions.invoke`), mesmo jeito de montar o
// componente e disparar o formulário.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

const carrinho: CartItem[] = [
  {
    product: {
      id: "prod-1",
      name: "Blusa Teste",
      description: "",
      price: 100,
      images: [],
      category: "Roupas",
      stock: 5,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: new Date(0).toISOString(),
    },
    quantity: 1,
  },
];

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — erro de cotação sai traduzido, nunca cru", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let selecionadas: unknown[];

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    invoke.mockReset();
    selecionadas = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function montarECotar(cepDigitado: string) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );

    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          subtotal={100}
          freeShippingMin={0}
          selectedOption={null}
          onSelectOption={(opt) => selecionadas.push(opt)}
        />,
      );
    });

    const campo = hospedeiro.querySelector("input") as HTMLInputElement;
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      setter?.call(campo, cepDigitado);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const formulario = hospedeiro.querySelector("form") as HTMLFormElement;
    await act(async () => {
      formulario.dispatchEvent(
        new Event("submit", { bubbles: true, cancelable: true }),
      );
      await Promise.resolve();
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("FunctionsHttpError (resposta fora de 2xx): a tela mostra a frase traduzida, NUNCA o rótulo do SDK", async () => {
    // Formato REAL do que @supabase/functions-js devolve para uma resposta
    // HTTP fora de 2xx — escolhido de propósito para não coincidir com
    // nenhuma palavra da tradução esperada, então o teste não pode passar
    // por acidente.
    invoke.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        message: "Edge Function returned a non-2xx status code",
        context: { status: 500 },
      },
    });

    await montarECotar("69000000");

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("non-2xx");
    expect(texto).not.toContain("FunctionsHttpError");
    expect(texto).toContain(
      "Não foi possível calcular o frete agora. Tente novamente em instantes.",
    );
    expect(selecionadas.filter((o) => o !== null)).toEqual([]);
  });

  it("FunctionsFetchError (o fetch em si falhou, sem resposta): a tela avisa sobre a CONEXÃO, causa verificada — não o genérico", async () => {
    invoke.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsFetchError",
        message: "Failed to send a request to the Edge Function",
      },
    });

    await montarECotar("69000000");

    const texto = hospedeiro.textContent ?? "";
    expect(texto).not.toContain("Failed to send a request");
    expect(texto).toContain(
      "Sem conexão com o servidor. Verifique sua internet e tente novamente.",
    );
  });
});
