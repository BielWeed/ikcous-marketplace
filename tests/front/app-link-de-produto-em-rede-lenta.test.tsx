// @vitest-environment jsdom
//
// Link de produto compartilhado aberto com a rede PENDURADA (conecta e não
// responde, sem erro): a checagem "esse produto existe?" não tinha prazo e a
// tela ficava BRANCA para sempre, sem aviso e sem botão. Agora (a) a consulta
// do produto tem prazo, (b) enquanto o catálogo/a sessão carregam aparece um
// esqueleto "Carregando produto…" em vez de nada, (c) se a espera passa do
// razoável a tela "Não conseguimos carregar este produto" aparece com "Tentar
// de novo" e "Voltar à loja".
// Mocks iguais aos de app-link-de-produto-sem-rede-nao-vai-para-a-home, com
// `carregando` (catálogo ainda lendo) e `consultaPendurada` (nunca responde).
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
      <button
        type="button"
        data-testid="produto-inexistente"
        onClick={() => onProductClick("produto-Z")}
      >
        Produto inexistente
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
    info: (texto: string) => {
      catalogo.avisos.push(texto);
    },
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

vi.mock("@/contexts/StoreContext", async () => {
  const { useCallback, useState } = await import("react");
  return {
    StoreProvider: ({ children }: { readonly children?: unknown }) =>
      children as never,
    useStore: () => {
      const [, atualizar] = useState(0);
      const incluirProduto = useCallback((produto: { id: string }) => {
        if (!catalogo.products.some((p) => p.id === produto.id)) {
          catalogo.products = [...catalogo.products, produto];
          atualizar((v) => v + 1);
        }
      }, []);
      return { config: null, incluirProduto };
    },
  };
});
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
const catalogo = vi.hoisted(() => ({
  products: [{ id: "produto-A" }] as { id: string }[],
  fetchProducts: () => {},
  // O que a checagem `vw_produtos_public ... .single()` devolve agora.
  respostaDoProduto: {
    data: null as unknown,
    error: null as unknown,
  } as { data: unknown; error: unknown },
  consultasDoProduto: 0,
  // Textos que o App mandou para `toast.info` (o aviso que a cliente vê).
  avisos: [] as string[],
  // Catálogo ainda sendo lido (o `loading` do useProducts).
  carregando: false,
  // A consulta do produto conecta e nunca responde (rede pendurada).
  consultaPendurada: false,
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: catalogo.products,
    loading: catalogo.carregando,
    fetchProducts: () => catalogo.fetchProducts(),
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
  consulta.single = () => {
    catalogo.consultasDoProduto += 1;
    if (catalogo.consultaPendurada) return new Promise(() => {});
    return Promise.resolve(catalogo.respostaDoProduto);
  };
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

describe("link de produto compartilhado em rede lenta", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    catalogo.products = [{ id: "produto-A" }];
    catalogo.fetchProducts = () => {};
    catalogo.consultasDoProduto = 0;
    catalogo.avisos = [];
    catalogo.carregando = false;
    catalogo.consultaPendurada = false;
    catalogo.respostaDoProduto = { data: null, error: null };
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
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

    globalThis.history.replaceState(null, "", "/");

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
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const avancar = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  };

  const abrirOProdutoDoLink = async () => {
    const achar = () =>
      container?.querySelector<HTMLButtonElement>(
        '[data-testid="produto-inexistente"]',
      );
    // O App carrega telas por import dinâmico (tempo REAL): espera a Home com
    // o relógio de verdade e só então liga o relógio falso.
    await act(async () => {
      raiz?.render(<App />);
    });
    for (let volta = 0; volta < 100 && !achar(); volta++) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
    }
    vi.useFakeTimers();
    const botaoDoProduto = achar();
    if (!botaoDoProduto) {
      throw new Error("botão produto-inexistente não encontrado");
    }
    await act(async () => {
      botaoDoProduto.click();
    });
    await avancar(50);
  };

  const botao = (texto: string) =>
    Array.from(container?.querySelectorAll("button") ?? []).find((b) =>
      b.textContent?.includes(texto),
    );
  const esqueleto = () =>
    container?.querySelector('[aria-busy="true"]') ?? null;
  const caminho = () =>
    globalThis.location.pathname + globalThis.location.search;

  it("consulta do produto pendurada: esqueleto no começo, e depois do prazo a tela com 'Tentar de novo' e 'Voltar à loja'", async () => {
    catalogo.consultaPendurada = true;
    await abrirOProdutoDoLink();

    expect(catalogo.consultasDoProduto).toBe(1);
    expect(esqueleto()).not.toBeNull();
    expect(container?.textContent).toContain("Carregando produto");
    expect(container?.textContent).not.toContain("Não conseguimos carregar");

    await avancar(13_000);

    expect(container?.textContent).toContain(
      "Não conseguimos carregar este produto",
    );
    expect(botao("Tentar de novo")).toBeDefined();
    expect(botao("Voltar à loja")).toBeDefined();
    expect(esqueleto()).toBeNull();
    // falha de rede nunca vira "o produto não existe": o link fica
    expect(caminho()).toContain("produto-Z");
    expect(catalogo.avisos).toEqual([]);
  });

  it("catálogo que nunca termina de carregar: esqueleto, e passado o prazo a tela de falha (não fica em branco)", async () => {
    catalogo.carregando = true;
    await abrirOProdutoDoLink();

    expect(catalogo.consultasDoProduto).toBe(0);
    expect(esqueleto()).not.toBeNull();
    expect(container?.textContent).toContain("Carregando produto");

    await avancar(16_000);

    expect(container?.textContent).toContain(
      "Não conseguimos carregar este produto",
    );
    expect(botao("Tentar de novo")).toBeDefined();
    expect(botao("Voltar à loja")).toBeDefined();
  });

  it("'Voltar à loja' leva à Home", async () => {
    catalogo.consultaPendurada = true;
    await abrirOProdutoDoLink();
    await avancar(13_000);

    await act(async () => {
      botao("Voltar à loja")?.click();
    });
    await avancar(500);

    expect(container?.querySelector('[data-testid="home"]')).not.toBeNull();
    expect(caminho()).toBe("/");
    expect(container?.textContent).not.toContain("Não conseguimos carregar");
  });

  it("'Tentar de novo' volta ao esqueleto, consulta outra vez e, pendurando de novo, volta a avisar", async () => {
    catalogo.consultaPendurada = true;
    await abrirOProdutoDoLink();
    await avancar(13_000);
    expect(catalogo.consultasDoProduto).toBe(1);

    await act(async () => {
      botao("Tentar de novo")?.click();
    });
    await avancar(50);

    expect(catalogo.consultasDoProduto).toBe(2);
    expect(esqueleto()).not.toBeNull();

    await avancar(13_000);
    expect(container?.textContent).toContain(
      "Não conseguimos carregar este produto",
    );
  });

  it("rede lenta que ainda responde dentro do prazo: abre o produto, sem tela de falha", async () => {
    catalogo.consultaPendurada = false;
    catalogo.respostaDoProduto = { data: { id: "produto-Z" }, error: null };
    await abrirOProdutoDoLink();
    await avancar(500);

    expect(
      container?.querySelector('[data-testid="tela-produto"]'),
    ).not.toBeNull();
    expect(container?.textContent).not.toContain("Não conseguimos carregar");
  });
});
