// @vitest-environment jsdom
//
// Lote 242 (caça 12-B #2): loja que ainda não tem CEP de origem do frete.
//
// DEFEITO MEDIDO: é o estado padrão de uma loja recém-entregue. A cliente
// preenchia o checkout inteiro e só no fim lia "Esta loja ainda não calcula o
// frete pelo app. Fale com a loja." — um parágrafo sem botão, abaixo de tudo. O
// atalho de WhatsApp existe no checkout, mas não era oferecido ali; e numa loja
// nova costuma nem haver WhatsApp. Agora o aviso fica NO TOPO da tela (antes de
// ela digitar qualquer coisa), com o botão de contato quando a loja tem WhatsApp
// e uma frase honesta quando não tem. Só apresentação: o Finalizar continua
// travado exatamente como antes.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig, mockCarrinho } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national",
    originCep: "" as string,
    whatsappNumber: "(34) 99999-0000" as string,
  },
  mockCarrinho: { freteIndefinido: true },
}));

vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => <section aria-label="Entrega e frete" />,
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
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
    freteIndefinido: mockCarrinho.freteIndefinido,
    clearCart: vi.fn(),
    selectedShippingOption: null,
    shippingCep: "",
  }),
}));

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const FRASE = "Esta loja ainda não calcula o frete pelo app. Fale com a loja.";
const FRASE_SEM_CONTATO =
  "Esta loja ainda não calcula o frete pelo app e não cadastrou um contato aqui. Procure a loja pelos canais em que você a conheceu.";

describe("CheckoutView — loja sem CEP de origem avisa no topo e oferece contato", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    mockConfig.originCep = "";
    mockConfig.whatsappNumber = "(34) 99999-0000";
    mockCarrinho.freteIndefinido = true;
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
    // A barra do Finalizar renderiza com atraso proposital (useDeferredRender).
    await act(async () => {
      await new Promise((r) => setTimeout(r, 900));
    });
  }

  const aviso = () =>
    document.querySelector("[data-testid='checkout-motivo-frete']");
  const botaoDoAviso = () =>
    [...(aviso()?.querySelectorAll("button") ?? [])].find((b) =>
      b.textContent?.includes("WhatsApp"),
    );
  const botaoFinalizar = () =>
    [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Finalizar Pedido"),
    ) as HTMLButtonElement;

  it("com WhatsApp: o aviso vem ANTES dos campos, com o botão de falar com a loja; o Finalizar segue travado", async () => {
    await montar();

    expect(aviso()).not.toBeNull();
    expect(aviso()?.textContent).toContain(FRASE);
    // Antes de a pessoa digitar qualquer coisa: precede o campo de nome/CEP.
    const primeiroCampo = document.getElementById("checkout-name");
    expect(primeiroCampo).not.toBeNull();
    expect(
      (aviso()?.compareDocumentPosition(primeiroCampo as Node) ?? 0) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(botaoDoAviso()).toBeDefined();
    expect(botaoDoAviso()?.textContent).toContain("Falar com a loja");
    expect(botaoFinalizar().disabled).toBe(true);
    // Um aviso só (a duplicata no pé da seção de entrega foi para o topo).
    expect(
      document.querySelectorAll("[data-testid='checkout-motivo-frete']"),
    ).toHaveLength(1);
  });

  it("o botão abre o WhatsApp da loja com o número em formato internacional", async () => {
    const abrir = vi.spyOn(globalThis, "open").mockImplementation(() => null);
    await montar();

    await act(async () => {
      botaoDoAviso()?.click();
    });

    expect(abrir).toHaveBeenCalledTimes(1);
    const [url, alvo, recursos] = abrir.mock.calls[0];
    expect(String(url)).toContain("https://wa.me/5534999990000?text=");
    expect(alvo).toBe("_blank");
    expect(recursos).toBe("noopener,noreferrer");
  });

  it("sem WhatsApp: frase honesta, sem botão e sem o 'Fale com a loja' solto", async () => {
    mockConfig.whatsappNumber = "";
    await montar();

    expect(aviso()?.textContent).toBe(FRASE_SEM_CONTATO);
    expect(botaoDoAviso()).toBeUndefined();
    expect(aviso()?.querySelectorAll("button")).toHaveLength(0);
    expect(document.body.textContent).not.toContain("Fale com a loja.");
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("número de WhatsApp curto demais não conta como contato", async () => {
    mockConfig.whatsappNumber = "12345";
    await montar();

    expect(aviso()?.textContent).toBe(FRASE_SEM_CONTATO);
    expect(botaoDoAviso()).toBeUndefined();
  });

  it("controle: loja COM CEP de origem não mostra o aviso", async () => {
    mockConfig.originCep = "38500-000";
    await montar();

    expect(aviso()).toBeNull();
  });

  it("controle: sem CEP, mas o frete não está indefinido (frete grátis do produto): nada é bloqueado nem avisado", async () => {
    mockCarrinho.freteIndefinido = false;
    await montar();

    expect(aviso()).toBeNull();
  });
});
