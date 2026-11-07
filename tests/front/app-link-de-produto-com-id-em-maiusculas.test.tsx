// @vitest-environment jsdom
//
// Link de produto com o id em LETRAS MAIÚSCULAS (digitado à mão, vindo de
// planilha ou de banner escrito pelo lojista). O banco aceita o uuid em
// maiúsculas e devolve o produto com o id em minúsculas; o App procurava o
// produto na lista com `===` e nunca achava: a tela ficava para sempre no
// esqueleto "Carregando produto…", sem aviso, sem "Tentar de novo" e sem voltar.
// Agora o id do link e o do catálogo são comparados sem diferenciar maiúscula
// de minúscula (só nessa comparação: o `?id=` serve também a pedido, cupom e
// usuário, que não são uuid).
// Mesmo harness de app-link-de-produto-sem-rede-nao-vai-para-a-home.
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
    info: (texto: string) => {
      catalogo.avisos.push(texto);
    },
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

vi.mock("@/contexts/StoreContext", async () => {
  const { useCallback, useState } = await import("react");
  return {
    StoreProvider: ({ children }: { readonly children?: unknown }) =>
      children as never,
    useStore: () => {
      const [, atualizar] = useState(0);
      const incluirProduto = useCallback((produto: { id: string }) => {
        if (!catalogo.products.some((p) => p.id === produto.id)) {
          catalogo.products = [...catalogo.products, produto];
          atualizar((v) => v + 1);
        }
      }, []);
      return { config: null, incluirProduto };
    },
  };
});
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
  // Textos que o App mandou para `toast.info` (o aviso que a cliente vê).
  avisos: [] as string[],
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

const ID_MINUSCULO = "ab12cd34-0000-4000-8000-00000000abcd";
const ID_MAIUSCULO = ID_MINUSCULO.toUpperCase();

describe("link de produto com o id em maiusculas", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    catalogo.products = [{ id: "outro-produto" }];
    catalogo.fetchProducts = () => {};
    catalogo.consultasDoProduto = 0;
    catalogo.avisos = [];
    catalogo.respostaDoProduto = { data: null, error: null };
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
    globalThis.history.replaceState(null, "", "/");
  });

  const assentar = async (voltas = 10) => {
    for (let i = 0; i < voltas; i++) {
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  // Abre o app JÁ no endereço do produto (link digitado / planilha / banner).
  const abrirNoLink = async (id: string) => {
    globalThis.history.replaceState(null, "", `/product-detail?id=${id}`);
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar(20);
  };
  const telaDoProduto = () =>
    container?.querySelector('[data-testid="tela-produto"]') ?? null;
  const caminho = () =>
    globalThis.location.pathname + globalThis.location.search;

  it("produto já no catálogo (id minúsculo): o link em MAIÚSCULAS abre o produto", async () => {
    catalogo.products = [{ id: "outro-produto" }, { id: ID_MINUSCULO }];
    // O banco acha o produto sem diferenciar maiúscula (devolve id minúsculo).
    catalogo.respostaDoProduto = { data: { id: ID_MINUSCULO }, error: null };
    await abrirNoLink(ID_MAIUSCULO);

    expect(telaDoProduto()).not.toBeNull();
    expect(container?.textContent).not.toContain("Carregando produto");
  });

  it("produto fora do catálogo: a consulta acha (id minúsculo) e o link em MAIÚSCULAS abre o produto", async () => {
    catalogo.respostaDoProduto = { data: { id: ID_MINUSCULO }, error: null };
    await abrirNoLink(ID_MAIUSCULO);

    expect(catalogo.consultasDoProduto).toBeGreaterThan(0);
    expect(telaDoProduto()).not.toBeNull();
    expect(catalogo.avisos).toEqual([]);
  });

  it("controle: o link em minúsculas continua abrindo o produto", async () => {
    catalogo.products = [{ id: "outro-produto" }, { id: ID_MINUSCULO }];
    catalogo.respostaDoProduto = { data: { id: ID_MINUSCULO }, error: null };
    await abrirNoLink(ID_MINUSCULO);

    expect(telaDoProduto()).not.toBeNull();
  });

  it("borda: id em maiúsculas de produto que NÃO existe segue para a Home com o aviso", async () => {
    catalogo.respostaDoProduto = {
      data: null,
      error: {
        message: "JSON object requested, multiple (or no) rows returned",
        code: "PGRST116",
      },
    };
    await abrirNoLink(ID_MAIUSCULO);

    expect(telaDoProduto()).toBeNull();
    expect(caminho()).toBe("/");
    expect(catalogo.avisos).toEqual(["Este produto não está mais disponível."]);
  });

  it("borda: id parecido mas DIFERENTE não casa com o produto do catálogo", async () => {
    catalogo.products = [{ id: "outro-produto" }, { id: ID_MINUSCULO }];
    catalogo.respostaDoProduto = {
      data: null,
      error: { message: "sem linha", code: "PGRST116" },
    };
    await abrirNoLink("AB12CD34-0000-4000-8000-00000000ABCE");

    expect(telaDoProduto()).toBeNull();
    expect(caminho()).toBe("/");
  });
});
