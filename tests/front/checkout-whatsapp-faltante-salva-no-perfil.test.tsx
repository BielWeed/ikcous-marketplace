// @vitest-environment jsdom
// Checkout real; só as fronteiras de rede/conta são dublês.
// Sem a gravação pós-pedido o primeiro caso falha; sem as guardas, os
// controles de perfil preenchido, convidado e conta desconhecida falham.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

type Perfil = { id: string; full_name: string; whatsapp: string | null };
const { conta, createOrder, updateProfile, toastError, clearCart, online } =
  vi.hoisted(() => ({
    conta: {
      user: { id: "user-1" } as { id: string } | null,
      profile: null as Perfil | null,
    },
    createOrder: vi.fn(),
    updateProfile: vi.fn(),
    toastError: vi.fn(),
    clearCart: vi.fn(),
    online: { ligado: false },
  }));
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const CARRINHO = [
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
      createdAt: "2026-11-14T00:00:00.000Z",
    },
    quantity: 1,
  },
];
const RETIRADA = {
  id: "store-pickup",
  name: "Retirar na loja",
  price: 0,
  deliveryDays: 0,
  provider: "pickup",
  pickupAddress: "Rua Fictícia, 100",
};
vi.mock("@/lib/sessao-ainda-e-do-dono", () => ({
  sessaoAindaEhDoDono: async () => true,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localDeliveryEnabled: false,
      enabledShippingMethods: ["store-pickup"],
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
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ ...conta, loading: false, updateProfile }),
}));
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: CARRINHO,
      cartTotal: 100,
      shippingFee: 0,
      clearCart,
      removeFromCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: RETIRADA,
      shippingCep: "38500000",
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
    })),
  };
});
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => online.ligado,
  lerFlagPagamentoOnline: (valor: string | undefined) => valor === "true",
}));
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return { useConfigDoCartao: () => estadoPronto(null) };
});
vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: ({ orderId }: { orderId: string }) => (
    <div role="status">Pagamento disponível: {orderId}</div>
  ),
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: vi.fn() },
}));
// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function digitar(id: string, valor: string) {
  const campo = document.getElementById(id) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )!.set!.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}
const esperar = () => new Promise((resolve) => setTimeout(resolve, 0));
function pendente<T>() {
  let resolver!: (valor: T) => void;
  const promessa = new Promise<T>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

describe("CheckoutView — guarda o WhatsApp que faltava sem atrapalhar a compra", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    online.ligado = false;
    conta.user = { id: "user-1" };
    conta.profile = { id: "user-1", full_name: "Cliente Teste", whatsapp: "" };
    createOrder
      .mockReset()
      .mockResolvedValue({ id: "pedido-1", totalAmount: 100 });
    updateProfile.mockReset().mockResolvedValue(true);
    clearCart.mockReset();
    toastError.mockReset();
    pararABuscaDeCep();
    for (const nome of ["localStorage", "sessionStorage"]) {
      const dados = new Map<string, string>();
      vi.stubGlobal(nome, {
        getItem: (chave: string) => dados.get(chave) ?? null,
        setItem: (chave: string, valor: string) => {
          dados.set(chave, valor);
        },
        removeItem: (chave: string) => {
          dados.delete(chave);
        },
      });
    }
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
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
      await esperar();
    });
  }
  async function preencher(whatsapp = "34999999999") {
    await renderizar();
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      digitar("checkout-tel", whatsapp);
      if (!conta.user) digitar("guest-cep", "38500000");
      await esperar();
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
  }
  const finalizar = () =>
    [...document.body.querySelectorAll("button")].find((botao) =>
      botao.textContent?.includes("Finalizar Pedido"),
    ) as HTMLButtonElement;
  async function enviar() {
    expect(finalizar().disabled).toBe(false);
    await act(async () => {
      finalizar().click();
      await esperar();
      await esperar();
    });
    expect(createOrder).toHaveBeenCalledTimes(1);
  }
  function compraConcluida() {
    expect(clearCart).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("Pedido recebido!");
    expect(toastError).not.toHaveBeenCalled();
  }

  it.each(["", null, "   "])(
    "grava só o WhatsApp no perfil vazio (%j), após criar o pedido",
    async (whatsapp) => {
      conta.profile!.whatsapp = whatsapp;
      const pedido = pendente<{ id: string; totalAmount: number }>();
      createOrder.mockReturnValue(pedido.promessa);
      await preencher();
      await enviar();
      expect(updateProfile).not.toHaveBeenCalled();
      await act(async () => {
        pedido.resolver({ id: "pedido-1", totalAmount: 100 });
        await esperar();
      });
      expect(updateProfile).toHaveBeenCalledExactlyOnceWith(
        { whatsapp: "(34) 99999-9999" },
        { silencioso: true, contaEsperada: "user-1" },
      );
      compraConcluida();
    },
  );

  it("não troca o número já salvo pelo número diferente desta entrega", async () => {
    conta.profile!.whatsapp = "11988887777";
    await preencher();
    await enviar();
    expect(updateProfile).not.toHaveBeenCalled();
    compraConcluida();
  });

  it("não grava perfil na compra de visitante, mesmo com número válido", async () => {
    conta.user = null;
    conta.profile = null;
    await preencher();
    await enviar();
    expect(updateProfile).not.toHaveBeenCalled();
    compraConcluida();
  });

  it.each(["ausente", "outra conta"])(
    "não presume vazio um perfil %s",
    async (caso) => {
      conta.profile =
        caso === "ausente"
          ? null
          : {
              id: "outra-conta",
              full_name: "Outra pessoa",
              whatsapp: "",
            };
      await preencher();
      await enviar();
      expect(updateProfile).not.toHaveBeenCalled();
      compraConcluida();
    },
  );

  it("não envia nem grava número incompleto pela mesma validação do checkout", async () => {
    await preencher("3499999999");
    expect(finalizar().disabled).toBe(true);
    expect(createOrder).not.toHaveBeenCalled();
    expect(updateProfile).not.toHaveBeenCalled();
  });

  it("falha silenciosa ao gravar não desfaz nem bloqueia o pedido", async () => {
    updateProfile.mockResolvedValue(false);
    await preencher();
    await enviar();
    expect(updateProfile).toHaveBeenCalledTimes(1);
    compraConcluida();
  });

  it("gravação pendurada não atrasa a confirmação do pedido", async () => {
    const gravacao = pendente<boolean>();
    updateProfile.mockReturnValue(gravacao.promessa);
    try {
      await preencher();
      await enviar();
      expect(updateProfile).toHaveBeenCalledTimes(1);
      compraConcluida();
    } finally {
      await act(async () => {
        gravacao.resolver(true);
        await esperar();
      });
    }
  });

  it("rejeição inesperada da gravação não vira erro de pedido nem expõe o número", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    updateProfile.mockRejectedValue(new Error("34999999999"));
    await preencher();
    await enviar();
    expect(updateProfile).toHaveBeenCalledTimes(1);
    compraConcluida();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "[Checkout] Não foi possível salvar o WhatsApp no perfil.",
    );
  });

  it("libera o pagamento online enquanto a gravação do perfil não responde", async () => {
    online.ligado = true;
    const gravacao = pendente<boolean>();
    updateProfile.mockReturnValue(gravacao.promessa);
    try {
      await preencher();
      await act(async () => {
        const pagarAgora = [...document.body.querySelectorAll("button")].find(
          (botao) => botao.textContent?.includes("Pagar agora com PIX"),
        ) as HTMLButtonElement;
        expect(pagarAgora).toBeDefined();
        pagarAgora.click();
        await esperar();
      });
      await enviar();
      expect(createOrder.mock.calls[0][1]).toEqual({
        comPagamentoOnline: true,
      });
      expect(updateProfile).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain(
        "Pagamento disponível: pedido-1",
      );
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        gravacao.resolver(true);
        await esperar();
      });
    }
  });

  it("erro síncrono inesperado da gravação também não bloqueia o pedido", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    updateProfile.mockImplementation(() => {
      throw new Error("34999999999");
    });
    await preencher();
    await enviar();
    compraConcluida();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "[Checkout] Não foi possível salvar o WhatsApp no perfil.",
    );
  });

  it("pedido recusado não grava o WhatsApp no perfil", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    createOrder.mockRejectedValue(new Error("falha de teste"));
    await preencher();
    await enviar();
    expect(updateProfile).not.toHaveBeenCalled();
    expect(clearCart).not.toHaveBeenCalled();
  });

  it("não sobrescreve perfil preenchido enquanto o pedido estava em voo", async () => {
    const pedido = pendente<{ id: string; totalAmount: number }>();
    createOrder.mockReturnValue(pedido.promessa);
    await preencher();
    await enviar();
    conta.profile = { ...conta.profile!, whatsapp: "11988887777" };
    await renderizar();
    await act(async () => {
      pedido.resolver({ id: "pedido-1", totalAmount: 100 });
      await esperar();
    });
    expect(updateProfile).not.toHaveBeenCalled();
    compraConcluida();
  });
});
