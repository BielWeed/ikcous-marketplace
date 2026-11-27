// @vitest-environment jsdom
//
// CHECKOUT = DINHEIRO (27/11/2026): a cliente toca em "Finalizar" e, enquanto
// o pedido é enviado (conferência da sessão, revisão do frete, releitura dos
// endereços), troca a forma de pagamento. O pedido sai com a forma do CLIQUE
// (closure de `handleSubmitEvent`), mas a tela passava a mostrar a outra — a
// confirmação dizia "Pix na entrega" para quem viu "Cartão na entrega" marcado.
//
// Duas travas, provadas SEPARADAS (irmãs das do frete em
// checkout-view-frete-trocado-durante-o-envio.test.tsx):
//   1. Durante o envio as opções ficam `aria-disabled` e o toque não troca
//      nada (o foco não cai: `aria-disabled`, não `disabled`).
//   2. Antes de a RPC sair, o checkout relê a forma VIVA: se um efeito a
//      trocou durante a espera (ex.: a loja desligou a forma na entrega), o
//      pedido NÃO nasce, a trava solta e a cliente é avisada.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();

let liberarSessao: (valor: boolean) => void = () => {};
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: () =>
    new Promise<boolean>((resolve) => {
      liberarSessao = resolve;
    }),
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

const ENTREGA_PROPRIA = {
  id: "local-delivery",
  name: "Entrega pela loja",
  price: 10,
  deliveryDays: 1,
  provider: "local",
};

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
      shippingFee: 10,
      clearCart,
      selectedShippingOption: ENTREGA_PROPRIA,
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

const AVISO_FORMA_MUDOU =
  "A forma de pagamento mudou enquanto o pedido era enviado. Confira o pagamento e finalize de novo.";

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

function radio(rotulo: string): HTMLButtonElement {
  const achado = [
    ...document.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
  ].find((b) => b.textContent?.includes(rotulo));
  if (!achado) throw new Error(`opção "${rotulo}" não está na tela`);
  return achado;
}

function botaoFinalizar(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    '[aria-label="Finalizar pedido"]',
  )!;
}

describe("CheckoutView — forma de pagamento com o pedido em envio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    createOrder.mockReset();
    toastError.mockReset();
    liberarSessao = () => {};
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

  // Escolhe a forma, preenche e toca em "Finalizar" — o envio PARA na
  // conferência da sessão, com `isSubmitting` ligado e nada enviado ainda.
  async function montarEIniciarEnvio(forma: string) {
    await renderizar();
    await act(async () => {
      radio(forma).click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    expect(radio(forma).getAttribute("aria-checked")).toBe("true");
    expect(botaoFinalizar().disabled).toBe(false);
    await act(async () => {
      botaoFinalizar().click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  async function terminarASessao() {
    await act(async () => {
      liberarSessao(true);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("TRAVA 1: durante o envio as opções ficam aria-disabled e o toque não troca a forma; o pedido sai com a do clique", async () => {
    await montarEIniciarEnvio("Pix na Entrega");
    expect(createOrder).not.toHaveBeenCalled();

    const cartao = radio("Cartão na Entrega");
    expect(cartao.getAttribute("aria-disabled")).toBe("true");
    // `aria-disabled`, não `disabled`: o controle continua focável.
    expect(cartao.disabled).toBe(false);
    await act(async () => {
      cartao.click();
      await esperarMicrotarefas();
    });
    expect(radio("Pix na Entrega").getAttribute("aria-checked")).toBe("true");
    expect(radio("Cartão na Entrega").getAttribute("aria-checked")).toBe(
      "false",
    );

    createOrder.mockResolvedValue({ id: "ped-ok", totalAmount: 110 });
    await terminarASessao();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: "pix" }),
      expect.anything(),
    );
  });

  it("TRAVA 1: as setas do teclado também não trocam a forma durante o envio", async () => {
    await montarEIniciarEnvio("Pix na Entrega");
    const pix = radio("Pix na Entrega");
    pix.focus();
    await act(async () => {
      pix.dispatchEvent(
        new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }),
      );
      await esperarMicrotarefas();
    });
    expect(radio("Pix na Entrega").getAttribute("aria-checked")).toBe("true");
    expect(document.activeElement).toBe(radio("Pix na Entrega"));
  });

  it("depois do envio (recusado) as opções voltam a responder", async () => {
    await montarEIniciarEnvio("Pix na Entrega");
    await act(async () => {
      liberarSessao(false);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(createOrder).not.toHaveBeenCalled();
    const cartao = radio("Cartão na Entrega");
    expect(cartao.hasAttribute("aria-disabled")).toBe(false);
    await act(async () => {
      cartao.click();
      await esperarMicrotarefas();
    });
    expect(radio("Cartão na Entrega").getAttribute("aria-checked")).toBe(
      "true",
    );
  });

  it("TRAVA 2: a loja desliga a forma do clique durante o envio (efeito troca a escolha) — o pedido NÃO nasce com a forma antiga", async () => {
    await montarEIniciarEnvio("Pix na Entrega");
    configDaLoja.formasPagamentoEntrega = ["card", "cash"];
    await renderizar();
    // A opção do clique saiu da lista e o efeito de fallback marcou outra.
    expect(
      [...document.querySelectorAll('[role="radio"]')].some((b) =>
        b.textContent?.includes("Pix na Entrega"),
      ),
    ).toBe(false);
    expect(radio("Pagar agora com PIX").getAttribute("aria-checked")).toBe(
      "true",
    );

    createOrder.mockResolvedValue({ id: "nao-deveria-nascer" });
    await terminarASessao();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(AVISO_FORMA_MUDOU);
    expect(botaoFinalizar().disabled).toBe(false);
  });

  it("SEM troca: o envio segue com a forma do clique (guarda contra aborto indevido)", async () => {
    await montarEIniciarEnvio("Cartão na Entrega");
    // Re-render comum no meio do envio não é troca.
    await renderizar();
    createOrder.mockResolvedValue({ id: "ped-ok", totalAmount: 110 });
    await terminarASessao();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({ paymentMethod: "card" }),
      expect.anything(),
    );
    expect(toastError).not.toHaveBeenCalledWith(AVISO_FORMA_MUDOU);
  });
});
