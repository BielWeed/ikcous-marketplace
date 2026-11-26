// @vitest-environment jsdom
//
// A cliente que chega por link de produto (anúncio, Instagram) esperava o
// CATÁLOGO INTEIRO carregar antes de ver o produto: o catálogo é lido em
// páginas de 200 em fila e a tela do produto só se resolvia com
// `productsLoading` falso -- com milhares de produtos, dezenas de segundos de
// esqueleto em 4G. Agora o produto do link é lido SOZINHO (a mesma consulta
// pública da vitrine, com as variações) enquanto o catálogo continua
// carregando; quando o catálogo chega, a tela passa a usar a versão dele sem
// remontar (a variação e a quantidade escolhidas ficam).
// "Não existe" (consulta respondeu vazio) continua indo para a Home com aviso;
// falha de rede continua sendo "Não conseguimos carregar".
// Harness igual ao de app-link-de-produto-em-rede-lenta, com a consulta do
// produto controlada pelo teste (responde quando o teste manda).
import { act, useEffect } from "react";
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
  HomeView: () => <div data-testid="home" />,
}));
// A tela do produto mostra nome e preço do que recebeu e conta as próprias
// montagens: remontar perderia a variação e a quantidade escolhidas.
vi.mock("@/views/customer/ProductView", () => ({
  ProductView: ({
    product,
  }: {
    readonly product: { name: string; price: number };
  }) => {
    useEffect(() => {
      catalogo.montagensDaTela += 1;
    }, []);
    return (
      <div data-testid="tela-produto">
        <span data-testid="nome">{product.name}</span>
        <span data-testid="preco">{product.price}</span>
      </div>
    );
  },
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
  const { useCallback, useEffect: useEfeito, useState } = await import("react");
  return {
    StoreProvider: ({ children }: { readonly children?: unknown }) =>
      children as never,
    useStore: () => {
      const [, atualizar] = useState(0);
      useEfeito(() => {
        const redesenhar = () => atualizar((v) => v + 1);
        catalogo.redesenhos.add(redesenhar);
        return () => {
          catalogo.redesenhos.delete(redesenhar);
        };
      }, []);
      const incluirProduto = useCallback((produto: { id: string }) => {
        catalogo.incluidos.push(produto.id);
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
    isAdmin: catalogo.adminStatus === "admin",
    adminStatus: catalogo.adminStatus,
    loading: false,
    isPasswordRecovery: false,
  }),
}));
type RespostaDoProduto = { data: unknown; error: unknown };
const catalogo = vi.hoisted(() => ({
  products: [] as { id: string; name?: string; price?: number }[],
  // O `loading` do useProducts: o catálogo ainda está lendo as páginas.
  carregando: true,
  consultasDoProduto: 0,
  // Cada consulta do produto fica pendente até o teste chamar `responder`.
  pendentes: [] as ((resposta: RespostaDoProduto) => void)[],
  avisos: [] as string[],
  incluidos: [] as string[],
  montagensDaTela: 0,
  adminStatus: "not-admin" as "unknown" | "admin" | "not-admin",
  redesenhos: new Set<() => void>(),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: catalogo.products,
    loading: catalogo.carregando,
    fetchProducts: () => {},
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
    return new Promise<RespostaDoProduto>((resolver) => {
      catalogo.pendentes.push(resolver);
    });
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

const ID = "ab12cd34-0000-4000-8000-00000000abcd";
// Linha como a `vw_produtos_public` devolve (com as variações embutidas).
const LINHA_DO_BANCO = {
  id: ID,
  name: "Vestido Azul",
  price: 129.9,
  ativo: true,
  product_variants: [],
};

describe("link de produto abre sem esperar o catálogo inteiro", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    catalogo.products = [];
    catalogo.carregando = true;
    catalogo.consultasDoProduto = 0;
    catalogo.pendentes = [];
    catalogo.avisos = [];
    catalogo.incluidos = [];
    catalogo.montagensDaTela = 0;
    catalogo.adminStatus = "not-admin";
    catalogo.redesenhos.clear();
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
    globalThis.history.replaceState(null, "", "/");
  });

  const assentar = async (voltas = 10) => {
    for (let i = 0; i < voltas; i++) {
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };

  // Abre o app JÁ no endereço do produto (o link do anúncio).
  const abrirNoLink = async (id: string) => {
    globalThis.history.replaceState(null, "", `/product-detail?id=${id}`);
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar(20);
  };
  // Responde TODAS as consultas do produto em espera.
  const responder = async (resposta: RespostaDoProduto) => {
    const emEspera = catalogo.pendentes;
    catalogo.pendentes = [];
    for (const resolver of emEspera) resolver(resposta);
    await assentar();
  };
  // O catálogo termina de ler as páginas e chega à tela.
  const catalogoChega = async (
    produtos: { id: string; name?: string; price?: number }[],
  ) => {
    catalogo.products = produtos;
    catalogo.carregando = false;
    await act(async () => {
      for (const redesenhar of catalogo.redesenhos) redesenhar();
    });
    await assentar();
  };
  const telaDoProduto = () =>
    container?.querySelector('[data-testid="tela-produto"]') ?? null;
  const texto = (testid: string) =>
    container?.querySelector(`[data-testid="${testid}"]`)?.textContent ?? null;
  const caminho = () =>
    globalThis.location.pathname + globalThis.location.search;

  it("catálogo ainda carregando: o produto do link aparece com nome e preço, lido sozinho", async () => {
    await abrirNoLink(ID);

    // A consulta do produto sai sem esperar o catálogo.
    expect(catalogo.consultasDoProduto).toBe(1);
    expect(container?.textContent).toContain("Carregando produto");

    await responder({ data: LINHA_DO_BANCO, error: null });

    expect(telaDoProduto()).not.toBeNull();
    expect(texto("nome")).toBe("Vestido Azul");
    expect(texto("preco")).toBe("129.9");
    expect(container?.textContent).not.toContain("Carregando produto");
    expect(caminho()).toContain(ID);
    expect(catalogo.avisos).toEqual([]);
  });

  it("quando o catálogo chega, a tela passa à versão dele SEM remontar e sem nova consulta", async () => {
    await abrirNoLink(ID);
    await responder({ data: LINHA_DO_BANCO, error: null });
    expect(catalogo.montagensDaTela).toBe(1);

    // A versão do catálogo (preço atualizado no meio do caminho) vence.
    await catalogoChega([
      { id: "outro-produto", name: "Outro", price: 10 },
      { id: ID, name: "Vestido Azul", price: 119.9 },
    ]);

    expect(texto("preco")).toBe("119.9");
    expect(catalogo.montagensDaTela).toBe(1);
    expect(catalogo.consultasDoProduto).toBe(1);
    expect(catalogo.avisos).toEqual([]);
  });

  it("produto que não existe: Home com o aviso só DEPOIS que a consulta responde vazio", async () => {
    await abrirNoLink(ID);

    // Antes da resposta: esqueleto, link intacto, nenhum aviso.
    expect(container?.textContent).toContain("Carregando produto");
    expect(caminho()).toContain(ID);
    expect(catalogo.avisos).toEqual([]);

    await responder({
      data: null,
      error: { message: "sem linha", code: "PGRST116" },
    });

    expect(telaDoProduto()).toBeNull();
    expect(caminho()).toBe("/");
    expect(catalogo.avisos).toEqual(["Este produto não está mais disponível."]);
  });

  it("falha de rede na consulta com o catálogo carregando: 'Não conseguimos carregar', nunca a Home", async () => {
    await abrirNoLink(ID);

    await responder({
      data: null,
      error: { message: "Failed to fetch", code: "" },
    });

    expect(container?.textContent).toContain(
      "Não conseguimos carregar este produto",
    );
    expect(caminho()).toContain(ID);
    expect(catalogo.avisos).toEqual([]);
  });

  it("lojista (catálogo do painel mostra pausados): resposta vazia da consulta pública NÃO expulsa enquanto o catálogo carrega", async () => {
    catalogo.adminStatus = "admin";
    await abrirNoLink(ID);

    await responder({
      data: null,
      error: { message: "sem linha", code: "PGRST116" },
    });

    expect(caminho()).toContain(ID);
    expect(catalogo.avisos).toEqual([]);
    expect(container?.textContent).toContain("Carregando produto");

    // O catálogo do painel traz o produto pausado: ele abre.
    await catalogoChega([{ id: ID, name: "Vestido Azul", price: 129.9 }]);
    expect(telaDoProduto()).not.toBeNull();
    expect(catalogo.avisos).toEqual([]);
  });

  it("produto pausado DURANTE a leitura do catálogo: catálogo chega sem ele, a consulta confirma e vai para a Home", async () => {
    await abrirNoLink(ID);
    await responder({ data: LINHA_DO_BANCO, error: null });
    expect(telaDoProduto()).not.toBeNull();

    await catalogoChega([{ id: "outro-produto", name: "Outro", price: 10 }]);
    // A cópia do link não vale mais que o catálogo: confere de novo.
    expect(catalogo.consultasDoProduto).toBe(2);

    await responder({
      data: null,
      error: { message: "sem linha", code: "PGRST116" },
    });

    expect(telaDoProduto()).toBeNull();
    expect(caminho()).toBe("/");
    expect(catalogo.avisos).toEqual(["Este produto não está mais disponível."]);
  });
});
