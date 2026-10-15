// @vitest-environment jsdom
//
// No 3G lento a sonda de rede estourava o prazo, declarava "sem conexão" e a
// calculadora lançava "Sem conexão com a internet." ANTES de chamar a função
// `calculate-shipping` — que talvez respondesse em 5-6 s. Sem frete a cliente
// não fecha o pedido. Aqui o hook `useOnlineStatus` é o de VERDADE (sem
// dublê): o que se prova é o conjunto sonda + calculadora.
//   - rede LENTA (sonda estourou o prazo): a cotação sai e o frete aparece;
//   - sem rede de verdade (a requisição rejeita): "Sem conexão", sem chamar a
//     função — o comportamento de sempre.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { CartItem } from "@/types";

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

/** Rede lenta: pendente até o prazo da sonda abortar (como o `fetch` real). */
function fetchPendenteAteAbortar() {
  return vi.fn(
    (_url: unknown, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("The operation was aborted.", "AbortError"));
        });
      }),
  );
}

describe("ShippingCalculator — rede lenta ainda cota o frete", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let status: string[];

  beforeEach(() => {
    vi.stubEnv("VITE_SUPABASE_URL", "https://exemplo.supabase.co");
    vi.stubEnv("VITE_SUPABASE_ANON_KEY", "chave-de-teste");
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
    status = [];
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
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  async function renderizar(cepDestino: string) {
    const { ShippingCalculator } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    await act(async () => {
      raiz.render(
        <ShippingCalculator
          cart={carrinho}
          selectedOption={null}
          onSelectOption={() => {}}
          cepDestino={cepDestino}
          onStatusChange={(s) => status.push(s)}
        />,
      );
    });
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("a sonda estourou o prazo nas duas tentativas: a cotação AINDA sai e o frete aparece", async () => {
    vi.stubGlobal("fetch", fetchPendenteAteAbortar());
    invoke.mockResolvedValue({
      data: {
        options: [
          { id: "melhorenvio-pac", name: "PAC", price: 10, deliveryDays: 7 },
        ],
      },
      error: null,
    });

    // A tela já está aberta e a sonda já declarou a rede lenta quando a
    // cliente informa o endereço de entrega.
    await renderizar("");
    await avancar(3500 + 1500 + 3500);
    expect(invoke).not.toHaveBeenCalled();

    await renderizar("69000000");
    await avancar(0);

    expect(invoke).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).not.toContain("Sem conexão");
    expect(hospedeiro.textContent).toContain("PAC");
    expect(status.at(-1)).toBe("pronto");
  });

  it("controle: a requisição da sonda rejeita por erro de rede — 'Sem conexão' e a função nem é chamada", async () => {
    // O erro lançado é o comportamento sob prova; só silencia o ruído do log.
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new TypeError("Failed to fetch")),
    );

    await renderizar("");
    await avancar(1500);

    await renderizar("69000000");
    await avancar(0);

    expect(hospedeiro.textContent).toContain("Sem conexão com a internet.");
    expect(invoke).not.toHaveBeenCalled();
  });
});
