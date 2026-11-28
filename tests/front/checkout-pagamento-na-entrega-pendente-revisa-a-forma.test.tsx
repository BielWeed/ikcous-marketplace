// @vitest-environment jsdom
//
// A LOJA NOVA SÓ VENDE O QUE A LOJISTA CONFIRMOU (20261655000000): enquanto o
// pagamento na entrega não foi confirmado, `formasNaEntregaOferecidas` zera a
// lista e o checkout fica como a loja que só vende pelo app. A liberação chega
// pelo realtime numa config NOVA — e pode mudar SEM que a lista de formas mude
// (a lojista desfaz a confirmação; as três formas continuam ligadas no painel).
//
// O efeito que reavalia a forma escolhida dependia só de
// `config.formasPagamentoEntrega`: com a mesma lista, ele não rodava, e a
// cliente ficava com "Pix na Entrega" escolhido numa loja que já não aceita
// pagamento na entrega (nenhuma opção marcada na tela, o pedido montado com
// uma forma que a loja recusa). O teste prova a revisão com a MESMA lista (a
// mesma referência) e só a liberação mudando.
//
// Andaime: o de checkout-convidado-loja-so-pelo-app.test.tsx, com a cliente
// LOGADA (o fallback pode ir para "online") e identidades estáveis em tudo que
// é dependência do efeito — opção de frete e usuário novos a cada render
// fariam o efeito rodar por outro motivo e o teste passaria sem a correção.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { comReleituraDeEnderecos } from "./duble-releitura-de-enderecos";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const FORMAS = ["pix", "card", "cash"] as ("pix" | "card" | "cash")[];

const { estado } = vi.hoisted(() => ({
  estado: {
    config: {} as Record<string, unknown>,
  },
}));

function configDaLoja(pagamentoNaEntregaLiberado: boolean) {
  return {
    shippingCoverage: "local",
    originCep: "38500-000",
    enableCoupons: false,
    // A MESMA referência nas duas configs: só a liberação muda.
    formasPagamentoEntrega: FORMAS,
    pagamentoNaEntregaLiberado,
  };
}

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: estado.config, isLoaded: true }),
}));

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () =>
    comReleituraDeEnderecos({
      addresses: [],
      addAddress: vi.fn(),
      updateAddress: vi.fn(),
      loading: false,
    }),
}));

const mockUser = { id: "user-1", email: "cliente@exemplo.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser, profile: null, loading: false }),
}));

const carrinho = [
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
      createdAt: "2026-11-28T00:00:00.000Z",
    },
    quantity: 1,
  },
];
const entregaLocal = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 0,
  deliveryDays: 1,
  provider: "local",
};
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: carrinho,
      cartTotal: 100,
      shippingFee: 0,
      freteIndefinido: false,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      selectedShippingOption: entregaLocal,
      shippingCep: "38500-000",
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn() }),
}));

const mockConfigDoCartao = { credito: true, debito: false, parcelasMax: 6 };
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return { useConfigDoCartao: () => estadoPronto(mockConfigDoCartao) };
});

vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

vi.mock("@/components/checkout/PagamentoOnline", () => ({
  PagamentoOnline: () => <div data-testid="pagamento-online-brick" />,
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function opcaoMarcada(): string | null {
  const marcada = document.querySelector<HTMLElement>(
    '[role="radiogroup"][aria-label="Meio de pagamento"] [role="radio"][aria-checked="true"]',
  );
  return marcada ? (marcada.textContent ?? "").replace(/\u00A0/g, " ") : null;
}

describe("CheckoutView — a liberação do pagamento na entrega muda sem a lista de formas mudar", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    estado.config = configDaLoja(true);
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
    vi.restoreAllMocks();
  });

  async function desenhar() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      await new Promise((r) => setTimeout(r, 0));
    });
  }

  it("'Pix na Entrega' escolhido; a liberação cai (mesma lista): a escolha é revista para a forma que sobrou", async () => {
    await desenhar();
    expect(opcaoMarcada()).toContain("Pix na Entrega");

    // O realtime entrega uma config NOVA com a liberação desligada e a MESMA
    // lista de formas.
    estado.config = configDaLoja(false);
    await desenhar();

    const texto = (document.body.textContent ?? "").replace(/\u00A0/g, " ");
    expect(texto).not.toContain("Pix na Entrega");
    // A forma escolhida foi revista: alguma opção está marcada, e não é
    // nenhuma "na entrega".
    const marcada = opcaoMarcada();
    expect(marcada).not.toBeNull();
    expect(marcada).not.toContain("na Entrega");
  });

  it("CONTROLE: a liberação segue ligada (mesma lista): a escolha da cliente fica como está", async () => {
    await desenhar();
    expect(opcaoMarcada()).toContain("Pix na Entrega");

    estado.config = configDaLoja(true);
    await desenhar();

    expect(opcaoMarcada()).toContain("Pix na Entrega");
  });
});
