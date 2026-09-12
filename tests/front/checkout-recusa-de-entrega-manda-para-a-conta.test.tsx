// @vitest-environment jsdom
//
// Item 3c (12/09/2026): das seis recusas do portão de entrega que caíam em
// `conferir_antes` (destino "Ver meus pedidos" — que não existe para quem
// comprou sem conta), duas resolvem entrando na conta. Este teste prova o
// caminho de PONTA A PONTA: a recusa crua que a RPC devolve tem de terminar
// num `onNavigate("auth")` de verdade, não só numa classificação correta —
// `recusa-do-pedido-classifica.test.ts` já prova a classificação; este
// arquivo prova que `agirNaRecusa` (CheckoutView.tsx) sabe rotear o destino
// "conta", que é NOVO e não tem rede de segurança do compilador (o switch de
// destino não é `Record` exaustivo — só o `DESTINO_DA_ACAO` é).
//
// Modelo estrutural copiado de
// checkout-conferir-antes-tranca-o-finalizar.test.tsx (mesmo harness de
// render real via react-dom/client + jsdom).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn();
const clearCart = vi.fn();
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();
const toastError = vi.fn();

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      shippingCoverage: "local",
      originCep: "38500-000",
      localCepRange: "01310-100",
      enableCoupons: false,
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

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
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
    shippingFee: 0,
    clearCart,
    selectedShippingOption: null,
    shippingCep: "38500-000",
    setSelectedShippingOption: vi.fn(),
    setShippingCep: vi.fn(),
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// Espalha o módulo REAL (classificarRecusaDoPedido incluída) — mesmo motivo
// do arquivo copiado: um mock que a omitisse faria a classificação real
// nunca rodar, e este teste existe para provar o CAMINHO INTEIRO.
vi.mock("@/hooks/useOrders", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({ createOrder, updateOrderStatus: vi.fn() }),
  };
});

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: toastError, success: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros arquivos desta pasta.
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

function localizarBotaoFinalizar() {
  return [...document.body.querySelectorAll("button")].find((b) =>
    b.textContent?.includes("Finalizar Pedido"),
  ) as HTMLButtonElement | undefined;
}

async function preencherEClicarFinalizar() {
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

  const botao = localizarBotaoFinalizar()!;
  await act(async () => {
    botao.click();
    await esperarMicrotarefas();
    await esperarMicrotarefas();
  });
}

describe("CheckoutView — a recusa do gate de convidado manda para a conta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockReset();
    clearCart.mockClear();
    onNavigate.mockClear();
    toastError.mockReset();
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

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("loja sem CEP de origem: o painel oferece 'Entrar ou criar conta', e clicar chama onNavigate('auth')", async () => {
    createOrder.mockRejectedValueOnce({
      code: "P0001",
      message: "A loja ainda está configurando a entrega. Fale com a loja.",
    });
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    await preencherEClicarFinalizar();

    const botaoAcao = document.querySelector(
      'button[data-acao="entrar_na_conta"]',
    ) as HTMLButtonElement | null;
    expect(botaoAcao).not.toBeNull();
    expect(botaoAcao?.textContent).toContain("Entrar ou criar conta");

    // O Finalizar Pedido NÃO trava aqui — diferente de `conferir_antes`,
    // este não é um caso de "não sei se o pedido nasceu": a RPC falha ANTES
    // do INSERT nos dois casos que viram `entrar_na_conta`, então repetir
    // o clique não duplica nada.
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);

    await act(async () => {
      botaoAcao!.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("auth");
    // O painel some depois da ação — mesmo contrato dos outros destinos.
    expect(document.querySelector('[role="alert"]')).toBeNull();
  });

  it("convidado fora da área da loja: mesmo botão, mesmo destino", async () => {
    createOrder.mockRejectedValueOnce({
      code: "P0001",
      message:
        "Compra sem conta é só com entrega na cidade da loja. Entre na sua conta para receber em outro endereço.",
    });
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    await preencherEClicarFinalizar();

    const botaoAcao = document.querySelector(
      'button[data-acao="entrar_na_conta"]',
    ) as HTMLButtonElement | null;
    expect(botaoAcao).not.toBeNull();

    await act(async () => {
      botaoAcao!.click();
    });

    expect(onNavigate).toHaveBeenCalledWith("auth");
  });
});
