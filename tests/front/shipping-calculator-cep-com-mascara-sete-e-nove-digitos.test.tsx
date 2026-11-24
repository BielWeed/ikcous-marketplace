// @vitest-environment jsdom
//
// O CEP que chega à calculadora vem do endereço de entrega e pode estar como
// a pessoa colou: com ponto, hífen, espaço. A calculadora cota SÓ com 8
// dígitos limpos. CEP de 7 ou 9 dígitos (digitado pela metade ou com um dígito
// a mais) não é destino: nada é cotado e a tela pede o endereço — nunca fica
// "calculando" para sempre, que era o que um `>= 8` no lugar do `=== 8`
// faria com o 9º dígito (achado por mutação, 24/11/2026).
//
// Segue o padrão de shipping-calculator-cep-do-endereco-cadastrado.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem, Product, ShippingOption } from "@/types";

const invoke = vi.fn();
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
}));

vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: null }) }));
vi.mock("@/contexts/CartContext", () => ({
  useCartState: () => ({ freteGratis: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { freeShippingMin: 0 }, isLoaded: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

function produto(): Product {
  return {
    id: "prod-1",
    name: "Blusa Teste",
    description: "",
    price: 128.25,
    images: [],
    category: "Roupas",
    stock: 50,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

const CARRINHO: CartItem[] = [{ product: produto(), quantity: 1 }];

const ECONOMICO: ShippingOption = {
  id: "eco",
  name: "Econômico",
  price: 12.34,
  deliveryDays: 4,
  provider: "melhor_envio",
};

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("ShippingCalculator — CEP com máscara, sete e nove dígitos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let selecionada: ShippingOption | null;

  beforeEach(() => {
    vi.useFakeTimers();
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
    invoke.mockResolvedValue({ data: { options: [ECONOMICO] }, error: null });
    selecionada = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function renderizar(cepDestino: string) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={CARRINHO}
          selectedOption={selecionada}
          onSelectOption={(opt) => {
            selecionada = opt;
          }}
          onCepValidated={() => {}}
          cepDestino={cepDestino}
          cepDaSelecao={null}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  function textoDaTela(): string {
    return hospedeiro.textContent ?? "";
  }

  it("CEP colado com ponto, hífen e espaços cota UMA vez com os 8 dígitos limpos", async () => {
    await renderizar(" 38.500-000 ");

    expect(invoke).toHaveBeenCalledTimes(1);
    const corpo = (invoke.mock.calls[0][1] as { body: { cep: string } }).body;
    expect(corpo.cep).toBe("38500000");
    expect(textoDaTela()).toContain("CEP 38500-000");
  });

  for (const [rotulo, cep] of [
    ["7 dígitos (digitado pela metade)", "3850000"],
    ["9 dígitos (um a mais)", "38500-0001"],
  ] as const) {
    it(`CEP com ${rotulo}: nada é cotado e a tela pede o endereço, sem ficar calculando`, async () => {
      await renderizar(cep);

      expect(invoke).not.toHaveBeenCalled();
      expect(selecionada).toBeNull();
      expect(textoDaTela()).toContain("Cadastre um endereço");
      expect(textoDaTela()).not.toContain("R$");
    });
  }
});
