// @vitest-environment jsdom
//
// Captura do dono (23/09/2026): cartão "Mais barata" era um, a opção
// marcada era outra, e o total somava a marcada. Antes de criar o pedido o
// checkout confere que a opção marcada é, com o MESMO preço, uma opção da
// cotação que a calculadora mostrou (o envelope do cache do navegador).
// Harness copiado de checkout-view-revisao-do-frete-antes-de-fechar.test.tsx
// (a revisão do envelope BATE aqui — o que se prova é só a conferência).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();
const invoke = vi.fn();
const shippingCalculatorProps: Array<{ forcarNovaCotacaoEm?: number }> = [];

// `chaveDoCacheDeFrete` real (o formato da chave é o contrato do envelope);
// só o COMPONENTE vira dublê neutro.
vi.mock("@/components/ui/custom/ShippingCalculator", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/ui/custom/ShippingCalculator")
    >();
  return {
    ...real,
    ShippingCalculator: (props: { forcarNovaCotacaoEm?: number }) => {
      shippingCalculatorProps.push({
        forcarNovaCotacaoEm: props.forcarNovaCotacaoEm,
      });
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

let mockSelectedShippingOption: {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
} | null = null;
let mockEscolhidoPelaCliente = false;
const setSelectedShippingOption = vi.fn(
  (opt: typeof mockSelectedShippingOption) => {
    mockSelectedShippingOption = opt;
  },
);

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
      shippingFee: mockSelectedShippingOption?.price ?? 30,
      clearCart,
      selectedShippingOption: mockSelectedShippingOption,
      // Mesmo CEP do endereço padrão — a reconciliação de CEP (onda 4 do
      // laudo 3108) não é o que este arquivo prova.
      shippingCep: "38500-000",
      freteEscolhidoPelaCliente: mockEscolhidoPelaCliente,
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

describe("CheckoutView — a opção marcada confere com a cotação na tela antes de fechar", () => {
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
    shippingCalculatorProps.length = 0;
    mockEscolhidoPelaCliente = false;
    mockSelectedShippingOption = {
      id: "melhorenvio-pac",
      name: "PAC",
      price: 30,
      deliveryDays: 6,
      provider: "melhor_envio",
    };
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

  async function gravarEnvelope(revisaoConfig: string, opcoes?: unknown[]) {
    const { chaveDoCacheDeFrete } = await import(
      "@/components/ui/custom/ShippingCalculator"
    );
    // Formato REAL de `EnvelopeDeCacheDeFrete` (ShippingCalculator.tsx):
    // `opcoes`/`gravadoEm`/`assinatura`/`contexto`/`revisaoConfig` — não os
    // nomes inventados que este teste usava antes da revisão.
    armazem.set(
      chaveDoCacheDeFrete("38500000"),
      JSON.stringify({
        opcoes: opcoes ?? [mockSelectedShippingOption],
        revisaoConfig,
        gravadoEm: Date.now(),
        assinatura: "prod-1:1",
        contexto: "cotacao-3",
      }),
    );
  }

  async function montarEFinalizar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const botaoOnline = localizarBotaoPorTexto(
      hospedeiro,
      "Pagar agora com PIX",
    )!;
    await act(async () => {
      botaoOnline.click();
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", "34999999999");
      // TRANSPORTADORA EXIGE CPF (checkout compacto + CPF, 23/09/2026).
      digitar("checkout-cpf", "11144477735");
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

  const REVISAO = "rev-igual";
  function revisaoBate() {
    invoke.mockResolvedValue({ data: { revisaoConfig: REVISAO }, error: null });
  }
  function forcouNovaCotacao(): boolean {
    const ultimo = shippingCalculatorProps.at(-1)?.forcarNovaCotacaoEm ?? 0;
    const primeiro = shippingCalculatorProps[0]?.forcarNovaCotacaoEm ?? 0;
    return ultimo > primeiro;
  }

  it("mesmo id com PREÇO diferente na cotação da tela: não cria o pedido, marca o objeto fresco e avisa", async () => {
    mockEscolhidoPelaCliente = true;
    const fresca = { ...mockSelectedShippingOption!, price: 24.9 };
    await gravarEnvelope(REVISAO, [fresca]);
    revisaoBate();

    await montarEFinalizar();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "O frete foi atualizado. Confira o total e finalize.",
    );
    // A escolha da cliente continua dela, com o preço novo.
    expect(setSelectedShippingOption).toHaveBeenCalledWith(
      expect.objectContaining({ id: "melhorenvio-pac", price: 24.9 }),
      "cliente",
    );
    expect(forcouNovaCotacao()).toBe(false);
  });

  it("opção marcada FORA da cotação da tela: não cria o pedido, limpa a seleção e recota", async () => {
    await gravarEnvelope(REVISAO, [
      {
        id: "melhor-envio-31",
        name: "Loggi — Express",
        price: 10.49,
        deliveryDays: 3,
        provider: "melhor_envio",
      },
    ]);
    revisaoBate();

    await montarEFinalizar();

    expect(createOrder).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "O frete foi atualizado. Confira o total e finalize.",
    );
    expect(setSelectedShippingOption).toHaveBeenCalledWith(null);
    expect(forcouNovaCotacao()).toBe(true);
  });

  it("controle: opção marcada confere com a cotação (id e preço): o pedido nasce com o frete dela", async () => {
    await gravarEnvelope(REVISAO);
    revisaoBate();
    createOrder.mockResolvedValueOnce({ id: "ped-1" });

    await montarEFinalizar();

    expect(createOrder).toHaveBeenCalledTimes(1);
    const pedido = createOrder.mock.calls[0][0] as {
      shippingOptionId: string;
      shippingCost: number;
    };
    expect(pedido.shippingOptionId).toBe("melhorenvio-pac");
    expect(pedido.shippingCost).toBe(30);
    expect(toastError).not.toHaveBeenCalledWith(
      "O frete foi atualizado. Confira o total e finalize.",
    );
  });
});
