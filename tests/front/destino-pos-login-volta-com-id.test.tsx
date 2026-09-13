// @vitest-environment jsdom
// Follow-up da rodada 2 do destino pós-login (revisão do conserto do #561):
// Toda entrada em user-profile leva o `id` do perfil, e o gate do
// `handleNavigate` o mantém vivo no state do login
// ({view:"auth", id, requested:"user-profile"}). Honrar o `requested` sem
// REPASSAR o id era mandar a pessoa à view certa sem perfil nenhum —
// `UserProfileView` só desenha com `userId`, e sem ele o skeleton carrega
// para sempre. Nenhum teste cobria o par App→lib; este cobre a jornada:
// visitante barrada → login → volta à view pedida COM o id (e com `?id` na
// URL). E trava a regressão: onSuccess partindo de /auth puro (sem
// requested) cai no perfil próprio, SEM `?id` fantasma.
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

// Mutável de propósito: o teste loga a pessoa NO MEIO da jornada.
const { estadoAuth } = vi.hoisted(() => ({
  estadoAuth: {
    user: null as { id: string } | null,
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
        data-testid="ir-para-perfil-publico"
        onClick={() => onNavigate("user-profile", "outra-pessoa")}
      >
        Perfil público
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
// O duble expõe o `userId` recebido — é exatamente ele o objeto do conserto.
vi.mock("@/views/customer/UserProfileView", () => ({
  UserProfileView: ({ userId }: { readonly userId: string }) => (
    <div data-testid="tela-perfil-publico" data-user-id={userId} />
  ),
}));
vi.mock("@/views/shared/AuthView", async () => {
  const React = await import("react");
  return {
    // O AuthView real dispara `onSuccess` num `useEffect` que reage ao
    // `user` sair de `null`. O duble repete o MESMO mecanismo — e a ordem é
    // parte do que se prova: efeito de filho roda antes do efeito de pai,
    // então o onSuccess (e o repasse do id) vence a checagem do
    // `syncWithUrl` que devolveria um usuário logado em /auth ao perfil.
    AuthView: ({ onSuccess }: { readonly onSuccess: () => void }) => {
      // Local de propósito: é ele a dependência legítima do efeito — o
      // duble reexecuta a cada render do App e relê o estado mutável.
      const user = estadoAuth.user;
      React.useEffect(() => {
        if (user) onSuccess();
      }, [user, onSuccess]);
      return <div data-testid="tela-login" />;
    },
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

describe("destino pós-login repassa o id do perfil público pedido", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    estadoAuth.user = null;
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

  // Loga NO MEIO do teste: muta o estado e força re-render. O App só relê
  // `useAuth()` ao renderizar; `userRef` sincroniza no `useLayoutEffect`
  // desse render, e o efeito do duble do AuthView (filho) dispara o
  // `onSuccess` antes dos efeitos do App (pai) — a ordem de produção.
  const entrar = async () => {
    estadoAuth.user = { id: "pessoa-logada" };
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };

  it("visitante barrada no perfil público: depois de entrar volta à view pedida COM o id do perfil", async () => {
    await abrir();
    await clicar("ir-para-perfil-publico");

    // O gate mandou ao login e guardou o pedido + o id no state.
    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.history.state?.view).toBe("auth");
    expect(globalThis.history.state?.requested).toBe("user-profile");
    expect(globalThis.history.state?.id).toBe("outra-pessoa");
    expect(
      container?.querySelector('[data-testid="tela-perfil-publico"]'),
    ).toBeNull();

    await entrar();

    // A view CERTA montou, com o perfil PEDIDO (não skeleton, não "").
    const tela = container?.querySelector(
      '[data-testid="tela-perfil-publico"]',
    );
    expect(tela).not.toBeNull();
    expect(tela?.getAttribute("data-user-id")).toBe("outra-pessoa");
    expect(globalThis.location.pathname).toBe("/user-profile");
    expect(globalThis.location.search).toBe("?id=outra-pessoa");
    expect(globalThis.history.state?.view).toBe("user-profile");
  });

  it("onSuccess partindo de /auth puro (sem requested): cai no perfil próprio, sem ?id fantasma", async () => {
    await abrir();
    await act(async () => {
      globalThis.history.pushState({ view: "auth" }, "", "/auth");
      globalThis.dispatchEvent(
        new PopStateEvent("popstate", { state: { view: "auth" } }),
      );
    });
    await assentar();
    expect(globalThis.location.pathname).toBe("/auth");

    await entrar();

    expect(globalThis.location.pathname).toBe("/profile");
    expect(globalThis.location.search).toBe("");
    expect(
      container?.querySelector('[data-testid="tela-perfil-publico"]'),
    ).toBeNull();
    expect(globalThis.history.state?.view).toBe("profile");
  });
});
