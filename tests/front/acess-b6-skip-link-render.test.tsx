// @vitest-environment jsdom
//
// Rodada 2 do B6 (laudo Opus do PR #455, 08/09): o teste textual em
// acess-b6-skip-link-contrato.test.tsx prova a MARCAÇÃO (ordem no fonte,
// atributos do <main>), mas não prova o COMPORTAMENTO — nem que o link é de
// fato o primeiro elemento focável do DOCUMENTO renderizado, nem que
// ativá-lo não navega. O defeito do laudo era exatamente isso: o
// `href="#conteudo"` fazia o clique mudar `location.hash`, disparar
// `hashchange`/`popstate` e o app tratava isso como "Voltar"
// (`backOverrideRef` no checkout jogava o cliente com o QR PIX na tela para
// a home; `isAdminDirtyRef` abria "Descartar e Sair" no admin com formulário
// sujo). Nenhum teste textual pegaria isso — só renderizar o App de verdade
// e medir o efeito do clique prova.
//
// Setup copiado de barra-de-rota-fica-montada-para-o-exit.test.tsx (mesmo
// vizinho que já renderiza o App de verdade). O mock de Header devolve
// `null` — para o caso 1 (primeiro focável) isso é aceitável: o skip link
// vem ANTES do Header de qualquer jeito na árvore (App.tsx:2624, Header só
// entra em 2659), então um Header real com campo de busca focável não
// mudaria qual elemento é o PRIMEIRO. O caso 2 (clique não navega) nem
// depende do Header.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Todos os focáveis do documento, em ordem do DOM (mesma heurística que um
// leitor de tela/Tab usa para decidir o próximo parada).
const SELETOR_FOCAVEL =
  'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focaveis(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(SELETOR_FOCAVEL),
  ).filter((el) => !(el as HTMLButtonElement).disabled);
}

describe("B6 rodada 2 — skip link: primeiro focável e clique não navega", () => {
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

  it("o skip link é o primeiro focável de TODO o documento renderizado", async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();

    const primeiro = focaveis()[0];
    expect(primeiro, "nenhum elemento focável no documento").toBeDefined();
    expect(primeiro?.textContent?.trim()).toBe("Pular para o conteúdo");
  });

  it("ativar o skip link foca o <main> sem navegar nem disparar popstate/hashchange", async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();

    const link = focaveis()[0] as HTMLAnchorElement;
    expect(link.textContent?.trim()).toBe("Pular para o conteúdo");

    const popstateSpy = vi.fn();
    const hashchangeSpy = vi.fn();
    window.addEventListener("popstate", popstateSpy);
    window.addEventListener("hashchange", hashchangeSpy);

    const hashAntes = window.location.hash;
    const tamanhoAntes = window.history.length;

    // Sondado à parte (script descartável, fora do repo): neste jsdom
    // (v4.1.10 do vitest deste projeto) `elemento.click()` num <a
    // href="#x"> SEM handler não muda location.hash nem dispara
    // hashchange/popstate — jsdom não implementa a navegação nativa por
    // fragmento em clique sintético. Por isso as três asserções abaixo
    // (hash/popstate/history) NÃO são sensíveis, sozinhas, à mutação de
    // remover o `e.preventDefault()`: ficam verdes com ou sem o bug do
    // laudo Opus. A prova que REALMENTE derruba a mutação é o retorno de
    // `dispatchEvent`: ele vem `false` quando o evento foi cancelado
    // (`preventDefault()` chamado) e cancelável — é o mesmo sinal que o
    // navegador usaria para decidir se segue com a ação padrão do link.
    let cliqueNaoCancelado = true;
    await act(async () => {
      cliqueNaoCancelado = link.dispatchEvent(
        new MouseEvent("click", { bubbles: true, cancelable: true }),
      );
    });

    window.removeEventListener("popstate", popstateSpy);
    window.removeEventListener("hashchange", hashchangeSpy);

    expect(
      cliqueNaoCancelado,
      "o clique não foi cancelado — falta o e.preventDefault() que impede a navegação padrão do link",
    ).toBe(false);
    expect(
      document.activeElement,
      'o foco não caiu no <main id="conteudo">',
    ).toBe(document.getElementById("conteudo"));
    // Defesa em profundidade: neste ambiente estas três já vinham
    // inalteradas mesmo sem o preventDefault (ver comentário acima), mas
    // documentam o resultado esperado caso o motor de teste algum dia passe
    // a simular a navegação nativa por fragmento.
    expect(
      window.location.hash,
      "a URL mudou — isso dispara popstate no app",
    ).toBe(hashAntes);
    expect(
      popstateSpy,
      "popstate disparou — o app trataria isso como Voltar",
    ).not.toHaveBeenCalled();
    expect(hashchangeSpy).not.toHaveBeenCalled();
    expect(window.history.length, "uma entrada de histórico foi somada").toBe(
      tamanhoAntes,
    );
  });
});
