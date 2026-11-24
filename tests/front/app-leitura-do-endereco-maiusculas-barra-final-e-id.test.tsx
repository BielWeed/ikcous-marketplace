// @vitest-environment jsdom
//
// A LEITURA DO ENDEREÇO DO APP (`syncWithUrl`) TEM LIMITES QUE NENHUM TESTE
// PRENDIA: o caminho em maiúsculas (`/CART`), a barra no fim (`/cart/`), a forma
// com barra do painel (`/admin/orders`, que vira `admin-orders`), o `?category=`
// vazio (que NÃO é uma categoria chamada ""), o `?id=` do endereço que vence o
// `id` que sobrou no `history.state`, e o `#trecho` do endereço desconhecido,
// que a correção para a Início não pode perder.
//
// Mesmo cenário-base de app-endereco-desconhecido-volta-para-a-home (App
// inteiro, só as pontas dubladas); aqui a sessão é ajustável por teste.
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
  HomeView: ({ selectedCategory }: { readonly selectedCategory: string }) => (
    <div data-testid="home" data-categoria={selectedCategory} />
  ),
}));
vi.mock("@/views/customer/CartView", () => ({
  CartView: () => <div data-testid="tela-carrinho" />,
}));
vi.mock("@/views/customer/ProductView", () => ({
  ProductView: ({ product }: { readonly product: { readonly id: string } }) => (
    <div data-testid="tela-produto" data-produto={product.id} />
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
vi.mock("@/components/ui/custom/BottomNav", () => ({
  BottomNav: () => null,
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
// Objeto ESTÁVEL entre renders (um novo a cada render reabriria os efeitos).
const sessaoDoTeste = vi.hoisted(() => ({
  retorno: {
    user: null,
    isAdmin: false,
    adminStatus: "not-admin",
    loading: false,
    isPasswordRecovery: false,
    linkDeRecuperacaoVencido: false,
    linkDeConfirmacaoVencido: false,
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => sessaoDoTeste.retorno,
}));
vi.mock("@/views/shared/AuthView", () => ({
  AuthView: () => <div data-testid="tela-auth" />,
}));
const catalogo = vi.hoisted(() => ({
  products: [{ id: "produto-A" }, { id: "produto-B" }] as { id: string }[],
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: catalogo.products,
    loading: false,
    fetchProducts: () => {},
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
  consulta.single = () =>
    Promise.resolve({ data: null, error: { code: "PGRST116" } });
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

describe("App — leitura do endereço: maiúsculas, barra final, forma do painel e id", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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

  const assentar = async (voltas = 20) => {
    for (let i = 0; i < voltas; i++) {
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };
  const abrirEm = async (endereco: string, estado: unknown = null) => {
    globalThis.history.replaceState(estado, "", endereco);
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };
  const tela = (id: string) =>
    container?.querySelector(`[data-testid="${id}"]`) ?? null;

  it.each(["/CART", "/Cart", "/cart/", "/CART/"])(
    "%s abre o carrinho (maiúsculas e barra final não fazem o endereço virar desconhecido)",
    async (endereco) => {
      await abrirEm(endereco);
      expect(tela("tela-carrinho")).not.toBeNull();
      // O endereço não foi corrigido para a Início.
      expect(globalThis.location.pathname).toBe(endereco);
    },
  );

  it("LIMITE: /cart//  (duas barras no fim) não é o carrinho — só UMA barra final é tirada", async () => {
    await abrirEm("/cart//");
    expect(tela("tela-carrinho")).toBeNull();
    expect(tela("home")).not.toBeNull();
    expect(globalThis.location.pathname).toBe("/");
  });

  it.each(["/admin/orders", "/Admin/Orders/"])(
    "%s (forma com barra do painel) é a tela de pedidos do painel: sem sessão pede entrada, não cai na vitrine",
    async (endereco) => {
      await abrirEm(endereco);
      expect(tela("tela-auth")).not.toBeNull();
      expect(globalThis.location.pathname).toBe("/auth");
    },
  );

  it("CONTROLE: /admin/ sozinho não vira uma tela do painel com nome em branco", async () => {
    await abrirEm("/admin/");
    // "admin/" perde a barra final e é a porta do painel (`admin`): sem sessão
    // pede entrada, igual a /admin.
    expect(tela("tela-auth")).not.toBeNull();
    expect(globalThis.location.pathname).toBe("/auth");
  });

  it('/?category= (vazio) NÃO é uma categoria chamada "": a Início fica em Todas', async () => {
    await abrirEm("/?category=");
    expect(tela("home")?.getAttribute("data-categoria")).toBe("Todas");
  });

  it("controle: /?category=Bebidas segue filtrando", async () => {
    await abrirEm("/?category=Bebidas");
    expect(tela("home")?.getAttribute("data-categoria")).toBe("Bebidas");
  });

  it("o ?id= do endereço vence o id que sobrou no history.state (link colado em cima de uma entrada velha)", async () => {
    await abrirEm("/product-detail?id=produto-A", {
      view: "product-detail",
      id: "produto-B",
    });
    expect(tela("tela-produto")?.getAttribute("data-produto")).toBe(
      "produto-A",
    );
  });

  it("endereço desconhecido com #trecho: vai para a Início SEM perder o #trecho", async () => {
    await abrirEm("/produto/abc#ofertas");
    expect(tela("home")).not.toBeNull();
    expect(globalThis.location.pathname).toBe("/");
    expect(globalThis.location.hash).toBe("#ofertas");
  });

  it("endereço desconhecido com categoria e #trecho: mantém os dois", async () => {
    await abrirEm("/produto/abc?category=Bebidas#ofertas");
    expect(globalThis.location.pathname + globalThis.location.search).toBe(
      "/?category=Bebidas",
    );
    expect(globalThis.location.hash).toBe("#ofertas");
  });
});
