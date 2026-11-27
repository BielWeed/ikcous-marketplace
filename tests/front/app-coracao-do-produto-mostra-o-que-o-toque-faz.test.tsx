// @vitest-environment jsdom
//
// O coração da tela do produto tem de mostrar o que o toque vai FAZER. O toque
// (`toggleFavorite`) decide pelos ids guardados (`isFavorite` do contexto); o
// desenho vinha de `favorites`, que só tem produtos do catálogo JÁ carregado.
// Produto favoritado aberto por link com o catálogo ainda carregando (a tela
// usa a leitura avulsa): coração vazio, a cliente toca para favoritar e o app
// REMOVE ("Removido dos favoritos"). O desenho passa a vir de `isFavorite`.
// Arnês igual ao de app-link-de-produto-abre-antes-do-catalogo.
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
  HomeView: () => <div data-testid="home" />,
}));
// A tela do produto mostra nome e preço do que recebeu e conta as próprias
// montagens: remontar perderia a variação e a quantidade escolhidas.
vi.mock("@/views/customer/ProductView", () => ({
  ProductView: ({
    isFavorite,
    onToggleFavorite,
  }: {
    readonly isFavorite: boolean;
    readonly onToggleFavorite: () => void;
  }) => (
    <div data-testid="tela-produto">
      <button
        type="button"
        data-testid="coracao"
        aria-pressed={isFavorite}
        onClick={onToggleFavorite}
      />
    </div>
  ),
}));

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
  const { useCallback, useEffect: useEfeito, useState } = await import("react");
  return {
    StoreProvider: ({ children }: { readonly children?: unknown }) =>
      children as never,
    useStore: () => {
      const [, atualizar] = useState(0);
      useEfeito(() => {
        const redesenhar = () => atualizar((v) => v + 1);
        catalogo.redesenhos.add(redesenhar);
        return () => {
          catalogo.redesenhos.delete(redesenhar);
        };
      }, []);
      const incluirProduto = useCallback((produto: { id: string }) => {
        catalogo.incluidos.push(produto.id);
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
    isAdmin: catalogo.adminStatus === "admin",
    adminStatus: catalogo.adminStatus,
    loading: false,
    isPasswordRecovery: false,
  }),
}));
type RespostaDoProduto = { data: unknown; error: unknown };
const catalogo = vi.hoisted(() => ({
  products: [] as { id: string; name?: string; price?: number }[],
  // O `loading` do useProducts: o catálogo ainda está lendo as páginas.
  carregando: true,
  consultasDoProduto: 0,
  // Cada consulta do produto fica pendente até o teste chamar `responder`.
  pendentes: [] as ((resposta: RespostaDoProduto) => void)[],
  avisos: [] as string[],
  incluidos: [] as string[],
  adminStatus: "not-admin" as "unknown" | "admin" | "not-admin",
  redesenhos: new Set<() => void>(),
  idsFavoritos: [] as string[],
  toques: [] as string[],
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: catalogo.products,
    loading: catalogo.carregando,
    fetchProducts: () => {},
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    isFavorite: (id: string) => catalogo.idsFavoritos.includes(id),
    // Mesma regra do contexto: decide pelos ids guardados.
    toggleFavorite: (produto: { id: string }) => {
      catalogo.toques.push(
        catalogo.idsFavoritos.includes(produto.id) ? "remover" : "favoritar",
      );
    },
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
    return new Promise<RespostaDoProduto>((resolver) => {
      catalogo.pendentes.push(resolver);
    });
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

const ID = "ab12cd34-0000-4000-8000-00000000abcd";
// Linha como a `vw_produtos_public` devolve (com as variações embutidas).
const LINHA_DO_BANCO = {
  id: ID,
  name: "Vestido Azul",
  price: 129.9,
  ativo: true,
  product_variants: [],
};

describe("coração da tela do produto aberta por link antes do catálogo", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    catalogo.products = [];
    catalogo.carregando = true;
    catalogo.consultasDoProduto = 0;
    catalogo.pendentes = [];
    catalogo.avisos = [];
    catalogo.incluidos = [];
    catalogo.adminStatus = "not-admin";
    catalogo.redesenhos.clear();
    catalogo.idsFavoritos = [];
    catalogo.toques = [];
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
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

  const abrirNoLinkComOProdutoLidoSozinho = async () => {
    globalThis.history.replaceState(null, "", `/product-detail?id=${ID}`);
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar(20);
    const emEspera = catalogo.pendentes;
    catalogo.pendentes = [];
    for (const resolver of emEspera)
      resolver({ data: LINHA_DO_BANCO, error: null });
    await assentar();
  };
  const coracao = () =>
    container?.querySelector<HTMLButtonElement>('[data-testid="coracao"]') ??
    null;

  it("produto favoritado (nos ids guardados) aparece com o coração CHEIO, e o toque remove", async () => {
    catalogo.idsFavoritos = [ID];
    await abrirNoLinkComOProdutoLidoSozinho();

    expect(coracao()?.getAttribute("aria-pressed")).toBe("true");

    await act(async () => {
      coracao()?.click();
    });
    expect(catalogo.toques).toEqual(["remover"]);
  });

  it("produto não favoritado aparece com o coração VAZIO, e o toque favorita", async () => {
    await abrirNoLinkComOProdutoLidoSozinho();

    expect(coracao()?.getAttribute("aria-pressed")).toBe("false");

    await act(async () => {
      coracao()?.click();
    });
    expect(catalogo.toques).toEqual(["favoritar"]);
  });
});
