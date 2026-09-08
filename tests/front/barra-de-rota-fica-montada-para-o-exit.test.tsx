// @vitest-environment jsdom
/**
 * Regressão apontada pelo laudo do robô no PR #427 (comentário mais recente,
 * 04/09/2026): `src/App.tsx` renderizava a barra de progresso de rota com
 *
 *     {isRouteLoading && (
 *       <React.Suspense fallback={null}>
 *         <RouteLoadingProgress active={isRouteLoading} />
 *       </React.Suspense>
 *     )}
 *
 * Quando `isRouteLoading` vira `false`, esse `&&` remove o `Suspense` (e o
 * `RouteLoadingProgress`/`AnimatePresence` de dentro dele) da árvore DE UMA
 * VEZ — o componente inteiro desmonta. O `exit` da barra (largura 100% +
 * fade de 0,25s, em `AppMotionFallbacks.tsx`) nunca tem chance de rodar: ele
 * é responsabilidade do `AnimatePresence`, e o `AnimatePresence` já foi
 * embora junto com o pai.
 *
 * O QUE ESTE TESTE PROVA (e o que ele NÃO tenta provar): a máquina de teste
 * deste repositório trata framer-motion como periferia — todo teste que
 * monta o `<App/>` de verdade troca a biblioteca por um passthrough burro em
 * jsdom (ver `produto-a-produto-nao-carrega-lixo-do-anterior.test.tsx`), que
 * NÃO reproduz o adiamento de saída do `AnimatePresence` real. Por isso a
 * asserção não é "a animação de saída rodou visualmente" — é a causa raiz
 * estrutural: **o componente `RouteLoadingProgress` continua MONTADO** (não
 * desmonta) quando `isRouteLoading` volta a `false`, e continua recebendo
 * `active={isRouteLoading}` atualizado. Só um dublê do próprio
 * `RouteLoadingProgress` (e não do `framer-motion`) enxerga esse fato: ele
 * marca um `data-testid` que sobrevive independente do valor de `active`,
 * então "sumiu do DOM" só pode significar "o pai desmontou o componente" —
 * exatamente o defeito do laudo. `MainTabsMotionShell` e
 * `SecondaryViewMotionShell` continuam os de verdade (via `importOriginal`),
 * batendo contra o mesmo framer-motion burro que o resto da suíte usa.
 *
 * A NAVEGAÇÃO É REAL: clique no botão que a Home expõe chama
 * `handleNavigate("cart")` de verdade em `src/App.tsx`. Só a promessa de
 * `prefetchViewPromise` fica sob controle do teste (via `CONTROLE` abaixo)
 * — sem isso, em jsdom o `import()` do preload resolve rápido demais e o
 * `setTimeout` de 120ms de "Defer showing the loading bar to prevent
 * micro-flickers" cancela antes de `isRouteLoading` sequer virar `true`
 * (ver o próprio comentário no código-fonte, `src/App.tsx`).
 */
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// `vi.hoisted`: a fábrica de `vi.mock` de usePrefetchOnHover sobe para o
// topo do arquivo e não enxerga uma variável de módulo comum.
const CONTROLE = vi.hoisted(() => {
  let liberar: (() => void) | null = null;
  const prefetchPromise = new Promise<void>((resolve) => {
    liberar = resolve;
  });
  return {
    prefetchPromise,
    liberarPrefetch: () => liberar?.(),
  };
});

// --- A tela sob observação: RouteLoadingProgress vira um marcador de ciclo
// de vida, mantendo MainTabsMotionShell/SecondaryViewMotionShell reais (o
// contrato deles não está em jogo aqui).
vi.mock("@/components/layouts/AppMotionFallbacks", async (importOriginal) => {
  const real =
    await importOriginal<
      typeof import("@/components/layouts/AppMotionFallbacks")
    >();
  function RouteLoadingProgress({ active }: { readonly active: boolean }) {
    return <div data-testid="barra-de-rota" data-active={String(active)} />;
  }
  return { ...real, RouteLoadingProgress };
});

// --- Periferia: framer-motion vira passthrough burro (mesmo dublê de
// produto-a-produto-nao-carrega-lixo-do-anterior.test.tsx — MainTabsMotionShell
// e SecondaryViewMotionShell reais o usam por baixo).
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

vi.mock("@/views/customer/HomeView", async () => {
  const React = await import("react");
  return {
    HomeView: ({
      onNavigate,
    }: {
      readonly onNavigate: (view: string) => void;
    }) =>
      React.createElement(
        "div",
        { "data-testid": "home" },
        React.createElement(
          "button",
          {
            type: "button",
            "data-testid": "ir-para-o-carrinho",
            onClick: () => onNavigate("cart"),
          },
          "ir para o carrinho",
        ),
      ),
  };
});
vi.mock("@/views/customer/CartView", async () => {
  const React = await import("react");
  return {
    CartView: () => React.createElement("div", { "data-testid": "carrinho" }),
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
  useAuth: () => ({
    user: null,
    isAdmin: false,
    adminStatus: "not-admin",
    loading: false,
    isPasswordRecovery: false,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
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
// A promessa de prefetch fica sob controle do teste — ver `CONTROLE` acima.
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: () => {},
    prefetchAll: () => {},
    prefetchViewPromise: () => CONTROLE.prefetchPromise,
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

describe("a barra de rota fica montada para o exit rodar", () => {
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

    globalThis.history.replaceState({ view: "home" }, "", "/");

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

  const ler = () =>
    container?.querySelector('[data-testid="barra-de-rota"]') ?? null;

  it("continua montada (active=false) depois que a navegação termina, em vez de desmontar com isRouteLoading", async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();

    // Ainda em repouso: nenhuma navegação em voo, a barra não existe.
    expect(ler()).toBeNull();

    const botao = container?.querySelector<HTMLButtonElement>(
      '[data-testid="ir-para-o-carrinho"]',
    );
    if (!botao) throw new Error('botão "ir-para-o-carrinho" não está na tela');
    await act(async () => {
      botao.click();
    });

    // O código de produção adia 120ms antes de acender `isRouteLoading`
    // ("Defer showing the loading bar to prevent micro-flickers on instant
    // cache hits" — src/App.tsx). A promessa de prefetch está travada por
    // `CONTROLE`, então a navegação não pode terminar antes disso.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 200));
    });

    expect(ler()).not.toBeNull();
    expect(ler()?.getAttribute("data-active")).toBe("true");

    // Libera a navegação: prefetch/preload resolvem, `performTransition`
    // roda e `isRouteLoading` volta a `false`.
    CONTROLE.liberarPrefetch();
    await assentar();

    // O DEFEITO DO LAUDO: sem o latch, `{isRouteLoading && <Suspense>...}`
    // desmonta a barra inteira assim que `isRouteLoading` vira `false` — o
    // `RouteLoadingProgress` some do DOM em vez de só receber
    // `active={false}`. A correção mantém o componente montado.
    const barra = ler();
    expect(
      barra,
      "a barra desmontou quando isRouteLoading virou false — o exit nunca teria a chance de rodar",
    ).not.toBeNull();
    expect(barra?.getAttribute("data-active")).toBe("false");
  });
});
