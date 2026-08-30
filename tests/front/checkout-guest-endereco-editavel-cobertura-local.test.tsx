// @vitest-environment jsdom
//
// Regressão introduzida pela Tarefa 4 do plano
// "2026-08-18-o-app-para-de-inventar-endereco": ao tirar os valores
// pré-preenchidos de cidade/estado/CEP, os três campos do endereço do
// convidado continuavam `readOnly` sempre que `shippingCoverage !==
// "national"`. Como eles também nasceram vazios (Tarefa 4), o resultado em
// loja de cobertura LOCAL era um campo travado + vazio + obrigatório: o
// convidado nunca conseguia preencher, "Finalizar Pedido" nunca habilitava,
// e `createOrder` nunca era chamado.
//
// A correção é subtrativa: os campos de endereço do cliente são SEMPRE
// editáveis. A cobertura de entrega da loja decide para onde ela entrega
// (isso é aplicado no `calculate-shipping`, por CEP), nunca onde o cliente
// pode digitar que mora.
//
// Este arquivo prova que, em cobertura local, um convidado consegue DIGITAR
// cidade e estado (o campo não está mais travado) e o pedido fecha de
// verdade (`createOrder` é chamado). Montagem copiada de
// checkout-nao-preenche-endereco-do-cliente.test.tsx e
// checkout-view-flag-on.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-local-1" });
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "local" as "national" | "local",
    originCep: "38500-000" as string | undefined,
      localCepRange: "01310-100",
    storeCity: "Uberlândia" as string | undefined,
    storeState: "MG" as string | undefined,
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: mockConfig,
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

// `user: null` liga o bloco de endereço de convidado — é exatamente o
// caminho onde o defeito vivia.
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
    clearCart: vi.fn(),
    selectedShippingOption: null,
    shippingCep: "",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// outros testes de checkout deste diretório.
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

describe("CheckoutView (convidado, cobertura LOCAL) — endereço editável", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    onNavigate.mockClear();
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
    Object.assign(mockConfig, {
      shippingCoverage: "local",
      originCep: "38500-000",
      storeCity: "Uberlândia",
      storeState: "MG",
    });
  });

  it("os campos de cidade, estado e CEP não estão readOnly", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const cep = document.getElementById("guest-cep") as HTMLInputElement;
    const city = document.getElementById("guest-city") as HTMLInputElement;
    const state = document.getElementById("guest-state") as HTMLInputElement;

    expect(cep.readOnly).toBe(false);
    expect(city.readOnly).toBe(false);
    expect(state.readOnly).toBe(false);
  });

  it("convidado digita cidade e estado e consegue fechar o pedido", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const botaoPix = localizarBotaoPorTexto(hospedeiro, "Pix na Entrega")!;
    expect(botaoPix).toBeDefined();

    // Cada `digitar` no seu próprio `act`, com uma passagem de microtarefas
    // entre um e outro: disparar todos os `onChange` no mesmo lote síncrono
    // faz validações assíncronas concorrentes do zodResolver correrem em
    // paralelo, e a última a resolver pode deixar `formState.isValid`
    // parado em `false` mesmo com `formState.errors` já vazio.
    await act(async () => {
      botaoPix.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("checkout-name", "Cliente Teste");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("checkout-tel", "34999999999");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("guest-cep", "01310-100");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("guest-street", "Rua Teste");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("guest-number", "100");
      await esperarMicrotarefas();
    });
    await act(async () => {
      digitar("guest-neighborhood", "Centro");
      await esperarMicrotarefas();
    });
    // O ponto que este teste prova: em cobertura LOCAL, o campo de cidade e
    // o de estado ACEITAM digitação — antes da correção eles estavam
    // `readOnly` e vazios ao mesmo tempo, e não havia como preenchê-los.
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

    const botaoFinalizar = localizarBotaoPorTexto(
      document.body,
      "Finalizar Pedido",
    );
    expect(botaoFinalizar).toBeDefined();
    expect(botaoFinalizar!.disabled).toBe(false);

    await act(async () => {
      botaoFinalizar!.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
    const [pedidoEnviado] = createOrder.mock.calls[0];
    expect(pedidoEnviado.addressData.city).toBe("Cidade Teste");
    expect(pedidoEnviado.addressData.state).toBe("SP");
  });
});
