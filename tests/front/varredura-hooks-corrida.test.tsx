// @vitest-environment jsdom
//
// Varredura de bugs (12/10/2026), frente hooks-corrida: guardas de corrida/
// erro dos hooks de LEITURA. Cada bloco prende um item da varredura.
import type { CartItem, Product } from "@/types";
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockInvoke } = vi.hoisted(() => ({ mockInvoke: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: mockInvoke } },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(): Product {
  return {
    id: "prod-1",
    name: "Produto Teste",
    description: "",
    price: 10,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
}

describe("item 1: useEconomiaDoFreteExibida descarta resposta de rodada encerrada", () => {
  let raiz: Root;
  let alvo: HTMLElement;

  beforeEach(() => {
    mockInvoke.mockReset();
    alvo = document.createElement("div");
    document.body.appendChild(alvo);
    raiz = createRoot(alvo);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    alvo.remove();
  });

  it("carrinho esvaziado com a cotação em voo: a resposta velha não pinta economia", async () => {
    const { useEconomiaDoFreteExibida, _limparCacheDeEconomiaDoFreteParaTeste } =
      await import("@/hooks/useEconomiaDoFreteExibida");
    _limparCacheDeEconomiaDoFreteParaTeste();
    function Sonda(props: Parameters<typeof useEconomiaDoFreteExibida>[0]) {
      const valor = useEconomiaDoFreteExibida(props);
      return createElement("span", null, String(valor));
    }
    let resolver: (v: unknown) => void = () => {};
    mockInvoke.mockReturnValue(
      new Promise((r) => {
        resolver = r;
      }),
    );
    const base = {
      freteGratis: true,
      cepDeEntrega: "01310-100",
      temUsuario: true,
      originCep: "38500-000",
      localCepRange: undefined,
      localDeliveryFee: 12.9,
      freeShippingMin: 0.01,
      isOffline: false,
    };
    const cheio: CartItem[] = [{ product: produto(), quantity: 1 }];

    act(() => raiz.render(createElement(Sonda, { ...base, cart: cheio })));
    await act(async () => {
      await new Promise((r) => setTimeout(r, 600));
    });
    expect(mockInvoke).toHaveBeenCalledTimes(1);

    act(() => raiz.render(createElement(Sonda, { ...base, cart: [] })));
    await act(async () => {
      resolver({
        data: { options: [{ id: "x", price: 25, name: "x" }] },
        error: null,
      });
      await Promise.resolve();
    });
    expect(alvo.textContent).toBe("0");
  });
});
