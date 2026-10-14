// @vitest-environment jsdom
// O aviso (push) de "pedido novo" abre `/admin-orders`. Quem toca nele sem
// sessão (saiu da conta, ou a sessão caiu) era jogada na vitrine de clientes,
// sem tela de entrada e sem nenhum aviso. Agora o painel sem conta pede
// entrada (a mesma tela `/auth` que o perfil usa), guarda o pedido, e depois
// de entrar a lojista chega nos pedidos. Quem NÃO é admin nunca vê o painel, e
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

// Mutável de propósito: cada teste escolhe visitante, logada ou admin no ato.
const { estadoAuth, avisoErro } = vi.hoisted(() => ({
  // `toast.error` espiado: é o aviso "Acesso restrito" que a logada que não é
  // admin lê ao ser mandada para a vitrine.
  avisoErro: vi.fn(),
  estadoAuth: {
    user: null as { id: string } | null,
    isAdmin: false,
    adminStatus: "not-admin" as string,
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

describe("painel sem sessão pede entrada (aviso de pedido novo)", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    estadoAuth.user = null;
    estadoAuth.isAdmin = false;
    estadoAuth.adminStatus = "not-admin";
    estadoAuth.loading = false;
    avisoErro.mockClear();
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
    // O `popstate` do App agenda um `setTimeout` de 150 ms (direção da
    // navegação). Espera o debounce com o app ainda montado.
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

  // Abre o app JÁ no endereço (é o que o toque no aviso faz: janela nova).
  const abrirEm = async (endereco: string) => {
    globalThis.history.replaceState(null, "", endereco);
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };

  const abrirNaVitrine = async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
    expect(globalThis.history.state).toBeNull();
  };

  const tela = (marca: string) =>
    container?.querySelector(`[data-testid="${marca}"]`) ?? null;

  // Loga NO MEIO do teste: muta o estado e força re-render (o AuthView duble
  // dispara `onSuccess` antes dos efeitos do App, na ordem de produção).
  const entrar = async (comoAdmin: boolean) => {
    estadoAuth.user = { id: "pessoa-logada" };
    estadoAuth.isAdmin = comoAdmin;
    estadoAuth.adminStatus = comoAdmin ? "admin" : "not-admin";
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };

  // A ordem REAL de um login (AuthContext, SIGNED_IN): primeiro chega o
  // usuário novo com `loading: true` e o `adminStatus` ainda o "not-admin" da
  // sessão anterior (passo A); só depois o servidor dá o veredito e a tela de
  // carregamento sai (passo B). É nessa janela que a guarda de admin tem de
  // esperar, e é por ela que quem NÃO é admin chega ao mesmo fim.
  const entrarEmDoisPassos = async (comoAdmin: boolean) => {
    estadoAuth.user = { id: "pessoa-logada" };
    estadoAuth.loading = true;
    estadoAuth.adminStatus = "not-admin";
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();

    estadoAuth.isAdmin = comoAdmin;
    estadoAuth.adminStatus = comoAdmin ? "admin" : "not-admin";
    estadoAuth.loading = false;
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };

  const esperarTelaDeEntradaComPedidoGuardado = () => {
    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.history.state?.view).toBe("auth");
    expect(globalThis.history.state?.requested).toBe("admin-orders");
    expect(tela("tela-login")).not.toBeNull();
    expect(tela("painel")).toBeNull();
  };

  it("(a) sem sessão, aviso abre /admin-orders: vai para a tela de entrada com o destino guardado", async () => {
    await abrirEm("/admin-orders");
    esperarTelaDeEntradaComPedidoGuardado();
    // Janela nova: a vitrine nem chega a montar (era para onde ela caía).
    expect(tela("home")).toBeNull();
  });

  it("(a) a mesma regra vale quando o endereço chega por Voltar/avançar do navegador (popstate)", async () => {
    await abrirNaVitrine();
    await act(async () => {
      const estado = { view: "admin-orders" };
      globalThis.history.pushState(estado, "", "/admin-orders");
      globalThis.dispatchEvent(
        new PopStateEvent("popstate", { state: estado }),
      );
    });
    await assentar();
    esperarTelaDeEntradaComPedidoGuardado();
  });

  it("(a) a navegação interna (handleNavigate) segue a mesma regra e guarda o pedido", async () => {
    await abrirNaVitrine();
    await clicar("ir-para-pedidos-do-painel");
    esperarTelaDeEntradaComPedidoGuardado();
  });

  it("(a) outra tela do painel sem sessão também pede entrada, mas NÃO vira destino (lista fechada: depois de entrar vai ao perfil)", async () => {
    await abrirEm("/admin-settings");
    expect(globalThis.location.pathname).toBe("/auth");
    expect(tela("tela-login")).not.toBeNull();
    expect(tela("painel")).toBeNull();

    await entrar(true);
    // `admin-settings` foi pedido, mas só `admin-orders` é destino aceito.
    expect(tela("painel")).toBeNull();
    expect(globalThis.location.pathname).toBe("/profile");
  });

  it("(b) depois de entrar como admin, a lojista chega em /admin-orders", async () => {
    await abrirEm("/admin-orders");
    esperarTelaDeEntradaComPedidoGuardado();

    await entrarEmDoisPassos(true);

    const painel = tela("painel");
    expect(painel).not.toBeNull();
    expect(painel?.getAttribute("data-tela")).toBe("admin-orders");
    expect(globalThis.location.pathname).toBe("/admin-orders");
    expect(globalThis.history.state?.view).toBe("admin-orders");
    expect(tela("tela-login")).toBeNull();
  });

  it("(b) depois de entrar como cliente (NÃO admin), nunca vê o painel: vai para a vitrine", async () => {
    await abrirEm("/admin-orders");
    esperarTelaDeEntradaComPedidoGuardado();

    await entrarEmDoisPassos(false);

    expect(tela("painel")).toBeNull();
    expect(tela("home")).not.toBeNull();
    expect(globalThis.history.state?.view).toBe("home");
    expect(globalThis.location.pathname).not.toContain("admin");
  });

  // R1 (revisão Opus): o caso MAIS COMUM — refresh token vencido. A página abre
  // em /admin-orders com a sessão guardada no aparelho (`loading: true`,
  // `adminStatus: "unknown"`); o servidor derruba a sessão (user vira null,
  // loading false). O `AdminAccessDenied` (filho) roda ANTES do `syncWithUrl`
  // (pai) e expulsava para a vitrine com "Acesso restrito" — a transição
  // terminava por cima do redirecionamento para a entrada.
  it("(R1) sessão guardada que o servidor derruba: vai para a tela de entrada com o destino guardado, sem 'Acesso restrito'", async () => {
    estadoAuth.user = { id: "lojista" };
    estadoAuth.loading = true;
    estadoAuth.adminStatus = "unknown";
    await abrirEm("/admin-orders");
    expect(globalThis.location.pathname).toBe("/admin-orders");

    estadoAuth.user = null;
    estadoAuth.loading = false;
    estadoAuth.adminStatus = "not-admin";
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();

    esperarTelaDeEntradaComPedidoGuardado();
    expect(avisoErro).not.toHaveBeenCalled();

    await entrarEmDoisPassos(true);

    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-orders");
    expect(globalThis.location.pathname).toBe("/admin-orders");
    expect(tela("tela-login")).toBeNull();
  });

  it("(R1 controle) logada que NÃO é admin: vai para a vitrine COM o aviso 'Acesso restrito' (inalterado)", async () => {
    estadoAuth.user = { id: "pessoa-logada" };
    estadoAuth.loading = true;
    estadoAuth.adminStatus = "unknown";
    await abrirEm("/admin-orders");

    estadoAuth.loading = false;
    estadoAuth.adminStatus = "not-admin";
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();

    expect(avisoErro).toHaveBeenCalledWith(
      "Acesso restrito a administradores.",
    );
    expect(tela("painel")).toBeNull();
    expect(tela("tela-login")).toBeNull();
    expect(globalThis.history.state?.view).toBe("home");
    expect(globalThis.location.pathname).not.toContain("admin");
  });

  it("(c) logada e NÃO admin abrindo /admin-orders: vai para a vitrine, exatamente como hoje (não pede login)", async () => {
    estadoAuth.user = { id: "pessoa-logada" };
    await abrirEm("/admin-orders");

    expect(tela("tela-login")).toBeNull();
    expect(tela("painel")).toBeNull();
    expect(tela("home")).not.toBeNull();
    expect(globalThis.location.pathname).not.toBe("/auth");
    expect(globalThis.location.pathname).not.toContain("admin");
    expect(globalThis.history.state?.view).toBe("home");
  });

  it("(c) logada e NÃO admin clicando para o painel: continua na vitrine (não é mandada ao login)", async () => {
    estadoAuth.user = { id: "pessoa-logada" };
    await abrirNaVitrine();
    await clicar("ir-para-pedidos-do-painel");

    expect(tela("tela-login")).toBeNull();
    expect(tela("painel")).toBeNull();
    expect(tela("home")).not.toBeNull();
  });

  it("(c) admin já logada abrindo /admin-orders: chega direto no painel, sem passar pela entrada", async () => {
    estadoAuth.user = { id: "lojista" };
    estadoAuth.isAdmin = true;
    estadoAuth.adminStatus = "admin";
    await abrirEm("/admin-orders");

    expect(tela("tela-login")).toBeNull();
    expect(tela("painel")?.getAttribute("data-tela")).toBe("admin-orders");
    expect(globalThis.location.pathname).toBe("/admin-orders");
  });

  it("enquanto a sessão ainda carrega, o App NÃO manda a lojista para a entrada (espera o servidor responder)", async () => {
    estadoAuth.user = { id: "lojista" };
    estadoAuth.loading = true;
    estadoAuth.adminStatus = "unknown";
    await abrirEm("/admin-orders");

    expect(tela("tela-login")).toBeNull();
    expect(globalThis.location.pathname).toBe("/admin-orders");
  });

  it("(d) `requested` de fonte insegura: um history.state forjado com outra tela do painel não vira destino", async () => {
    await abrirNaVitrine();
    await act(async () => {
      const estado = { view: "auth", requested: "admin-settings" };
      globalThis.history.pushState(estado, "", "/auth");
      globalThis.dispatchEvent(
        new PopStateEvent("popstate", { state: estado }),
      );
    });
    await assentar();
    expect(tela("tela-login")).not.toBeNull();

    await entrar(true);

    expect(tela("painel")).toBeNull();
    expect(globalThis.location.pathname).toBe("/profile");
  });

  it("a tela de entrada do próprio lojista (/admin-login) continua alcançável sem sessão", async () => {
    await abrirEm("/admin-login");

    expect(globalThis.location.pathname).toBe("/admin-login");
    expect(tela("tela-login-do-lojista")).not.toBeNull();
    expect(tela("tela-login")).toBeNull();
  });
});
