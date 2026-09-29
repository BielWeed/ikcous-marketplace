// @vitest-environment jsdom
//
// App-743: tocar a aba JÁ ativa do admin (ex.: "Ajustes" estando em
// admin-settings) com o formulário sujo abre o AlertDialog "Alterações Não
// Salvas". Ao confirmar "Descartar e Sair", `handleNavigate` recebe a MESMA
// view (App.tsx:2911-2921) e cai no ramo de "mesmo destino" (App.tsx:834-842)
// — que só rola pro topo. A tela continua montada com as edições intactas,
// mas `setIsAdminDirty(false)` já desligou a guarda: nem saiu, nem descartou,
// e o `beforeunload` (App.tsx:537-547) para de avisar.
//
// CAUSA: `handleNavigate` consulta `isAdminDirtyRef` (App.tsx:743-746) ANTES
// de calcular `isReallyDifferent`/mesmo-destino (829-842). Tocar a própria
// aba ativa deveria SEMPRE só rolar pro topo (como já acontece sem dirty) —
// nunca abrir o diálogo, porque não há "para onde ir".
//
// Harness copiado de categoria-da-home-sobrevive-ao-voltar.test.tsx e
// checkout-seta-voltar-so-fecha-painel-primeiro-toque.test.tsx (mesmo padrão
// de mocks pesados pra renderizar o `<App/>` de verdade). O AlertDialog é
// dublê `nada` como nesses dois — não dá pra ver o diálogo por dentro dele,
// então a prova é comportamental: o mesmo `handleNavigate` que abriria o
// diálogo é o que decide se `scrollTo` roda IMEDIATAMENTE (mesmo destino) ou
// se a navegação para (destino realmente diferente, aguardando confirmação).
// `AdminAreaGate` (o portão real faz round-trip com o Supabase — fora do
// escopo desta peça) vira um dublê mínimo que expõe só o que este teste
// precisa: a view atual, um contêiner `.active-scroll-container` (o mesmo
// seletor que App.tsx:836 usa) e botões para sujar o formulário e navegar.
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

// Dublê MÍNIMO do portão do admin: o portão real (`AdminAreaGate`) confirma
// com o Supabase antes de montar o pacote — fora do escopo desta peça (que é
// só sobre `handleNavigate`). Este dublê expõe a view atual e botões que
// chamam EXATAMENTE os mesmos contratos que `AdminLayout` chama de verdade
// (`onNavigate` e `setIsAdminDirty`, ambos recebidos do App real).
vi.mock("@/components/layouts/AdminAreaGate", () => ({
  AdminAreaGate: ({
    currentView,
    onNavigate,
    setIsAdminDirty,
  }: {
    readonly currentView: string;
    readonly onNavigate: (view: string, id?: string) => void;
    readonly setIsAdminDirty: (dirty: boolean) => void;
  }) => (
    <div data-testid="admin-area" data-view={currentView}>
      {/* Mesmo seletor que App.tsx consulta pra rolar o painel admin pro topo. */}
      <div className="active-scroll-container" />
      <button
        type="button"
        data-testid="sujar-formulario"
        onClick={() => setIsAdminDirty(true)}
      >
        Editar identidade
      </button>
      <button
        type="button"
        data-testid="tocar-ajustes"
        onClick={() => onNavigate("admin-settings")}
      >
        Ajustes
      </button>
      <button
        type="button"
        data-testid="tocar-pedidos"
        onClick={() => onNavigate("admin-orders")}
      >
        Pedidos
      </button>
    </div>
  ),
}));

vi.mock("@/views/customer/HomeView", () => ({
  HomeView: () => <div data-testid="home" />,
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
vi.mock("@/components/ui/custom/BottomNav", () => ({ BottomNav: () => null }));
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

// Mesmo dublê `nada` de categoria-da-home-sobrevive-ao-voltar.test.tsx e
// checkout-seta-voltar-so-fecha-painel-primeiro-toque.test.tsx: com o
// AlertDialog real não dá pra ver o `open` por fora (é Radix + portal), então
// a prova de que o diálogo NÃO capturou a navegação é comportamental (ver os
// comentários no topo do arquivo).
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
// Lojista autenticado como admin — é o cenário do relato (Ajustes → editar
// identidade → tocar Ajustes de novo).
const mockUser = { id: "lojista-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    isAdmin: true,
    adminStatus: "admin",
    loading: false,
    isPasswordRecovery: false,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [], loading: false }),
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
  consulta.single = () => Promise.resolve({ data: null, error: null });
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

describe("tocar a aba já ativa do admin com formulário sujo não desliga a guarda", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
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

    globalThis.history.replaceState(
      { view: "admin-settings" },
      "",
      "/admin-settings",
    );

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

  const esperarAte = async (
    condicao: () => boolean,
    { timeoutMs = 10000, passoMs = 10 } = {},
  ) => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, passoMs));
      });
    }
  };

  const areaAdmin = () =>
    container?.querySelector<HTMLDivElement>('[data-testid="admin-area"]') ??
    null;
  const view = () => areaAdmin()?.getAttribute("data-view");

  const abrir = async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
    await esperarAte(() => areaAdmin() !== null);
  };

  const clicar = async (testId: string) => {
    const botao = container?.querySelector<HTMLButtonElement>(
      `[data-testid="${testId}"]`,
    );
    if (!botao) throw new Error(`botão ${testId} não encontrado`);
    await act(async () => {
      botao.click();
    });
    await assentar();
  };

  it("chega em admin-settings pela URL direta", async () => {
    await abrir();
    expect(view()).toBe("admin-settings");
  });

  it("tocar a própria aba ativa com o formulário sujo só rola pro topo — não abre o diálogo nem desliga a guarda", async () => {
    await abrir();
    expect(view()).toBe("admin-settings");

    const scrollContainer = container?.querySelector<HTMLDivElement>(
      ".active-scroll-container",
    );
    if (!scrollContainer) throw new Error("contêiner de scroll não achado");
    const scrollSpy = vi.fn();
    scrollContainer.scrollTo = scrollSpy;

    await clicar("sujar-formulario");
    await clicar("tocar-ajustes");

    // A trava desta peça: no bug, `handleNavigate` consultava o dirty ANTES
    // do curto-circuito de "mesmo destino" e abria o diálogo em vez de
    // rolar — `scrollTo` nunca era chamado aqui.
    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(view()).toBe("admin-settings");

    // A guarda continua de pé: uma navegação para uma aba DE VERDADE
    // diferente, com o formulário ainda sujo, tem que seguir interceptada
    // (handleNavigate para sem rolar nem trocar de view, aguardando a
    // confirmação do usuário) — a correção do "mesmo destino" não pode
    // desligar a guarda para navegações reais.
    scrollSpy.mockClear();
    await clicar("tocar-pedidos");
    expect(scrollSpy).not.toHaveBeenCalled();
    expect(view()).toBe("admin-settings");
  });

  it("sem formulário sujo, tocar a própria aba ativa continua só rolando pro topo (comportamento de sempre não regride)", async () => {
    await abrir();

    const scrollContainer = container?.querySelector<HTMLDivElement>(
      ".active-scroll-container",
    );
    if (!scrollContainer) throw new Error("contêiner de scroll não achado");
    const scrollSpy = vi.fn();
    scrollContainer.scrollTo = scrollSpy;

    await clicar("tocar-ajustes");

    expect(scrollSpy).toHaveBeenCalledWith({ top: 0, behavior: "smooth" });
    expect(view()).toBe("admin-settings");
  });
});
