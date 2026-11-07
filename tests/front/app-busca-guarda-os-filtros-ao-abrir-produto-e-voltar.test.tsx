// @vitest-environment jsdom
// Achado 1 do lote r56-d (06/11/2026): na tela de busca (/search), categoria e
// ordem escolhidas se perdiam ao abrir um produto e voltar.
//
// A tela só existe enquanto a rota é "search" e é desmontada ao abrir o
// produto; só o termo digitado voltava (o App o devolve). Agora o App guarda os
// filtros (como já fazia com o termo) e os devolve à tela quando ela volta. Eles
// só somem quando a cliente sai da busca de propósito — a mesma regra que já
// zera o termo (para o carrinho, perfil etc.; Início e produto não contam).
//
// Andaime: o MESMO de destino-pos-login-voltar-nao-cai-no-perfil.test.tsx.
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

const { FILTROS_ESCOLHIDOS } = vi.hoisted(() => ({
  FILTROS_ESCOLHIDOS: {
    category: "Acessórios",
    minPrice: "" as number | "",
    maxPrice: "" as number | "",
    sort: "price_asc",
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
        data-testid="ir-busca"
        onClick={() => onNavigate("search")}
      >
        Buscar
      </button>
    </div>
  ),
}));
// A busca de verdade é pesada e tem teste próprio
// (search-view-filtros-sobrevivem-a-abrir-produto-e-voltar.test.tsx); aqui o
// duble só repete o contrato com o App: recebe os filtros guardados, avisa as
// mudanças e abre produto.
vi.mock("@/views/customer/SearchView", () => ({
  SearchView: ({
    onNavigate,
    filtrosIniciais,
    aoMudarFiltros,
  }: {
    readonly onNavigate: (view: string, id?: string) => void;
    readonly filtrosIniciais?: unknown;
    readonly aoMudarFiltros?: (filtros: unknown) => void;
  }) => (
    <div
      data-testid="busca"
      data-filtros={
        filtrosIniciais ? JSON.stringify(filtrosIniciais) : "padrao"
      }
    >
      <button
        type="button"
        data-testid="escolher-filtros"
        onClick={() => aoMudarFiltros?.(FILTROS_ESCOLHIDOS)}
      >
        Escolher filtros
      </button>
      <button
        type="button"
        data-testid="abrir-produto"
        onClick={() => onNavigate("product-detail", "produto-A")}
      >
        Abrir produto
      </button>
    </div>
  ),
}));
// O CartView real serve as abas Carrinho e Pedidos (a mesma instância).
vi.mock("@/views/customer/CartView", () => ({
  CartView: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string) => void;
  }) => (
    <div data-testid="tela-carrinho">
      <button
        type="button"
        data-testid="ir-para-checkout"
        onClick={() => onNavigate("checkout")}
      >
        Fechar compra
      </button>
      <button
        type="button"
        data-testid="entrar-pela-aba"
        onClick={() => onNavigate("auth")}
      >
        Entrar
      </button>
    </div>
  ),
}));
vi.mock("@/views/customer/CheckoutView", () => ({
  CheckoutView: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string) => void;
  }) => (
    <div data-testid="tela-checkout">
      <button
        type="button"
        data-testid="pagar-com-pix"
        onClick={() => onNavigate("auth")}
      >
        Pagar com PIX
      </button>
    </div>
  ),
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
// A seta do cabeçalho é o `handleBack` do App: é ela que a cliente aperta.
vi.mock("@/components/ui/custom/Header", () => ({
  Header: ({ onBack }: { readonly onBack: () => void }) => (
    <button type="button" data-testid="seta-voltar" onClick={onBack}>
      Voltar
    </button>
  ),
}));
vi.mock("@/components/ui/custom/BottomNav", () => ({
  BottomNav: ({
    onNavigate,
  }: { readonly onNavigate: (view: string) => void }) => (
    <div>
      <button
        type="button"
        data-testid="inicio"
        onClick={() => onNavigate("home")}
      >
        Início
      </button>
      <button
        type="button"
        data-testid="ir-carrinho"
        onClick={() => onNavigate("cart")}
      >
        Carrinho
      </button>
    </div>
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

describe("A busca (/search) guarda categoria e ordem ao abrir um produto e voltar", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    estadoAuth.user = null;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("localStorage", dubleDeArmazem());
    vi.stubGlobal("sessionStorage", dubleDeArmazem());
    vi.stubGlobal("IntersectionObserver", ObservadorDeInterseccao);
    vi.stubGlobal("ResizeObserver", ObservadorDeInterseccao);
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
    // O App agenda um setTimeout de 350 ms ao fim de cada transição de tela;
    // se disparar depois de o ambiente ser desfeito, vira erro não tratado.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
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
    const alvo = container?.querySelector<HTMLElement>(
      `[data-testid="${marca}"]`,
    );
    if (!alvo) throw new Error(`elemento ${marca} não encontrado`);
    await act(async () => {
      alvo.click();
    });
    await assentar();
  };

  const existe = (marca: string) =>
    container?.querySelector(`[data-testid="${marca}"]`) != null;

  const filtrosNaBusca = () =>
    container
      ?.querySelector('[data-testid="busca"]')
      ?.getAttribute("data-filtros");

  const abrir = async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
    for (let i = 0; i < 40 && !existe("busca") && !existe("home"); i++) {
      await assentar(5);
    }
  };

  it("abrir a busca direto, filtrar, abrir um produto e voltar: categoria e ordem continuam", async () => {
    globalThis.history.replaceState(null, "", "/search");
    await abrir();
    expect(existe("busca")).toBe(true);
    expect(filtrosNaBusca()).toBe("padrao");

    await clicar("escolher-filtros");
    await clicar("abrir-produto");
    expect(existe("tela-produto")).toBe(true);
    expect(existe("busca")).toBe(false);

    await clicar("seta-voltar");

    expect(existe("busca")).toBe(true);
    expect(filtrosNaBusca()).toBe(JSON.stringify(FILTROS_ESCOLHIDOS));
  });

  it("o Voltar do APARELHO a partir do produto também devolve os filtros", async () => {
    globalThis.history.replaceState(null, "", "/search");
    await abrir();
    await clicar("escolher-filtros");
    await clicar("abrir-produto");
    expect(existe("tela-produto")).toBe(true);

    await act(async () => {
      globalThis.history.back();
    });
    await assentar();

    expect(existe("busca")).toBe(true);
    expect(filtrosNaBusca()).toBe(JSON.stringify(FILTROS_ESCOLHIDOS));
  });

  it("LIMITE: sair da busca de propósito (para o carrinho) larga os filtros — a próxima busca abre no padrão", async () => {
    await abrir();
    expect(existe("home")).toBe(true);
    await clicar("ir-busca");
    expect(existe("busca")).toBe(true);
    await clicar("escolher-filtros");

    await clicar("ir-carrinho");
    expect(existe("tela-carrinho")).toBe(true);
    await clicar("inicio");
    await clicar("ir-busca");

    expect(existe("busca")).toBe(true);
    expect(filtrosNaBusca()).toBe("padrao");
  });

  it("LIMITE: passar pela Início e voltar à busca mantém os filtros, como mantém o termo digitado", async () => {
    await abrir();
    await clicar("ir-busca");
    await clicar("escolher-filtros");

    await clicar("inicio");
    expect(existe("home")).toBe(true);
    await clicar("ir-busca");

    expect(filtrosNaBusca()).toBe(JSON.stringify(FILTROS_ESCOLHIDOS));
  });
});
