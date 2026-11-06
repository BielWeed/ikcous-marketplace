// @vitest-environment jsdom
//
// Caça 30 (06/11/2026): o "Comprar" da faixa de ofertas mostrava o aviso
// vermelho de estoque ao abrir o checkout quando a cliente já tinha a ÚLTIMA
// unidade no carrinho (o addToCart recusava a segunda unidade e avisava, e o
// App navegava mesmo assim). Agora, com a linha já no carrinho no limite do
// estoque, o App segue direto ao checkout SEM chamar addToCart (sem aviso e
// sem dobrar a quantidade); com estoque sobrando soma 1 como sempre; e o
// produto esgotado de verdade (nada no carrinho) fica na vitrine.
//
// Mesmo cenário-base de app-endereco-desconhecido-volta-para-a-home (App
// inteiro, só as pontas dubladas).
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
    products,
    onQuickBuy,
  }: {
    readonly products: { id: string }[];
    readonly onQuickBuy: (product: { id: string }) => void;
  }) => (
    <div data-testid="home">
      <button
        type="button"
        data-testid="comprar"
        onClick={() => onQuickBuy(products[0])}
      >
        Comprar
      </button>
    </div>
  ),
}));
vi.mock("@/views/customer/CheckoutView", () => ({
  CheckoutView: () => <div data-testid="tela-checkout" />,
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
const carrinho = vi.hoisted(() => ({
  linhas: [] as unknown[],
  addToCart: (() => 0) as (...args: unknown[]) => number,
}));
vi.mock("@/contexts/CartContext", () => ({
  CartProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
  useCartState: () => ({ cartCount: 0, cart: carrinho.linhas }),
  useCartActions: () => ({ addToCart: carrinho.addToCart }),
  useCartContext: () => ({ cartCount: 0, addToCart: carrinho.addToCart }),
}));
vi.mock("@/contexts/FavoritesContext", () => ({
  FavoritesProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({ cartCount: 0, addToCart: carrinho.addToCart }),
  useCartState: () => ({ cartCount: 0, cart: carrinho.linhas }),
  useCartActions: () => ({ addToCart: carrinho.addToCart }),
}));
const estadoDoLink = vi.hoisted(() => ({
  vencido: false,
  confirmacaoVencida: false,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    isAdmin: false,
    adminStatus: "not-admin",
    loading: false,
    isPasswordRecovery: false,
    linkDeRecuperacaoVencido: estadoDoLink.vencido,
    linkDeConfirmacaoVencido: estadoDoLink.confirmacaoVencida,
  }),
}));
vi.mock("@/views/shared/AuthView", () => ({
  AuthView: () => <div data-testid="tela-auth" />,
}));
const catalogo = vi.hoisted(() => ({
  products: [{ id: "produto-A", stock: 1 }] as { id: string; stock: number }[],
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

describe("App — Comprar da faixa de ofertas com a última unidade já no carrinho", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;
  let adicionar: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    catalogo.products = [{ id: "produto-A", stock: 1 }];
    carrinho.linhas = [];
    adicionar = vi.fn(() => 1);
    carrinho.addToCart = adicionar as never;
    estadoDoLink.vencido = false;
    estadoDoLink.confirmacaoVencida = false;
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

  const abrirEComprar = async () => {
    globalThis.history.replaceState(null, "", "/");
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
    const botao = container?.querySelector<HTMLButtonElement>(
      '[data-testid="comprar"]',
    );
    expect(botao).not.toBeNull();
    await act(async () => {
      botao?.click();
    });
    await assentar();
  };

  const naTelaDoCheckout = () =>
    container?.querySelector('[data-testid="tela-checkout"]') !== null;

  it("a última unidade já está no carrinho: vai ao checkout SEM chamar addToCart (sem aviso, sem dobrar)", async () => {
    carrinho.linhas = [
      {
        product: { id: "produto-A", stock: 1 },
        quantity: 1,
        variantId: undefined,
      },
    ];
    await abrirEComprar();

    expect(adicionar).not.toHaveBeenCalled();
    expect(naTelaDoCheckout()).toBe(true);
  });

  it("ainda sobra estoque: soma 1 como sempre e vai ao checkout", async () => {
    catalogo.products = [{ id: "produto-A", stock: 5 }];
    carrinho.linhas = [
      {
        product: { id: "produto-A", stock: 5 },
        quantity: 1,
        variantId: undefined,
      },
    ];
    await abrirEComprar();

    expect(adicionar).toHaveBeenCalledTimes(1);
    expect(naTelaDoCheckout()).toBe(true);
  });

  it("produto novo no carrinho: soma 1 e vai ao checkout", async () => {
    await abrirEComprar();

    expect(adicionar).toHaveBeenCalledTimes(1);
    expect(naTelaDoCheckout()).toBe(true);
  });

  it("esgotado de verdade (nada no carrinho, addToCart devolve 0): fica na vitrine", async () => {
    catalogo.products = [{ id: "produto-A", stock: 0 }];
    adicionar.mockReturnValue(0);
    await abrirEComprar();

    expect(adicionar).toHaveBeenCalledTimes(1);
    expect(naTelaDoCheckout()).toBe(false);
    expect(container?.querySelector('[data-testid="home"]')).not.toBeNull();
  });
});
