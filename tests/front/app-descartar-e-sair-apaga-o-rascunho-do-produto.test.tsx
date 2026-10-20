// @vitest-environment jsdom
//
// "Descartar e Sair" tem que DESCARTAR de verdade o rascunho do produto.
//
// O defeito: o diálogo "Alterações Não Salvas" só desligava a guarda e
// navegava; o rascunho que o formulário guardou a cada edição ficava no
// aparelho. Dias depois o aviso "Rascunho não salvo encontrado — Restaurar?"
// trazia de volta o que ela tinha mandado jogar fora (e, antes da correção do
// estoque, devolvia o estoque de antes das vendas).
//
// Provado aqui: com o formulário de produto sujo e um rascunho guardado, tocar
// em "Descartar e Sair" apaga a chave desse produto — e só a dele (o rascunho
// de OUTRO produto, e o de outra tela, ficam); em tela que não é a do produto
// nada é apagado.
//
// Harness copiado de app-aba-ativa-com-formulario-sujo-nao-desliga-a-guarda
// (mesmos dublês pesados para renderizar o `<App/>`), com o AlertDialog
// RENDERIZADO (aqui é a ação do diálogo que se prova) e o portão do admin
// reduzido ao que a prova precisa.
import { act } from "react";
import type { ReactNode } from "react";
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

// Dublê mínimo do portão do admin: a view atual e botões que chamam os mesmos
// contratos que o `AdminLayout` real chama (`onNavigate`, `setIsAdminDirty`).
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
      <div className="active-scroll-container" />
      <button
        type="button"
        data-testid="sujar-formulario"
        onClick={() => setIsAdminDirty(true)}
      >
        Editar
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

// O diálogo RENDERIZADO: só quando `open`, e a ação vira um botão de verdade.
vi.mock("@/components/ui/alert-dialog", () => {
  const Caixa = ({ children }: { readonly children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    AlertDialog: ({
      open,
      children,
    }: {
      readonly open?: boolean;
      readonly children?: ReactNode;
    }) =>
      open ? <div data-testid="dialogo-de-descarte">{children}</div> : null,
    AlertDialogAction: ({
      onClick,
      children,
    }: {
      readonly onClick?: () => void;
      readonly children?: ReactNode;
    }) => (
      <button type="button" data-testid="descartar-e-sair" onClick={onClick}>
        {children}
      </button>
    ),
    AlertDialogCancel: ({ children }: { readonly children?: ReactNode }) => (
      <button type="button">{children}</button>
    ),
    AlertDialogContent: Caixa,
    AlertDialogDescription: Caixa,
    AlertDialogFooter: Caixa,
    AlertDialogHeader: Caixa,
    AlertDialogTitle: Caixa,
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

const CHAVE_DO_P1 = "ikcous_product_form_draft_edit_p-1:lojista-1";
const CHAVE_DO_P2 = "ikcous_product_form_draft_edit_p-2:lojista-1";
const CHAVE_DO_NOVO = "ikcous_product_form_draft:lojista-1";
const CHAVE_DO_BANNER = "admin_banner_form_draft:lojista-1";

describe("Descartar e Sair apaga o rascunho do produto que ela está deixando", () => {
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

  const abrir = async (caminho: string, estado: Record<string, unknown>) => {
    globalThis.history.replaceState(estado, "", caminho);
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

  const guardarRascunhos = () => {
    for (const chave of [
      CHAVE_DO_P1,
      CHAVE_DO_P2,
      CHAVE_DO_NOVO,
      CHAVE_DO_BANNER,
    ]) {
      localStorage.setItem(chave, JSON.stringify({ name: chave }));
    }
  };

  it("editando o produto p-1: descartar apaga o rascunho de p-1 e só o dele", async () => {
    guardarRascunhos();
    await abrir("/admin-product-form?id=p-1", {
      view: "admin-product-form",
      id: "p-1",
    });
    expect(view()).toBe("admin-product-form");

    await clicar("sujar-formulario");
    await clicar("tocar-pedidos");
    // A guarda segurou a saída e perguntou.
    expect(view()).toBe("admin-product-form");
    expect(localStorage.getItem(CHAVE_DO_P1)).not.toBeNull();

    await clicar("descartar-e-sair");

    expect(localStorage.getItem(CHAVE_DO_P1)).toBeNull();
    expect(localStorage.getItem(CHAVE_DO_P2)).not.toBeNull();
    expect(localStorage.getItem(CHAVE_DO_NOVO)).not.toBeNull();
    expect(localStorage.getItem(CHAVE_DO_BANNER)).not.toBeNull();
    await esperarAte(() => view() === "admin-orders");
  });

  it("produto NOVO (sem id): descartar apaga o rascunho de produto novo", async () => {
    guardarRascunhos();
    await abrir("/admin-product-form", { view: "admin-product-form" });
    expect(view()).toBe("admin-product-form");

    await clicar("sujar-formulario");
    await clicar("tocar-pedidos");
    await clicar("descartar-e-sair");

    expect(localStorage.getItem(CHAVE_DO_NOVO)).toBeNull();
    expect(localStorage.getItem(CHAVE_DO_P1)).not.toBeNull();
    expect(localStorage.getItem(CHAVE_DO_BANNER)).not.toBeNull();
  });

  it("controle: descartar numa tela que não é a do produto não mexe em rascunho de produto", async () => {
    guardarRascunhos();
    await abrir("/admin-settings", { view: "admin-settings" });
    expect(view()).toBe("admin-settings");

    await clicar("sujar-formulario");
    await clicar("tocar-pedidos");
    await clicar("descartar-e-sair");

    expect(localStorage.getItem(CHAVE_DO_P1)).not.toBeNull();
    expect(localStorage.getItem(CHAVE_DO_P2)).not.toBeNull();
    expect(localStorage.getItem(CHAVE_DO_NOVO)).not.toBeNull();
  });
});
