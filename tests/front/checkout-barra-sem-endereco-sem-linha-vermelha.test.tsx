// @vitest-environment jsdom
//
// CONVIDADO SEM ENDEREÇO: A BARRA NÃO GANHA LINHA DE IDENTIFICAÇÃO (dono,
// 1.5.50, commit 38c52de4: repetir em vermelho na barra o que o card do alto
// já pede só a engordava). Na primeira versão da frente "barra não pula com o
// frete", a pendência de identificação passou a ignorar o frete e por isso
// voltou a aparecer quando NÃO há destino ("Informe seu nome…" e depois
// "Complete o endereço de entrega…"). Aqui se prova:
//   1. sem destino de entrega, a barra não mostra a pendência (o texto do
//      aviso de frete é só para leitor de tela);
//   2. com destino, a pendência aparece igual cotando e pronto, e a altura
//      estrutural da barra (mesmos elementos) não muda.
import type { CartItem } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national" as "national" | "local",
    originCep: "38500-000",
    localCepRange: undefined as string | undefined,
    localDeliveryFee: 12.9,
    freeShippingMin: 0.01,
    enableCoupons: false,
    formasPagamentoEntrega: ["pix", "card", "cash"],
  },
}));

// A calculadora é um dublê que reporta o status que o teste manda, mas só
// "tem destino" quando o checkout lhe entrega um CEP (como a real).
const { mockFrete } = vi.hoisted(() => ({
  mockFrete: { statusComDestino: "cotando" },
}));
vi.mock("@/components/ui/custom/ShippingCalculator", async () => {
  const { useEffect } = await import("react");
  function CalculadoraDeTeste(props: {
    cepDestino?: string | null;
    onStatusChange?: (status: string) => void;
  }) {
    const { cepDestino, onStatusChange } = props;
    useEffect(() => {
      onStatusChange?.(cepDestino ? mockFrete.statusComDestino : "sem-destino");
    }, [cepDestino, onStatusChange]);
    return <section aria-label="Entrega e frete" />;
  }
  return { ShippingCalculator: CalculadoraDeTeste };
});

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      cartTotal: 0,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      shippingCep: null,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
      freteGratis: false,
      selectedShippingOption: null,
      freteIndefinido: true,
    })),
  };
});
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CART: CartItem[] = [
  {
    product: {
      id: "p1",
      name: "Camiseta",
      description: "",
      price: 80,
      images: [],
      category: "geral",
      stock: 10,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: new Date().toISOString(),
    },
    quantity: 1,
  },
];

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

const PENDENCIA = "[data-testid='checkout-pendencia-identificacao']";

describe("CheckoutView — convidado: a barra e a pendência de identificação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  const montar = async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={CART}
          subtotal={80}
          shipping={0}
          total={80}
          onNavigate={vi.fn()}
          onSetBackOverride={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
  };

  const barra = () =>
    (
      [...document.querySelectorAll("button")].find(
        (b) => b.getAttribute("aria-label") === "Finalizar pedido",
      ) as HTMLElement
    ).closest(".bottom-docked-navigation") as HTMLElement;

  /** Estrutura da barra FORA do grupo "Valores do pedido" (tags, papéis, ids
   * de teste), sem o texto: é o que cria ou some uma linha e muda a altura.
   * Dentro do grupo, só o texto troca ("Calculando", faixa do Total). */
  const estrutura = () =>
    [...barra().querySelectorAll("*")]
      .filter(
        (el) =>
          !barra()
            .querySelector("[aria-label='Valores do pedido']")
            ?.contains(el),
      )
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}|${el.getAttribute("role") ?? ""}|${
            el.getAttribute("data-testid") ?? ""
          }`,
      );

  /** Texto que a pessoa vê na barra (o `sr-only` fica de fora). */
  const textoVisivelDaBarra = () => {
    const copia = barra().cloneNode(true) as HTMLElement;
    for (const escondido of copia.querySelectorAll(".sr-only")) {
      escondido.remove();
    }
    return copia.textContent ?? "";
  };

  const preencherCep = async () => {
    await act(async () => {
      digitar("guest-cep", "38500-000");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
  };

  beforeEach(async () => {
    const { _limparCacheDeEconomiaDoFreteParaTeste } = await import(
      "@/hooks/useEconomiaDoFreteExibida"
    );
    _limparCacheDeEconomiaDoFreteParaTeste();
    const { HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    slotDoHeader = document.createElement("div");
    slotDoHeader.id = HEADER_CENTER_SLOT_ID;
    document.body.appendChild(slotDoHeader);
    globalThis.sessionStorage.clear();
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
    mockFrete.statusComDestino = "cotando";
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    slotDoHeader.remove();
    globalThis.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("sem endereço (recém-aberto): a barra não mostra pendência nem linha vermelha; o motivo é só para leitor de tela", async () => {
    await montar();

    expect(barra().querySelector(PENDENCIA)).toBeNull();
    expect(textoVisivelDaBarra()).not.toContain("para finalizar");
    expect(textoVisivelDaBarra()).not.toContain("Informe");
    // Os dois avisos "para finalizar" não aparecem nem em outro lugar da barra.
    expect(barra().innerHTML).not.toContain("text-red-700");
  });

  it("sem endereço, com nome e WhatsApp digitados: continua sem a linha 'Complete o endereço de entrega'", async () => {
    await montar();
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 50));
    });

    expect(barra().querySelector(PENDENCIA)).toBeNull();
    expect(textoVisivelDaBarra()).not.toContain("Complete o endereço");
  });

  it("com destino: a pendência aparece igual cotando e pronto, e a barra tem a mesma estrutura", async () => {
    await montar();
    await preencherCep();

    mockFrete.statusComDestino = "cotando";
    await act(async () => {
      digitar("guest-number", "10");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const textoCotando = barra().querySelector(PENDENCIA)?.textContent;
    expect(textoCotando).toBeTruthy();
    const estruturaCotando = estrutura();

    mockFrete.statusComDestino = "pronto";
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar();
    await preencherCep();
    await act(async () => {
      digitar("guest-number", "10");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(barra().querySelector(PENDENCIA)?.textContent).toBe(textoCotando);
    // Mesma estrutura fora do grupo de valores: nada ganha nem perde linha.
    expect(estrutura()).toEqual(estruturaCotando);
  });
});
