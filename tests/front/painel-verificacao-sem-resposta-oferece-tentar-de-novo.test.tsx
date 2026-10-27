// @vitest-environment jsdom
//
// Lojista dona com internet ruim abre o painel (sessão guardada no aparelho) e
// a pergunta "ela é dona?" ao servidor não volta a tempo. Antes: o contexto de
// login gravava "não é dona" (o limite era de 3 s), o App mostrava "Acesso
// restrito a administradores." e a mandava à vitrine. "O servidor não
// respondeu" não é "o servidor disse que não": agora vira a tela "Não foi
// possível confirmar seu acesso" com "Tentar de novo" (a mesma que o portão do
// painel já mostrava), sem aviso de acesso negado e sem montar nenhum pedaço do
// painel. Quem o servidor RESPONDE que não é dona continua expulsa, com o aviso.
//
// RENDER DE VERDADE: AuthProvider real + App real (supabase dublado). O
// servidor continua barrando os dados por `is_admin()`; isto é só o que a tela
// decide.
// quem já está logada e não é admin segue indo para a vitrine, como hoje.
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
vi.mock("@/views/shared/AuthView", async () => {
  const React = await import("react");
  return {
    // O AuthView real dispara `onSuccess` num `useEffect` que reage ao
    // `user` sair de `null`. O duble repete o MESMO mecanismo.
    AuthView: ({ onSuccess }: { readonly onSuccess: () => void }) => {
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

describe("painel: o servidor não respondeu se a lojista é dona", () => {
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

    globalThis.history.replaceState(null, "", "/admin");

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

  const botao = (texto: string) =>
    Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.trim() === texto,
    ) ?? null;

  const textoDaTela = () => container?.textContent ?? "";

  const avisoDeAcessoNegado = () =>
    avisoErro.mock.calls.filter(([msg]) =>
      String(msg).includes("Acesso restrito"),
    );

  it("sem resposta depois do limite: mostra 'Tentar de novo', NÃO avisa acesso restrito e NÃO monta o painel", async () => {
    await abrirPainel();
    expect(servidor.pendentes.length).toBe(1); // a pergunta saiu e não volta
    // Antes do limite (3 s) ainda é "verificando".
    expect(botao("Tentar de novo")).toBeNull();

    await esperar(3300); // o limite de 3 s estourou

    expect(botao("Tentar de novo")).not.toBeNull();
    expect(textoDaTela()).toContain("Não foi possível confirmar seu acesso");
    expect(avisoDeAcessoNegado()).toHaveLength(0);
    // Ficou no painel: não foi mandada à vitrine nem montou o painel.
    expect(globalThis.location.pathname).toBe("/admin");
    expect(tela("painel")).toBeNull();
    expect(tela("home")).toBeNull();
  }, 15_000);

  it("'Tentar de novo' pergunta outra vez; se agora o servidor diz que é dona, o painel abre", async () => {
    await abrirPainel();
    await esperar(3300);
    expect(botao("Tentar de novo")).not.toBeNull();

    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    await esperar(50);
    expect(servidor.pendentes.length).toBe(2); // perguntou de novo
    expect(botao("Tentar de novo")).toBeNull(); // voltou a "verificando"

    servidor.pendentes[1].resolve({ data: true, error: null });
    await esperar(50);

    expect(tela("painel")).not.toBeNull();
    expect(avisoDeAcessoNegado()).toHaveLength(0);
  }, 15_000);

  it("controle: o servidor RESPONDE que não é dona -> aviso de acesso restrito e vitrine, como sempre", async () => {
    await abrirPainel();
    expect(servidor.pendentes.length).toBe(1);
    servidor.pendentes[0].resolve({ data: false, error: null });
    await esperar(100);

    expect(avisoDeAcessoNegado().length).toBeGreaterThan(0);
    expect(botao("Tentar de novo")).toBeNull();
    expect(tela("painel")).toBeNull();
    expect(tela("home")).not.toBeNull();
  }, 15_000);
});
