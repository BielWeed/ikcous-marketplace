// @vitest-environment jsdom
// Regressão #466: a primeira volta instala a armadilha sem apagar a categoria.
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
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [{ id: "produto-A" }],
    loading: false,
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
  consulta.single = () => Promise.resolve({ data: null, error: null });
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

describe("a categoria da home sobrevive ao voltar", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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

  const categoria = () =>
    container
      ?.querySelector('[data-testid="home"]')
      ?.getAttribute("data-categoria");
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
  const voltar = async () => {
    // history.back() entrega popstate em uma macrotask no jsdom.
    await act(async () => {
      globalThis.history.back();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await assentar();
  };
  const irAoCarrinho = async () => {
    await clicar("Bebidas");
    expect(globalThis.history.state).toBeNull();
    await clicar("carrinho");
    expect(globalThis.location.pathname).toBe("/cart");
    expect(
      container?.querySelector('[data-testid="tela-carrinho"]'),
    ).not.toBeNull();
    await voltar();
  };

  it("preserva Bebidas e o endereço para recarregar na primeira volta do carrinho", async () => {
    await abrir();
    await irAoCarrinho();
    expect(globalThis.location.pathname).toBe("/");
    expect.soft(categoria()).toBe("Bebidas");
    expect.soft(globalThis.location.search).toBe("?category=Bebidas");
  });

  it("preserva a categoria ao voltar durante a ida ao carrinho, inclusive Todas", async () => {
    const moduloDePrefetch = await import("@/hooks/usePrefetchOnHover");
    const prefetchOriginal = moduloDePrefetch.usePrefetchOnHover();
    let esperaDoCarrinho: Promise<unknown> = Promise.resolve();
    vi.spyOn(moduloDePrefetch, "usePrefetchOnHover").mockReturnValue({
      ...prefetchOriginal,
      prefetchViewPromise: () => esperaDoCarrinho,
    });
    const avisar = vi.spyOn(console, "warn").mockImplementation(() => {});
    const empurrar = vi.spyOn(globalThis.history, "pushState");
    await abrir();

    for (const [escolha, busca] of [
      ["Todas", ""],
      ["Bebidas", "?category=Bebidas"],
    ]) {
      await clicar(escolha);
      expect(categoria()).toBe(escolha);
      expect(globalThis.location.search).toBe(busca);
      // Garante uma entrada anterior da home para o history.back() real.
      const estadoAnterior = globalThis.history.state;
      globalThis.history.pushState(null, "", `/${busca}`);
      let liberarCarrinho = () => {};
      esperaDoCarrinho = new Promise((resolve) => {
        liberarCarrinho = () => resolve(undefined);
      });

      try {
        // O App liga a trava antes de aguardar o carregamento do carrinho.
        // Seguramos só esse carregamento, sem alterar o roteador ou seus refs.
        await clicar("carrinho");
        expect(categoria()).toBe(escolha);
        avisar.mockClear();
        empurrar.mockClear();
        await voltar();
        expect(avisar).toHaveBeenCalledWith(
          "[App] Popstate blocked by transition lock. Reverting history to maintain sync.",
        );
        expect(empurrar).toHaveBeenCalledTimes(1);
        expect(globalThis.history.state).toEqual(
          estadoAnterior || { view: "home" },
        );
        expect(globalThis.location.pathname).toBe("/");
        expect.soft(globalThis.location.search).toBe(busca);
      } finally {
        liberarCarrinho();
        await assentar();
      }
      await clicar("inicio");
      // Não deixa o encerramento da transição anterior liberar a próxima.
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 400));
      });
    }
  });

  it("mantém a armadilha empurrando uma nova entrada ao voltar à base", async () => {
    await abrir();
    await irAoCarrinho();
    expect(globalThis.history.state).toEqual({ view: "home", trap: true });
    const empurrar = vi.spyOn(globalThis.history, "pushState");
    await voltar();
    expect(empurrar).toHaveBeenCalledWith(
      { view: "home", trap: true },
      "",
      expect.any(String),
    );
    expect(globalThis.history.state).toEqual({ view: "home", trap: true });
    expect(globalThis.location.pathname).toBe("/");
  });

  it("preserva a categoria ao voltar do produto sem levar id para a home", async () => {
    await abrir();
    await clicar("Bebidas");
    await clicar("produto");
    expect(globalThis.location.pathname).toBe("/product-detail");
    expect(new URLSearchParams(globalThis.location.search).get("id")).toBe(
      "produto-A",
    );
    expect(
      container?.querySelector('[data-testid="tela-produto"]'),
    ).not.toBeNull();
    await voltar();
    expect(categoria()).toBe("Bebidas");
    expect(globalThis.location.pathname + globalThis.location.search).toBe(
      "/?category=Bebidas",
    );
  });

  it.each([
    ["Todas", ""],
    ["Doces", "?category=Doces"],
    ["Café & chá", "?category=Caf%C3%A9%20%26%20ch%C3%A1"],
  ])(
    "permite trocar Bebidas por %s após instalar a armadilha",
    async (novaCategoria, busca) => {
      await abrir();
      await irAoCarrinho();
      await clicar(
        novaCategoria === "Café & chá" ? "categoria-especial" : novaCategoria,
      );
      expect(categoria()).toBe(novaCategoria);
      expect(
        new URLSearchParams(globalThis.location.search).get("category"),
      ).toBe(novaCategoria === "Todas" ? null : novaCategoria);
      // A entrada base ainda contém Bebidas: a escolha nova precisa prevalecer
      // quando a proteção empurra a próxima entrada de home.
      await voltar();
      expect(categoria()).toBe(novaCategoria);
      expect(globalThis.location.search).toBe(busca);
      await clicar("carrinho");
      await clicar("inicio");
      expect(categoria()).toBe(novaCategoria);
      expect(globalThis.location.search).toBe(busca);
    },
  );

  it("preserva Bebidas na segunda ida e volta na mesma página", async () => {
    await abrir();
    await irAoCarrinho();
    expect(categoria()).toBe("Bebidas");
    await clicar("carrinho");
    expect(globalThis.location.pathname).toBe("/cart");
    await voltar();
    expect(categoria()).toBe("Bebidas");
    expect(globalThis.location.search).toBe("?category=Bebidas");
  });

  it.each(["carrinho", "produto"])(
    "preserva a categoria ao tocar Início a partir de %s",
    async (destino) => {
      await abrir();
      await clicar("Bebidas");
      await clicar(destino);
      expect(globalThis.location.pathname).toBe(
        destino === "carrinho" ? "/cart" : "/product-detail",
      );
      await clicar("inicio");
      expect(categoria()).toBe("Bebidas");
      expect(globalThis.location.pathname + globalThis.location.search).toBe(
        "/?category=Bebidas",
      );
    },
  );
});
