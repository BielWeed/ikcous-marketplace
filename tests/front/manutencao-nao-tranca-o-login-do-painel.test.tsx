// @vitest-environment jsdom

import App from "@/App";
import { type ReactNode, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/config/configuracaoDaLoja", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/config/configuracaoDaLoja")>()),
  modoManutencao: () => true,
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

// Mantém o roteador e as telas reais. Desliga as pontas que consultam a
// loja ou disparam trabalho em segundo plano: nenhum login é enviado.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));
vi.mock("@/contexts/StoreContext", () => ({
  StoreProvider: ({ children }: { children: ReactNode }) => children,
  useStore: () => ({ config: {} }),
}));
vi.mock("@/contexts/CartContext", () => ({
  CartProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/contexts/FavoritesContext", () => ({
  FavoritesProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [], loading: false }),
}));
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
vi.mock("@/hooks/useViewTransition", () => ({
  useViewTransition: () => ({ navigate: vi.fn(), isSupported: false }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({
    prefetchView: vi.fn(),
    prefetchAll: vi.fn(),
    prefetchViewPromise: () => Promise.resolve(),
  }),
}));
vi.mock("@/hooks/useCacheWarmer", () => ({ useCacheWarmer: vi.fn() }));
vi.mock("@/hooks/usePredictiveNavigation", () => ({
  usePredictiveNavigation: vi.fn(),
}));
vi.mock("@/hooks/useBehavioralPrefetch", () => ({
  useBehavioralPrefetch: vi.fn(),
}));
vi.mock("@/hooks/useUpdateCheck", () => ({
  useUpdateCheck: () => ({ checkUpdate: vi.fn(), updateAvailable: false }),
}));
vi.mock("@/hooks/useRealtimeUpdate", () => ({ useRealtimeUpdate: vi.fn() }));
vi.mock("@/hooks/useVoltaDaManutencao", () => ({
  useVoltaDaManutencao: vi.fn(),
}));
vi.mock("@/components/ui/custom/Header", () => ({ Header: () => null }));
vi.mock("@/components/ui/custom/BottomNav", () => ({ BottomNav: () => null }));
vi.mock("@/components/ui/custom/CartReminder", () => ({
  CartReminder: () => null,
}));
vi.mock("@/components/pwa/PushNotificationBanner", () => ({
  PushNotificationBanner: () => null,
}));

let raiz: Root;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("scrollTo", vi.fn());
  vi.stubGlobal(
    "IntersectionObserver",
    class {
      observe() {}
      disconnect() {}
    },
  );
  vi.stubGlobal("matchMedia", (media: string) => ({
    matches: false,
    media,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  container = document.createElement("div");
  document.body.append(container);
  raiz = createRoot(container);
});

afterEach(async () => {
  await act(async () => raiz.unmount());
  container.remove();
  globalThis.history.replaceState(null, "", "/");
  localStorage.clear();
  sessionStorage.clear();
});

async function abrirEm(caminho: string) {
  globalThis.history.replaceState(null, "", caminho);
  await act(async () => raiz.render(<App />));
  await act(async () => vi.dynamicImportSettled());
  return container.querySelector("main");
}

const TEXTO_MANUTENCAO = "Loja em manutenção";

async function esperarBotaoDeEntrada(texto: string) {
  await vi.waitFor(async () => {
    await act(async () => vi.dynamicImportSettled());
    expect(
      container.querySelector('main button[type="submit"]')?.textContent,
    ).toBe(texto);
  });
}

it("mostra o formulário do lojista em /admin-login durante a manutenção", async () => {
  const tela = await abrirEm("/admin-login");

  expect(tela?.textContent ?? "").not.toContain(TEXTO_MANUTENCAO);
  await esperarBotaoDeEntrada("Entrar no Sistema");
});

it.each([
  { caminho: "/admin", destino: "admin", id: undefined },
  {
    caminho: "/admin-orders?id=9c05a94e-e8ba-4aed-9bbc-d76c0427f7f5",
    destino: "admin-orders",
    id: "9c05a94e-e8ba-4aed-9bbc-d76c0427f7f5",
  },
])(
  "mostra a entrada sem sessão em $caminho e preserva o destino durante a manutenção",
  async ({ caminho, destino, id }) => {
    const tela = await abrirEm(caminho);

    expect(globalThis.location.pathname).toBe("/auth");
    expect(globalThis.history.state).toEqual({
      view: "auth",
      requested: destino,
      ...(id === undefined ? {} : { id }),
    });
    expect(tela?.textContent ?? "").not.toContain(TEXTO_MANUTENCAO);
    await esperarBotaoDeEntrada("ENTRAR AGORA");
  },
);

it.each(["/", "/cart", "/auth"])(
  "continua mostrando a manutenção em %s sem um destino do painel",
  async (caminho) => {
    const tela = await abrirEm(caminho);

    expect(tela?.textContent).toContain(TEXTO_MANUTENCAO);
    expect(tela?.querySelector('button[type="submit"]')).toBeNull();
  },
);
