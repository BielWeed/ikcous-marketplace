// @vitest-environment jsdom
//
// COMO O TEMA DA LOJA CHEGA À TELA: o App liga/desliga a classe `dark` e o
// atributo `data-theme-mode` na <html> conforme o `themeMode` que a loja
// escolheu (claro / escuro / vidro). O CSS inteiro do modo escuro e do vidro
// depende desses dois marcadores, e NENHUM teste olhava o efeito do App:
// `store-context-nao-mexe-em-dark` só garante que o StoreContext não mexe, e o
// resto confere o CSS por fora. Trocar `"glass"` por outro texto, esquecer de
// tirar o atributo ao voltar para o claro ou deixar o painel sem forçar o
// escuro passava verde.
//
// O App é o REAL; só o entorno é simulado (dados, auth, rede, animação,
// barras). O que se confere é o resultado visível no documento:
//   - claro: sem `dark`, sem atributo;
//   - escuro: `dark`, sem atributo;
//   - vidro: `dark` + `data-theme-mode="glass"`;
//   - voltar de vidro para claro limpa os DOIS marcadores (não fica vidro preso);
//   - valor que não é nenhum dos três (dado corrompido) cai no claro;
//   - sem `themeMode` (config ainda não chegou) não mexe no que já está;
//   - dentro do painel (rota admin) o tema é sempre escuro e o vidro sai,
//     seja qual for o tema da loja.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const estado = vi.hoisted(() => ({
  config: {
    shippingFee: 0,
    freeShippingMin: 0,
    enableReviews: false,
  } as Record<string, unknown>,
  admin: false,
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
    "viewport",
  ]);
  const criar = (tag: string) =>
    React.forwardRef(function Duble(
      { children, ...resto }: Record<string, unknown>,
      ref,
    ) {
      const limpo = Object.fromEntries(
        Object.entries(resto).filter(([k]) => !PROPS_DE_ANIMACAO.has(k)),
      );
      return React.createElement(
        tag,
        { ...limpo, ref },
        children as React.ReactNode,
      );
    });
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
  const valorFalso = (v: unknown) => ({
    get: () => v,
    set: () => {},
    on: () => () => {},
  });
  return {
    motion,
    m: motion,
    AnimatePresence,
    LazyMotion: AnimatePresence,
    domAnimation: {},
    useReducedMotion: () => true,
    useAnimation: () => ({ start: () => Promise.resolve(), stop: () => {} }),
    useMotionValue: valorFalso,
    useTransform: () => valorFalso(0),
    useSpring: valorFalso,
    useScroll: () => ({ scrollY: { get: () => 0, on: () => () => {} } }),
    useInView: () => true,
    usePresence: () => [true, () => {}],
    useIsPresent: () => true,
    animate: () => ({ stop: () => {} }),
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
vi.mock("@/views/customer/CartView", () => ({ CartView: () => null }));
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
  useStore: () => ({
    config: estado.config,
    products: [],
    isLoaded: true,
    catalogoErro: null,
    fetchProducts: () => Promise.resolve(),
  }),
}));
vi.mock("@/contexts/FavoritesContext", () => ({
  FavoritesProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: estado.admin ? { id: "lojista-1" } : null,
    isAdmin: estado.admin,
    adminStatus: estado.admin ? "admin" : "not-admin",
    loading: false,
    isPasswordRecovery: false,
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: true }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [],
    loading: false,
    trackRecommendationClick: () => {},
    fetchRecommendations: () => Promise.resolve([]),
  }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    toggleFavorite: () => {},
    isFavorite: () => false,
    loading: false,
    erro: null,
    refresh: () => {},
  }),
}));
vi.mock("@/hooks/useRecomendacoesDeProduto", () => ({
  useRecomendacoesDeProduto: () => ({
    recomendacoes: [],
    carregando: false,
    consultado: true,
  }),
}));
vi.mock("@/hooks/useReviews", () => ({
  useReviews: () => ({
    reviews: [],
    loading: false,
    getReviewsByProduct: () => {},
    markHelpful: () => {},
    subscribeToReviews: () => () => {},
  }),
}));
vi.mock("@/components/ui/custom/ProductQA", () => ({ ProductQA: () => null }));
vi.mock("@/hooks/useDeferredRender", () => ({
  useDeferredRender: () => true,
}));
vi.mock("@/hooks/useBanners", () => ({
  useBanners: () => ({ getBannersByPosition: () => [], isLoaded: true }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [], isLoading: false }),
}));
vi.mock("@/components/ui/custom/CategoryFilter", () => ({
  CategoryFilter: () => null,
}));
vi.mock("@/hooks/useAppBadge", () => ({
  useAppBadge: () => ({ setBadge: () => {}, clearBadge: () => {} }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: () => {},
    prefetchAll: () => {},
    prefetchImage: () => {},
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
  type Consulta = Promise<{ data: unknown; error: null }> & {
    select: () => Consulta;
    eq: () => Consulta;
    in: () => Consulta;
    order: () => Consulta;
    limit: () => Consulta;
    single: () => Promise<unknown>;
    maybeSingle: () => Promise<unknown>;
  };
  const consulta: Consulta = Object.assign(
    Promise.resolve({ data: [] as unknown, error: null }),
    {
      select: () => consulta,
      eq: () => consulta,
      in: () => consulta,
      order: () => consulta,
      limit: () => consulta,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
    },
  );
  return {
    supabase: {
      from: () => consulta,
      rpc: () => Promise.resolve({ data: false, error: null }),
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => Promise.resolve(),
    },
  };
});

import App from "@/App";

const flagDoReact = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
flagDoReact.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
  takeRecords() {
    return [];
  }
}

function armazemFalso() {
  const guardados = new Map<string, string>();
  return {
    getItem: (k: string) => guardados.get(k) ?? null,
    setItem: (k: string, v: string) => {
      guardados.set(k, String(v));
    },
    removeItem: (k: string) => {
      guardados.delete(k);
    },
    clear: () => guardados.clear(),
    key: (i: number) => Array.from(guardados.keys()).at(i) ?? null,
    get length() {
      return guardados.size;
    },
  };
}

const raizHtml = document.documentElement;
let raiz: Root | null = null;
let hospedeiro: HTMLDivElement | null = null;

beforeEach(() => {
  estado.config = { shippingFee: 0, freeShippingMin: 0, enableReviews: false };
  estado.admin = false;
  vi.stubGlobal("localStorage", armazemFalso());
  vi.stubGlobal("sessionStorage", armazemFalso());
  vi.stubGlobal("IntersectionObserver", ObservadorFalso);
  vi.stubGlobal("ResizeObserver", ObservadorFalso);
  vi.stubGlobal("CSS", { escape: (v: string) => v, supports: () => false });
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
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = () => {};
  if (!Element.prototype.scrollIntoView) {
    Element.prototype.scrollIntoView = () => {};
  }
  flagDoReact.IS_REACT_ACT_ENVIRONMENT = true;
  raizHtml.classList.remove("dark");
  delete raizHtml.dataset.themeMode;
  hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(async () => {
  const atual = raiz;
  await act(async () => {
    atual?.unmount();
  });
  hospedeiro?.remove();
  document.body.innerHTML = "";
  vi.unstubAllGlobals();
  globalThis.history.replaceState(null, "", "/");
  raizHtml.classList.remove("dark");
  delete raizHtml.dataset.themeMode;
});

/** Monta o App com o `themeMode` da loja indicado. */
async function montarCom(themeMode: unknown, caminho = "/") {
  estado.config = { ...estado.config, themeMode };
  globalThis.history.replaceState(null, "", caminho);
  await act(async () => {
    raiz?.render(<App />);
  });
}

/** Troca o tema da loja com o App já montado (a lojista salvou outro). */
async function trocarPara(themeMode: unknown) {
  estado.config = { ...estado.config, themeMode };
  await act(async () => {
    raiz?.render(<App />);
  });
}

const estaEscuro = () => raizHtml.classList.contains("dark");
const modo = () => raizHtml.dataset.themeMode;

describe("o tema da loja chega ao documento pelo App", () => {
  it("claro: nem `dark` nem o atributo de vidro", async () => {
    await montarCom("light");
    expect(estaEscuro()).toBe(false);
    expect(modo()).toBeUndefined();
  });

  it("escuro: liga `dark`, sem atributo de vidro", async () => {
    await montarCom("dark");
    expect(estaEscuro()).toBe(true);
    expect(modo()).toBeUndefined();
  });

  it("vidro: liga `dark` E marca `data-theme-mode=glass`", async () => {
    await montarCom("glass");
    expect(estaEscuro()).toBe(true);
    expect(modo()).toBe("glass");
  });

  it("voltar de vidro para claro limpa os DOIS marcadores", async () => {
    await montarCom("glass");
    expect(modo()).toBe("glass");

    await trocarPara("light");

    expect(estaEscuro()).toBe(false);
    expect(modo()).toBeUndefined();
  });

  it("de vidro para escuro mantém `dark` mas solta o atributo de vidro", async () => {
    await montarCom("glass");
    await trocarPara("dark");

    expect(estaEscuro()).toBe(true);
    expect(modo()).toBeUndefined();
  });

  it("de escuro para vidro põe o atributo sem perder o `dark`", async () => {
    await montarCom("dark");
    await trocarPara("glass");

    expect(estaEscuro()).toBe(true);
    expect(modo()).toBe("glass");
  });

  it("valor que não é nenhum dos três (dado corrompido) cai no claro", async () => {
    // Estava escuro (ex.: a loja anterior) e chega um valor que ninguém conhece.
    raizHtml.classList.add("dark");
    raizHtml.dataset.themeMode = "glass";
    await montarCom("neon-quebrado");

    expect(estaEscuro()).toBe(false);
    expect(modo()).toBeUndefined();
  });

  it("sem `themeMode` (config ainda não chegou) o App não mexe no que já está", async () => {
    raizHtml.classList.add("dark");
    raizHtml.dataset.themeMode = "glass";
    await montarCom(undefined);

    expect(estaEscuro()).toBe(true);
    expect(modo()).toBe("glass");
  });

  it("no painel o tema é sempre escuro, mesmo com a loja no claro", async () => {
    estado.admin = true;
    await montarCom("light", "/admin/dashboard");

    expect(estaEscuro()).toBe(true);
    expect(modo()).toBeUndefined();
  });

  it("entrar no painel vindo da vitrine em vidro tira o atributo de vidro", async () => {
    // A vitrine estava em vidro (`dark` + atributo); o painel é escuro liso.
    raizHtml.classList.add("dark");
    raizHtml.dataset.themeMode = "glass";
    estado.admin = true;
    await montarCom("glass", "/admin/dashboard");

    expect(estaEscuro()).toBe(true);
    expect(modo()).toBeUndefined();
  });
});
