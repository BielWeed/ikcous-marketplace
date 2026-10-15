// @vitest-environment jsdom
//
// INTEGRAÇÃO do defeito de 14/10/2026 ("Carrinho" da Busca e dos Favoritos
// mostrava "Salvo!" e nada entrava): o defeito nasceu de o App NÃO entregar a
// função do carrinho às telas. Os testes que montam as telas direto
// (carrinho-dos-cards-busca-e-favoritos, quantidade-da-folha-chega-ao-carrinho)
// não enxergam essa ligação — se ela sumir do App de novo, ficam verdes.
//
// Aqui o App é o REAL, o CartProvider é o REAL (um espião DENTRO dele lê o
// conteúdo do carrinho de verdade) e as telas são as reais: Home (grade e
// carrossel), Busca, Favoritos e Produto ("Você também pode gostar"). O que se
// confere é o que ENTROU no carrinho: produto, quantidade, variação e preço.
// Só o entorno é simulado (dados, auth, rede, animação, barras de navegação).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type ItemDoCarrinho = {
  product: { id: string; price: number };
  quantity: number;
  variantId?: string;
  variantNames?: string;
};

const lido = vi.hoisted(() => ({ carrinho: [] as unknown[] }));

vi.mock("framer-motion", async () => {
  const React = await import("react");
  const PROPS_DE_ANIMACAO = new Set([
    "initial",
    "animate",
    "exit",
    "transition",
    "variants",
    "custom",
    "layout",
    "layoutId",
    "whileTap",
    "whileHover",
    "whileInView",
    "whileDrag",
    "drag",
    "dragConstraints",
    "dragElastic",
    "onDragEnd",
    "onAnimationComplete",
    "onAnimationStart",
    "viewport",
  ]);
  const criar = (tag: string) =>
    React.forwardRef(function Duble(
      { children, ...resto }: Record<string, unknown>,
      ref,
    ) {
      const limpo = Object.fromEntries(
        Object.entries(resto).filter(([k]) => !PROPS_DE_ANIMACAO.has(k)),
      );
      return React.createElement(
        tag,
        { ...limpo, ref },
        children as React.ReactNode,
      );
    });
  const cache = new Map<string, unknown>();
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_alvo, tag) => {
      if (typeof tag !== "string") return undefined;
      if (!cache.has(tag)) cache.set(tag, criar(tag));
      return cache.get(tag);
    },
  });
  function AnimatePresence({ children }: { readonly children?: unknown }) {
    return React.createElement(
      React.Fragment,
      null,
      children as React.ReactNode,
    );
  }
  const valorFalso = (v: unknown) => ({
    get: () => v,
    set: () => {},
    on: () => () => {},
  });
  return {
    motion,
    m: motion,
    AnimatePresence,
    LazyMotion: AnimatePresence,
    domAnimation: {},
    useReducedMotion: () => true,
    useAnimation: () => ({ start: () => Promise.resolve(), stop: () => {} }),
    useMotionValue: valorFalso,
    useTransform: () => valorFalso(0),
    useSpring: valorFalso,
    useScroll: () => ({ scrollY: { get: () => 0, on: () => () => {} } }),
    useInView: () => true,
    usePresence: () => [true, () => {}],
    useIsPresent: () => true,
    animate: () => ({ stop: () => {} }),
  };
});

// Espião: lê o carrinho REAL de dentro do CartProvider REAL.
vi.mock("@/contexts/CartContext", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/contexts/CartContext")>();
  const React = await import("react");
  function Espiao() {
    const { cart } = real.useCartContext();
    React.useEffect(() => {
      lido.carrinho = cart;
    }, [cart]);
    return null;
  }
  return {
    ...real,
    CartProvider: ({ children }: { readonly children?: React.ReactNode }) =>
      React.createElement(
        real.CartProvider,
        null,
        React.createElement(Espiao),
        children,
      ),
  };
});

vi.mock("@/components/debug/DebugPanel", () => ({ DebugPanel: () => null }));
vi.mock("@/components/pwa/PushNotificationBanner", () => ({
  PushNotificationBanner: () => null,
}));
vi.mock("@/components/pwa/UpdateNotification", () => ({
  UpdateNotification: () => null,
}));
vi.mock("@/components/ui/custom/Header", () => ({ Header: () => null }));
vi.mock("@/components/ui/custom/BottomNav", () => ({ BottomNav: () => null }));
vi.mock("@/components/ui/custom/CartReminder", () => ({
  CartReminder: () => null,
}));
vi.mock("@/views/customer/CartView", () => ({ CartView: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("sonner", () => ({
  toast: Object.assign(() => {}, {
    error: () => {},
    success: () => {},
    info: () => {},
    warning: () => {},
    message: () => {},
    loading: () => {},
    dismiss: () => {},
    custom: () => {},
  }),
}));
vi.mock("@/components/ui/custom/LocalErrorBoundary", () => ({
  LocalErrorBoundary: ({ children }: { readonly children?: unknown }) =>
    children as never,
}));
vi.mock("@/components/ui/alert-dialog", () => {
  const nada = () => null;
  return {
    AlertDialog: nada,
    AlertDialogAction: nada,
    AlertDialogCancel: nada,
    AlertDialogContent: nada,
    AlertDialogDescription: nada,
    AlertDialogFooter: nada,
    AlertDialogHeader: nada,
    AlertDialogTitle: nada,
  };
});

const dados = vi.hoisted(() => {
  const variantes = [
    {
      id: "v-m",
      productId: "p-vestido",
      name: "Tamanho",
      value: "M",
      stockIncrement: 10,
      active: true,
    },
    {
      id: "v-g",
      productId: "p-vestido",
      name: "Tamanho",
      value: "G",
      stockIncrement: 10,
      active: true,
    },
  ];
  const base = {
    description: "x",
    images: ["https://example.com/a.png"],
    category: "roupas",
    sold: 0,
    isActive: true,
    freeShipping: false,
    createdAt: "2026-10-01T00:00:00Z",
    rating: 5,
    reviewCount: 0,
  };
  const simples = {
    ...base,
    id: "p-camiseta",
    name: "Camiseta Lisa",
    price: 50,
    stock: 20,
    isBestseller: true,
    variants: [],
  };
  const vestido = {
    ...base,
    id: "p-vestido",
    name: "Vestido Midi",
    price: 120,
    stock: 20,
    isBestseller: true,
    variants: variantes,
  };
  const pagina = {
    ...base,
    id: "p-pagina",
    name: "Bolsa Pagina",
    price: 70,
    stock: 5,
    isBestseller: false,
    variants: [],
  };
  const config = {
    shippingFee: 0,
    freeShippingMin: 0,
    enableReviews: false,
    themeMode: "light",
  };
  return {
    simples,
    vestido,
    pagina,
    catalogo: [simples, vestido, pagina],
    config,
  };
});

vi.mock("@/contexts/StoreContext", () => ({
  StoreProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
  useStore: () => ({
    config: dados.config,
    products: dados.catalogo,
    isLoaded: true,
    catalogoErro: null,
    fetchProducts: () => Promise.resolve(),
  }),
}));
vi.mock("@/contexts/FavoritesContext", () => ({
  FavoritesProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    isAdmin: false,
    adminStatus: "not-admin",
    loading: false,
    isPasswordRecovery: false,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: dados.catalogo,
    loading: false,
    trackRecommendationClick: () => {},
    fetchRecommendations: () => Promise.resolve([]),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [dados.simples, dados.vestido],
    toggleFavorite: () => {},
    isFavorite: () => true,
    loading: false,
    erro: null,
    refresh: () => {},
  }),
}));
vi.mock("@/hooks/useRecomendacoesDeProduto", () => ({
  useRecomendacoesDeProduto: () => ({
    recomendacoes: [dados.vestido, dados.simples],
    carregando: false,
    consultado: true,
  }),
}));
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: () => {},
    markHelpful: () => {},
    subscribeToReviews: () => () => {},
  }),
}));
vi.mock("@/components/ui/custom/ProductQA", () => ({ ProductQA: () => null }));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/hooks/useAppBadge", () => ({
  useAppBadge: () => ({ setBadge: () => {}, clearBadge: () => {} }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: () => {},
    prefetchAll: () => {},
    prefetchImage: () => {},
    prefetchViewPromise: () => Promise.resolve(),
  }),
}));
vi.mock("@/hooks/useNetworkAdaptive", () => ({
  useNetworkAdaptive: () => ({ isSlow: () => false }),
}));
vi.mock("@/hooks/useUpdateCheck", () => ({
  useUpdateCheck: () => ({
    checkUpdate: () => {},
    updateAvailable: false,
    newVersion: null,
    performNuclearPurge: () => {},
  }),
}));
vi.mock("@/hooks/useBehavioralPrefetch", () => ({
  useBehavioralPrefetch: () => {},
}));
vi.mock("@/hooks/useCacheWarmer", () => ({ useCacheWarmer: () => {} }));
vi.mock("@/hooks/usePredictiveNavigation", () => ({
  usePredictiveNavigation: () => {},
}));
vi.mock("@/hooks/useSwipeBack", () => ({ useSwipeBack: () => {} }));
vi.mock("@/hooks/useWebVitals", () => ({ useWebVitals: () => {} }));
vi.mock("@/hooks/useRealtimeUpdate", () => ({ useRealtimeUpdate: () => {} }));
vi.mock("@/lib/supabase", () => {
  // Consulta encadeável que, ao ser aguardada, devolve lista vazia: uma
  // Promise de verdade com os métodos do construtor de consultas colados.
  type Consulta = Promise<{ data: unknown; error: null }> & {
    select: () => Consulta;
    eq: () => Consulta;
    in: () => Consulta;
    order: () => Consulta;
    limit: () => Consulta;
    single: () => Promise<unknown>;
    maybeSingle: () => Promise<unknown>;
  };
  const consulta: Consulta = Object.assign(
    Promise.resolve({ data: [] as unknown, error: null }),
    {
      select: () => consulta,
      eq: () => consulta,
      in: () => consulta,
      order: () => consulta,
      limit: () => consulta,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    },
  );
  return {
    supabase: {
      from: () => consulta,
      rpc: () => Promise.resolve({ data: false, error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => Promise.resolve(),
    },
  };
});

import App from "@/App";

/** Flag interna do React (sem tipo público): liga/desliga o modo de teste. */
const flagDoReact = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
flagDoReact.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function armazemFalso() {
  const dadosGuardados = new Map<string, string>();
  return {
    getItem: (k: string) => dadosGuardados.get(k) ?? null,
    setItem: (k: string, v: string) => {
      dadosGuardados.set(k, String(v));
    },
    removeItem: (k: string) => {
      dadosGuardados.delete(k);
    },
    clear: () => dadosGuardados.clear(),
    key: (i: number) => Array.from(dadosGuardados.keys()).at(i) ?? null,
    get length() {
      return dadosGuardados.size;
    },
  };
}

let raiz: Root | null = null;
let hospedeiro: HTMLDivElement | null = null;

beforeEach(() => {
  lido.carrinho = [];
  vi.stubGlobal("localStorage", armazemFalso());
  vi.stubGlobal("sessionStorage", armazemFalso());
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  vi.stubGlobal("CSS", { escape: (v: string) => v, supports: () => false });
  vi.stubGlobal("scrollTo", () => {});
  vi.stubGlobal("matchMedia", (consulta: string) => ({
    matches: false,
    media: consulta,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  flagDoReact.IS_REACT_ACT_ENVIRONMENT = true;
  hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  const atual = raiz;
  await act(async () => {
    atual?.unmount();
  });
  hospedeiro?.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
});

/** Espera uma condição de verdade (o App tem timers e telas preguiçosas). */
const aguardar = async (condicao: () => void, limiteMs = 8000) => {
  flagDoReact.IS_REACT_ACT_ENVIRONMENT = false;
  try {
    await vi.waitFor(condicao, { timeout: limiteMs, interval: 20 });
  } finally {
    flagDoReact.IS_REACT_ACT_ENVIRONMENT = true;
  }
  await act(async () => {});
};

// As abas (Home/Favoritos) ficam MONTADAS em `.admin-tab-pane` mesmo com outra
// tela na frente. Tela secundária (Busca/Produto) = fora de qualquer aba; aba
// = dentro da aba ativa.
let escopo: "secundaria" | "aba-ativa" = "secundaria";

async function abrir(caminho: string) {
  escopo =
    caminho.startsWith("/search") || caminho.startsWith("/product-detail")
      ? "secundaria"
      : "aba-ativa";
  globalThis.history.replaceState(null, "", caminho);
  await act(async () => {
    raiz?.render(<App />);
  });
}

async function tocar(el: Element | null | undefined) {
  if (!el) throw new Error("elemento ausente");
  await act(async () => {
    (el as HTMLElement).click();
  });
}

const noEscopo = (b: Element) =>
  escopo === "secundaria"
    ? b.closest(".admin-tab-pane") === null
    : b.closest(".active-scroll-container") !== null;

const botoes = (rotulo: string) =>
  Array.from(
    document.body.querySelectorAll<HTMLButtonElement>(
      '[data-testid="product-card-action"]',
    ),
  )
    .filter(noEscopo)
    .filter((b) =>
      (b.getAttribute("aria-label") ?? b.textContent ?? "").includes(rotulo),
    );

/** Folha de opções do card: escolhe "M", sobe a quantidade e adiciona. */
async function folhaMQuantidade(quantidade: number) {
  await aguardar(() => {
    expect(
      document.body.querySelector('[data-testid="product-card-options-sheet"]'),
    ).not.toBeNull();
  });
  const folha = document.body.querySelector(
    '[data-testid="product-card-options-sheet"]',
  );
  if (!folha) throw new Error("folha de opções ausente");
  const chipM = Array.from(folha.querySelectorAll("button")).find(
    (b) =>
      b.textContent?.trim() === "M" && b.getAttribute("aria-pressed") !== null,
  );
  await tocar(chipM);
  const mais = folha.querySelector('button[aria-label="Aumentar quantidade"]');
  for (let i = 1; i < quantidade; i++) await tocar(mais);
  await tocar(folha.querySelector('[data-testid="product-card-options-add"]'));
}

/** O que realmente entrou no carrinho (lido de dentro do CartProvider real). */
const resumo = () =>
  (lido.carrinho as ItemDoCarrinho[]).map((i) => ({
    id: i.product.id,
    q: i.quantity,
    v: i.variantId,
    n: i.variantNames,
    preco: i.product.price,
  }));

const camiseta = {
  id: "p-camiseta",
  q: 1,
  v: undefined,
  n: undefined,
  preco: 50,
};
const vestidoMx = (q: number) => ({
  id: "p-vestido",
  q,
  v: "v-m",
  n: "Tamanho: M",
  preco: 120,
});

const folhaFechada = () =>
  aguardar(() => {
    expect(
      document.body.querySelector('[data-testid="product-card-options-sheet"]'),
    ).toBeNull();
  });

describe("App real + carrinho real: o que os cards entregam chega ao carrinho", () => {
  it("BUSCA: pesquisa, 'Carrinho' do produto simples entra (id, quantidade 1, sem variação, preço)", async () => {
    await abrir("/search");
    await aguardar(() => {
      expect(document.getElementById("search-input")).not.toBeNull();
    });
    const campo = document.getElementById("search-input") as HTMLInputElement;
    const definirValor = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      definirValor?.call(campo, "camiseta");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await aguardar(() => {
      expect(
        botoes("Adicionar Camiseta Lisa ao carrinho").length,
      ).toBeGreaterThan(0);
      expect(botoes("Vestido Midi")).toHaveLength(0);
    });

    await tocar(botoes("Adicionar Camiseta Lisa ao carrinho")[0]);

    await aguardar(() => {
      expect(resumo()).toEqual([camiseta]);
    });
  });

  it("BUSCA: dois toques seguidos no mesmo botão adicionam UMA unidade", async () => {
    await abrir("/search");
    await aguardar(() => {
      expect(
        botoes("Adicionar Camiseta Lisa ao carrinho").length,
      ).toBeGreaterThan(0);
    });
    const botao = botoes("Adicionar Camiseta Lisa ao carrinho")[0];

    await tocar(botao);
    await tocar(botao);

    await aguardar(() => {
      expect(resumo()).toEqual([camiseta]);
    });
  });

  it("BUSCA: produto com variação abre a folha; M x3 entra (variação, quantidade 3, nomes) e fica na Busca", async () => {
    await abrir("/search");
    await aguardar(() => {
      expect(botoes("Escolher opções de Vestido Midi").length).toBeGreaterThan(
        0,
      );
    });

    await tocar(botoes("Escolher opções de Vestido Midi")[0]);
    await folhaMQuantidade(3);

    await aguardar(() => {
      expect(resumo()).toEqual([vestidoMx(3)]);
    });
    expect(globalThis.location.pathname).toBe("/search");
  });

  it("FAVORITOS: simples entra com quantidade 1; variação M x2 entra com 2", async () => {
    await abrir("/favorites");
    await aguardar(() => {
      expect(
        botoes("Adicionar Camiseta Lisa ao carrinho").length,
      ).toBeGreaterThan(0);
    });

    await tocar(botoes("Adicionar Camiseta Lisa ao carrinho")[0]);
    await tocar(botoes("Escolher opções de Vestido Midi")[0]);
    await folhaMQuantidade(2);

    await aguardar(() => {
      expect(resumo()).toEqual([camiseta, vestidoMx(2)]);
    });
  });

  it("HOME/CATÁLOGO (ProductList): M x3 entra como 3", async () => {
    await abrir("/");
    await aguardar(() => {
      const noCatalogo = botoes("Escolher opções de Vestido Midi").filter((b) =>
        b.closest(".grid-cols-2"),
      );
      expect(noCatalogo.length).toBeGreaterThan(0);
    });
    const alvo = botoes("Escolher opções de Vestido Midi").find((b) =>
      b.closest(".grid-cols-2"),
    );

    await tocar(alvo);
    await folhaMQuantidade(3);

    await aguardar(() => {
      expect(resumo()).toEqual([vestidoMx(3)]);
    });
  });

  it("HOME/CARROSSEL: M x3 entra como 3; produto simples entra com 1", async () => {
    await abrir("/");
    await aguardar(() => {
      expect(
        botoes("Escolher opções de Vestido Midi").filter((b) =>
          b.closest(".snap-x"),
        ).length,
      ).toBeGreaterThan(0);
    });

    await tocar(
      botoes("Escolher opções de Vestido Midi").find((b) =>
        b.closest(".snap-x"),
      ),
    );
    await folhaMQuantidade(3);
    await aguardar(() => {
      expect(resumo()).toEqual([vestidoMx(3)]);
    });
    await folhaFechada();
    await tocar(
      botoes("Adicionar Camiseta Lisa ao carrinho").find((b) =>
        b.closest(".snap-x"),
      ),
    );

    await aguardar(() => {
      expect(resumo()).toContainEqual(camiseta);
    });
  });

  it("PRODUTO/RELACIONADOS: M x3 entra como 3 (o produto do card, não o da página); simples entra com 1", async () => {
    await abrir("/product-detail?id=p-pagina");
    await aguardar(() => {
      expect(botoes("Escolher opções de Vestido Midi").length).toBeGreaterThan(
        0,
      );
    });

    await tocar(botoes("Escolher opções de Vestido Midi")[0]);
    await folhaMQuantidade(3);
    await aguardar(() => {
      expect(resumo()).toEqual([vestidoMx(3)]);
    });
    await folhaFechada();
    await tocar(botoes("Adicionar Camiseta Lisa ao carrinho")[0]);

    await aguardar(() => {
      expect(resumo()).toContainEqual(camiseta);
    });
  });
});
