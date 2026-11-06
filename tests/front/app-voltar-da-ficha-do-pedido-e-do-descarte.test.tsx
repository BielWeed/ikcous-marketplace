// @vitest-environment jsdom
//
// Dois defeitos do botão Voltar do painel, provados no <App/> de VERDADE (o
// roteador, o histórico do jsdom e o `popstate` dele são os reais; só a área do
// painel é um dublê que expõe a tela e o pedido escolhido):
//
// 1. Voltar do aparelho dentro da ficha de um pedido NÃO fechava a ficha: a
//    entrada da lista (`/admin-orders`, sem `?id=`) era lida, mas o App
//    "guardava" o pedido antigo e saía em "já estamos no mesmo destino". A
//    lojista via a ficha continuar aberta e a seta do cabeçalho passar a dizer
//    "Perfil".
//
// 2. "Descartar e Sair" depois de um Voltar com formulário sujo EMPURRAVA o
//    destino como entrada nova: a pilha virava [lista, formulário, lista] e o
//    primeiro Voltar seguinte reabria o formulário que ela tinha acabado de
//    descartar. Agora o descarte vindo do Voltar consome a entrada do
//    formulário com um Voltar de verdade (e o descarte vindo de um toque na aba
//    continua sendo uma navegação normal).
//
// Harness copiado de app-descartar-e-sair-apaga-o-rascunho-do-produto.
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

// Dublê do portão do admin: a tela atual, o pedido/produto escolhido e botões
// que chamam os mesmos contratos que o `AdminLayout` real chama.
vi.mock("@/components/layouts/AdminAreaGate", () => ({
  AdminAreaGate: ({
    currentView,
    selectedProductId,
    onNavigate,
    setIsAdminDirty,
  }: {
    readonly currentView: string;
    readonly selectedProductId?: string | null;
    readonly onNavigate: (view: string, id?: string) => void;
    readonly setIsAdminDirty: (dirty: boolean) => void;
  }) => (
    <div
      data-testid="admin-area"
      data-view={currentView}
      data-id={selectedProductId ?? ""}
    >
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
      <button
        type="button"
        data-testid="abrir-ficha"
        onClick={() => onNavigate("admin-orders", "ped-1")}
      >
        Abrir pedido
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

// O diálogo RENDERIZADO: só quando `open`, e as ações viram botões de verdade.
const dialogo = vi.hoisted(() => ({
  fechar: null as null | ((aberto: boolean) => void),
}));
vi.mock("@/components/ui/alert-dialog", () => {
  const Caixa = ({ children }: { readonly children?: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    AlertDialog: ({
      open,
      onOpenChange,
      children,
    }: {
      readonly open?: boolean;
      readonly onOpenChange?: (aberto: boolean) => void;
      readonly children?: ReactNode;
    }) => {
      dialogo.fechar = onOpenChange ?? null;
      return open ? (
        <div data-testid="dialogo-de-descarte">{children}</div>
      ) : null;
    },
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
      <button
        type="button"
        data-testid="permanecer"
        onClick={() => dialogo.fechar?.(false)}
      >
        {children}
      </button>
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
  useCartState: () => ({ cart: [], cartCount: 0 }),
  useCartActions: () => ({ addToCart: () => {} }),
  useCartContext: () => ({ cartCount: 0, addToCart: () => {} }),
}));
vi.mock("@/contexts/FavoritesContext", () => ({
  FavoritesProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
}));

vi.mock("@/hooks/useCart", () => ({
  useCart: () => ({ cartCount: 0, addToCart: () => {} }),
  useCartState: () => ({ cart: [], cartCount: 0 }),
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

describe("Voltar do painel no App de verdade", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    vi.spyOn(console, "log").mockImplementation(() => {});
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
  const pedidoEscolhido = () => areaAdmin()?.getAttribute("data-id");
  const dialogoAberto = () =>
    container?.querySelector('[data-testid="dialogo-de-descarte"]') != null;
  const rota = () => globalThis.location.pathname + globalThis.location.search;

  // Monta a pilha do histórico (do mais antigo ao mais novo) e abre o App na
  // última entrada. O 1º item substitui a entrada atual do jsdom.
  const abrirNaPilha = async (
    pilha: ReadonlyArray<{ caminho: string; estado: Record<string, unknown> }>,
  ) => {
    pilha.forEach(({ caminho, estado }, i) => {
      if (i === 0) globalThis.history.replaceState(estado, "", caminho);
      else globalThis.history.pushState(estado, "", caminho);
    });
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

  const voltarDoAparelho = async () => {
    await act(async () => {
      globalThis.history.back();
    });
    await assentar(20);
  };

  const avancarDoAparelho = async () => {
    await act(async () => {
      globalThis.history.forward();
    });
    await assentar(20);
  };

  const LISTA = {
    caminho: "/admin-orders",
    estado: { view: "admin-orders", from: "admin-settings" },
  };
  const BASE = {
    caminho: "/admin-settings",
    estado: { view: "admin-settings" },
  };

  describe("1. ficha de um pedido", () => {
    it("Voltar do aparelho dentro da ficha fecha a ficha e volta à lista", async () => {
      await abrirNaPilha([BASE, LISTA]);
      expect(view()).toBe("admin-orders");
      expect(pedidoEscolhido()).toBe("");

      await clicar("abrir-ficha");
      expect(rota()).toBe("/admin-orders?id=ped-1");
      expect(pedidoEscolhido()).toBe("ped-1");

      await voltarDoAparelho();

      expect(rota()).toBe("/admin-orders");
      expect(view()).toBe("admin-orders");
      // Antes da correção: continuava "ped-1" (ficha aberta, seta dizendo
      // "Perfil"), e só o segundo Voltar saía de verdade.
      expect(pedidoEscolhido()).toBe("");
    });

    it("Avançar do aparelho reabre a mesma ficha (a lista não perde o pedido)", async () => {
      await abrirNaPilha([BASE, LISTA]);
      await clicar("abrir-ficha");
      await voltarDoAparelho();
      expect(pedidoEscolhido()).toBe("");

      await avancarDoAparelho();

      expect(rota()).toBe("/admin-orders?id=ped-1");
      expect(pedidoEscolhido()).toBe("ped-1");
    });

    it("controle: link direto com ?id= abre a ficha, e um Voltar sai de Pedidos", async () => {
      await abrirNaPilha([
        BASE,
        {
          caminho: "/admin-orders?id=ped-9",
          estado: { view: "admin-orders", id: "ped-9", from: "admin-settings" },
        },
      ]);
      expect(view()).toBe("admin-orders");
      expect(pedidoEscolhido()).toBe("ped-9");

      await voltarDoAparelho();

      expect(view()).toBe("admin-settings");
    });
  });

  describe("2. Descartar e Sair depois do Voltar", () => {
    const FORMULARIO = {
      caminho: "/admin-product-form?id=p-1",
      estado: {
        view: "admin-product-form",
        id: "p-1",
        from: "admin-orders",
      },
    };

    it("o Voltar seguinte ao descarte NÃO reabre o formulário descartado", async () => {
      await abrirNaPilha([BASE, LISTA, FORMULARIO]);
      expect(view()).toBe("admin-product-form");

      await clicar("sujar-formulario");
      await voltarDoAparelho();
      // O aviso abre e o formulário continua na tela.
      expect(dialogoAberto()).toBe(true);
      expect(view()).toBe("admin-product-form");

      await clicar("descartar-e-sair");
      await esperarAte(() => view() === "admin-orders");
      expect(dialogoAberto()).toBe(false);
      expect(rota()).toBe("/admin-orders");

      // Antes da correção a pilha era [base, lista, formulário, lista] e este
      // Voltar caía no formulário de novo.
      await voltarDoAparelho();
      expect(view()).toBe("admin-settings");
      expect(dialogoAberto()).toBe(false);
    });

    it("Permanecer deixa a pessoa no formulário, e um novo Voltar pergunta de novo", async () => {
      await abrirNaPilha([BASE, LISTA, FORMULARIO]);
      await clicar("sujar-formulario");
      await voltarDoAparelho();
      expect(dialogoAberto()).toBe(true);

      await clicar("permanecer");
      expect(dialogoAberto()).toBe(false);
      expect(view()).toBe("admin-product-form");
      expect(rota()).toBe("/admin-product-form?id=p-1");

      await voltarDoAparelho();
      expect(dialogoAberto()).toBe(true);
      expect(view()).toBe("admin-product-form");
    });

    it("Voltar de dois passos: o descarte cai na tela que o Voltar mirava", async () => {
      // Pilha [base, lista, formulário]: o Voltar do formulário mira a lista.
      // Com a lista na frente de OUTRA tela, o destino é sempre a entrada em
      // que o navegador pousou — nunca uma tela adivinhada.
      await abrirNaPilha([
        BASE,
        {
          caminho: "/admin-customers",
          estado: { view: "admin-customers", from: "admin-settings" },
        },
        LISTA,
        FORMULARIO,
      ]);
      await clicar("sujar-formulario");
      await voltarDoAparelho();
      await clicar("descartar-e-sair");
      await esperarAte(() => view() === "admin-orders");

      await voltarDoAparelho();
      expect(view()).toBe("admin-customers");
    });

    it("controle: descarte vindo do TOQUE na aba segue sendo uma navegação normal", async () => {
      await abrirNaPilha([BASE, LISTA, FORMULARIO]);
      await clicar("sujar-formulario");
      await clicar("tocar-pedidos");
      expect(dialogoAberto()).toBe(true);
      expect(view()).toBe("admin-product-form");

      await clicar("descartar-e-sair");
      await esperarAte(() => view() === "admin-orders");
      expect(rota()).toBe("/admin-orders");

      // Aqui o toque EMPURROU a lista: o Voltar volta ao formulário (que está
      // limpo agora, sem aviso). É o comportamento normal do navegador.
      await voltarDoAparelho();
      expect(view()).toBe("admin-product-form");
      expect(dialogoAberto()).toBe(false);
    });
  });
});
