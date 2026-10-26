// @vitest-environment jsdom
//
// O relógio de 150 ms que devolve a direção da navegação para "forward" depois
// do Voltar do aparelho (popstate) tem de ser cancelado quando o App desmonta.
// Sem isso ele disparava com o app já fechado e, no CI, derrubou uma rodada com
// "ReferenceError: window is not defined ... App.tsx (Timeout._onTimeout,
// dispatchSetState)". Aqui o `<App/>` é o de verdade e o `popstate` é o do
// jsdom (`history.back()`).
//
// Harness copiado de financeiro-folha-suja-voltar-do-aparelho.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const prova = vi.hoisted(() => {
  const estado = {
    dialogoAberto: 0,
    produtos: [{ id: "p-1" }],
    chunkPendente: null as Promise<void> | null,
    // View Transition ASSÍNCRONA como no Chrome (ver o teste de referência).
    viewTransitions: 0,
  };
  (
    document as unknown as {
      startViewTransition: (atualizar: () => void) => unknown;
    }
  ).startViewTransition = (atualizar: () => void) => {
    estado.viewTransitions += 1;
    const terminou = new Promise<void>((resolver) => {
      setTimeout(() => {
        atualizar();
        resolver();
      }, 0);
    });
    return { ready: terminou, finished: terminou, skip: () => {} };
  };
  return estado;
});

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

// O portão é liberado no harness, mas a AdminArea real continua no caminho.
// Isso faz a regressão de rota provar também o repasse de selectedProductId
// da AdminArea para a tela de devoluções.
vi.mock("@/components/layouts/AdminAreaGate", async () => {
  const { AdminArea } = await import("@/components/layouts/AdminArea");
  return {
    AdminAreaGate: ({
      fallback: _fallback,
      ...props
    }: Record<string, unknown>) => (
      <AdminArea
        {...(props as unknown as React.ComponentProps<typeof AdminArea>)}
      />
    ),
  };
});

vi.mock("@/components/layouts/AdminLayout", () => ({
  AdminLayout: ({ children }: { readonly children?: unknown }) => (
    <div data-testid="admin-area">{children as React.ReactNode}</div>
  ),
}));

vi.mock("@/views/admin/AdminOrdersView", () => ({
  AdminOrdersView: () => <div data-testid="tela-pedidos" />,
}));

vi.mock("@/views/customer/HomeView", () => ({
  HomeView: () => <div data-testid="home" />,
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

// Dublê do AlertDialog do App ("alterações não salvas"): conta as renderizações
// abertas. A pergunta de descarte do Financeiro NÃO usa este componente.
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
    if (!open) return null;
    return React.createElement(
      React.Fragment,
      null,
      children as React.ReactNode,
    );
  }
  const passaFilhos = ({ children }: { readonly children?: unknown }) => (
    <>{children as React.ReactNode}</>
  );
  const nada = () => null;
  return {
    AlertDialog,
    AlertDialogAction: passaFilhos,
    AlertDialogCancel: passaFilhos,
    AlertDialogContent: passaFilhos,
    AlertDialogDescription: nada,
    AlertDialogFooter: passaFilhos,
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
  useProducts: () => ({ products: prova.produtos, loading: false }),
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
// Estável de propósito (o hook real devolve funções estáveis): `handleNavigate`
// depende de `prefetchViewPromise`, e a tela real de Devoluções depende de
// `onNavigate` no efeito que registra o Voltar — uma identidade nova a cada
// render vira laço de render entre o App e a tela.
vi.mock("@/hooks/usePrefetchOnHover", () => {
  const api = {
    prefetchView: () => {},
    prefetchAll: () => {},
    prefetchViewPromise: () => prova.chunkPendente ?? Promise.resolve(),
  };
  return { usePrefetchOnHover: () => api };
});
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
      rpc: (nome: string) => {
        if (nome === "fin_contas_listar") {
          return Promise.resolve({
            data: [
              {
                id: "conta-banco",
                nome: "Conta bancária",
                tipo: "banco",
                saldo_inicial: 0,
                saldo_inicial_em: "2026-10-13",
                ativa: true,
                sistema: true,
                saldo: 0,
              },
            ],
            error: null,
          });
        }
        if (nome === "fin_categorias_listar") {
          return Promise.resolve({
            data: [
              {
                id: "cat-aluguel",
                nome: "Aluguel",
                natureza: "despesa",
                grupo_dre: "despesa_fixa",
                ativa: true,
              },
            ],
            error: null,
          });
        }
        if (nome === "fin_extrato") {
          return Promise.resolve({
            data: [
              {
                id: "v1",
                origem: "venda_online",
                tipo: "entrada",
                status: "realizado",
                valor: 150,
                data: "2026-09-20",
                conta_id: "conta-banco",
                conta_nome: "Conta bancária",
                categoria_nome: "Vendas",
                descricao: "Venda #abc123",
                forma_pagamento: "online",
                pedido_id: "11111111-2222-3333-4444-555555abc123",
                editavel: false,
              },
            ],
            error: null,
          });
        }
        if (nome === "fin_lancamento_salvar") {
          return Promise.resolve({ data: { ids: ["a"] }, error: null });
        }
        if (nome === "fin_resumo") {
          return Promise.resolve({ data: { saldo_total: 0 }, error: null });
        }
        return Promise.resolve({ data: [], error: null });
      },
      functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
      storage: { from: () => ({}) },
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

describe("App: o relógio do Voltar é cancelado ao desmontar (popstate de verdade)", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    prova.dialogoAberto = 0;
    prova.viewTransitions = 0;
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

    // Há uma entrada ANTERIOR para o Voltar existir.
    globalThis.history.replaceState(
      { view: "admin-orders" },
      "",
      "/admin-orders",
    );
    globalThis.history.pushState(
      { view: "admin-financeiro" },
      "",
      "/admin-financeiro",
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

  it("desmontar dentro dos 150 ms cancela o relógio: nenhum relógio do Voltar sobra pendente", async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();

    // Só os relógios de 150 ms criados a partir do Voltar entram na conta.
    const criados = new Set<unknown>();
    const cancelados = new Set<unknown>();
    const setTimeoutReal = globalThis.setTimeout;
    const clearTimeoutReal = globalThis.clearTimeout;
    let registrando = false;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      ...args: Parameters<typeof setTimeout>
    ) => {
      const id = setTimeoutReal(...args);
      if (registrando && args[1] === 150) criados.add(id);
      return id;
    }) as typeof setTimeout);
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(((
      id?: Parameters<typeof clearTimeout>[0],
    ) => {
      cancelados.add(id);
      return clearTimeoutReal(id);
    }) as typeof clearTimeout);

    registrando = true;
    await act(async () => {
      globalThis.history.back();
    });
    // O jsdom entrega o popstate numa macrotask: espera até o App armar o
    // relógio (bem antes dos 150 ms) e desmonta na sequência.
    const inicio = Date.now();
    while (criados.size === 0 && Date.now() - inicio < 100) {
      await act(async () => {
        await new Promise((resolve) => setTimeoutReal(resolve, 1));
      });
    }
    expect(criados.size).toBeGreaterThan(0);

    const paraDesmontar = raiz;
    raiz = null;
    await act(async () => {
      paraDesmontar?.unmount();
    });
    registrando = false;

    const pendentes = [...criados].filter((id) => !cancelados.has(id));
    expect(pendentes).toEqual([]);

    // Passados os 150 ms, nada dispara e nada quebra.
    await new Promise((resolve) => setTimeoutReal(resolve, 250));
  });
});
