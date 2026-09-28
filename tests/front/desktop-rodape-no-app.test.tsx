import { CONSULTA_TELA_DE_COMPUTADOR } from "@/hooks/useTelaDeComputador";
// @vitest-environment jsdom
// F1.15: harness do App baseado na regressão da categoria, com as telas isoladas.
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

vi.mock("@/views/customer/HomeView", () => ({
  HomeView: ({
    selectedCategory,
    onCategoryChange,
    onNavigate,
    onProductClick,
  }: {
    readonly selectedCategory: string;
    readonly onCategoryChange: (category: string) => void;
    readonly onNavigate: (view: string) => void;
    readonly onProductClick: (id: string) => void;
  }) => (
    <div data-testid="home" data-categoria={selectedCategory}>
      {["Bebidas", "Todas", "Doces", "Café & chá"].map((categoria) => (
        <button
          key={categoria}
          type="button"
          data-testid={
            categoria === "Café & chá" ? "categoria-especial" : categoria
          }
          onClick={() => onCategoryChange(categoria)}
        >
          {categoria}
        </button>
      ))}
      <button
        type="button"
        data-testid="carrinho"
        onClick={() => onNavigate("cart")}
      >
        Carrinho
      </button>
      <button
        type="button"
        data-testid="produto"
        onClick={() => onProductClick("produto-A")}
      >
        Produto
      </button>
    </div>
  ),
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
vi.mock("@/components/ui/custom/BottomNav", () => ({
  BottomNav: ({
    onNavigate,
  }: { readonly onNavigate: (view: string) => void }) => (
    <button
      type="button"
      data-testid="inicio"
      onClick={() => onNavigate("home")}
    >
      Início
    </button>
  ),
}));
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

vi.mock("@/components/layouts/AppMotionFallbacks", () => ({
  MainTabsMotionShell: ({ children }: { readonly children?: unknown }) =>
    children as never,
  SecondaryViewMotionShell: ({ children }: { readonly children?: unknown }) =>
    children as never,
  RouteLoadingProgress: () => null,
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
    config: {
      storeName: "Loja de Teste",
      storeCity: "Cidade",
      storeState: "UF",
    },
  }),
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
// Quem está logada muda por teste: deslogada, `/address-form` é redirecionada
// para `/auth` (outra tela, que leva rodapé) — o modo foco só existe logada.
const sessao = vi.hoisted(() => ({
  user: null as { id: string; email: string } | null,
}));
const USUARIA = { id: "usuaria-1", email: "cliente@exemplo.com" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: sessao.user,
    isAdmin: false,
    adminStatus: "not-admin",
    loading: false,
    isPasswordRecovery: false,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [{ id: "produto-A" }],
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

vi.mock("@/components/desktop/RodapeDaLoja", () => ({
  RodapeDaLoja: () => <footer>Rodapé da prova</footer>,
}));
vi.mock("@/views/customer/CheckoutView", () => ({
  CheckoutView: () => <div data-testid="checkout" />,
}));
vi.mock("@/views/customer/AddressFormView", () => ({
  AddressFormView: () => <div data-testid="endereco" />,
}));
vi.mock("@/views/shared/AuthView", () => ({
  AuthView: () => <div data-testid="login" />,
}));

describe("F1.15 rodapé dentro da rolagem da cliente", () => {
  // @ts-expect-error flag interna do React para act.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  let root: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    sessao.user = null;
    vi.stubGlobal("localStorage", dubleDeArmazem());
    vi.stubGlobal("sessionStorage", dubleDeArmazem());
    vi.stubGlobal("IntersectionObserver", ObservadorDeInterseccao);
    vi.stubGlobal("scrollTo", () => {});
    Element.prototype.scrollTo = () => {};
    host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    vi.unstubAllGlobals();
  });
  const passo = () =>
    act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  // Espera a tela pedida montar de verdade (o chunk lazy pode levar mais que
  // qualquer número fixo de ticks — foi o que fez o teste do modo foco passar
  // no vazio) e só então dá uns ticks para um rodapé indevido aparecer.
  async function abrir(rota: string, tela: string, desktop = true) {
    vi.stubGlobal("matchMedia", (q: string) => ({
      matches: desktop && q === CONSULTA_TELA_DE_COMPUTADOR,
      addEventListener() {},
      removeEventListener() {},
    }));
    history.replaceState(null, "", rota);
    await act(async () => {
      root.render(<App />);
    });
    for (
      let i = 0;
      i < 400 && !host.querySelector(`[data-testid="${tela}"]`);
      i++
    )
      await passo();
    expect(host.querySelector(`[data-testid="${tela}"]`)).not.toBeNull();
    for (let i = 0; i < 20; i++) await passo();
  }
  it.each([
    ["/", "home"],
    ["/product-detail?id=produto-A", "tela-produto"],
  ])("desktop em %s mostra rodapé após a tela", async (rota, tela) => {
    await abrir(rota, tela);
    const conteudo = host.querySelector(`[data-testid="${tela}"]`)!;
    expect(conteudo).not.toBeNull();
    const footer = host.querySelector("footer")!;
    expect(footer).not.toBeNull();
    expect(
      conteudo.compareDocumentPosition(footer) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(host.querySelectorAll("footer")).toHaveLength(1);
  });
  it.each([
    ["/checkout", "checkout"],
    ["/address-form", "endereco"],
  ])("modo foco %s não monta rodapé", async (rota, tela) => {
    sessao.user = USUARIA;
    await abrir(rota, tela);
    expect(host.querySelector("footer")).toBeNull();
  });
  // O login é passagem do checkout e do endereço para quem está deslogada
  // (`address-form` é redirecionada para `/auth`; o checkout leva a `auth` nos
  // botões "Entrar ou criar conta"), então segue o mesmo modo foco. `/login` é
  // o alias da mesma AuthView. Aqui a cliente fica DESLOGADA, de propósito.
  it.each([["/auth"], ["/login"]])(
    "modo foco %s não monta rodapé",
    async (rota) => {
      await abrir(rota, "login");
      expect(host.querySelector("footer")).toBeNull();
    },
  );
  it("celular não monta rodapé", async () => {
    await abrir("/", "home", false);
    expect(host.querySelector("footer")).toBeNull();
  });
});
