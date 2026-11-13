// @vitest-environment jsdom
//
// CHECKOUT = DINHEIRO (13/11/2026): trocar a modalidade (entrega x retirada)
// ENQUANTO o envio do pedido está em curso mudava a tela, mas o pedido saía
// com a modalidade e o frete capturados no clique de "Finalizar". Loja com
// entrega própria de R$ 10 e retirada grátis: a cliente tocava em Finalizar,
// trocava para retirada durante a espera e o pedido nascia com R$ 10 de
// entrega numa tela que mostrava "retirada, sem frete" (e o inverso).
//
// Duas travas, provadas SEPARADAS (uma não pode esconder o bug da outra):
//   1. A calculadora recebe `bloqueado` enquanto `isSubmitting` — o toque na
//      tela já não troca nada (prova fina em
//      shipping-calculator-bloqueado-durante-o-envio.test.tsx).
//   2. Depois do último `await` e antes de a RPC sair, o checkout relê a
//      escolha VIVA: se não é a do clique, o pedido NÃO nasce, a trava de
//      envio solta e a cliente é avisada. Cobre o que a 1 não cobre: a janela
//      do `form.trigger()` (antes de `isSubmitting` chegar à tela), a recotação
//      automática e a troca de endereço. Aqui a calculadora é um dublê que não
//      trava nada — a mudança entra pelo contexto, direto.
//
// Harness de checkout-view-revisao-do-frete-antes-de-fechar.test.tsx; a
// conferência da sessão é um adiamento controlado — é a espera que abre a
// janela da corrida.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();
const invoke = vi.fn();
const propsDaCalculadora: Array<{ bloqueado?: boolean }> = [];

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
  return {
    ...real,
    // Dublê que NÃO trava nada: a trava 1 não pode mascarar a 2.
    ShippingCalculator: (props: { bloqueado?: boolean }) => {
      propsDaCalculadora.push({ bloqueado: props.bloqueado });
      return null;
    },
  };
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
  useAddresses: () => ({
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
    fetchAddresses: vi.fn(),
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
  pickupAddress?: string;
}

const ENTREGA_PROPRIA: OpcaoDeTeste = {
  id: "local-delivery",
  name: "Entrega pela loja",
  price: 10,
  deliveryDays: 1,
  provider: "local",
};
const RETIRADA: OpcaoDeTeste = {
  id: "store-pickup",
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "pickup",
  pickupAddress: "Rua da Loja, 1 - Centro",
};

let mockSelectedShippingOption: OpcaoDeTeste | null = null;
const setSelectedShippingOption = vi.fn((opt: OpcaoDeTeste | null) => {
  mockSelectedShippingOption = opt;
});

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
      shippingFee: mockSelectedShippingOption?.price ?? 0,
      clearCart,
      selectedShippingOption: mockSelectedShippingOption,
      shippingCep: "38500-000",
      setSelectedShippingOption,
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
  supabase: { functions: { invoke: (...args: unknown[]) => invoke(...args) } },
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

function localizarBotaoPorTexto(
  raiz: ParentNode,
  texto: string,
): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

describe("CheckoutView — trocar entrega x retirada com o pedido em envio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    createOrder.mockReset();
    clearCart.mockClear();
    onNavigate.mockClear();
    toastError.mockReset();
    setSelectedShippingOption.mockClear();
    invoke.mockReset();
    propsDaCalculadora.length = 0;
    liberarSessao = () => {};
    mockSelectedShippingOption = ENTREGA_PROPRIA;
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

  // Preenche e toca em "Finalizar" — o envio PARA na conferência da sessão
  // (adiamento controlado), com `isSubmitting` ligado e nada enviado ainda.
  async function montarEIniciarEnvio() {
    await renderizar();
    const botaoOnline = localizarBotaoPorTexto(
      hospedeiro,
      "Pagar agora com PIX",
    )!;
    await act(async () => {
      botaoOnline.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    )!;
    expect(botaoFinalizar.disabled).toBe(false);
    await act(async () => {
      botaoFinalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  // A mudança entra pelo contexto (como a recotação ou outro caminho que o
  // `disabled` da tela não alcança) e o checkout re-renderiza.
  async function trocarPara(opcao: OpcaoDeTeste | null) {
    setSelectedShippingOption(opcao);
    await renderizar();
  }

  async function terminarASessao() {
    await act(async () => {
      liberarSessao(true);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
  }

  const finalizarHabilitado = () =>
    localizarBotaoPorTexto(document.body, "Finalizar Pedido")?.disabled ===
    false;

  it("TRAVA 1: enquanto o pedido é enviado a calculadora recebe `bloqueado`; antes e depois do envio, não", async () => {
    await montarEIniciarEnvio();
    // Antes de tocar em "Finalizar": livre.
    expect(propsDaCalculadora[0]?.bloqueado).toBeFalsy();
    expect(createOrder).not.toHaveBeenCalled();
    expect(propsDaCalculadora.at(-1)?.bloqueado).toBe(true);

    // Envio termina sem pedido (aqui: a conferência diz que a sessão não vale):
    // a calculadora volta a ficar livre para a cliente corrigir.
    await act(async () => {
      liberarSessao(false);
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });
    expect(createOrder).not.toHaveBeenCalled();
    expect(propsDaCalculadora.at(-1)?.bloqueado).toBe(false);
  });

  it("TRAVA 2 (entrega -> retirada no meio do envio): o pedido NÃO nasce com a entrega de R$ 10; avisa e solta o botão", async () => {
    await montarEIniciarEnvio();
    expect(createOrder).not.toHaveBeenCalled();

    await trocarPara(RETIRADA);
    createOrder.mockResolvedValue({ id: "nao-deveria-nascer" });
    await terminarASessao();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "A forma de entrega mudou enquanto o pedido era enviado. Confira o total e finalize.",
    );
    // A escolha da cliente (retirada) NÃO é desfeita pelo checkout.
    expect(mockSelectedShippingOption).toBe(RETIRADA);
    expect(setSelectedShippingOption).toHaveBeenLastCalledWith(RETIRADA);
    // A trava de envio soltou: ela pode finalizar de novo, já com a retirada.
    expect(finalizarHabilitado()).toBe(true);
  });

  it("TRAVA 2 (retirada -> entrega no meio do envio): o pedido NÃO nasce como retirada", async () => {
    mockSelectedShippingOption = RETIRADA;
    await montarEIniciarEnvio();
    expect(createOrder).not.toHaveBeenCalled();

    await trocarPara(ENTREGA_PROPRIA);
    createOrder.mockResolvedValue({ id: "nao-deveria-nascer" });
    await terminarASessao();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "A forma de entrega mudou enquanto o pedido era enviado. Confira o total e finalize.",
    );
    expect(finalizarHabilitado()).toBe(true);
  });

  it("TRAVA 2 (a seleção some no meio do envio, ex.: troca de endereço): não cria pedido", async () => {
    await montarEIniciarEnvio();
    await trocarPara(null);
    createOrder.mockResolvedValue({ id: "nao-deveria-nascer" });
    await terminarASessao();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "A forma de entrega mudou enquanto o pedido era enviado. Confira o total e finalize.",
    );
  });

  it("TRAVA 2 (mesma opção, mas o preço cotado mudou no meio do envio): não cria pedido com o valor antigo", async () => {
    await montarEIniciarEnvio();
    await trocarPara({ ...ENTREGA_PROPRIA, price: 15 });
    createOrder.mockResolvedValue({ id: "nao-deveria-nascer" });
    await terminarASessao();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "A forma de entrega mudou enquanto o pedido era enviado. Confira o total e finalize.",
    );
  });

  it("SEM troca: o envio segue e o pedido sai com a modalidade e o frete do clique (guarda contra aborto indevido)", async () => {
    await montarEIniciarEnvio();
    createOrder.mockResolvedValue({ id: "ped-ok" });
    await terminarASessao();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        shippingOptionId: "local-delivery",
        shippingCost: 10,
      }),
      expect.anything(),
    );
    expect(toastError).not.toHaveBeenCalledWith(
      "A forma de entrega mudou enquanto o pedido era enviado. Confira o total e finalize.",
    );
  });

  it("o contexto devolve um OBJETO novo da MESMA opção e preço (re-render comum): não é troca, o pedido sai", async () => {
    await montarEIniciarEnvio();
    await trocarPara({ ...ENTREGA_PROPRIA });
    createOrder.mockResolvedValue({ id: "ped-ok" });
    await terminarASessao();

    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        shippingOptionId: "local-delivery",
        shippingCost: 10,
      }),
      expect.anything(),
    );
  });
});
