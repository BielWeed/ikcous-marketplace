// @vitest-environment jsdom
//
// Visitante com mais de 10 unidades é avisado ANTES de enviar (lote 238, caça
// 11-A #2). O freio é do banco (migration 20261394000000: sem conta e fora do
// pagamento online, no máximo 10 unidades por pedido, somando as linhas) — o
// visitante só descobria no último toque, depois de preencher nome, WhatsApp e
// endereço. O checkout já avisa antes o caso irmão "fora da cidade é só com
// conta"; este teste prende o mesmo para as unidades:
//   1. visitante, 11 unidades (ou 6 + 5 em duas linhas): aviso com a frase do
//      banco, "Finalizar" apagado, porta para entrar na conta, e a RPC não é
//      chamada;
//   2. visitante, exatamente 10: sem aviso (o limite é "mais de 10");
//   3. cliente com conta, 11 unidades: sem aviso (o teto não vale para ela).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FRASE_TETO_DE_UNIDADES_DO_VISITANTE,
  LIMITE_DE_UNIDADES_DO_VISITANTE,
  classificarRecusaDoPedido,
} from "@/lib/recusaDoPedido";

const FRASE_DO_BANCO =
  "Sem entrar na conta, o pedido aceita até 10 unidades. Entre na conta para comprar mais.";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig, mundo } = vi.hoisted(() => ({
  mockConfig: { shippingCoverage: "national", originCep: "38500-000" },
  mundo: {
    usuario: null as null | { id: string; email: string },
    quantidades: [11] as number[],
    createOrder: undefined as unknown as (...args: unknown[]) => unknown,
  },
}));

// A calculadora de frete do checkout (cotação automática pelo endereço)
// tem suíte própria (shipping-calculator-*.test.tsx e
// checkout-frete-automatico-*.test.tsx). Aqui ela é neutra: não cota, não
// mexe na opção de frete que o teste preparou e não reporta status.
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
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

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mundo.usuario, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({
    cart: mundo.quantidades.map((quantity, i) => ({
      product: {
        id: `prod-${i}`,
        name: `Produto Teste ${i}`,
        description: "",
        price: 10,
        images: [],
        category: "geral",
        stock: 50,
        sold: 0,
        isActive: true,
        isBestseller: false,
        freeShipping: false,
        createdAt: new Date(0).toISOString(),
      },
      quantity,
    })),
    cartTotal: 10 * mundo.quantidades.reduce((a, b) => a + b, 0),
    shippingFee: 0,
    freteIndefinido: false,
    clearCart: vi.fn(),
    selectedShippingOption: null,
    shippingCep: "",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: mundo.createOrder }),
}));

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão de
// checkout-guest-cep.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("CheckoutView (visitante) — aviso das mais de 10 unidades antes de enviar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    mundo.usuario = null;
    mundo.quantidades = [11];
    mundo.createOrder = vi.fn();
    onNavigate.mockClear();
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
    vi.stubGlobal(
      "fetch",
      vi.fn(() => new Promise(() => {})),
    );
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
  });

  async function montar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    // A barra do "Finalizar" nasce com atraso (useDeferredRender).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
  }

  const textoDaTela = () =>
    (document.body.textContent ?? "").replace(/\s/g, " ");

  function botaoFinalizar(): HTMLButtonElement {
    const botao = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Finalizar Pedido"),
    ) as HTMLButtonElement;
    expect(botao).toBeDefined();
    return botao;
  }

  it("11 unidades numa linha: mostra a frase do banco, apaga o Finalizar e oferece entrar na conta", async () => {
    await montar();

    expect(textoDaTela()).toContain(FRASE_DO_BANCO);
    expect(botaoFinalizar().disabled).toBe(true);

    const porta = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Entrar ou criar conta"),
    ) as HTMLButtonElement;
    expect(porta).toBeDefined();
    await act(async () => {
      porta.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("auth");
    expect(mundo.createOrder).not.toHaveBeenCalled();
  });

  it("6 + 5 em duas linhas: a SOMA passa de 10 e o aviso aparece", async () => {
    mundo.quantidades = [6, 5];
    await montar();

    expect(textoDaTela()).toContain(FRASE_DO_BANCO);
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("exatamente 10 unidades: sem aviso (o limite é 'mais de 10')", async () => {
    mundo.quantidades = [10];
    await montar();

    botaoFinalizar(); // âncora: a barra montou
    expect(textoDaTela()).not.toContain("aceita até 10 unidades");
  });

  it("cliente COM conta e 11 unidades: sem aviso (o teto é só de quem não entrou)", async () => {
    mundo.usuario = { id: "u1", email: "cliente@exemplo.com" };
    await montar();

    botaoFinalizar(); // âncora: a barra montou
    expect(textoDaTela()).not.toContain("aceita até 10 unidades");
  });
});

describe("a frase do aviso é a que o banco escreve", () => {
  it("é a frase da migration 20261394000000, e a classificação da recusa a reconhece", () => {
    expect(FRASE_TETO_DE_UNIDADES_DO_VISITANTE).toBe(FRASE_DO_BANCO);
    expect(LIMITE_DE_UNIDADES_DO_VISITANTE).toBe(10);
    expect(
      classificarRecusaDoPedido({
        code: "P0001",
        message: FRASE_TETO_DE_UNIDADES_DO_VISITANTE,
      }).acao,
    ).toBe("entrar_na_conta");
  });
});
