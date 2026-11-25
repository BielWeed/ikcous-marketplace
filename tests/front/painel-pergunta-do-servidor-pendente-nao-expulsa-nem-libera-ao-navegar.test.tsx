// @vitest-environment jsdom
//
// Caça de provas fracas (24/11/2026), papéis: NAVEGAR para o painel (toque no
// aviso de "pedido novo", por exemplo) enquanto a pergunta "ela é dona?" ainda
// não foi respondida (`adminStatus` "unknown"). O teste vizinho
// (`painel-verificacao-sem-resposta-oferece-tentar-de-novo`) abre o painel
// DIRETO pela URL; o caminho por navegação interna (`handleNavigate`) tem a
// própria guarda e não tinha prova:
//   - "ainda não sei" não expulsa: a lojista que toca em "Pedidos" no
//     instante em que o app abre não é mandada à vitrine antes de o servidor
//     responder, e o painel abre quando ele diz que é dona;
//   - o "não" REAL do servidor barra a navegação: quem não é administradora
//     fica na vitrine e o painel nunca monta.
//
// RENDER DE VERDADE: AuthProvider real + App real (supabase dublado). O
// servidor continua barrando os dados por `is_admin()`; isto é só o que a tela
// decide.
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

const { avisoErro, servidor } = vi.hoisted(() => ({
  // `toast.error` espiado: é o aviso "Acesso restrito" que NÃO pode aparecer
  // quando o servidor simplesmente não respondeu.
  avisoErro: vi.fn(),
  servidor: {
    // Cada chamada de `is_admin` entra aqui; o teste decide quando e o que
    // responder (nunca responder = rede que não volta).
    pendentes: [] as Array<{
      resolve: (v: unknown) => void;
      reject: (e: unknown) => void;
    }>,
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
        data-testid="ir-para-pedidos-do-painel"
        onClick={() => onNavigate("admin-orders")}
      >
        Pedidos do painel
      </button>
      <button
        type="button"
        data-testid="ir-para-o-login-do-lojista"
        onClick={() => onNavigate("admin-login")}
      >
        Entrada do lojista
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
vi.mock("@/views/admin/AdminLoginView", () => ({
  AdminLoginView: () => <div data-testid="tela-login-do-lojista" />,
}));
// O portão real fala com o servidor (`is_admin`); aqui basta saber SE o painel
// montou — o que só acontece para quem o App já confirmou como admin.
vi.mock("@/components/layouts/AdminAreaGate", () => ({
  AdminAreaGate: ({ currentView }: { readonly currentView: string }) => (
    <div data-testid="painel" data-tela={currentView} />
  ),
}));
// Aqui só importa saber se a tela de entrada apareceu.
vi.mock("@/views/shared/AuthView", () => ({
  AuthView: () => <div data-testid="tela-login" />,
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
    error: avisoErro,
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
  const sessao = {
    access_token: "token-da-dona",
    user: { id: "dona", app_metadata: {} },
  };
  const consulta: Record<string, unknown> = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.single = () =>
    Promise.resolve({
      data: null,
      error: { message: "network error", code: "FETCH" },
    });
  return {
    supabase: {
      from: () => consulta,
      rpc: (nome: string) => {
        if (nome === "is_admin") {
          return new Promise((resolve, reject) => {
            servidor.pendentes.push({ resolve, reject });
          });
        }
        return Promise.resolve({ data: null, error: null });
      },
      auth: {
        getSession: () => Promise.resolve({ data: { session: sessao } }),
        getUser: () =>
          Promise.resolve({ data: { user: sessao.user }, error: null }),
        onAuthStateChange: () => ({
          data: { subscription: { unsubscribe: () => {} } },
        }),
        signOut: () => Promise.resolve({ error: null }),
      },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
    },
  };
});

import App from "@/App";
import { AuthProvider } from "@/contexts/AuthContext";
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

describe("painel: navegar para ele com a pergunta do servidor pendente", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    avisoErro.mockClear();
    servidor.pendentes.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    const armazem = dubleDeArmazem();
    // A sessão guardada no aparelho: é ela que faz o app abrir já "logado".
    armazem.setItem(
      "sb-loja-auth-token",
      JSON.stringify({
        access_token: "token-da-dona",
        user: { id: "dona", app_metadata: {} },
      }),
    );
    vi.stubGlobal("localStorage", armazem);
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
      await new Promise((resolve) => setTimeout(resolve, 200));
    });
    await act(async () => {
      paraDesmontar?.unmount();
    });
    container?.remove();
    raiz = null;
    container = null;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const esperar = async (ms: number) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  };

  const abrirPainel = async () => {
    await act(async () => {
      raiz?.render(
        <AuthProvider>
          <App />
        </AuthProvider>,
      );
    });
    await esperar(50);
  };

  const tela = (marca: string) =>
    container?.querySelector(`[data-testid="${marca}"]`) ?? null;

  const avisoDeAcessoNegado = () =>
    avisoErro.mock.calls.filter(([msg]) =>
      String(msg).includes("Acesso restrito"),
    );

  const tocarEmPedidosDoPainel = async () => {
    await act(async () => {
      (tela("ir-para-pedidos-do-painel") as HTMLButtonElement | null)?.click();
    });
    await esperar(100);
  };

  it("toca em 'Pedidos do painel' com a pergunta ainda pendente: não é desviada para a vitrine, e o painel abre nessa tela quando o servidor diz que é dona", async () => {
    await abrirPainel();
    expect(tela("home")).not.toBeNull();
    expect(servidor.pendentes.length).toBe(1);

    await tocarEmPedidosDoPainel();

    // "Ainda não sei" não expulsa: a navegação vale, e nenhum pedaço do painel
    // monta antes do sim do servidor.
    expect(globalThis.location.pathname).toBe("/admin-orders");
    expect(tela("painel")).toBeNull();
    expect(avisoDeAcessoNegado()).toHaveLength(0);

    servidor.pendentes[0].resolve({ data: true, error: null });
    await esperar(100);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-orders");
    expect(avisoDeAcessoNegado()).toHaveLength(0);
  }, 15_000);

  it("controle: o servidor RESPONDE que não é administradora -> tocar em 'Pedidos do painel' não sai da vitrine e o painel nunca monta", async () => {
    await abrirPainel();
    servidor.pendentes[0].resolve({ data: false, error: null });
    await esperar(100);

    await tocarEmPedidosDoPainel();

    expect(globalThis.location.pathname).toBe("/");
    expect(tela("home")).not.toBeNull();
    expect(tela("painel")).toBeNull();
  }, 15_000);

  it("abrir /admin direto e o servidor dizer que NÃO é administradora: vai à vitrine com UM aviso só (não um por porta)", async () => {
    globalThis.history.replaceState(null, "", "/admin");
    await abrirPainel();
    servidor.pendentes[0].resolve({ data: false, error: null });
    await esperar(100);

    expect(tela("painel")).toBeNull();
    expect(tela("home")).not.toBeNull();
    expect(avisoDeAcessoNegado()).toHaveLength(1);
  }, 15_000);

  it("a tela de ENTRADA do lojista (admin-login) não é tela do painel: quem tem conta de cliente chega nela, não é devolvida à vitrine", async () => {
    await abrirPainel();
    servidor.pendentes[0].resolve({ data: false, error: null });
    await esperar(100);

    await act(async () => {
      (tela("ir-para-o-login-do-lojista") as HTMLButtonElement | null)?.click();
    });
    await esperar(100);

    expect(tela("tela-login-do-lojista")).not.toBeNull();
    expect(tela("painel")).toBeNull();
    expect(avisoDeAcessoNegado()).toHaveLength(0);
  }, 15_000);
});
