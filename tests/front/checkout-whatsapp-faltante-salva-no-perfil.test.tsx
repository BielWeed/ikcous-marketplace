// @vitest-environment jsdom
// Checkout real; só as fronteiras de rede/conta são dublês.
// Sem a gravação pós-pedido o primeiro caso falha; sem as guardas, os
// controles de perfil preenchido, convidado e conta desconhecida falham.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { pararABuscaDeCep } from "./duble-busca-de-cep";

type Perfil = { id: string; full_name: string; whatsapp: string | null };
const {
  conta,
  createOrder,
  updateProfile,
  fetchProfile,
  toastError,
  clearCart,
  online,
} = vi.hoisted(() => ({
  conta: {
    user: { id: "user-1" } as { id: string } | null,
    profile: null as Perfil | null,
  },
  createOrder: vi.fn(),
  updateProfile: vi.fn(),
  fetchProfile: vi.fn(),
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
  useAuth: () => ({ ...conta, loading: false, updateProfile, fetchProfile }),
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
const { from, update, eq, is, setHeader, rpc, getSession } = vi.hoisted(() => ({
  from: vi.fn(),
  update: vi.fn(),
  eq: vi.fn(),
  is: vi.fn(),
  setHeader: vi.fn(),
  rpc: vi.fn(),
  getSession: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from,
    rpc,
    auth: { getSession },
  },
}));
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
    updateProfile.mockReset();
    fetchProfile.mockReset().mockResolvedValue(true);
    rpc.mockReset();
    from.mockReset().mockReturnValue({ update });
    update.mockReset().mockReturnValue({ eq });
    eq.mockReset().mockReturnValue({ eq, is, setHeader });
    is.mockReset().mockReturnValue({ setHeader });
    setHeader.mockReset().mockResolvedValue({ data: null, error: null });
    getSession.mockReset().mockImplementation(async () => ({
      data: { session: { user: conta.user, access_token: "token-de-teste" } },
      error: null,
    }));
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
    expect(updateProfile).not.toHaveBeenCalled();
    expect(
      rpc.mock.calls.some(([nome]) => nome === "update_my_profile_secure"),
    ).toBe(false);
  }

  function simularWhatsappNoBanco(whatsapp: string | null) {
    const perfilNoBanco = { whatsapp };
    setHeader.mockImplementation(async () => {
      const filtro =
        is.mock.calls.find(([coluna]) => coluna === "whatsapp") ??
        eq.mock.calls.find(([coluna]) => coluna === "whatsapp");
      if (filtro?.[1] === perfilNoBanco.whatsapp) {
        perfilNoBanco.whatsapp = update.mock.calls[0][0].whatsapp;
      }
      return { data: null, error: null };
    });
    return perfilNoBanco;
  }

  it.each(["", null, "   "])(
    "grava só o WhatsApp no perfil vazio (%j), após criar o pedido",
    async (whatsapp) => {
      conta.profile!.whatsapp = whatsapp;
      const perfilNoBanco = simularWhatsappNoBanco(whatsapp);
      const pedido = pendente<{ id: string; totalAmount: number }>();
      createOrder.mockReturnValue(pedido.promessa);
      await preencher();
      await enviar();
      expect(from).not.toHaveBeenCalled();
      await act(async () => {
        pedido.resolver({ id: "pedido-1", totalAmount: 100 });
        await esperar();
      });
      expect(perfilNoBanco.whatsapp).toBe("(34) 99999-9999");
      expect(from).toHaveBeenCalledExactlyOnceWith("profiles");
      if (whatsapp === null) {
        expect(eq).toHaveBeenCalledExactlyOnceWith("id", "user-1");
        expect(is).toHaveBeenCalledExactlyOnceWith("whatsapp", null);
      } else {
        expect(eq.mock.calls).toEqual([
          ["id", "user-1"],
          ["whatsapp", whatsapp],
        ]);
        expect(is).not.toHaveBeenCalled();
      }
      expect(update).toHaveBeenCalledExactlyOnceWith({
        whatsapp: "(34) 99999-9999",
      });
      expect(setHeader).toHaveBeenCalledExactlyOnceWith(
        "Authorization",
        "Bearer token-de-teste",
      );
      expect(fetchProfile).toHaveBeenCalledExactlyOnceWith();
      compraConcluida();
    },
  );

  it("não sobrescreve WhatsApp salvo por outro aparelho mesmo se a cópia local estiver vazia", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    conta.profile!.whatsapp = "   ";
    const perfilNoBanco = simularWhatsappNoBanco("   ");
    await preencher();
    // Outro aparelho grava depois que este aqui já leu o perfil.
    perfilNoBanco.whatsapp = "11988887777";
    await enviar();

    expect(from).toHaveBeenCalledExactlyOnceWith("profiles");
    expect(update).toHaveBeenCalledExactlyOnceWith({
      whatsapp: "(34) 99999-9999",
    });
    expect(eq.mock.calls).toEqual([
      ["id", "user-1"],
      ["whatsapp", "   "],
    ]);
    expect(setHeader).toHaveBeenCalledTimes(1);
    expect(perfilNoBanco.whatsapp).toBe("11988887777");
    expect(createOrder.mock.calls[0][0].customer.whatsapp).toBe(
      "(34) 99999-9999",
    );
    expect(log).not.toHaveBeenCalled();
    compraConcluida();
  });

  it("não troca o número já salvo pelo número diferente desta entrega", async () => {
    conta.profile!.whatsapp = "11988887777";
    await preencher();
    await enviar();
    expect(from).not.toHaveBeenCalled();
    compraConcluida();
  });

  it("não grava perfil na compra de visitante, mesmo com número válido", async () => {
    conta.user = null;
    conta.profile = null;
    await preencher();
    await enviar();
    expect(from).not.toHaveBeenCalled();
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
      expect(from).not.toHaveBeenCalled();
      compraConcluida();
    },
  );

  it("não envia nem grava número incompleto pela mesma validação do checkout", async () => {
    await preencher("3499999999");
    expect(finalizar().disabled).toBe(true);
    expect(createOrder).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it("falha silenciosa ao gravar não desfaz nem bloqueia o pedido", async () => {
    setHeader.mockResolvedValue({ data: null, error: { message: "sem rede" } });
    await preencher();
    await enviar();
    expect(setHeader).toHaveBeenCalledTimes(1);
    compraConcluida();
  });

  it("gravação pendurada não atrasa a confirmação do pedido", async () => {
    const gravacao = pendente<{ data: null; error: null }>();
    setHeader.mockReturnValue(gravacao.promessa);
    try {
      await preencher();
      await enviar();
      expect(setHeader).toHaveBeenCalledTimes(1);
      compraConcluida();
    } finally {
      await act(async () => {
        gravacao.resolver({ data: null, error: null });
        await esperar();
      });
    }
  });

  it("rejeição inesperada da gravação não vira erro de pedido nem expõe o número", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    setHeader.mockRejectedValue(new Error("34999999999"));
    await preencher();
    await enviar();
    expect(setHeader).toHaveBeenCalledTimes(1);
    compraConcluida();
    expect(log).toHaveBeenCalledExactlyOnceWith(
      "[Checkout] Não foi possível salvar o WhatsApp no perfil.",
    );
  });

  it("libera o pagamento online enquanto a gravação do perfil não responde", async () => {
    online.ligado = true;
    const gravacao = pendente<{ data: null; error: null }>();
    setHeader.mockReturnValue(gravacao.promessa);
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
      expect(setHeader).toHaveBeenCalledTimes(1);
      expect(document.body.textContent).toContain(
        "Pagamento disponível: pedido-1",
      );
      expect(toastError).not.toHaveBeenCalled();
    } finally {
      await act(async () => {
        gravacao.resolver({ data: null, error: null });
        await esperar();
      });
    }
  });

  it("erro síncrono inesperado da gravação também não bloqueia o pedido", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    update.mockImplementation(() => {
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
    expect(from).not.toHaveBeenCalled();
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
    expect(from).not.toHaveBeenCalled();
    compraConcluida();
  });

  it("não grava o perfil se a sessão mudou depois do pedido", async () => {
    getSession.mockResolvedValue({
      data: {
        session: { user: { id: "outra-conta" }, access_token: "outro-token" },
      },
      error: null,
    });
    await preencher();
    await enviar();
    expect(from).not.toHaveBeenCalled();
    compraConcluida();
  });
});
