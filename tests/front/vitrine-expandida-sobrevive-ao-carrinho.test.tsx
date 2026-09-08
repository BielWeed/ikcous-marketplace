import { ProductList } from "@/components/ui/custom/ProductList";
import type { Product } from "@/types";
// @vitest-environment jsdom
// Regressão #471: sair da home não reinicia a paginação da vitrine.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { categoriasRecebidas, produtos } = vi.hoisted(() => ({
  categoriasRecebidas: [] as string[],
  produtos: Array.from({ length: 30 }, (_, indice) => ({
    id: `produto-${indice}`,
    name: `Bebida ${indice}`,
    description: "Bebida de teste",
    price: 10,
    images: [],
    category: "Bebidas",
    stock: 10,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
    createdAt: "2026-09-08T00:00:00Z",
  })),
}));

vi.mock("@/components/ui/custom/ProductCard", () => ({
  ProductCard: ({ product }: { readonly product: Product }) => (
    <div data-testid="card-produto">{product.name}</div>
  ),
}));

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
  }) => {
    categoriasRecebidas.push(selectedCategory);
    return (
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
        <ProductList
          products={produtos}
          resetKey={JSON.stringify([selectedCategory, "", "relevance"])}
          isLoading={false}
          favorites={[]}
          onToggleFavorite={() => {}}
          onProductClick={onProductClick}
        />
      </div>
    );
  },
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
  useStore: () => ({ config: { enableReviews: false } }),
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
  static ativos = new Set<ObservadorDeInterseccao>();
  private alvo: Element | null = null;
  private readonly callback: IntersectionObserverCallback;

  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
  }

  observe(alvo: Element) {
    this.alvo = alvo;
    ObservadorDeInterseccao.ativos.add(this);
  }

  disconnect() {
    ObservadorDeInterseccao.ativos.delete(this);
  }

  aparecer() {
    this.callback(
      [
        {
          isIntersecting: true,
          target: this.alvo,
        } as IntersectionObserverEntry,
      ],
      this as unknown as IntersectionObserver,
    );
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

describe("a vitrine expandida sobrevive ao carrinho", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    categoriasRecebidas.length = 0;
    ObservadorDeInterseccao.ativos.clear();
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
  const abrir = async (endereco = "/?category=Bebidas") => {
    globalThis.history.replaceState(null, "", endereco);
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
  const quantidadeVisivel = () =>
    container?.querySelectorAll('[data-testid="card-produto"]').length;

  const expandir = async () => {
    expect(quantidadeVisivel()).toBe(12);
    // A vitrine atual carrega mais pelo sentinela de rolagem, sem botão.
    // Disparamos o observador real do ProductList, sem reproduzir visibleCount.
    for (const esperado of [24, 30]) {
      await act(async () => {
        for (const observador of ObservadorDeInterseccao.ativos) {
          observador.aparecer();
        }
      });
      expect(quantidadeVisivel()).toBe(esperado);
    }
  };

  const esperarTransicao = async () => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
  };

  it.each(["carrinho", "produto"])(
    "mantém 30 produtos e nunca passa por Todas ao ir a %s e voltar",
    async (destino) => {
      await abrir();
      expect(categoria()).toBe("Bebidas");
      await expandir();
      categoriasRecebidas.length = 0;
      await clicar(destino);
      expect(globalThis.location.pathname).toBe(
        destino === "carrinho" ? "/cart" : "/product-detail",
      );
      expect.soft(quantidadeVisivel()).toBe(30);
      await esperarTransicao();
      await voltar();
      expect(globalThis.location.pathname + globalThis.location.search).toBe(
        "/?category=Bebidas",
      );
      expect.soft(quantidadeVisivel()).toBe(30);
      expect.soft(categoria()).toBe("Bebidas");
      expect(categoriasRecebidas).not.toContain("Todas");
    },
  );

  it("reinicia em 12 quando a pessoa troca Bebidas por Todas", async () => {
    await abrir();
    await expandir();
    await clicar("Todas");
    expect(categoria()).toBe("Todas");
    expect(globalThis.location.search).toBe("");
    expect(quantidadeVisivel()).toBe(12);
  });

  it("mostra Todas ao abrir diretamente o carrinho e ir à home", async () => {
    await abrir("/cart");
    expect(globalThis.location.pathname).toBe("/cart");
    await esperarTransicao();
    await clicar("inicio");
    expect(globalThis.location.pathname + globalThis.location.search).toBe("/");
    expect(categoria()).toBe("Todas");
    expect(quantidadeVisivel()).toBe(12);
  });
});
