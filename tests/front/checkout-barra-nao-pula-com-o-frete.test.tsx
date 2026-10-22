// @vitest-environment jsdom
//
// A BARRA DE BAIXO DO CHECKOUT NÃO PULA COM O FRETE (dono, celular real,
// 22/10/2026): ao abrir "Finalizar pedido", a barra fixa subia para mostrar
// uma linha VERMELHA "Calculando o frete…" e encolhia quando o frete ficava
// pronto — a página pulava junto (a altura da barra é o espaço reservado no
// fim da página). A ESPERA do frete não é erro. Aqui se prova só a
// APRESENTAÇÃO (a segurança do valor — botão travado, clique e banco que
// reconferem — tem outros testes):
//
//   1. cotando × pronto: a barra tem os MESMOS elementos, nada extra embaixo
//      do botão;
//   2. cotando: nenhum `role="alert"`, o aviso é `role="status"`, e o botão
//      Finalizar continua travado;
//   3. "Calculando…" mora na linha Entrega, e o Total vira uma faixa cinza
//      de altura fixa;
//   4. "escolha uma opção" e "loja configurando" moram na seção de entrega,
//      não na barra (a barra diz "ver acima" / "indisponível");
//   5. a pendência de identificação aparece igual com o frete cotando e com
//      o frete pronto.
//
// Altura e posição em pixels exigem navegador real: o teste Playwright
// `tests/e2e/jornada-checkout-barra-nao-pula.spec.ts` mede isso no CI.
import type { CartItem, Product, ShippingOption } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const onNavigate = vi.fn();
const onSetBackOverride = vi.fn();

const { mockConfig } = vi.hoisted(() => ({
  mockConfig: {
    shippingCoverage: "national" as "national" | "local",
    originCep: "38500-000" as string,
    localCepRange: undefined as string | undefined,
    localDeliveryFee: 12.9 as number | undefined,
    freeShippingMin: 0.01,
    enableCoupons: false as boolean | undefined,
    formasPagamentoEntrega: ["pix", "card", "cash"] as string[],
  },
}));

const LOCAL: ShippingOption = {
  id: "local-delivery",
  name: "Entrega Local",
  price: 5,
  deliveryDays: 1,
  provider: "local",
};

const { mockUseCartOverrides } = vi.hoisted(() => ({
  mockUseCartOverrides: {
    freteGratis: false,
    selectedShippingOption: null as ShippingOption | null,
    freteIndefinido: true,
  },
}));

// A calculadora é um dublê: só devolve a seção "Entrega e frete" e reporta o
// status que o teste manda. Os textos e o erro DELA não são o assunto aqui.
const { mockFrete } = vi.hoisted(() => ({
  mockFrete: { status: "cotando" as string },
}));
vi.mock("@/components/ui/custom/ShippingCalculator", async () => {
  const { useEffect } = await import("react");
  function CalculadoraDeTeste(props: {
    onStatusChange?: (status: string) => void;
  }) {
    const { onStatusChange } = props;
    useEffect(() => {
      onStatusChange?.(mockFrete.status);
    }, [onStatusChange]);
    return <section aria-label="Entrega e frete" />;
  }
  return { ShippingCalculator: CalculadoraDeTeste };
});

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

const mockAddresses = [
  {
    id: "addr-1",
    user_id: "user-1",
    name: "Casa",
    recipient_name: "Cliente Teste",
    cep: "01310-100",
    street: "Av Paulista",
    number: "1000",
    neighborhood: "Bela Vista",
    city: "São Paulo",
    state: "SP",
    is_default: true,
  },
];

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: mockAddresses,
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
  }),
}));

// Referência ESTÁVEL de `user` (ver checkout-economia-do-frete-na-barra).
const USUARIA = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: USUARIA, profile: null, loading: false }),
}));

vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: [],
      cartTotal: 0,
      shippingFee: 0,
      clearCart: vi.fn(),
      addToCart: vi.fn(),
      shippingCep: null,
      setSelectedShippingOption: vi.fn(),
      setShippingCep: vi.fn(),
      ...mockUseCartOverrides,
    })),
  };
});

vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: vi.fn() }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ createOrder: vi.fn(), updateOrderStatus: vi.fn() }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: { functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("canvas-confetti", () => ({ default: vi.fn() }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function produto(): Product {
  return {
    id: "prod-1",
    name: "Camiseta",
    description: "",
    price: 80,
    images: [],
    category: "geral",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: new Date().toISOString(),
  };
}
const CART: CartItem[] = [{ product: produto(), quantity: 1 }];

type EstadoDoFrete = "cotando" | "pronto" | "escolher" | "loja-configurando";

/** Põe o dublê do carrinho e da calculadora no estado pedido. */
function prepararFrete(estado: EstadoDoFrete) {
  mockConfig.originCep = estado === "loja-configurando" ? "" : "38500-000";
  if (estado === "pronto") {
    mockFrete.status = "pronto";
    mockUseCartOverrides.selectedShippingOption = LOCAL;
    mockUseCartOverrides.freteIndefinido = false;
    return;
  }
  mockFrete.status = estado === "cotando" ? "cotando" : "pronto";
  mockUseCartOverrides.selectedShippingOption = null;
  mockUseCartOverrides.freteIndefinido = true;
}

describe("CheckoutView — a barra de baixo não pula com o frete", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let slotDoHeader: HTMLDivElement;

  const montar = async (estado: EstadoDoFrete) => {
    prepararFrete(estado);
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView
          cart={CART}
          subtotal={80}
          shipping={estado === "pronto" ? 5 : 0}
          total={estado === "pronto" ? 85 : 80}
          onNavigate={onNavigate}
          onSetBackOverride={onSetBackOverride}
        />,
      );
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 420));
    });
  };

  const botaoFinalizar = () =>
    [...document.body.querySelectorAll("button")].find(
      (b) => b.getAttribute("aria-label") === "Finalizar pedido",
    ) as HTMLButtonElement;

  const barra = () =>
    botaoFinalizar().closest(".bottom-docked-navigation") as HTMLElement;

  const grupoDeValores = () =>
    barra().querySelector("[aria-label='Valores do pedido']") as HTMLElement;

  /** Tudo o que a barra tem FORA do grupo "Valores do pedido" (o botão, o que
   * vem antes e o que vem depois dele), como uma lista de rótulos: é isso que
   * muda a altura da barra. Texto não entra, só a estrutura. */
  const estruturaForaDosValores = () =>
    [...barra().querySelectorAll("*")]
      .filter((el) => !grupoDeValores().contains(el))
      .map(
        (el) =>
          `${el.tagName.toLowerCase()}|${el.getAttribute("role") ?? ""}|${
            el.getAttribute("data-testid") ?? ""
          }|${el.className?.toString().includes("sr-only") ? "sr" : ""}`,
      );

  /** Elementos que aparecem DEPOIS do botão dentro da barra — o lugar onde a
   * linha vermelha crescia. A pendência de identificação é de outro assunto
   * (não depende do frete) e tem o teste (5); fica de fora desta conta. */
  const elementosDepoisDoBotao = () => {
    const botao = botaoFinalizar();
    return [...barra().querySelectorAll("*")].filter(
      (el) =>
        !botao.contains(el) &&
        !el.contains(botao) &&
        !el.closest("[data-testid='checkout-pendencia-identificacao']") &&
        !!(
          botao.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING
        ),
    );
  };

  const linhaEntrega = () =>
    grupoDeValores().querySelector(".checkout-delivery") as HTMLElement;

  beforeEach(async () => {
    const { _limparCacheDeEconomiaDoFreteParaTeste } = await import(
      "@/hooks/useEconomiaDoFreteExibida"
    );
    _limparCacheDeEconomiaDoFreteParaTeste();
    const { HEADER_CENTER_SLOT_ID } = await import(
      "@/components/ui/custom/Header"
    );
    slotDoHeader = document.createElement("div");
    slotDoHeader.id = HEADER_CENTER_SLOT_ID;
    document.body.appendChild(slotDoHeader);
    onNavigate.mockClear();
    onSetBackOverride.mockClear();
    globalThis.sessionStorage.clear();
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

  afterEach(async () => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    slotDoHeader.remove();
    const { _limparCacheDeEconomiaDoFreteParaTeste } = await import(
      "@/hooks/useEconomiaDoFreteExibida"
    );
    _limparCacheDeEconomiaDoFreteParaTeste();
    globalThis.sessionStorage.clear();
    vi.unstubAllGlobals();
  });

  it("(1) cotando e pronto: a barra tem os MESMOS elementos, e nada aparece embaixo do botão por causa do frete", async () => {
    await montar("cotando");
    const cotando = estruturaForaDosValores();
    expect(elementosDepoisDoBotao()).toHaveLength(0);

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);

    await montar("pronto");
    const pronto = estruturaForaDosValores();
    expect(elementosDepoisDoBotao()).toHaveLength(0);

    expect(cotando).toEqual(pronto);
  });

  it("(2) cotando: nenhum role=alert, o aviso para leitor de tela é role=status, e o Finalizar continua travado", async () => {
    await montar("cotando");

    expect(botaoFinalizar().disabled).toBe(true);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
    const status = barra().querySelector('[role="status"]');
    expect(status).not.toBeNull();
    expect(status!.textContent).toContain(
      "Calculando o frete do endereço de entrega",
    );
    // O rótulo do botão é o de sempre.
    expect(botaoFinalizar().textContent).toContain("Finalizar Pedido");
  });

  it("(2b) pronto: o aviso de espera some (a região continua lá, vazia)", async () => {
    await montar("pronto");

    expect(barra().querySelector('[role="status"]')?.textContent?.trim()).toBe(
      "",
    );
    expect(document.body.textContent).not.toContain("Calculando");
  });

  it("(3) 'Calculando…' fica na linha Entrega, em cinza com ícone girando; o Total vira uma faixa de altura fixa", async () => {
    await montar("cotando");

    const entrega = linhaEntrega();
    expect(entrega.textContent).toContain("Calculando…");
    expect(entrega.querySelector(".animate-spin")).not.toBeNull();
    const textoCalculando = [...entrega.querySelectorAll("span")].find(
      (s) => s.textContent?.includes("Calculando…") && !s.querySelector("span"),
    );
    expect(textoCalculando?.className).toContain("text-zinc-500");
    expect(entrega.className).not.toContain("red");
    expect(entrega.innerHTML).not.toContain("text-red");

    const total = grupoDeValores().querySelector(
      "[data-testid='checkout-total-calculando']",
    );
    expect(total).not.toBeNull();
    expect(total!.className).toContain("h-8");
    expect(total!.className).toContain("animate-pulse");
    expect(grupoDeValores().textContent).not.toContain("a calcular");
    expect(grupoDeValores().textContent).not.toMatch(/R\$\s*85/);
  });

  it("(4) 'escolha uma opção': o motivo mora na seção de entrega, a barra diz 'ver acima', e o Finalizar segue travado", async () => {
    await montar("escolher");

    const motivo = document.querySelector(
      "[data-testid='checkout-motivo-frete']",
    );
    expect(motivo).not.toBeNull();
    expect(motivo!.textContent).toContain(
      "Escolha uma opção de frete para continuar",
    );
    expect(barra().contains(motivo)).toBe(false);
    // O motivo fica logo depois da seção "Entrega e frete".
    expect(
      document.querySelector("section[aria-label='Entrega e frete']")
        ?.nextElementSibling,
    ).toBe(motivo);

    expect(linhaEntrega().textContent).toContain("ver acima");
    expect(barra().textContent).not.toContain("Escolha uma opção");
    expect(elementosDepoisDoBotao()).toHaveLength(0);
    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(0);
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("(4b) loja sem origem de frete: a frase simples mora na seção e a barra diz 'indisponível'", async () => {
    await montar("loja-configurando");

    const motivo = document.querySelector(
      "[data-testid='checkout-motivo-frete']",
    );
    expect(motivo?.textContent).toBe(
      "Esta loja ainda não calcula o frete pelo app. Fale com a loja.",
    );
    expect(barra().contains(motivo)).toBe(false);
    expect(linhaEntrega().textContent).toContain("indisponível");
    expect(barra().textContent).not.toContain("configurando");
    expect(elementosDepoisDoBotao()).toHaveLength(0);
    expect(botaoFinalizar().disabled).toBe(true);
  });

  it("(4c) frete pronto e escolhido: nenhum motivo de frete aparece em lugar nenhum", async () => {
    await montar("pronto");

    expect(
      document.querySelector("[data-testid='checkout-motivo-frete']"),
    ).toBeNull();
    expect(linhaEntrega().textContent).toContain("R$ 5,00");
  });

  it("(5) a pendência de identificação aparece igual com o frete cotando e com o frete pronto", async () => {
    const pendencia = () =>
      document.querySelector(
        "[data-testid='checkout-pendencia-identificacao']",
      );

    await montar("cotando");
    const comCotando = pendencia()?.textContent;
    expect(comCotando).toBeTruthy();

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar("pronto");
    expect(pendencia()?.textContent).toBe(comCotando);

    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar("escolher");
    expect(pendencia()?.textContent).toBe(comCotando);
  });
});
