// @vitest-environment jsdom
// Achados 2 e 3 do lote r56-d (06/11/2026): o Voltar de um produto que não veio
// de um card.
//
// Antes: o banner gravava a entrada do histórico SEM "de onde veio", e o link
// direto (WhatsApp, aviso do celular, aba nova) também não tem. Sem isso a seta
// Voltar do app caía no ramo "absoluto" e EMPILHAVA uma segunda Início por cima
// do produto: o histórico ficava [vitrine, produto, vitrine] e o Voltar do
// celular, estando na vitrine, trazia o produto de volta (no link direto, em
// vez de sair da loja).
//
// Agora: o banner grava `from` (como o card) e o ramo absoluto da seta TROCA a
// entrada do produto pela Início, em vez de empilhar.
//
// Andaime: o MESMO de destino-pos-login-voltar-nao-cai-no-perfil.test.tsx, com
// a Home trazendo um card e o BannerCarousel de verdade.
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

// Mutável de propósito: o teste loga a pessoa NO MEIO da jornada.
const { estadoAuth, bannerDaHome } = vi.hoisted(() => ({
  // Destino que o painel gravou no banner da Home do teste.
  bannerDaHome: { link: "/product-detail?id=produto-A" },
  estadoAuth: {
    user: null as { id: string } | null,
    isAdmin: false,
    adminStatus: "not-admin",
    loading: false,
    isPasswordRecovery: false,
  },
}));

vi.mock("embla-carousel-react", () => ({
  default: () => [
    () => {},
    {
      scrollNext: () => {},
      scrollTo: () => {},
      on: () => {},
      off: () => {},
      selectedScrollSnap: () => 0,
    },
  ],
}));

// A Home do teste tem os DOIS caminhos que abrem um produto: o card (que passa
// por `onNavigate` e grava de onde a pessoa veio) e o BANNER de verdade (que
// grava a entrada do histórico por conta própria).
vi.mock("@/views/customer/HomeView", async () => {
  const { BannerCarousel } = await import(
    "@/components/ui/custom/BannerCarousel"
  );
  const banner = {
    id: "b1",
    imageUrl: "https://example.com/banner.jpg",
    title: "Campanha",
    position: "home_top",
    active: true,
    order: 1,
  };
  return {
    HomeView: ({
      onNavigate,
    }: {
      readonly onNavigate: (view: string, id?: string) => void;
    }) => (
      <div data-testid="home">
        <button
          type="button"
          data-testid="abrir-pelo-card"
          onClick={() => onNavigate("product-detail", "produto-A")}
        >
          Card
        </button>
        <BannerCarousel
          banners={[{ ...banner, link: bannerDaHome.link } as never]}
          autoPlay={false}
        />
      </div>
    ),
  };
});
// O CartView real serve as abas Carrinho e Pedidos (a mesma instância).
vi.mock("@/views/customer/CartView", () => ({
  CartView: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string) => void;
  }) => (
    <div data-testid="tela-carrinho">
      <button
        type="button"
        data-testid="ir-para-checkout"
        onClick={() => onNavigate("checkout")}
      >
        Fechar compra
      </button>
      <button
        type="button"
        data-testid="entrar-pela-aba"
        onClick={() => onNavigate("auth")}
      >
        Entrar
      </button>
    </div>
  ),
}));
vi.mock("@/views/customer/CheckoutView", () => ({
  CheckoutView: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string) => void;
  }) => (
    <div data-testid="tela-checkout">
      <button
        type="button"
        data-testid="pagar-com-pix"
        onClick={() => onNavigate("auth")}
      >
        Pagar com PIX
      </button>
    </div>
  ),
}));
vi.mock("@/views/customer/ProductView", () => ({
  ProductView: () => <div data-testid="tela-produto" />,
}));
vi.mock("@/views/customer/ProfileView", () => ({
  ProfileView: () => <div data-testid="tela-perfil-proprio" />,
}));
// O duble expõe o `userId` recebido — é exatamente ele o objeto do conserto.
vi.mock("@/views/customer/UserProfileView", () => ({
  UserProfileView: ({ userId }: { readonly userId: string }) => (
    <div data-testid="tela-perfil-publico" data-user-id={userId} />
  ),
}));
vi.mock("@/views/shared/AuthView", async () => {
  const React = await import("react");
  return {
    // O AuthView real dispara `onSuccess` num `useEffect` que reage ao
    // `user` sair de `null`. O duble repete o MESMO mecanismo — e a ordem é
    // parte do que se prova: efeito de filho roda antes do efeito de pai,
    // então o onSuccess (e o repasse do id) vence a checagem do
    // `syncWithUrl` que devolveria um usuário logado em /auth ao perfil.
    AuthView: ({ onSuccess }: { readonly onSuccess: () => void }) => {
      // Local de propósito: é ele a dependência legítima do efeito — o
      // duble reexecuta a cada render do App e relê o estado mutável.
      const user = estadoAuth.user;
      React.useEffect(() => {
        if (user) onSuccess();
      }, [user, onSuccess]);
      return <div data-testid="tela-login" />;
    },
  };
});

vi.mock("@/components/debug/DebugPanel", () => ({ DebugPanel: () => null }));
vi.mock("@/components/pwa/PushNotificationBanner", () => ({
  PushNotificationBanner: () => null,
}));
vi.mock("@/components/pwa/UpdateNotification", () => ({
  UpdateNotification: () => null,
}));
// A seta do cabeçalho é o `handleBack` do App: é ela que a cliente aperta.
vi.mock("@/components/ui/custom/Header", () => ({
  Header: ({ onBack }: { readonly onBack: () => void }) => (
    <button type="button" data-testid="seta-voltar" onClick={onBack}>
      Voltar
    </button>
  ),
}));
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
  useAuth: () => estadoAuth,
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
  consulta.single = () =>
    Promise.resolve({
      data: null,
      error: { message: "not found", code: "PGRST116" },
    });
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

describe("Voltar de um produto sem 'de onde veio' não empilha outra Início", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    estadoAuth.user = null;
    bannerDaHome.link = "/product-detail?id=produto-A";
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("localStorage", dubleDeArmazem());
    vi.stubGlobal("sessionStorage", dubleDeArmazem());
    vi.stubGlobal("IntersectionObserver", ObservadorDeInterseccao);
    vi.stubGlobal("ResizeObserver", ObservadorDeInterseccao);
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

    globalThis.history.replaceState(null, "", "/");

    container = document.createElement("div");
    document.body.append(container);
    raiz = createRoot(container);
  });

  afterEach(async () => {
    // O App agenda um setTimeout de 350 ms ao fim de cada transição de tela;
    // se disparar depois de o ambiente ser desfeito, vira erro não tratado.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });
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

  const clicar = async (seletor: string) => {
    const alvo = container?.querySelector<HTMLElement>(seletor);
    if (!alvo) throw new Error(`elemento ${seletor} não encontrado`);
    await act(async () => {
      alvo.click();
    });
    await assentar();
  };

  const existe = (marca: string) =>
    container?.querySelector(`[data-testid="${marca}"]`) != null;

  const abrir = async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
    // A primeira tela é carregada sob demanda (módulo dublado, mas assíncrono):
    // espera aparecer, em vez de apostar num número fixo de voltas.
    for (let i = 0; i < 40 && !existe("home") && !existe("tela-produto"); i++) {
      await assentar(5);
    }
  };

  // O Voltar do APARELHO: o jsdom enfileira o popstate sozinho.
  const voltarDoAparelho = async () => {
    await act(async () => {
      globalThis.history.back();
    });
    await assentar();
  };

  it("banner que abre um produto: a seta Voltar volta de verdade (não empilha Início) e o Voltar do aparelho depois NÃO traz o produto de volta", async () => {
    await abrir();
    expect(existe("home")).toBe(true);

    await clicar('[role="button"]');
    expect(existe("tela-produto")).toBe(true);
    expect(globalThis.location.pathname).toBe("/product-detail");
    // A entrada gravada pelo banner diz de onde a pessoa veio, como a do card.
    expect(globalThis.history.state?.from).toBe("home");
    const entradasComOProduto = globalThis.history.length;

    await clicar('[data-testid="seta-voltar"]');
    expect(existe("home")).toBe(true);
    expect(existe("tela-produto")).toBe(false);
    // Voltar é recuar uma posição, não acrescentar outra Início por cima.
    expect(globalThis.history.length).toBe(entradasComOProduto);

    // Estando na vitrine, o Voltar do aparelho não pode devolver o produto.
    await voltarDoAparelho();
    expect(existe("tela-produto")).toBe(false);
    expect(globalThis.location.pathname).not.toBe("/product-detail");
  });

  it("CONTROLE: produto aberto pelo card — a seta recua uma posição (history.back) e o aparelho não traz o produto de volta", async () => {
    await abrir();
    await clicar('[data-testid="abrir-pelo-card"]');
    expect(existe("tela-produto")).toBe(true);
    expect(globalThis.history.state?.from).toBe("home");
    const entradasComOProduto = globalThis.history.length;

    const espiaBack = vi.spyOn(globalThis.history, "back");
    await clicar('[data-testid="seta-voltar"]');
    expect(espiaBack).toHaveBeenCalledTimes(1);
    expect(existe("home")).toBe(true);
    expect(globalThis.history.length).toBe(entradasComOProduto);

    await voltarDoAparelho();
    expect(existe("tela-produto")).toBe(false);
  });

  it("link direto de produto (WhatsApp, aba nova): a seta leva à Início OCUPANDO o lugar do link — nada empilhado, o link não sobra atrás", async () => {
    globalThis.history.replaceState(null, "", "/product-detail?id=produto-A");
    await abrir();
    expect(existe("tela-produto")).toBe(true);
    expect(globalThis.history.state).toBeNull();
    const entradas = globalThis.history.length;

    const espiaPush = vi.spyOn(globalThis.history, "pushState");
    await clicar('[data-testid="seta-voltar"]');

    expect(existe("home")).toBe(true);
    expect(existe("tela-produto")).toBe(false);
    expect(globalThis.location.pathname).not.toBe("/product-detail");
    // A Início trocou a entrada do link: o histórico não cresceu...
    expect(globalThis.history.length).toBe(entradas);
    expect(globalThis.history.state?.view).toBe("home");
    // ...e a entrada nova não finge ter uma tela de origem (não há nenhuma antes).
    expect(globalThis.history.state?.from).toBeUndefined();
    // Nenhuma entrada de Início foi EMPILHADA por cima do link.
    expect(
      espiaPush.mock.calls.filter(
        ([estado]) => (estado as { view?: string } | null)?.view === "home",
      ),
    ).toHaveLength(0);
  });

  it("LIMITE: depois de sair do link direto pela seta, abrir outro produto pelo card e voltar leva à Início normalmente", async () => {
    globalThis.history.replaceState(null, "", "/product-detail?id=produto-A");
    await abrir();
    await clicar('[data-testid="seta-voltar"]');
    expect(existe("home")).toBe(true);

    await clicar('[data-testid="abrir-pelo-card"]');
    expect(existe("tela-produto")).toBe(true);
    expect(globalThis.history.state?.from).toBe("home");

    await clicar('[data-testid="seta-voltar"]');
    expect(existe("home")).toBe(true);
    expect(existe("tela-produto")).toBe(false);
  });

  it("CARACTERIZAÇÃO: banner com link de caminho que o app não conhece não leva a lugar nenhum — fica na Início, sem tela quebrada", async () => {
    // O painel só recusa link com esquema perigoso ou fora da loja; um caminho
    // como "/tela-que-nao-existe" é salvo. Hoje o toque grava essa entrada,
    // o App não reconhece o endereço e o troca pela Início (replaceState).
    // Resultado: a cliente toca e nada acontece (decisão de produto: validar a
    // rota no painel). Este teste TRAVA o que acontece hoje -- sem tela em
    // branco, sem produto, sem sair da loja -- e fica vermelho se isso mudar.
    bannerDaHome.link = "/tela-que-nao-existe";
    await abrir();
    expect(existe("home")).toBe(true);

    const entradasAntes = globalThis.history.length;
    await clicar('[role="button"]');

    // O toque DISPAROU a navegação (uma entrada nova no histórico), que o App
    // desfez trocando-a pela Início: sem isto o teste passaria com o banner morto.
    expect(globalThis.history.length).toBe(entradasAntes + 1);
    expect(existe("home")).toBe(true);
    expect(existe("tela-produto")).toBe(false);
    expect(globalThis.location.pathname).toBe("/");
    expect(globalThis.history.state?.view).toBe("home");
  });
});
