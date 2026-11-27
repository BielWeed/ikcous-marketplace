// @vitest-environment jsdom
//
// LEITOR DE TELA NO DINHEIRO (27/11/2026): o frete se recota (troca de
// endereço, revisão da loja) e o total do checkout muda — quem usa leitor de
// tela não ouvia nada: o Total da barra não é região viva. O carrinho já fala
// o Total (`CartView`, `role="status"` só no valor); o checkout segue a mesma
// régua, SEM spam: só quando o valor FINAL muda, nunca a cada "a calcular", e
// uma recotação que termina no mesmo valor não fala de novo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: () => Promise.resolve(true),
}));

vi.mock("@/components/ui/custom/ShippingCalculator", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/ui/custom/ShippingCalculator")
    >();
  return { ...real, ShippingCalculator: () => null };
});

const configDaLoja: Record<string, unknown> = {};
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: configDaLoja, isLoaded: true }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
      addresses: [
        {
          id: "addr-1",
          user_id: "user-1",
          name: "Casa",
          recipient_name: "Cliente Teste",
          cep: "38500-000",
          street: "Rua Teste",
          number: "100",
          neighborhood: "Centro",
          city: "Monte Carmelo",
          state: "MG",
          is_default: true,
        },
      ],
      addAddress: vi.fn(),
      updateAddress: vi.fn(),
      loading: false,
    }),
}));

const mockUser = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

interface OpcaoDeTeste {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
}

const ENTREGA_PROPRIA: OpcaoDeTeste = {
  id: "local-delivery",
  name: "Entrega pela loja",
  price: 10,
  deliveryDays: 1,
  provider: "local",
};

let freteEscolhido: OpcaoDeTeste | null = ENTREGA_PROPRIA;

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [
        {
          product: {
            id: "prod-1",
            name: "Produto Teste",
            description: "",
            price: 100,
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
      ],
      cartTotal: 100,
      shippingFee: freteEscolhido?.price ?? 0,
      clearCart,
      selectedShippingOption: freteEscolhido,
      shippingCep: "38500-000",
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function botaoFinalizar(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    '[aria-label="Finalizar pedido"]',
  )!;
}

// O texto exato que o checkout monta (mesma função `reais` da tela: espaço
// comum no lugar do não separável).
const brl = (valor: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" })
    .format(valor)
    .replace(" ", " ");

describe("CheckoutView — total anunciado ao leitor de tela", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    createOrder.mockReset();
    toastError.mockReset();
    freteEscolhido = ENTREGA_PROPRIA;
    for (const chave of Object.keys(configDaLoja)) delete configDaLoja[chave];
    Object.assign(configDaLoja, {
      shippingCoverage: "national",
      originCep: "38500-000",
      enableCoupons: false,
      formasPagamentoEntrega: ["pix", "card", "cash"],
    });
    armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
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
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
  }

  // A barra do total só monta depois de ~380 ms (`useDeferredRender`).
  async function montarComABarra() {
    await renderizar();
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    expect(botaoFinalizar()).not.toBeNull();
  }

  async function freteVira(opcao: OpcaoDeTeste | null) {
    freteEscolhido = opcao;
    await renderizar();
  }

  // A região do total: um `status` da barra, só para leitor de tela.
  function regiaoDoTotal(): HTMLElement {
    const regioes = [
      ...document.querySelectorAll<HTMLElement>('[role="status"]'),
    ].filter((r) => r.textContent?.includes("Total do pedido"));
    expect(regioes).toHaveLength(1);
    return regioes[0];
  }

  it("nasce com o total atual (região que nasce cheia não é anunciada) e fala quando o frete muda o total", async () => {
    await montarComABarra();
    const regiao = regiaoDoTotal();
    expect(regiao.className).toContain("sr-only");
    expect(regiao.getAttribute("aria-atomic")).toBe("true");
    expect(regiao.textContent).toBe(
      `Total do pedido: ${brl(110)}. Entrega: ${brl(10)}.`,
    );

    await freteVira({ ...ENTREGA_PROPRIA, price: 15 });
    expect(regiaoDoTotal()).toBe(regiao);
    expect(regiao.textContent).toBe(
      `Total do pedido: ${brl(115)}. Entrega: ${brl(15)}.`,
    );
  });

  it("enquanto recota ('a calcular') a região esvazia, sem o total velho e sem falar; se a recotação volta ao mesmo valor, não fala de novo", async () => {
    await montarComABarra();
    const regiao = regiaoDoTotal();
    const antes = regiao.textContent;
    const textos: string[] = [];
    const observador = new MutationObserver(() =>
      textos.push(regiao.textContent ?? ""),
    );
    observador.observe(regiao, {
      childList: true,
      characterData: true,
      subtree: true,
    });

    await freteVira(null);
    // A barra mostra "a calcular"; o total de antes não fica legível aqui
    // (o preço pode ter mudado) e esvaziar não é anunciado.
    expect(regiao.textContent).toBe("");
    await freteVira({ ...ENTREGA_PROPRIA });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    observador.disconnect();

    // Mesmo valor de antes: a região NÃO volta a receber o texto (seria a
    // mesma frase falada de novo).
    expect(regiao.textContent).toBe("");
    expect(textos.every((texto) => texto === "")).toBe(true);
    expect(antes).toContain("Total do pedido");

    // Valor diferente depois da recotação: aí fala.
    await freteVira({ ...ENTREGA_PROPRIA, price: 20 });
    expect(regiao.textContent).toBe(
      `Total do pedido: ${brl(120)}. Entrega: ${brl(20)}.`,
    );
  });

  it("frete grátis e retirada falam o que a linha Entrega mostra", async () => {
    await montarComABarra();
    const regiao = regiaoDoTotal();
    await freteVira({ ...ENTREGA_PROPRIA, price: 0 });
    expect(regiao.textContent).toBe(
      `Total do pedido: ${brl(100)}. Entrega: Grátis.`,
    );
    // Retirada: o mesmo total, mas outra frase — a região fala a troca.
    await freteVira({
      id: "store-pickup",
      name: "Retirar na loja",
      price: 0,
      deliveryDays: 0,
      provider: "pickup",
    });
    expect(regiao.textContent).toBe(
      `Total do pedido: ${brl(100)}. Retirada na loja.`,
    );
    expect(regiao.textContent).not.toContain("Entrega");
  });
});
