// @vitest-environment jsdom
//
// Issue #525: os três textos que citam a cidade da loja afirmam EXCLUSIVIDADE
// de entrega olhando só `storeCity`, sem consultar `shippingCoverage`. Com a
// cobertura NACIONAL (caso da Savy, frete pela API do Melhor Envio), qualquer
// cidade preenchida na identidade ligava frases falsas no meio da compra:
//
//   (1) o "Aviso de Região" do checkout — "entrega premium ativos
//       exclusivamente em <cidade>" (CheckoutView.tsx ~2717);
//   (2) o selo "<CIDADE> •" do FreeShippingBlock (~169), que lê como
//       "entrega (grátis) em <cidade>";
//   (3) o og:description da Home — "frete grátis em <cidade>" (HomeView
//       ~296), a prévia de compartilhamento no WhatsApp.
//
// Contrato deste arquivo: esses três textos só existem com cobertura LOCAL.
// O TÍTULO da aba ("<loja> | <cidade>, <UF>") NÃO muda — afirma onde a loja
// ESTÁ, não para onde entrega, e a própria issue #525 quer a cidade de volta
// no título quando o dono preencher a identidade.
//
// Montagem copiada de tests/front/checkout-nao-preenche-endereco-do-cliente
// .test.tsx (o checkout do convidado, onde o aviso vive) e de
// tests/front/identidade-da-loja-nas-telas.test.tsx (HomeView de verdade,
// lendo as metatags no DOM, e FreeShippingBlock).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mutável de propósito: cada caso reescreve `shippingCoverage`/`storeCity`/
// `storeState` (e `mockUser`: convidado para o checkout, logado para a Home)
// e o `afterEach` repõe o objeto inteiro — mesma guarda contra vazamento
// entre testes dos arquivos copiados.
const { mockConfig, mockUser } = vi.hoisted(() => ({
  mockConfig: {
    freeShippingMin: 50,
    shippingCoverage: "national" as "national" | "local",
    storeCity: undefined as string | undefined,
    storeState: undefined as string | undefined,
  },
  mockUser: { atual: null as null | { id: string } },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: mockConfig, isLoaded: true }),
}));

vi.mock("@/contexts/CartContext", () => ({
  useCartContext: () => ({ cartTotal: 0 }),
}));

// Convidado (user: null) abre o bloco de endereço do checkout; a Home é
// renderizada como logado, igual a identidade-da-loja-nas-telas.test.tsx.
// Wrapper mutável porque o destructuring de vi.hoisted é const.
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: mockUser.atual, profile: null, loading: false }),
}));

vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));

vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
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

vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    fetchAddresses: vi.fn(),
    addAddress: vi.fn(),
    updateAddress: vi.fn(),
    loading: false,
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão dos
// outros testes de checkout deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function cidadeConfigurada(cobertura: "national" | "local") {
  mockConfig.freeShippingMin = 50;
  mockConfig.shippingCoverage = cobertura;
  mockConfig.storeCity = "Uberlândia";
  mockConfig.storeState = "MG";
}

afterEach(() => {
  vi.restoreAllMocks();
  Object.assign(mockConfig, {
    freeShippingMin: 50,
    shippingCoverage: "national",
    storeCity: undefined,
    storeState: undefined,
  });
  mockUser.atual = null;
});

describe("CheckoutView — o Aviso de Região olha a cobertura de frete (#525)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
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
  });

  async function renderizarCheckout() {
    const { CheckoutView } = await import("@/views/customer/CheckoutView");
    await act(async () => {
      raiz.render(
        <CheckoutView onNavigate={vi.fn()} onSetBackOverride={vi.fn()} />,
      );
    });
  }

  it("cobertura NACIONAL com cidade configurada: o aviso não existe", async () => {
    // O caso da issue: a Savy entrega para o Brasil todo; com a cidade na
    // identidade, o checkout afirmava entrega "exclusivamente" nela.
    cidadeConfigurada("national");
    await renderizarCheckout();

    // "Aviso de Região" é o título do bloco — âncora única no arquivo.
    expect(hospedeiro.textContent).not.toContain("Aviso de Região");
    expect(hospedeiro.textContent).not.toContain("exclusivamente");
  });

  it("cobertura LOCAL com cidade configurada: o aviso afirma a exclusividade", async () => {
    cidadeConfigurada("local");
    await renderizarCheckout();

    expect(hospedeiro.textContent).toContain("Aviso de Região");
    expect(hospedeiro.textContent).toContain("Uberlândia, MG");
    expect(hospedeiro.textContent).toContain("exclusivamente");
  });

  it("cobertura LOCAL sem cidade: o aviso some (sem cidade solta no bloco)", async () => {
    mockConfig.shippingCoverage = "local";
    await renderizarCheckout();

    expect(hospedeiro.textContent).not.toContain("Aviso de Região");
  });
});

describe("FreeShippingBlock — o selo da cidade olha a cobertura (#525)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizarBloco() {
    const { FreeShippingBlock } = await import(
      "@/components/ui/custom/FreeShippingBlock"
    );
    await act(async () => {
      raiz.render(<FreeShippingBlock onNavigate={() => {}} />);
    });
  }

  it("cobertura NACIONAL com cidade: sem o selo, e a barra segue útil", async () => {
    cidadeConfigurada("national");
    await renderizarBloco();

    // "Uberlândia •" lê como "entrega em Uberlândia" — falso para loja
    // nacional. O rótulo "Entrega Grátis" continua sozinho, como já faz
    // quando a loja não configurou cidade.
    expect(hospedeiro.textContent).not.toContain("Uberlândia");
    expect(hospedeiro.textContent).toContain("Entrega Grátis");
  });

  it("cobertura LOCAL com cidade: o selo mostra a cidade", async () => {
    cidadeConfigurada("local");
    await renderizarBloco();

    expect(hospedeiro.textContent).toContain("Uberlândia");
    expect(hospedeiro.textContent).toContain("Entrega Grátis");
  });
});

describe("HomeView — o og:description olha a cobertura; o título não (#525)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // jsdom não implementa `CSS.escape` — useDocumentMeta usa para montar o
    // seletor do <script> de JSON-LD. Mesmo dublê de
    // identidade-da-loja-nas-telas.test.tsx.
    vi.stubGlobal("CSS", { escape: (v: string) => v });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    mockUser.atual = { id: "cliente-teste" };
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarHome() {
    const { HomeView } = await import("@/views/customer/HomeView");
    await act(async () => {
      raiz.render(
        <HomeView
          products={[]}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={() => {}}
          onNavigate={() => {}}
          searchQuery=""
          selectedCategory="Todas"
          onCategoryChange={() => {}}
          sortBy="default"
          onSortByChange={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("cobertura NACIONAL com cidade: og sem cidade — e o TÍTULO mantém a cidade", async () => {
    cidadeConfigurada("national");
    await renderizarHome();

    const metaOg = document.head
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content");
    const metaDescription = document.head
      .querySelector('meta[name="description"]')
      ?.getAttribute("content");

    // "frete grátis em Uberlândia" restringe a entrega — falso para loja
    // nacional. A frase cai no ramo sem cidade, já existente.
    expect(metaOg).not.toContain("Uberlândia");
    expect(metaOg).toContain("Descubra produtos exclusivos.");
    // meta[name=description] é frase de LOCALIZAÇÃO ("O marketplace online
    // de Uberlândia"), não de escopo de entrega — a cidade fica, igual ao
    // título.
    expect(metaDescription).toContain("Uberlândia");

    // O título da aba afirma onde a loja ESTÁ, não para onde entrega — e a
    // issue #525 quer a cidade de volta nele quando o dono preencher.
    expect(document.title).toContain("Uberlândia");
  });

  it("cobertura LOCAL com cidade: og promove o frete grátis na cidade", async () => {
    cidadeConfigurada("local");
    await renderizarHome();

    const metaOg = document.head
      .querySelector('meta[property="og:description"]')
      ?.getAttribute("content");

    expect(metaOg).toContain("frete grátis em Uberlândia");
  });
});
