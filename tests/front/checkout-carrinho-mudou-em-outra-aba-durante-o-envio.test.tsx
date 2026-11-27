// @vitest-environment jsdom
//
// CHECKOUT = DINHEIRO (27/11/2026): checkout aberto em duas abas (ou o
// carrinho mexido em outro aparelho). A cliente toca em "Finalizar" aqui e,
// durante a espera do envio (sessão, frete, endereços), o carrinho muda pela
// outra aba — o contexto entrega o carrinho novo e a tela já mostra outros
// itens e outro total. O pedido saía com os itens e o total CONGELADOS no
// clique: o servidor recalcula o preço do que recebe, mas recebe os itens
// velhos, e a cliente pagava por um carrinho que a tela não mostra mais.
//
// Mesma régua do frete trocado durante o envio
// (checkout-view-frete-trocado-durante-o-envio.test.tsx): antes de a RPC sair
// o checkout compara o carrinho e o total VIVOS com os do clique; mudou, o
// pedido não nasce, a trava solta e a cliente confere e finaliza de novo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const createOrder = vi.fn();
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

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "national",
      originCep: "38500-000",
      enableCoupons: false,
    },
    isLoaded: true,
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

const ENTREGA_PROPRIA = {
  id: "local-delivery",
  name: "Entrega pela loja",
  price: 10,
  deliveryDays: 1,
  provider: "local",
};

function linha(quantidade: number, preco = 100) {
  return {
    product: {
      id: "prod-1",
      name: "Produto Teste",
      description: "",
      price: preco,
      images: [],
      category: "geral",
      stock: 10,
      sold: 0,
      isActive: true,
      isBestseller: false,
      freeShipping: false,
      createdAt: "2026-11-01T00:00:00.000Z",
    },
    quantity: quantidade,
  };
}

// O carrinho que o CONTEXTO entrega (o que a outra aba gravou chega por aqui).
let carrinho = [linha(1)];

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: carrinho,
      cartTotal: carrinho.reduce(
        (soma, item) => soma + item.product.price * item.quantity,
        0,
      ),
      shippingFee: 10,
      clearCart: vi.fn(),
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

const AVISO_CARRINHO_MUDOU =
  "O carrinho mudou enquanto o pedido era enviado (em outra aba ou aparelho). Confira os itens e o total e finalize de novo.";

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

function botaoFinalizar(): HTMLButtonElement {
  return document.querySelector<HTMLButtonElement>(
    '[aria-label="Finalizar pedido"]',
  )!;
}

describe("CheckoutView — carrinho que muda em outra aba com o pedido em envio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    createOrder.mockReset();
    toastError.mockReset();
    liberarSessao = () => {};
    carrinho = [linha(1)];
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

  async function montarEIniciarEnvio() {
    await renderizar();
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
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
    expect(createOrder).not.toHaveBeenCalled();
  }

  // A outra aba grava; o contexto entrega o carrinho novo e o checkout
  // re-renderiza.
  async function outraAbaGrava(novo: ReturnType<typeof linha>[]) {
    carrinho = novo;
    await renderizar();
  }

  async function terminarASessao() {
    await act(async () => {
      liberarSessao(true);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  it("a quantidade muda na outra aba no meio do envio: o pedido NÃO nasce com o carrinho velho; avisa e solta o botão", async () => {
    await montarEIniciarEnvio();
    await outraAbaGrava([linha(2)]);
    createOrder.mockResolvedValue({ id: "nao-deveria-nascer" });
    await terminarASessao();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(AVISO_CARRINHO_MUDOU);
    expect(botaoFinalizar().disabled).toBe(false);

    // Finalizar de novo leva o carrinho que a tela mostra agora.
    createOrder.mockResolvedValue({ id: "ped-ok", totalAmount: 210 });
    await act(async () => {
      botaoFinalizar().click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await terminarASessao();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ quantity: 2 })],
        totalAmount: 210,
      }),
      expect.anything(),
    );
  });

  it("a outra aba esvazia o carrinho no meio do envio: nenhum pedido nasce", async () => {
    await montarEIniciarEnvio();
    await outraAbaGrava([]);
    createOrder.mockResolvedValue({ id: "nao-deveria-nascer" });
    await terminarASessao();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(AVISO_CARRINHO_MUDOU);
  });

  it("mesmos itens, mas o preço relido mudou no meio do envio: o pedido NÃO nasce com o total antigo", async () => {
    await montarEIniciarEnvio();
    await outraAbaGrava([linha(1, 120)]);
    createOrder.mockResolvedValue({ id: "nao-deveria-nascer" });
    await terminarASessao();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(AVISO_CARRINHO_MUDOU);
  });

  it("o contexto devolve um carrinho NOVO com o MESMO conteúdo (re-render comum): não é troca, o pedido sai", async () => {
    await montarEIniciarEnvio();
    await outraAbaGrava([linha(1)]);
    createOrder.mockResolvedValue({ id: "ped-ok", totalAmount: 110 });
    await terminarASessao();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        items: [expect.objectContaining({ quantity: 1 })],
        totalAmount: 110,
      }),
      expect.anything(),
    );
    expect(toastError).not.toHaveBeenCalledWith(AVISO_CARRINHO_MUDOU);
  });
});
