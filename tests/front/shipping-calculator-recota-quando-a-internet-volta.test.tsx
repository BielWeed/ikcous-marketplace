// @vitest-environment jsdom
//
// FRETE: "Sem conexão com a internet." NÃO FICA NA TELA DEPOIS QUE A REDE VOLTA.
//
// A calculadora só olhava a rede dentro da cotação. Cotou sem rede, mostrou o
// aviso -- e, com a internet de volta, o aviso ficava lá até a cliente tocar
// em "Tentar de novo". Agora, quando a rede volta e o erro da tela é o da falta
// de conexão, a cotação refaz sozinha (uma vez por volta de conexão); outros
// erros não são tocados.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

const { rede, invoke } = vi.hoisted(() => ({
  rede: { semInternet: true },
  invoke: vi.fn(),
}));

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
// Devolve o estado de AGORA: o teste vira a chave e re-renderiza.
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => rede.semInternet,
}));
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

describe("ShippingCalculator — recota sozinho quando a internet volta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

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
    rede.semInternet = true;
    invoke.mockReset();
    invoke.mockResolvedValue({
      data: {
        options: [
          {
            id: "pac",
            name: "PAC",
            price: 20,
            deliveryDays: 5,
            provider: "melhor-envio",
          },
        ],
      },
      error: null,
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    vi.restoreAllMocks();
  });

  async function renderizar() {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          selectedOption={null}
          onSelectOption={() => {}}
          cepDestino="69000000"
        />,
      );
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  async function mudarARede(semInternet: boolean) {
    rede.semInternet = semInternet;
    await renderizar();
  }

  it("a rede volta com o aviso de falta de conexão na tela: cota sozinho e o aviso some", async () => {
    await renderizar();
    expect(hospedeiro.textContent).toContain("Sem conexão com a internet.");
    expect(invoke).not.toHaveBeenCalled();

    await mudarARede(false);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).not.toContain("Sem conexão com a internet.");
    expect(hospedeiro.textContent).toContain("PAC");
  });

  it("uma cotação só por volta de conexão: re-renders com a rede boa não cotam de novo (sem laço)", async () => {
    await renderizar();
    await mudarARede(false);
    expect(invoke).toHaveBeenCalledTimes(1);

    // Re-renders com a rede boa não cotam de novo.
    await mudarARede(false);
    await mudarARede(false);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("outro erro na tela não é tocado quando a rede volta (nada de cotação extra)", async () => {
    // A rede nasce boa e a cotação falha por outro motivo.
    rede.semInternet = false;
    invoke.mockResolvedValue({
      data: null,
      error: { name: "FunctionsFetchError", message: "x" },
    });
    await renderizar();
    const chamadasAntes = invoke.mock.calls.length;
    expect(chamadasAntes).toBe(1);

    // Cai e volta a rede: o erro da tela não é "sem conexão", então fica quieto.
    await mudarARede(true);
    await mudarARede(false);

    expect(invoke).toHaveBeenCalledTimes(chamadasAntes);
  });
});
