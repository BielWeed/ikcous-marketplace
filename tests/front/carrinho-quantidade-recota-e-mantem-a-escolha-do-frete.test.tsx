// @vitest-environment jsdom
//
// A PONTA INTEIRA do achado "mudar a quantidade apaga a escolha de frete":
// CartProvider de verdade + ShippingCalculator de verdade, só a rede é dublê.
// A cliente toca numa opção que NÃO é a mais barata (Retirada na loja, ou a
// transportadora mais rápida), toca em "+" e espera a recotação. O VALOR pode
// mudar com a quantidade; a ESCOLHA dela não. Se a escolha deixou de existir
// na lista nova, aí sim vale a regra da casa (a mais barata, automática).
//
// A metade do contexto (a escolha não cai só porque a quantidade mudou) está
// em tests/front/carrinho-quantidade-nao-apaga-a-escolha-do-frete.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ShippingCalculator } from "@/components/ui/custom/ShippingCalculator";
import { CartProvider, useCartContext } from "@/contexts/CartContext";
import type { CartItem, Product, ShippingOption } from "@/types";

const invoke = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
    channel: () => {
      const canal: Record<string, unknown> = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: async () => {},
    rpc: async () => ({ error: new Error("sem rede") }),
    from: () => {
      throw new Error("sem rede");
    },
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { shippingFee: 0, freeShippingMin: 0, originCep: "38500-000" },
    isLoaded: true,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    info: vi.fn(),
    success: vi.fn(),
    warning: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CEP = "38500000";

const RETIRADA: ShippingOption = {
  id: "store-pickup",
  name: "Retirada na loja",
  price: 0,
  deliveryDays: 0,
  provider: "local",
};

/** O preço da transportadora acompanha a quantidade (peso). */
function pac(quantidade: number): ShippingOption {
  return {
    id: "melhorenvio-pac",
    name: "PAC",
    price: 20 * quantidade,
    deliveryDays: 6,
    provider: "melhor_envio",
  };
}
function sedex(quantidade: number): ShippingOption {
  return {
    id: "melhorenvio-sedex",
    name: "Sedex",
    price: 35 * quantidade,
    deliveryDays: 2,
    provider: "melhor_envio",
  };
}

function produto(): Product {
  return {
    id: "p1",
    name: "Produto p1",
    description: "",
    price: 50,
    images: [],
    category: "geral",
    stock: 50,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date(0).toISOString(),
  };
}

type Contexto = ReturnType<typeof useCartContext>;

function Pai({ onEstado }: Readonly<{ onEstado: (c: Contexto) => void }>) {
  const contexto = useCartContext();
  onEstado(contexto);
  return (
    <ShippingCalculator
      cart={contexto.cart}
      selectedOption={contexto.selectedShippingOption}
      selecaoEscolhidaPelaCliente={contexto.freteEscolhidoPelaCliente}
      onSelectOption={contexto.setSelectedShippingOption}
      onCepValidated={contexto.setShippingCep}
      cepDestino={CEP}
      cepDaSelecao={contexto.shippingCep}
    />
  );
}

describe("Carrinho — mudar a quantidade recota o frete e MANTÉM a escolha da cliente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: Contexto;
  // O que a "transportadora" devolve para cada quantidade do carrinho.
  let listaPara: (quantidade: number) => ShippingOption[];

  beforeEach(async () => {
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
    listaPara = (q) => [RETIRADA, pac(q), sedex(q)];
    invoke.mockReset();
    invoke.mockImplementation(
      (
        _nome: string,
        opts: { body: { action?: string; cart?: CartItem[] } },
      ) => {
        if (opts.body.action === "revisao_config_frete") {
          return Promise.resolve({ data: { revisaoConfig: "r" }, error: null });
        }
        const quantidade = opts.body.cart?.[0]?.quantity ?? 1;
        return Promise.resolve({
          data: { options: listaPara(quantidade), revisaoConfig: "r" },
          error: null,
        });
      },
    );
    localStorage.setItem(
      "marketplace_cart_v1",
      JSON.stringify([
        { product: produto(), quantity: 1, lastModifiedAt: Date.now() },
      ]),
    );
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <CartProvider>
          <Pai onEstado={(c) => (atual = c)} />
        </CartProvider>,
      );
    });
    await soltarRede();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function soltarRede() {
    await act(async () => {
      for (let i = 0; i < 15; i++) await Promise.resolve();
    });
  }

  async function clicarOpcao(nome: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(nome),
    );
    expect(botao, `botão "${nome}" na calculadora`).toBeDefined();
    await act(async () => {
      botao?.click();
    });
  }

  /** Toca em + e deixa o debounce de 700 ms e a rede resolverem. */
  async function mudarQuantidadePara(quantidade: number) {
    await act(async () => {
      atual.updateQuantity("p1", quantidade);
    });
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    await soltarRede();
  }

  it("nasce com a mais barata (automática): a calculadora de verdade cotou e escolheu", async () => {
    expect(atual.selectedShippingOption?.id).toBe("melhorenvio-pac");
    expect(atual.freteEscolhidoPelaCliente).toBe(false);
    expect(atual.shippingCep).toBe("38500-000");
  });

  it("Retirada na loja escolhida: o + recota com a quantidade nova e a retirada CONTINUA marcada", async () => {
    await clicarOpcao("Retirada na loja");
    expect(atual.selectedShippingOption?.id).toBe("store-pickup");
    expect(atual.freteEscolhidoPelaCliente).toBe(true);
    const chamadasAntes = invoke.mock.calls.length;

    await act(async () => {
      atual.updateQuantity("p1", 2);
    });
    // Durante o debounce a escolha NÃO some (antes sumia na hora).
    expect(atual.selectedShippingOption?.id).toBe("store-pickup");
    expect(atual.shippingCep).toBe("38500-000");

    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    await soltarRede();

    // Recotou de verdade, com a quantidade nova no corpo do pedido à edge…
    expect(invoke.mock.calls.length).toBeGreaterThan(chamadasAntes);
    const ultima = invoke.mock.calls.at(-1)?.[1] as {
      body: { cart: CartItem[] };
    };
    expect(ultima.body.cart[0]?.quantity).toBe(2);
    // …e a escolha dela ficou: nem a PAC (mais barata) a substituiu.
    expect(atual.selectedShippingOption?.id).toBe("store-pickup");
    expect(atual.freteEscolhidoPelaCliente).toBe(true);
    expect(atual.freteIndefinido).toBe(false);
  });

  it("transportadora mais rápida escolhida: fica marcada, com o PREÇO NOVO da quantidade nova", async () => {
    await clicarOpcao("Sedex");
    expect(atual.selectedShippingOption?.id).toBe("melhorenvio-sedex");
    expect(atual.selectedShippingOption?.price).toBe(35);
    expect(atual.freteEscolhidoPelaCliente).toBe(true);

    await mudarQuantidadePara(3);

    expect(atual.selectedShippingOption?.id).toBe("melhorenvio-sedex");
    expect(atual.selectedShippingOption?.price).toBe(105);
    expect(atual.freteEscolhidoPelaCliente).toBe(true);
  });

  it("rajada de + e -: uma cotação só ao fim, e a escolha da cliente ainda lá", async () => {
    await clicarOpcao("Retirada na loja");
    const chamadasAntes = invoke.mock.calls.length;

    for (const q of [2, 3, 4, 3]) {
      await act(async () => {
        atual.updateQuantity("p1", q);
      });
      await act(async () => {
        vi.advanceTimersByTime(200);
      });
    }
    await act(async () => {
      vi.advanceTimersByTime(700);
      await Promise.resolve();
    });
    await soltarRede();

    expect(invoke.mock.calls.length - chamadasAntes).toBe(1);
    expect(atual.cart[0]?.quantity).toBe(3);
    expect(atual.selectedShippingOption?.id).toBe("store-pickup");
    expect(atual.freteEscolhidoPelaCliente).toBe(true);
  });

  it("controle: a opção escolhida SUMIU da lista nova — vale a regra da casa (a mais barata, automática)", async () => {
    await clicarOpcao("Sedex");
    expect(atual.freteEscolhidoPelaCliente).toBe(true);
    // Com 2 unidades a transportadora rápida deixa de ser oferecida.
    listaPara = (q) => [RETIRADA, pac(q)];

    await mudarQuantidadePara(2);

    expect(atual.selectedShippingOption?.id).toBe("melhorenvio-pac");
    expect(atual.selectedShippingOption?.price).toBe(40);
    expect(atual.freteEscolhidoPelaCliente).toBe(false);
  });

  it("controle: escolha AUTOMÁTICA acompanha a mais barata da lista nova (não vira trava)", async () => {
    expect(atual.selectedShippingOption?.id).toBe("melhorenvio-pac");
    expect(atual.freteEscolhidoPelaCliente).toBe(false);
    // Com 2 unidades o Sedex passa a ser o mais barato.
    listaPara = (q) => [
      RETIRADA,
      { ...pac(q), price: 90 },
      { ...sedex(q), price: 50 },
    ];

    await mudarQuantidadePara(2);

    expect(atual.selectedShippingOption?.id).toBe("melhorenvio-sedex");
    expect(atual.freteEscolhidoPelaCliente).toBe(false);
  });

  it("controle: um PRODUTO novo no carrinho derruba a escolha da cliente, como antes", async () => {
    await clicarOpcao("Retirada na loja");
    expect(atual.freteEscolhidoPelaCliente).toBe(true);

    await act(async () => {
      atual.addToCart({ ...produto(), id: "p2", name: "Produto p2" }, 1);
    });

    expect(atual.cart).toHaveLength(2);
    expect(atual.freteEscolhidoPelaCliente).toBe(false);
    // O carrinho novo pode ter passado por recotação e auto-escolhido a mais
    // barata; o que NÃO pode sobrar é a retirada como "escolha da cliente".
    expect(atual.selectedShippingOption?.id).not.toBe("store-pickup");
  });
});
