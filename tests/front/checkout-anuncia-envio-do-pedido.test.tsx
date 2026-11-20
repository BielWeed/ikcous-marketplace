// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { concluirBuscaDeCepSemEndereco } from "./duble-busca-de-cep";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const { estado } = vi.hoisted(() => {
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
    estado: {
      user: null as null | { id: string },
      enderecos: [] as unknown[],
      cart: [{ product: produto, quantity: 1 }] as unknown[],
      cartTotal: 100,
      config: {
        shippingCoverage: "local",
        originCep: "38500-000",
        localCepRange: "01310-100",
        enableCoupons: false,
        whatsappNumber: "",
      } as Record<string, unknown>,
      offline: false,
      // Lote 257: liga a conferência de sessão REAL (o dublê da lib sai do meio).
      libReal: false,
    },
  };
});

const createOrder = vi.fn();
const clearCart = vi.fn();
const removeFromCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();
const toastInfo = vi.fn();
const sessaoAindaEhDoDono = vi.fn();
const getSession = vi.fn();

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
      addresses: estado.enderecos,
      addAddress: vi.fn(),
      updateAddress: vi.fn(),
      loading: false,
    }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, profile: null, loading: false }),
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

vi.mock("@/lib/sessao-ainda-e-do-dono", async (importOriginal) => {
  const real =
    await importOriginal<typeof import("@/lib/sessao-ainda-e-do-dono")>();
  return {
    sessaoAindaEhDoDono: (...args: unknown[]) =>
      estado.libReal
        ? (real.sessaoAindaEhDoDono as (...a: unknown[]) => unknown)(...args)
        : sessaoAindaEhDoDono(...args),
  };
});

vi.mock("@/lib/supabase", () => ({
  supabase: {
    auth: { getSession: (...args: unknown[]) => getSession(...args) },
  },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({
  useOnlineStatus: () => estado.offline,
}));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({
  toast: { error: toastError, success: vi.fn(), info: toastInfo },
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

const botaoFinalizar = () => botaoPorTexto("Finalizar Pedido");

/** Convidada: preenche o formulário inteiro e espera o botão. */
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
    botaoFinalizar()!.click();
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

it("anuncia o envio na mesma região de status e limpa quando a tentativa termina", async () => {
  const { CheckoutView } = await import("@/views/customer/CheckoutView");
  sessionStorage.clear();
  concluirBuscaDeCepSemEndereco();
  const dados = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => dados.set(chave, valor),
    removeItem: (chave: string) => dados.delete(chave),
  });
  let falhar!: (erro: Error) => void;
  createOrder.mockImplementationOnce(
    () =>
      new Promise((_resolve, reject) => {
        falhar = reject;
      }),
  );

  const hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  const raiz = createRoot(hospedeiro);
  const acharStatus = () =>
    document.body
      .querySelector('[aria-label="Finalizar pedido"]')
      ?.closest(".bottom-docked-navigation")
      ?.querySelector('[role="status"]');

  try {
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await preencherComoConvidada();
    const status = acharStatus();
    expect(status).toBeInstanceOf(HTMLElement);
    expect(status?.textContent).toBe("");

    const finalizar = botaoFinalizar();
    expect(finalizar?.disabled).toBe(false);
    await clicarFinalizar();
    expect(createOrder).toHaveBeenCalledTimes(1);
    expect(finalizar?.disabled).toBe(true);
    expect(acharStatus()).toBe(status);
    expect(status?.textContent).toBe("Enviando pedido…");

    await act(async () => falhar(new Error("Rede indisponível no teste")));
    expect(acharStatus()).toBe(status);
    expect(status?.textContent).toBe("");
    expect(botaoFinalizar()).toBe(finalizar);
  } finally {
    act(() => raiz.unmount());
    hospedeiro.remove();
    sessionStorage.clear();
    vi.unstubAllGlobals();
  }
});
