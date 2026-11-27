// @vitest-environment jsdom
//
// O relógio de 350 ms do Voltar não pode sobreviver ao App.
//
// Sem View Transitions (o caso do jsdom e de navegador antigo), o fim da
// animação do Voltar do aparelho é segurado por um `setTimeout` de 350 ms que
// zera a folga da rolagem e solta a trava de transição. Esse relógio não era
// guardado: se o ambiente era desmontado antes dos 350 ms (o último teste de
// um arquivo terminando logo depois de um Voltar), ele disparava com a janela
// já fechada e o vitest saía com código 1, com todos os testes verdes
// ("Unhandled Error: window is not defined", pilha em App.tsx -> dispatchSetState).
//
// Prova no <App/> de VERDADE (o roteador, o histórico do jsdom e o `popstate`
// dele são os reais; só a área do painel é um dublê). O `setTimeout` é
// espionado com passagem direta: o relógio roda de verdade, e o teste registra
// quem o criou (350 ms), se ele foi cancelado e se o callback chegou a rodar.
//
// Irmão do app-relogio-do-voltar-cancela-ao-desmontar (que cobre o relógio de
// 150 ms, com View Transitions). Harness copiado de
// app-voltar-da-ficha-do-pedido-e-do-descarte.
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

vi.mock("@/components/layouts/AdminAreaGate", () => ({
  AdminAreaGate: ({ currentView }: { readonly currentView: string }) => (
    <div data-testid="admin-area" data-view={currentView}>
      <div className="active-scroll-container" />
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
    isFavorite: () => false,
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

const ATRASO_DO_VOLTAR_MS = 350;

describe("Relógio de 350 ms do Voltar sem View Transitions", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  // Registro dos relógios de 350 ms: quem foi criado, quem foi cancelado e
  // quantas vezes o callback de fato rodou. Um registro NOVO por teste: um
  // relógio que vazasse de um teste (justamente o defeito) dispara no registro
  // do teste dele, nunca no do vizinho.
  const novoRegistro = () => ({
    criados: [] as Array<ReturnType<typeof setTimeout>>,
    cancelados: [] as Array<unknown>,
    disparos: 0,
  });
  let registro = novoRegistro();

  beforeEach(() => {
    registro = novoRegistro();
    const dono = registro;

    const setTimeoutReal = globalThis.setTimeout;
    const clearTimeoutReal = globalThis.clearTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(((
      callback: (...args: unknown[]) => void,
      atraso?: number,
      ...resto: unknown[]
    ) => {
      if (atraso !== ATRASO_DO_VOLTAR_MS) {
        return setTimeoutReal(callback, atraso, ...resto);
      }
      const id = setTimeoutReal(
        (...args: unknown[]) => {
          dono.disparos += 1;
          callback(...args);
        },
        atraso,
        ...resto,
      );
      dono.criados.push(id);
      return id;
    }) as typeof setTimeout);
    vi.spyOn(globalThis, "clearTimeout").mockImplementation(((
      id?: ReturnType<typeof setTimeout>,
    ) => {
      dono.cancelados.push(id);
      return clearTimeoutReal(id);
    }) as typeof clearTimeout);

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

  const esperarMs = async (ms: number) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  };

  // Dispara o Voltar e devolve assim que o relógio de 350 ms foi armado (sem
  // esperar a tela "assentar"): o teste fica longe do prazo de 350 ms mesmo
  // numa máquina lenta.
  const voltarAteArmarORelogio = async () => {
    const antes = registro.criados.length;
    await act(async () => {
      globalThis.history.back();
    });
    await esperarAte(() => registro.criados.length === antes + 1, {
      passoMs: 1,
    });
  };

  const BASE = {
    caminho: "/admin-settings",
    estado: { view: "admin-settings" },
  };
  const LISTA = {
    caminho: "/admin-orders",
    estado: { view: "admin-orders", from: "admin-settings" },
  };

  it("o Voltar arma o relógio de 350 ms (premissa do teste: o caminho sem View Transitions é o exercitado)", async () => {
    expect("startViewTransition" in document).toBe(false);
    await abrirNaPilha([BASE, LISTA]);
    expect(registro.criados).toHaveLength(0);

    await voltarAteArmarORelogio();
    await esperarAte(() => view() === "admin-settings");

    expect(registro.criados).toHaveLength(1);
  });

  it("desmontar o App logo depois do Voltar cancela o relógio, e o callback nunca roda", async () => {
    await abrirNaPilha([BASE, LISTA]);
    await voltarAteArmarORelogio();
    expect(registro.disparos).toBe(0);

    // Desmonta com o relógio ainda pendente (bem antes dos 350 ms).
    const paraDesmontar = raiz;
    raiz = null;
    await act(async () => {
      paraDesmontar?.unmount();
    });

    expect(registro.cancelados).toContain(registro.criados[0]);

    // Passa do prazo do relógio. Sem o cancelamento, o callback roda aqui,
    // com o App já desmontado (e, no vitest, com o jsdom já derrubado).
    await esperarMs(ATRASO_DO_VOLTAR_MS + 100);
    expect(registro.disparos).toBe(0);
  });

  it("controle: com o App montado o relógio NÃO é cancelado, dispara e solta a trava", async () => {
    await abrirNaPilha([BASE, LISTA]);
    await voltarAteArmarORelogio();

    // A troca de tela (a view muda e o efeito do roteador reexecuta) não pode
    // cancelar o relógio: só o desmonte cancela.
    await esperarAte(() => view() === "admin-settings");
    expect(registro.cancelados).not.toContain(registro.criados[0]);

    await esperarAte(() => registro.disparos === 1);
    expect(registro.cancelados).not.toContain(registro.criados[0]);

    // Trava solta: Avançar e Voltar do aparelho voltam a ser aceitos.
    await act(async () => {
      globalThis.history.forward();
    });
    await esperarAte(() => view() === "admin-orders");
    await esperarAte(() => registro.disparos === 2);
    await voltarAteArmarORelogio();
    await esperarAte(() => view() === "admin-settings");
  });
});
