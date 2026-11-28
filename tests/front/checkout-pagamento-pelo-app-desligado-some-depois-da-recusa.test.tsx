// @vitest-environment jsdom
//
// O PAGAMENTO PELO APP DESLIGADO COM O CHECKOUT ABERTO (caça 28/11/2026) —
// cliente presa num laço de recusa.
//
// DEFEITO MEDIDO: a cliente está no checkout com o grupo "No app" na tela. A
// lojista desliga o pagamento pelo app (`store_config.pagamento_online`). A
// cliente finaliza com "Pagar agora com PIX" e a RPC recusa, CERTO, com "Esta
// forma de pagamento não está disponível nesta loja. Escolha outra." — o
// servidor não manda código próprio (RAISE sem ERRCODE nem DETAIL; ver
// `forma_de_pagamento_aceita` na 20261399997000), só esta frase. A tela relia
// a config da loja, mas o grupo "No app" dependia só da ficha posta no HTML
// no carregamento (`pagamentoOnlineLigado()`), que não se relê: o PIX
// continuava oferecido, a cliente o escolhia de novo e recebia a mesma
// recusa. Com transportadora (o online é a única forma aceita) não havia
// saída nenhuma.
//
// Aqui a ficha diz `pagamentoOnline: true` (o dublê de `@/lib/flags`, a
// mesma porta que o app usa) e o "servidor" é o dublê de `createOrder`.
//
// Harness de checkout-rele-o-frete-gratis-da-loja.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const ENTREGA_LOCAL = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 10,
  deliveryDays: 1,
  provider: "local",
};

// Outra cidade: a transportadora só aceita o pagamento pelo app.
const TRANSPORTADORA = {
  id: "melhorenvio-1",
  name: "PAC",
  price: 10,
  deliveryDays: 5,
  provider: "melhorenvio",
};

const mundo = vi.hoisted(() => ({
  opcao: null as null | {
    id: string;
    name: string;
    price: number;
    deliveryDays: number;
    provider: string;
  },
}));

const RECUSA_DA_FORMA_DESLIGADA = {
  code: "P0001",
  message:
    "Esta forma de pagamento não está disponível nesta loja. Escolha outra.",
};

const CONFIG_DA_LOJA = {
  shippingCoverage: "national",
  originCep: "38500-000",
  enableCoupons: false,
  freeShippingMin: 0,
  shippingFee: 10,
};

const createOrder = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();
const refresh = vi.fn(async (_opcoes?: { onlyConfig?: boolean }) => {});

vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));

vi.mock("@/components/ui/custom/ShippingCalculator", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/ui/custom/ShippingCalculator")
    >();
  return { ...real, ShippingCalculator: () => null };
});

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: CONFIG_DA_LOJA,
    isLoaded: true,
    refresh: (opcoes?: { onlyConfig?: boolean }) => refresh(opcoes),
  }),
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
            price: 150,
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
      cartTotal: 150,
      shippingFee: 10,
      clearCart: vi.fn(),
      selectedShippingOption: mundo.opcao,
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

// A ficha da loja, lida no carregamento: o pagamento pelo app está LIGADO.
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => null,
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

function botaoDoPixPeloApp(): HTMLButtonElement | undefined {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Pagar agora com PIX"),
  ) as HTMLButtonElement | undefined;
}

function botaoFinalizar() {
  return document.body.querySelector<HTMLButtonElement>(
    'button[aria-label="Finalizar pedido"]',
  )!;
}

function textoDaTela() {
  return (document.body.textContent ?? "").replace(/\s/g, " ");
}

describe("CheckoutView — a loja desliga o pagamento pelo app com o checkout aberto", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockReset();
    onNavigate.mockClear();
    toastError.mockReset();
    refresh.mockClear();
    mundo.opcao = { ...ENTREGA_LOCAL };
    // O "servidor": a lojista já desligou o pagamento pelo app.
    createOrder.mockImplementation(
      async (orderData: { paymentMethod: string }) => {
        if (orderData.paymentMethod === "online") {
          throw { ...RECUSA_DA_FORMA_DESLIGADA };
        }
        return { id: "ped-aceito", totalAmount: 160 };
      },
    );
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(async () => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    const { esquecerRecusaDoPagamentoPeloApp } = await import(
      "@/lib/pagamento-pelo-app-na-sessao"
    );
    esquecerRecusaDoPagamentoPeloApp();
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

  async function escolherPixPeloAppEFinalizar() {
    await act(async () => {
      botaoDoPixPeloApp()!.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      // A transportadora pede o CPF de quem recebe (fixture inventada).
      if (document.getElementById("checkout-cpf")) {
        digitar("checkout-cpf", "111.444.777-35");
      }
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    expect(botaoFinalizar().disabled).toBe(false);
    await act(async () => {
      botaoFinalizar().click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("depois da recusa, o PIX pelo app some da tela e o Finalizar diz o que fazer, em vez de oferecer de novo a forma recusada", async () => {
    await renderizar();
    expect(botaoDoPixPeloApp()).toBeDefined();

    await escolherPixPeloAppEFinalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    await expect(createOrder.mock.results[0].value).rejects.toMatchObject(
      RECUSA_DA_FORMA_DESLIGADA,
    );
    expect(refresh).toHaveBeenCalledWith({ onlyConfig: true });
    await act(async () => {
      await esperarMicrotarefas();
    });

    // O grupo "No app" sumiu: nada de oferecer de novo o que a loja recusou.
    expect(botaoDoPixPeloApp()).toBeUndefined();
    // E a cliente sabe a saída: escolher um meio na entrega.
    expect(textoDaTela()).toContain(
      "Pagamento pelo app indisponível — escolha um meio de pagamento na entrega",
    );
    // O Finalizar não reenvia a forma recusada.
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("a recusa vale para a sessão: sair do checkout e voltar não traz o PIX pelo app de volta", async () => {
    await renderizar();
    await escolherPixPeloAppEFinalizar();
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(botaoDoPixPeloApp()).toBeUndefined();

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await renderizar();

    expect(botaoDoPixPeloApp()).toBeUndefined();
  });

  it("com transportadora (só o app é aceito): depois da recusa, o PIX some e a tela manda falar com a loja, em vez de deixar a cliente em laço", async () => {
    mundo.opcao = { ...TRANSPORTADORA };
    await renderizar();
    // A transportadora já marca o PIX pelo app sozinha.
    expect(botaoDoPixPeloApp()).toBeDefined();

    await escolherPixPeloAppEFinalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].paymentMethod).toBe("online");
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(botaoDoPixPeloApp()).toBeUndefined();
    expect(textoDaTela()).toContain(
      "esta loja não recebe pagamento pelo app. Fale com a loja para combinar a entrega.",
    );
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("CONTROLE: recusa de OUTRA forma (pagar na entrega) não esconde o PIX pelo app", async () => {
    createOrder.mockImplementation(async () => {
      throw { ...RECUSA_DA_FORMA_DESLIGADA };
    });
    await renderizar();
    const naEntrega = [...document.body.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Pix na "),
    ) as HTMLButtonElement | undefined;
    expect(naEntrega).toBeDefined();
    await act(async () => {
      naEntrega!.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    await act(async () => {
      botaoFinalizar().click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder.mock.calls[0][0].paymentMethod).toBe("pix");
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(botaoDoPixPeloApp()).toBeDefined();
  });
});
