// @vitest-environment jsdom
//
// T4 (app): o modo manutenção passa a vir da FICHA da loja
// (`modoManutencao()`, escala etapa 3, 11/09/2026) em vez de
// `import.meta.env.VITE_MAINTENANCE_MODE` — cada loja liga/desliga a própria
// manutenção pela configuração gravada no SEU banco, não por um valor único
// assado num build compartilhado por N lojas.
//
// Mesmo andaime de cor-da-loja-vem-do-banco.test.tsx: renderiza <App/>
// inteiro (a decisão mora em `renderCustomerContent`, dentro de
// `AppContent`) com o mesmo conjunto de dublês de shell — Header, BottomNav,
// HomeView etc. não são o que este arquivo prova.
//
// `App` é importado DINAMICAMENTE, depois de injetar a ficha e ANTES de
// renderizar — nunca estaticamente no topo do arquivo. Motivo (achado deste
// arquivo): `src/config/buildIdentity.ts` chama `lerFichaDaLoja()` na
// PRÓPRIA avaliação do módulo (é o caminho da identidade "assada" de
// build), e `App.tsx` importa esse módulo por trás de `@/config/branding`.
// `lerFichaDaLoja()` cacheia o resultado em variável de módulo — com um
// `import` estático de `@/App` no topo do arquivo, essa primeira leitura
// aconteceria ANTES de qualquer ficha existir no DOM (o arquivo de teste é
// avaliado antes do primeiro `beforeEach`), cacheando `null` para SEMPRE e
// tornando as duas variantes deste teste indistinguíveis (o "achado" que
// motivou este comentário: os dois testes passavam por acaso quando `App`
// era importado no topo, porque nenhum dos dois de fato lia a ficha).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { FichaDaLoja } from "@/config/fichaDaLojaContract";
import { FICHA_DA_LOJA_ID } from "@/config/fichaDaLojaContract";
import { parseStoreIdentity } from "@/lib/storeIdentity";

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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => construtorEncadeavel({ data: { id: 1 }, error: null }),
    rpc: () => construtorEncadeavel({ data: null, error: null }),
  },
}));

// ── Dublês de shell do <App /> (mesma lista de
// cor-da-loja-vem-do-banco.test.tsx) — o objetivo é chegar em
// `renderCustomerContent` com seus efeitos reais sem montar a árvore de
// views inteira. ──
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

const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const HASH = "a".repeat(64);

// ── Fixture da ficha v2 (mesmo builder de
// tests/front/configuracao-da-loja-pela-ficha.test.ts) ──
function asset(
  name: string,
  mediaType: string,
  width?: number,
  height?: number,
) {
  return {
    path: `v1/${HASH}/${name}`,
    sha256: HASH,
    media_type: mediaType,
    bytes: 100,
    ...(width === undefined ? {} : { width, height }),
  };
}

function identidadeValida() {
  const header = asset("header.png", "image/png");
  const row = {
    store_name: "Loja Da Manutencao",
    store_city: null,
    store_state: null,
    primary_color: "#123456",
    secondary_color: "#abcdef",
    accent_color: "#fedcba",
    logo_url: `${SUPABASE_URL}/storage/v1/object/public/branding/${header.path}`,
    branding_assets: {
      version: 1,
      originals: [header],
      header,
      loader: header,
      favicon: asset("favicon.png", "image/png"),
      apple_touch: asset("apple.png", "image/png", 180, 180),
      icon_192: asset("icon192.png", "image/png", 192, 192),
      icon_512: asset("icon512.png", "image/png", 512, 512),
      maskable_512: asset("maskable.png", "image/png", 512, 512),
      og: asset("og.png", "image/png", 1200, 630),
    },
  };
  return parseStoreIdentity(row, SUPABASE_URL);
}

function fichaValida(
  overridesConfiguracao: Partial<FichaDaLoja["configuracao"]> = {},
  host = "loja-manutencao-teste.exemplo.com",
): FichaDaLoja {
  return {
    schemaVersion: 2,
    host,
    identidade: {
      identity: identidadeValida(),
      localUrls: {
        originals: ["https://cdn.exemplo/originals/o.png"],
        header: "https://cdn.exemplo/header.png",
        loader: "https://cdn.exemplo/loader.png",
        favicon: "https://cdn.exemplo/favicon.png",
        apple_touch: "https://cdn.exemplo/apple.png",
        icon_192: "https://cdn.exemplo/icon192.png",
        icon_512: "https://cdn.exemplo/icon512.png",
        maskable_512: "https://cdn.exemplo/maskable.png",
        og: "https://cdn.exemplo/og.png",
      },
      publicUrl: `https://${host}`,
      identityRevision: "d".repeat(64),
    },
    conexao: {
      supabaseUrl: SUPABASE_URL,
      publishableKey: "sb_publishable_manutencao_teste",
    },
    configuracao: {
      mpPublicKey: null,
      vapidPublicKey: null,
      pagamentoOnline: false,
      manutencao: false,
      ...overridesConfiguracao,
    },
  };
}

function injetarFicha(conteudo: string) {
  const elemento = document.createElement("script");
  elemento.type = "application/json";
  elemento.id = FICHA_DA_LOJA_ID;
  elemento.textContent = conteudo;
  document.head.appendChild(elemento);
}

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
  document.head.innerHTML = "";
  stubsDeBrowser();
  // O App LÊ mais do que `hostname` de `window.location` (ex.:
  // `window.location.search`, no efeito do modo standalone do PWA) —
  // diferente da fixture de configuracao-da-loja-pela-ficha.test.ts, que só
  // exercita `lerFichaDaLoja()` isolado. Preserva o resto do location de
  // verdade do jsdom e troca só o `hostname`, para bater com o `host` da
  // ficha injetada.
  vi.stubGlobal("location", {
    ...globalThis.location,
    hostname: "loja-manutencao-teste.exemplo.com",
  });
  vi.stubGlobal("localStorage", criarStorageFake());
  vi.stubGlobal("sessionStorage", criarStorageFake());
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  document.head.innerHTML = "";
  vi.unstubAllGlobals();
});

const TEXTO_MANUTENCAO = "Servidor em Manutenção";

/** Importa `@/App` do ZERO — ver o comentário grande no topo do arquivo
 * sobre por que isto não pode ser um `import` estático. */
async function importarAppLimpo() {
  vi.resetModules();
  const { default: App } = await import("@/App");
  return App;
}

describe("App — o modo manutenção vem da ficha da loja (escala etapa 3)", () => {
  it("ficha v2 com manutencao: true — mostra a tela de manutenção", async () => {
    injetarFicha(JSON.stringify(fichaValida({ manutencao: true })));
    const App = await importarAppLimpo();

    await act(async () => {
      raiz.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      // Drena também a MACROtarefa dos chunks lazy que `PreloadedOrLazy`
      // dispara (import() dinâmico de views que este arquivo não mocka,
      // como ProductDetailView) — sem isto o React reclama de um recurso
      // suspenso resolvendo fora de act() depois que o teste já terminou.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(hospedeiro.textContent).toContain(TEXTO_MANUTENCAO);
  });

  it("ficha v2 com manutencao: false — não mostra a tela de manutenção", async () => {
    injetarFicha(JSON.stringify(fichaValida({ manutencao: false })));
    const App = await importarAppLimpo();

    await act(async () => {
      raiz.render(<App />);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      // Drena também a MACROtarefa dos chunks lazy que `PreloadedOrLazy`
      // dispara (import() dinâmico de views que este arquivo não mocka,
      // como ProductDetailView) — sem isto o React reclama de um recurso
      // suspenso resolvendo fora de act() depois que o teste já terminou.
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(hospedeiro.textContent).not.toContain(TEXTO_MANUTENCAO);
  });
});
