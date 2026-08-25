// @vitest-environment jsdom
//
// CONTRATO DE COR que este arquivo prova (a mesma regra documentada em
// src/config/branding.ts e src/contexts/StoreContext.tsx):
//
//   1. O branding do BUILD (applyBranding em main.tsx) é a semente imediata
//      anti-flash no :root — e no meta theme-color.
//   2. O primary_color do BANCO vence assim que a config chega (fetch, cache
//      do DataVault, updateConfig ou realtime) ou muda depois.
//   3. O default DE CÓDIGO (#000000 do defaultStoreConfig) não é cor de
//      banco: não pode pisar a semente do build durante o mount, na janela
//      em que o banco ainda não respondeu.
//
// (a) e (c) usam render real do StoreProvider (mesmo padrão de
// tests/front/store-context-nao-mexe-em-dark.test.tsx) porque a cor é
// aplicada por useEffect/efeitos imperativos no documentElement — dublê de
// contexto não provaria nada. (b) renderiza o <App /> inteiro porque o meta
// theme-color é responsabilidade do App (mesmo efeito que aplica o
// themeMode); os componentes de shell são dublados para o render não puxar
// a árvore de views inteira.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import App from "@/App";
import { applyBranding, branding, hexToTailwindHsl } from "@/config/branding";
import { StoreProvider } from "@/contexts/StoreContext";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: null,
    isAdmin: false,
    adminStatus: "user",
    loading: false,
    isPasswordRecovery: false,
  }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

// DataVault sem cache: `getById` resolvendo `null` pula o ramo de config
// vinda do IndexedDB (indisponível no jsdom puro) e isola o teste no que vem
// do `select().single()` do Supabase dublado.
vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn(() => () => {}),
  },
}));

// A linha do banco que `select("*").single()` devolve — cada teste ajusta
// antes de renderizar. `mapConfig` lê em tempo de render, então mudar a
// variável entre testes funciona mesmo com o módulo já carregado.
let linhaDoBanco: Record<string, unknown> = { id: 1 };
// Quando true, o builder devolve um thenable que nunca resolve — simula a
// janela anti-flash em que o banco ainda não respondeu.
let fetchPendente = false;

// Builder encadeável e "thenable" — cobre `.from().select().single()` (usado
// por fetchConfig) e `.from().select().is().limit().order()` (fetchProducts)
// sem replicar a assinatura exata de cada chamada. Mesmo dublê de
// tests/front/store-config-identidade-da-loja.test.ts.
function construtorEncadeavel(resultado: { data: unknown; error: unknown }) {
  const alvo: any = () => construtorEncadeavel(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) => resolve(resultado);
      }
      return () => construtorEncadeavel(resultado);
    },
    apply() {
      return construtorEncadeavel(resultado);
    },
  });
}

// Cadeia idem à de cima, mas o `await` nunca resolve.
function construtorQueNaoResolve(): any {
  const alvo: any = () => construtorQueNaoResolve();
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => void) =>
          new Promise<never>(() => {}).then(resolve);
      }
      return () => construtorQueNaoResolve();
    },
    apply: () => construtorQueNaoResolve(),
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () =>
      fetchPendente
        ? construtorQueNaoResolve()
        : construtorEncadeavel({ data: linhaDoBanco, error: null }),
    rpc: () => construtorEncadeavel({ data: null, error: null }),
  },
}));

// ── Dublês de shell do <App /> (para o teste do meta theme-color) ──
// O objetivo é chegar ao AppContent com seus efeitos reais sem montar a
// árvore de views inteira (Header, BottomNav, HomeView etc.).
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [], loading: false }),
}));
vi.mock("@/hooks/useViewTransition", () => ({
  useViewTransition: () => ({ navigate: vi.fn(), isSupported: false }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: vi.fn(),
    prefetchAll: vi.fn(),
    prefetchViewPromise: vi.fn(() => Promise.resolve()),
  }),
}));
vi.mock("@/hooks/useCacheWarmer", () => ({ useCacheWarmer: vi.fn() }));
vi.mock("@/hooks/useNetworkAdaptive", () => ({
  useNetworkAdaptive: () => ({ isSlow: () => false }),
}));
vi.mock("@/hooks/usePredictiveNavigation", () => ({
  usePredictiveNavigation: vi.fn(),
}));
vi.mock("@/hooks/useBehavioralPrefetch", () => ({
  useBehavioralPrefetch: vi.fn(),
}));
vi.mock("@/hooks/useWebVitals", () => ({ useWebVitals: vi.fn() }));
vi.mock("@/hooks/useSwipeBack", () => ({ useSwipeBack: vi.fn() }));
vi.mock("@/hooks/useCart", () => ({
  useCartState: () => ({ cartCount: 0 }),
  useCartActions: () => ({ addToCart: vi.fn() }),
}));
vi.mock("@/hooks/useFavorites", () => ({
  useFavorites: () => ({
    favorites: [],
    toggleFavorite: vi.fn(),
    loading: false,
  }),
}));
vi.mock("@/hooks/useAppBadge", () => ({
  useAppBadge: () => ({ setBadge: vi.fn(), clearBadge: vi.fn() }),
}));
vi.mock("@/hooks/useUpdateCheck", () => ({
  useUpdateCheck: () => ({
    checkUpdate: vi.fn(),
    updateAvailable: false,
    newVersion: null,
    performNuclearPurge: vi.fn(),
  }),
}));
vi.mock("@/hooks/useRealtimeUpdate", () => ({ useRealtimeUpdate: vi.fn() }));
vi.mock("@/contexts/CartContext", () => ({
  CartProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/contexts/FavoritesContext", () => ({
  FavoritesProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock("@/components/ui/custom/Header", () => ({ Header: () => null }));
vi.mock("@/components/ui/custom/BottomNav", () => ({
  BottomNav: () => null,
}));
vi.mock("@/components/ui/custom/CartReminder", () => ({
  CartReminder: () => null,
}));
vi.mock("@/components/pwa/PushNotificationBanner", () => ({
  PushNotificationBanner: () => null,
}));
vi.mock("@/components/pwa/UpdateNotification", () => ({
  UpdateNotification: () => null,
}));
vi.mock("@/components/debug/DebugPanel", () => ({ DebugPanel: () => null }));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: () => null,
  AlertDialogAction: () => null,
  AlertDialogCancel: () => null,
  AlertDialogContent: () => null,
  AlertDialogDescription: () => null,
  AlertDialogFooter: () => null,
  AlertDialogHeader: () => null,
  AlertDialogTitle: () => null,
}));
vi.mock("@/views/customer/HomeView", () => ({ HomeView: () => null }));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const COR_DO_BANCO = "#059669";

function metaThemeColor(): HTMLMetaElement | null {
  return document.head.querySelector('meta[name="theme-color"]');
}

// Node 25 pisa em `localStorage`/`sessionStorage` globais antes do jsdom —
// mesmo contorno de auth-logout-cleanup.test.tsx.
function criarStorageFake() {
  const armazem = new Map<string, string>();
  return {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => {
      armazem.set(chave, valor);
    },
    removeItem: (chave: string) => {
      armazem.delete(chave);
    },
    clear: () => {
      armazem.clear();
    },
    key: (index: number) => Array.from(armazem.keys()).at(index) ?? null,
    get length() {
      return armazem.size;
    },
  };
}

// jsdom não implementa matchMedia nem IntersectionObserver (o App usa ambos
// em efeitos de layout); visualViewport não existe e o efeito já retorna cedo.
function stubsDeBrowser() {
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  linhaDoBanco = { id: 1 };
  fetchPendente = false;
  stubsDeBrowser();
  vi.stubGlobal("localStorage", criarStorageFake());
  vi.stubGlobal("sessionStorage", criarStorageFake());
  document.documentElement.style.removeProperty("--primary");
  // Simula o index.html (dono de outro agente): meta theme-color fixo em
  // preto até alguém da aplicação atualizá-lo em runtime.
  let meta = metaThemeColor();
  if (!meta) {
    meta = document.createElement("meta");
    meta.setAttribute("name", "theme-color");
    document.head.appendChild(meta);
  }
  meta.setAttribute("content", "#000000");
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("StoreContext — a cor da loja vem do banco (contrato: build semeia, banco vence)", () => {
  it("(a) config com primary_color atualiza a CSS var --primary do documentElement", async () => {
    linhaDoBanco = { id: 1, primary_color: COR_DO_BANCO };

    await act(async () => {
      raiz.render(
        <StoreProvider>
          <span />
        </StoreProvider>,
      );
    });
    // Duas voltas de microtarefa: fetchConfig é assíncrono (await no
    // `.select().single()` dublado) e só depois disso setConfig/applyBranding rodam.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      hexToTailwindHsl(COR_DO_BANCO),
    );
  });

  it("(c) a semente do build sobrevive ao mount enquanto o banco não responde", async () => {
    fetchPendente = true;

    // O que main.tsx faz no boot da aplicação: semeia o :root (e o meta) com
    // a cor do branding de build, antes de qualquer dado.
    applyBranding();
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      hexToTailwindHsl(branding.theme.primary),
    );

    await act(async () => {
      raiz.render(
        <StoreProvider>
          <span />
        </StoreProvider>,
      );
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // O default de código (#000000) não veio do banco: a semente precisa
    // continuar intacta — nem a CSS var, nem o meta.
    expect(document.documentElement.style.getPropertyValue("--primary")).toBe(
      hexToTailwindHsl(branding.theme.primary),
    );
    expect(metaThemeColor()?.getAttribute("content")).toBe(
      branding.theme.primary,
    );
  });
});

describe("App — o meta theme-color acompanha a cor primária efetiva (banco > build)", () => {
  it("(b) config com primary_color atualiza o meta theme-color em runtime", async () => {
    linhaDoBanco = { id: 1, primary_color: COR_DO_BANCO };

    await act(async () => {
      raiz.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(metaThemeColor()?.getAttribute("content")).toBe(COR_DO_BANCO);
  });
});
