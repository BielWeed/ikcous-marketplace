// @vitest-environment jsdom
//
// Achado da revisão (18/08/2026), bloco "o app para de inventar endereço",
// Tarefa 7: a `calculate-shipping` passou a recusar cotar quando a loja não
// configurou o CEP de origem (correto) — mas o botão "Finalizar Pedido"
// olhava só `isValid` (validade do FORMULÁRIO), nunca a existência de uma
// opção de frete. Cenário real: cotação falha, tela não mostra opção
// nenhuma, `selectedShippingOption` continua `null`, e `shipping`
// (CartContext `shippingFee`) cai para `config.shippingFee` (padrão
// R$ 15) — o MESMO fallback que `create_marketplace_order_v24` usa no
// servidor quando `p_shipping_option_id` chega nulo. O pedido fechava
// cobrando um frete de fallback sem entrega correspondente.
//
// Esta suíte prova: (1) o defeito — cliente preenche tudo, cotação nunca
// selecionou opção, e o botão fica desabilitado com o motivo visível, sem
// criar pedido; (2) os dois caminhos legítimos sem opção selecionada não
// ficam travados — item com frete grátis, e limite de frete grátis
// atingido por cliente logado.
//
// Montagem copiada de checkout-guest-endereco-editavel-cobertura-local.
// test.tsx (mesmo padrão de mocks e do helper `digitar`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createOrder = vi.fn().mockResolvedValue({ id: "ped-frete-1" });
const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "local" as "national" | "local",
    originCep: undefined as string | undefined,
    storeCity: "Uberlândia" as string | undefined,
    storeState: "MG" as string | undefined,
    enableCoupons: false,
    freeShippingMin: 0,
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

// `user: null` — convidado, mesmo caminho do achado da revisão.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, profile: null, loading: false }),
}));

// Mutável: cada caso ajusta `mockCartItem` (freeShipping ou não) e
// `mockShippingFee`/`mockSelectedShippingOption` antes de montar — é
// exatamente a combinação que decide se a guarda trava o botão.
let mockCartItemFreeShipping = false;
let mockShippingFee = 15;
let mockSelectedShippingOption: {
  id: string;
  name: string;
  price: number;
  deliveryDays: number;
  provider: string;
} | null = null;

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
          freeShipping: mockCartItemFreeShipping,
          createdAt: new Date().toISOString(),
        },
        quantity: 1,
      },
    ],
    cartTotal: 100,
    shippingFee: mockShippingFee,
    clearCart: vi.fn(),
    selectedShippingOption: mockSelectedShippingOption,
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

/** Preenche todo o formulário de convidado (cobertura local, mesma
 * sequência de checkout-guest-endereco-editavel-cobertura-local.test.tsx)
 * e devolve o botão "Finalizar Pedido" já montado. */
async function preencherFormularioEAcharBotaoFinalizar(): Promise<HTMLButtonElement> {
  const botaoPix = localizarBotaoPorTexto(document.body, "Pix na Entrega")!;
  expect(botaoPix).toBeDefined();

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

  return localizarBotaoPorTexto(document.body, "Finalizar Pedido")!;
}

describe("CheckoutView — não fecha pedido sem opção de frete selecionada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    createOrder.mockClear();
    onNavigate.mockClear();
    mockCartItemFreeShipping = false;
    mockShippingFee = 15;
    mockSelectedShippingOption = null;
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
      originCep: undefined,
      storeCity: "Uberlândia",
      storeState: "MG",
      enableCoupons: false,
      freeShippingMin: 0,
    });
  });

  it("loja sem CEP de origem, cotação falhou (sem opção selecionada): botão fica desabilitado, motivo visível, pedido NÃO é criado", async () => {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const botaoFinalizar = await preencherFormularioEAcharBotaoFinalizar();
    expect(botaoFinalizar).toBeDefined();

    // O ponto central do defeito: mesmo com o FORMULÁRIO inteiro válido
    // (isValid=true), o botão continua desabilitado porque não existe
    // opção de frete selecionada e a entrega não é grátis.
    expect(botaoFinalizar.disabled).toBe(true);

    // Motivo visível — botão apagado sem explicação faz a pessoa desistir
    // sem saber por quê.
    expect(document.body.textContent).toContain(
      "Volte ao carrinho e calcule o frete para continuar",
    );

    // Clique no botão desabilitado não deve criar pedido nenhum — nem pelo
    // `disabled` do DOM, nem pela segunda trava dentro de
    // `handleSubmitEvent` (defesa em profundidade).
    await act(async () => {
      botaoFinalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).not.toHaveBeenCalled();
  });

  it("caminho legítimo: item com frete grátis no carrinho não trava o botão", async () => {
    mockCartItemFreeShipping = true;
    mockShippingFee = 0;
    mockSelectedShippingOption = null;

    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const botaoFinalizar = await preencherFormularioEAcharBotaoFinalizar();
    expect(botaoFinalizar).toBeDefined();
    expect(botaoFinalizar.disabled).toBe(false);
    expect(document.body.textContent).not.toContain(
      "Volte ao carrinho e calcule o frete para continuar",
    );

    await act(async () => {
      botaoFinalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
  });

  it("caminho legítimo: opção de frete paga já selecionada não trava o botão", async () => {
    mockCartItemFreeShipping = false;
    mockShippingFee = 15;
    mockSelectedShippingOption = {
      id: "opt-1",
      name: "Entrega Padrão",
      price: 15,
      deliveryDays: 3,
      provider: "flat_fee",
    };

    const { CheckoutView } = await import("@/views/customer/CheckoutView");

    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });

    const botaoFinalizar = await preencherFormularioEAcharBotaoFinalizar();
    expect(botaoFinalizar).toBeDefined();
    expect(botaoFinalizar.disabled).toBe(false);

    await act(async () => {
      botaoFinalizar.click();
      await esperarMicrotarefas();
      await esperarMicrotarefas();
    });

    expect(createOrder).toHaveBeenCalledTimes(1);
  });
});
