// @vitest-environment jsdom
//
// B1 do item 2 da fila do bastão (19/09): o Voltar do APARELHO no PDV com
// cupom cheio e camada aberta tem de fechar a CAMADA (o override registrado
// pelo AdminPdvView — perda zero, os itens continuam no cupom) e NÃO abrir o
// diálogo "alterações não salvas". Até este conserto, o gate de dirty do
// `handlePopState` corria ANTES da consulta ao `backOverrideRef`: re-empurrava
// o histórico sem a marca `{modal}` (a entrada da camada já tinha sido
// consumida pelo navegador ao apertar Voltar) e marcava `pendingNavigation`
// com a MESMA view — o diálogo abria por cima da camada que continuava
// aberta, sem ninguém ter saído de tela nenhuma (mesmo tema do 94c2638, lado
// do App).
//
// Harness copiado de app-aba-ativa-com-formulario-sujo-nao-desliga-a-guarda
// .test.tsx (mesmo padrão de mocks pesados para renderizar o `<App/>` de
// verdade; `AdminAreaGate` vira dublê mínimo que exõe os MESMOS contratos que
// o AdminPdvView real usa — `setIsAdminDirty` e `setBackOverride`, ambos
// descidos pelo App). O AlertDialog é dublê que CONTA quando renderiza
// `open={true}` — o `open` do diálogo é `!!pendingNavigation` (App.tsx), então
// é a prova direta de que o gate de dirty setou (ou não) a navegação pendente.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prova compartilhada entre os dublês: quantas vezes o override da camada
// rodou (o "fechamento da camada") e quantas renderizações o AlertDialog fez
// aberto (`open === true` — o diálogo de "alterações não salvas").
const prova = vi.hoisted(() => ({
  camadaFechadaPeloOverride: 0,
  dialogoAberto: 0,
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

// Dublê MÍNIMO do portão do admin: expõe a view atual e botões que usam
// EXATAMENTE os contratos que o AdminPdvView real usa — `setIsAdminDirty`
// (o cupom cheio liga o dirty) e `setBackOverride` (a camada aberta registra
// o fechamento como override e empurra a entrada `{modal: "pdv"}`, o mesmo
// par de gestos do AdminPdvView.tsx). A prova do fechamento é o contador
// incrementado DENTRO do override — é isso que o `handlePopState` roda.
vi.mock("@/components/layouts/AdminAreaGate", () => ({
  AdminAreaGate: ({
    currentView,
    setIsAdminDirty,
    setBackOverride,
  }: {
    readonly currentView: string;
    readonly setIsAdminDirty: (dirty: boolean) => void;
    readonly setBackOverride: (fn: (() => void) | null) => void;
  }) => (
    <div data-testid="admin-area" data-view={currentView}>
      <button
        type="button"
        data-testid="sujar-cupom"
        onClick={() => setIsAdminDirty(true)}
      >
        Cupom cheio
      </button>
      <button
        type="button"
        data-testid="abrir-camada"
        onClick={() => {
          window.history.pushState(
            { ...window.history.state, modal: "pdv" },
            "",
            window.location.pathname + window.location.search,
          );
          setBackOverride(() => () => {
            prova.camadaFechadaPeloOverride += 1;
          });
        }}
      >
        Abrir camada de cliente
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

// Dublê do AlertDialog que CONTA as renderizações abertas: o App abre o
// diálogo de "alterações não salvas" com `open={!!pendingNavigation}` —
// `dialogoAberto > 0` é a prova de que o gate de dirty capturou o popstate.
vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await import("react");
  function AlertDialog({
    children,
    open,
  }: {
    readonly children?: unknown;
    readonly open?: boolean;
  }) {
    if (open) prova.dialogoAberto += 1;
    return React.createElement(
      React.Fragment,
      null,
      children as React.ReactNode,
    );
  }
  const nada = () => null;
  return {
    AlertDialog,
    AlertDialogAction: nada,
    AlertDialogCancel: nada,
    AlertDialogContent: ({ children }: { readonly children?: unknown }) =>
      React.createElement(React.Fragment, null, children as React.ReactNode),
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
// Lojista autenticado como admin — é o cenário do relato (PDV do balcão).
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

describe("Voltar do aparelho no PDV: a camada aberta vem antes do gate de dirty", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    prova.camadaFechadaPeloOverride = 0;
    prova.dialogoAberto = 0;
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

    globalThis.history.replaceState({ view: "admin-pdv" }, "", "/admin-pdv");

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

  it("com cupom cheio e camada aberta, o Voltar fecha a camada e o diálogo de alterações não salvas NÃO abre", async () => {
    await abrir();

    // O cenário do relato: cupom com itens (dirty ligado) e a camada de
    // cliente aberta por cima (override registrado + entrada {modal} no
    // histórico, o mesmo par de gestos do AdminPdvView real).
    await clicar("sujar-cupom");
    await clicar("abrir-camada");
    expect(globalThis.history.state?.modal).toBe("pdv");

    // O Voltar do APARELHO: o navegador consome a entrada {modal} da camada
    // e entrega o popstate — o `history.back()` do jsdom dispara o evento
    // em uma macrotask.
    await act(async () => {
      globalThis.history.back();
    });
    await esperarAte(() => prova.camadaFechadaPeloOverride > 0);

    // A camada fechou pelo override (o Voltar era dela)…
    expect(prova.camadaFechadaPeloOverride).toBe(1);
    // …e o diálogo "alterações não salvas" NUNCA abriu: o gate de dirty não
    // pode roubar o popstate de uma camada que fecha sem perder nada.
    expect(prova.dialogoAberto).toBe(0);
  });

  it("sem camada aberta, o gate de dirty segue valendo: o Voltar com cupom cheio abre o diálogo", async () => {
    await abrir();

    // Cupom cheio, NENHUMA camada aberta (override desregistrado): aqui o
    // Voltar É uma tentativa de sair da tela — o diálogo tem de abrir.
    await clicar("sujar-cupom");

    // O histórico precisa de uma entrada ANTERIOR para o Voltar existir (o
    // `back()` do jsdom com pilha de uma entrada só não dispara popstate) —
    // o caminho de entrada do PDV no app real empurra entradas ao navegar.
    globalThis.history.pushState({ view: "admin-orders" }, "", "/admin-orders");
    await act(async () => {
      globalThis.history.back();
    });
    await esperarAte(() => prova.dialogoAberto > 0);

    expect(prova.dialogoAberto).toBeGreaterThan(0);
    expect(prova.camadaFechadaPeloOverride).toBe(0);
  });
});
