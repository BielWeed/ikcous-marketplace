// @vitest-environment jsdom
//
// A LOJA ABRE COM O ARMAZENAMENTO DO NAVEGADOR BLOQUEADO (caça, r430-a).
//
// Chrome com "Bloquear todos os cookies e dados de sites", Safari com
// "Bloquear todos os cookies" e certos modos privados/WebViews fazem o próprio
// ACESSO a `window.sessionStorage` / `window.localStorage` lançar
// SecurityError. O App lia `sessionStorage` ("splash_shown") sem proteção, em
// dois efeitos de arranque: a exceção subia ao error boundary e a loja não
// abria — recarregar repetia a mesma leitura, e a cliente ficava sem comprar
// mesmo com internet. Sem armazenamento, a loja abre igual e só não lembra
// que o splash já passou.
//
// Mocks no padrão de checkout-recarga-no-app.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Cada render do checkout, com as props que importam aqui.
const { rendersDoCheckout } = vi.hoisted(() => ({
  rendersDoCheckout: [] as Array<{
    retomarPedidoId: string | undefined;
    retomadaDaRecarga: boolean | undefined;
  }>,
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

// Mutável de propósito: o teste loga a pessoa NO MEIO da jornada.
const { estadoAuth } = vi.hoisted(() => ({
  estadoAuth: {
    user: { id: "user-1" } as { id: string } | null,
    isAdmin: false,
    adminStatus: "not-admin",
    loading: false,
    isPasswordRecovery: false,
  },
}));

vi.mock("@/views/customer/HomeView", () => ({
  HomeView: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string, id?: string) => void;
  }) => (
    <div data-testid="home">
      <button
        type="button"
        data-testid="ir-para-checkout"
        onClick={() => onNavigate("checkout")}
      >
        Checkout novo
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
vi.mock("@/views/customer/ProfileView", () => ({
  ProfileView: () => <div data-testid="tela-perfil-proprio" />,
}));
vi.mock("@/views/shared/AuthView", () => ({
  AuthView: () => <div data-testid="tela-login" />,
}));
// Dublê do checkout: registra as props de CADA render e oferece a saída
// que o cliente toca ("Ver meus pedidos", "Voltar à vitrine" — todas passam
// por `onNavigate`).
vi.mock("@/views/customer/CheckoutView", () => ({
  CheckoutView: ({
    onNavigate,
    retomarPedidoId,
    retomadaDaRecarga,
  }: {
    readonly onNavigate: (view: string) => void;
    readonly retomarPedidoId?: string;
    readonly retomadaDaRecarga?: boolean;
  }) => {
    rendersDoCheckout.push({ retomarPedidoId, retomadaDaRecarga });
    return (
      <div data-testid="tela-checkout">
        <button
          type="button"
          data-testid="sair-do-checkout"
          onClick={() => onNavigate("home")}
        >
          Voltar à vitrine
        </button>
      </div>
    );
  },
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
  useAuth: () => estadoAuth,
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
  consulta.single = () =>
    Promise.resolve({
      data: null,
      error: { message: "not found", code: "PGRST116" },
    });
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
    dados,
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

describe("App — a loja abre com o armazenamento do navegador bloqueado", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;
  let sessao: ReturnType<typeof dubleDeArmazem>;

  beforeEach(() => {
    estadoAuth.user = { id: "user-1" };
    estadoAuth.loading = false;
    rendersDoCheckout.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});

    vi.stubGlobal("localStorage", dubleDeArmazem());
    sessao = dubleDeArmazem();
    vi.stubGlobal("sessionStorage", sessao);
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
    globalThis.history.replaceState(null, "", "/");
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

  /** A carga da página (o F5): o App nasce na URL dada. */
  const carregarEm = async (caminho: string) => {
    globalThis.history.replaceState(null, "", caminho);
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };

  const naTela = (marca: string) =>
    container?.querySelector(`[data-testid="${marca}"]`) ?? null;

  /** O bloqueio de verdade: o ACESSO à propriedade lança, como no navegador. */
  const bloquearOAcesso = (nome: "localStorage" | "sessionStorage") => {
    const original = Object.getOwnPropertyDescriptor(globalThis, nome);
    Object.defineProperty(globalThis, nome, {
      configurable: true,
      get() {
        throw new DOMException("The operation is insecure.", "SecurityError");
      },
    });
    return () => {
      if (original) Object.defineProperty(globalThis, nome, original);
      else Reflect.deleteProperty(globalThis, nome);
    };
  };

  const pintarOLoader = () => {
    const loader = document.createElement("div");
    loader.id = "silent-guardian-loader";
    document.body.append(loader);
    return loader;
  };

  it("sessionStorage e localStorage lançam ao ACESSAR: a loja abre e o loader sai", async () => {
    const loader = pintarOLoader();
    const desfazer = [
      bloquearOAcesso("sessionStorage"),
      bloquearOAcesso("localStorage"),
    ];
    try {
      await carregarEm("/");

      expect(naTela("home")).not.toBeNull();
      expect(document.body.contains(loader)).toBe(false);
    } finally {
      for (const f of desfazer) f();
      loader.remove();
    }
  });

  it("controle: com armazenamento normal o splash fica marcado na sessão", async () => {
    const loader = pintarOLoader();
    try {
      await carregarEm("/");

      expect(naTela("home")).not.toBeNull();
      expect(sessao.dados.get("splash_shown")).toBe("true");
      expect(document.body.contains(loader)).toBe(false);
    } finally {
      loader.remove();
    }
  });

  it("controle: com o splash já marcado na sessão, o loader sai no arranque", async () => {
    sessao.dados.set("splash_shown", "true");
    const loader = pintarOLoader();
    // Dados ainda carregando: só o efeito do arranque pode tirar o loader.
    estadoAuth.loading = true;
    try {
      await carregarEm("/");

      expect(document.body.contains(loader)).toBe(false);
    } finally {
      loader.remove();
    }
  });
});
