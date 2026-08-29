// @vitest-environment jsdom
//
// O painel `SaidaDaRecusa` promete, por escrito, que `conferir_antes` NUNCA
// oferece "tentar de novo" — é o caso em que não se sabe se o pedido nasceu,
// e repetir debita estoque duas vezes e queima cupom de uso único
// (SaidaDaRecusa.tsx:17-20). Até esta correção, essa promessa cobria só o
// próprio painel: o botão "Finalizar Pedido", logo acima dele, continuava
// habilitado — a rede falha sem `code`, o classificador cai em
// `conferir_antes`, `isSubmitting` volta a `false` no `finally`, e a pessoa
// podia clicar de novo por cima do próprio aviso.
//
// Modelo estrutural copiado de checkout-view-erro-de-pedido-traduzido.test.tsx
// (mesmo harness de render real via react-dom/client + jsdom, necessário
// porque o botão "Finalizar Pedido" só existe depois do ciclo de vida de
// verdade: useDeferredRender(380) e a validação do react-hook-form).
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
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

// Espalha o módulo REAL (classificarRecusaDoPedido incluída) e só troca o
// hook — CheckoutView chama `decidirSaidaDoCheckout` (que delega para
// `classificarRecusaDoPedido`) direto do módulo importado, e um mock que a
// omitisse faria a classificação real nunca rodar.
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

function localizarBotaoFecharAviso() {
  return document.body.querySelector(
    'button[aria-label="Fechar o aviso"]',
  ) as HTMLButtonElement | null;
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

describe("CheckoutView — o botão Finalizar Pedido obedece o painel de conferir_antes", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockReset();
    clearCart.mockClear();
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

  it("recusa SEM code nem message (rede falhou, ninguém sabe se o pedido nasceu): o painel de conferir_antes aparece e o Finalizar Pedido fica DESABILITADO", async () => {
    createOrder.mockRejectedValueOnce({});
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

    // Confirma que caiu no caso certo antes de julgar o botão — senão um
    // teste que sempre passa (porque o painel nem apareceu) passaria oco.
    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      document.querySelector('button[data-acao="conferir_antes"]'),
    ).not.toBeNull();

    const botaoFinalizar = localizarBotaoFinalizar()!;
    expect(botaoFinalizar.disabled).toBe(true);
  });

  it("recusa com SQLSTATE (ex.: falha transitória do Postgres): o painel de tentar_de_novo aparece e o Finalizar Pedido continua HABILITADO", async () => {
    createOrder.mockRejectedValueOnce({
      code: "08006",
      message: "connection failure",
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

    expect(document.querySelector('[role="alert"]')).not.toBeNull();
    expect(
      document.querySelector('button[data-acao="tentar_de_novo"]'),
    ).not.toBeNull();

    const botaoFinalizar = localizarBotaoFinalizar()!;
    // Aqui o reenvio manual É a saída desenhada (recusaDoPedido.ts:150-154):
    // travar o botão empurraria a pessoa para um desvio que a própria regra
    // diz que não precisa existir.
    expect(botaoFinalizar.disabled).toBe(false);
  });

  it("fechar o painel de conferir_antes (botão 'Fechar o aviso') destrava o Finalizar Pedido de novo", async () => {
    createOrder.mockRejectedValueOnce({});
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

    expect(localizarBotaoFinalizar()!.disabled).toBe(true);

    const botaoFechar = localizarBotaoFecharAviso()!;
    expect(botaoFechar).not.toBeNull();
    await act(async () => {
      botaoFechar.click();
      await esperarMicrotarefas();
    });

    // O painel sumiu (a prova de que fechar realmente rodou)...
    expect(document.querySelector('[role="alert"]')).toBeNull();
    // ...e o botão volta a decidir sozinho, sem a trava do painel morto.
    // Isto é o que prova que a trava é um ATO deliberado (fechar o aviso),
    // não uma porta fechada de vez.
    expect(localizarBotaoFinalizar()!.disabled).toBe(false);
  });
});
