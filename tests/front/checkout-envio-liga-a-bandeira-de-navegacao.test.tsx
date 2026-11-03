// @vitest-environment jsdom

import { haEnvioDoCheckoutEmCurso } from "@/lib/envio-do-checkout-em-curso";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

//
// Caça 8 (03/11/2026) — o lado do CHECKOUT da trava de navegação durante o
// envio. Enquanto o pedido está a caminho (até 30 s em rede lenta), a tela
// liga a bandeira `haEnvioDoCheckoutEmCurso()`; o roteador (App.handleNavigate)
// consulta essa bandeira para não deixar a aba da barra de baixo desmontar a
// tela com o pedido no ar (ver app-navegar-durante-o-envio-do-checkout.test.tsx
// para o lado do roteador).
//
// A BORDA que importa: a bandeira tem de SOLTAR em todo fim de envio (sucesso,
// falha, desmonte) e ANTES de a tela de confirmação aparecer — senão a própria
// confirmação ("Ver meus pedidos", "Início") ficaria barrada pelo roteador.
//
// Harness copiado de checkout-pedido-chave-voltar-e-sessao.test.tsx (convidada).

const { estado, produto } = vi.hoisted(() => {
  const produto = {
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
  };
  return {
    produto,
    estado: {
      cart: [{ product: produto, quantity: 1 }] as unknown[],
      cartTotal: 100,
    },
  };
});

const createOrder = vi.fn();
const clearCart = vi.fn();
const removeFromCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
      whatsappNumber: "",
    },
    isLoaded: true,
  }),
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
      cart: estado.cart,
      cartTotal: estado.cartTotal,
      shippingFee: 0,
      clearCart,
      removeFromCart,
      addToCart: vi.fn(),
      selectedShippingOption: {
        id: "local-delivery",
        name: "Entrega Local",
        price: 0,
        deliveryDays: 1,
        provider: "local",
      },
      shippingCep: "01310-100",
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
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: () => Promise.resolve(true),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { auth: { getSession: vi.fn() } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => false,
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function digitar(id: string, valor: string) {
  const el = document.getElementById(id) as HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoPorTexto(texto: string) {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function preencherComoConvidada() {
  await act(async () => {
    digitar("checkout-name", "Cliente Teste");
    digitar("checkout-tel", "34999999999");
    digitar("guest-street", "Rua Teste");
    digitar("guest-number", "100");
    digitar("guest-neighborhood", "Centro");
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-cep", "01310-100");
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-city", "Cidade Teste");
    await esperarMicrotarefas();
  });
  await act(async () => {
    digitar("guest-state", "SP");
    await esperarMicrotarefas();
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 420));
  });
}

async function clicarFinalizar() {
  await act(async () => {
    botaoPorTexto("Finalizar Pedido")!.click();
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

describe("CheckoutView — a bandeira do envio em curso", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  async function abrirOApp() {
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

  /** Um envio que só termina quando o teste manda. */
  function pedidoQueEuControlo() {
    let responder!: (pedido: { id: string }) => void;
    let recusar!: (erro: unknown) => void;
    createOrder.mockImplementationOnce(
      () =>
        new Promise((resolve, rejeitar) => {
          responder = resolve;
          recusar = rejeitar;
        }),
    );
    return {
      responder: (pedido: { id: string }) => responder(pedido),
      recusar: (erro: unknown) => recusar(erro),
    };
  }

  beforeEach(() => {
    createOrder.mockReset();
    clearCart.mockReset();
    removeFromCart.mockReset();
    onNavigate.mockReset();
    onSetBackOverride.mockReset();
    estado.cart = [{ product: produto, quantity: 1 }];
    estado.cartTotal = 100;
    sessionStorage.clear();
    pararABuscaDeCep();
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

  it("desligada enquanto ninguém enviou nada", async () => {
    await abrirOApp();
    await preencherComoConvidada();
    expect(haEnvioDoCheckoutEmCurso()).toBe(false);
  });

  it("LIGADA enquanto o pedido está no ar e SOLTA antes de a confirmação aparecer", async () => {
    const pedido = pedidoQueEuControlo();
    await abrirOApp();
    await preencherComoConvidada();
    await clicarFinalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(haEnvioDoCheckoutEmCurso()).toBe(true);

    await act(async () => {
      pedido.responder({ id: "pedido-1234abcd" });
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    // A confirmação está na tela E a bandeira já soltou: os botões da
    // confirmação ("Ver meus pedidos") navegam por handleNavigate e não podem
    // ser barrados pelo próprio envio que acabou.
    expect(document.body.textContent).toContain("Pedido recebido");
    expect(haEnvioDoCheckoutEmCurso()).toBe(false);
  });

  it("SOLTA quando o envio FALHA — a pessoa não fica presa na tela", async () => {
    const pedido = pedidoQueEuControlo();
    await abrirOApp();
    await preencherComoConvidada();
    await clicarFinalizar();
    expect(haEnvioDoCheckoutEmCurso()).toBe(true);

    await act(async () => {
      pedido.recusar({ code: "23514", message: "Estoque insuficiente" });
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(haEnvioDoCheckoutEmCurso()).toBe(false);
  });

  it("SOLTA quando a tela desmonta com o pedido ainda no ar (nenhum caminho deixa a bandeira presa)", async () => {
    const pedido = pedidoQueEuControlo();
    await abrirOApp();
    await preencherComoConvidada();
    await clicarFinalizar();
    expect(haEnvioDoCheckoutEmCurso()).toBe(true);

    act(() => {
      raiz.unmount();
    });
    expect(haEnvioDoCheckoutEmCurso()).toBe(false);

    // A resposta chega depois do desmonte: não religa nada.
    await act(async () => {
      pedido.responder({ id: "pedido-1234abcd" });
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(haEnvioDoCheckoutEmCurso()).toBe(false);

    // O afterEach desmonta de novo; recria a raiz para ele não quebrar.
    raiz = createRoot(hospedeiro);
  });
});
