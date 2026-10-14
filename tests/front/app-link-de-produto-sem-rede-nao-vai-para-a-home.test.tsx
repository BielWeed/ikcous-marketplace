// @vitest-environment jsdom
//
// Link de produto aberto com a rede falhando: a checagem "esse produto
// existe?" falhava por REDE e o App tratava como "não existe" -- mandava o
// cliente para a Home (vazia, se era a primeira visita). Só "não existe de
// verdade" (PGRST116: nenhuma linha) leva à Home; falha de rede mantém o link
// e mostra "Não conseguimos carregar" com "Tentar de novo".
// Mesmo cenário do #502 (redirect-de-produto-inexistente-preserva-categoria).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
  ]);
  const criar = (tag: string) =>
    function DubleDeMotion({ children, ...resto }: Record<string, unknown>) {
      const limpo = Object.fromEntries(
        Object.entries(resto).filter(
          ([chave]) => !PROPS_DE_ANIMACAO.has(chave),
        ),
      );
      return React.createElement(tag, limpo, children as React.ReactNode);
    };
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
  return { motion, AnimatePresence, useReducedMotion: () => true };
});

vi.mock("@/views/customer/HomeView", () => ({
  HomeView: ({
    selectedCategory,
    onCategoryChange,
    onNavigate,
    onProductClick,
  }: {
    readonly selectedCategory: string;
    readonly onCategoryChange: (category: string) => void;
    readonly onNavigate: (view: string) => void;
    readonly onProductClick: (id: string) => void;
  }) => (
    <div data-testid="home" data-categoria={selectedCategory}>
      {["Bebidas", "Todas", "Doces", "Café & chá"].map((categoria) => (
        <button
          key={categoria}
          type="button"
          data-testid={
            categoria === "Café & chá" ? "categoria-especial" : categoria
          }
          onClick={() => onCategoryChange(categoria)}
        >
          {categoria}
        </button>
      ))}
      <button
        type="button"
        data-testid="carrinho"
        onClick={() => onNavigate("cart")}
      >
        Carrinho
      </button>
      <button
        type="button"
        data-testid="produto"
        onClick={() => onProductClick("produto-A")}
      >
        Produto
      </button>
      <button
        type="button"
        data-testid="produto-inexistente"
        onClick={() => onProductClick("produto-Z")}
      >
        Produto inexistente
      </button>
    </div>
  ),
}));
vi.mock("@/views/customer/CartView", () => ({
  CartView: () => <div data-testid="tela-carrinho" />,
}));
vi.mock("@/views/customer/ProductView", () => ({
  ProductView: () => <div data-testid="tela-produto" />,
}));

vi.mock("@/components/debug/DebugPanel", () => ({ DebugPanel: () => null }));
vi.mock("@/components/pwa/PushNotificationBanner", () => ({
  PushNotificationBanner: () => null,
}));
vi.mock("@/components/pwa/UpdateNotification", () => ({
  UpdateNotification: () => null,
}));
vi.mock("@/components/ui/custom/Header", () => ({ Header: () => null }));
vi.mock("@/components/ui/custom/BottomNav", () => ({
  BottomNav: ({
    onNavigate,
  }: { readonly onNavigate: (view: string) => void }) => (
    <button
      type="button"
      data-testid="inicio"
      onClick={() => onNavigate("home")}
    >
      Início
    </button>
  ),
}));
vi.mock("@/components/ui/custom/CartReminder", () => ({
  CartReminder: () => null,
}));
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

vi.mock("@/contexts/StoreContext", () => ({
  StoreProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
  useStore: () => ({ config: null }),
}));
vi.mock("@/contexts/CartContext", () => ({
  CartProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
  useCartState: () => ({ cartCount: 0 }),
  useCartActions: () => ({ addToCart: () => {} }),
  useCartContext: () => ({ cartCount: 0, addToCart: () => {} }),
}));
vi.mock("@/contexts/FavoritesContext", () => ({
  FavoritesProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({ cartCount: 0, addToCart: () => {} }),
  useCartState: () => ({ cartCount: 0 }),
  useCartActions: () => ({ addToCart: () => {} }),
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
const catalogo = vi.hoisted(() => ({
  products: [{ id: "produto-A" }] as { id: string }[],
  fetchProducts: () => {},
  // O que a checagem `vw_produtos_public ... .single()` devolve agora.
  respostaDoProduto: {
    data: null as unknown,
    error: null as unknown,
  } as { data: unknown; error: unknown },
  consultasDoProduto: 0,
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: catalogo.products,
    loading: false,
    fetchProducts: () => catalogo.fetchProducts(),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    toggleFavorite: () => {},
    loading: false,
  }),
}));
vi.mock("@/hooks/useAppBadge", () => ({
  useAppBadge: () => ({ setBadge: () => {}, clearBadge: () => {} }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: () => {},
    prefetchAll: () => {},
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
  const consulta: Record<string, unknown> = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.single = () => {
    catalogo.consultasDoProduto += 1;
    return Promise.resolve(catalogo.respostaDoProduto);
  };
  return {
    supabase: {
      from: () => consulta,
      rpc: () => Promise.resolve({ data: false, error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
    },
  };
});

import App from "@/App";

// --- Buracos do jsdom -------------------------------------------------
class ObservadorDeInterseccao {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function dubleDeArmazem() {
  const dados = new Map<string, string>();
  return {
    getItem: (chave: string) => dados.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      dados.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      dados.delete(chave);
    },
    clear: () => {
      dados.clear();
    },
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

const PGRST116 = {
  message: "JSON object requested, multiple (or no) rows returned",
  code: "PGRST116",
};

describe("link de produto aberto sem rede nao vai para a Home", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    catalogo.products = [{ id: "produto-A" }];
    catalogo.fetchProducts = () => {};
    catalogo.consultasDoProduto = 0;
    catalogo.respostaDoProduto = { data: null, error: PGRST116 };
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubGlobal("localStorage", dubleDeArmazem());
    vi.stubGlobal("sessionStorage", dubleDeArmazem());
    vi.stubGlobal("IntersectionObserver", ObservadorDeInterseccao);
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
    if (!Element.prototype.scrollTo) {
      Element.prototype.scrollTo = () => {};
    }

    // @ts-expect-error — bandeira interna do React para o `act`
    globalThis.IS_REACT_ACT_ENVIRONMENT = true;

    globalThis.history.replaceState(null, "", "/");

    container = document.createElement("div");
    document.body.append(container);
    raiz = createRoot(container);
  });

  afterEach(async () => {
    const paraDesmontar = raiz;
    await act(async () => {
      paraDesmontar?.unmount();
    });
    container?.remove();
    raiz = null;
    container = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const assentar = async (voltas = 10) => {
    for (let i = 0; i < voltas; i++) {
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  const clicar = async (marca: string) => {
    const botao = container?.querySelector<HTMLButtonElement>(
      `[data-testid="${marca}"]`,
    );
    if (!botao) throw new Error(`botão ${marca} não encontrado`);
    await act(async () => {
      botao.click();
    });
    await assentar();
  };
  const abrir = async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
    expect(globalThis.history.state).toBeNull();
  };

  const FALHA_DE_REDE = {
    message: "TypeError: Failed to fetch",
    details: "",
    hint: "",
    code: "",
  };
  const caminho = () =>
    globalThis.location.pathname + globalThis.location.search;
  const botaoTentar = () =>
    Array.from(container?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes("Tentar de novo"),
    );

  it("falha de REDE na checagem do link: o cliente NÃO é mandado para a Home", async () => {
    catalogo.respostaDoProduto = { data: null, error: FALHA_DE_REDE };
    await abrir();
    await clicar("produto-inexistente");
    await assentar(20);

    expect(container?.textContent).toContain("Não conseguimos carregar");
    expect(botaoTentar()).toBeDefined();
    expect(caminho()).not.toBe("/");
    expect(caminho()).toContain("produto-Z");
  });

  it("produto que de fato não existe (PGRST116) continua indo para a Home", async () => {
    await abrir();
    await clicar("produto-inexistente");
    await assentar(20);

    expect(container?.textContent).not.toContain("Não conseguimos carregar");
    expect(caminho()).toBe("/");
  });

  it("link com código malformado (22P02, não é uuid) é 'não existe': vai para a Home, como antes", async () => {
    catalogo.respostaDoProduto = {
      data: null,
      error: {
        message: 'invalid input syntax for type uuid: "abc"',
        code: "22P02",
      },
    };
    await abrir();
    await clicar("produto-inexistente");
    await assentar(20);

    expect(container?.textContent).not.toContain("Não conseguimos carregar");
    expect(caminho()).toBe("/");
  });

  it("consulta sem erro e sem linha também é 'não existe': vai para a Home", async () => {
    catalogo.respostaDoProduto = { data: null, error: null };
    await abrir();
    await clicar("produto-inexistente");
    await assentar(20);

    expect(caminho()).toBe("/");
    expect(container?.textContent).not.toContain("Não conseguimos carregar");
  });

  it("'Tentar de novo' consulta o catálogo e, voltando a rede, abre o produto", async () => {
    catalogo.respostaDoProduto = { data: null, error: FALHA_DE_REDE };
    let consultasDoCatalogo = 0;
    catalogo.fetchProducts = () => {
      consultasDoCatalogo += 1;
      // a rede voltou: o catálogo agora traz o produto do link
      catalogo.products = [{ id: "produto-A" }, { id: "produto-Z" }];
      catalogo.respostaDoProduto = { data: { id: "produto-Z" }, error: null };
    };
    await abrir();
    await clicar("produto-inexistente");
    await assentar(20);
    expect(botaoTentar()).toBeDefined();

    await act(async () => {
      botaoTentar()?.click();
    });
    await assentar(20);

    expect(consultasDoCatalogo).toBe(1);
    expect(
      container?.querySelector('[data-testid="tela-produto"]'),
    ).not.toBeNull();
    expect(container?.textContent).not.toContain("Não conseguimos carregar");
  });
});
