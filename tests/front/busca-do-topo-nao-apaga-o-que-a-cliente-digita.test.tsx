// @vitest-environment jsdom
//
// A busca do topo fica visivel em todas as telas, mas so a Home filtra a
// lista. Fora dela (num produto, no carrinho), 150 ms depois de a cliente
// parar de digitar o campo ESVAZIAVA sozinho e nada acontecia: o App zerava o
// termo sempre que ele mudava fora da Home, e a barra copiava o vazio de volta.
// Agora: buscar fora da Home leva a cliente a Home ja com o termo (uma entrada
// de historico so, nao uma por letra); trocar de tela SEM buscar limpa como
// antes.
//
// Aqui o App roda de verdade, com a SearchBar de verdade no lugar do Header.
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
    searchQuery,
    onNavigate,
    onProductClick,
  }: {
    readonly searchQuery: string;
    readonly onNavigate: (view: string) => void;
    readonly onProductClick: (id: string) => void;
  }) => (
    <div data-testid="home" data-busca={searchQuery}>
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
// O Header de verdade e pesado; o que importa aqui e' a SearchBar de verdade,
// ligada nas MESMAS props que o App passa ao Header.
vi.mock("@/components/ui/custom/Header", async () => {
  const { SearchBar } = await import("@/components/ui/custom/SearchBar");
  return {
    Header: ({
      searchQuery,
      onSearch,
      hideSearch,
    }: {
      readonly searchQuery?: string;
      readonly onSearch?: (query: string) => void;
      readonly hideSearch?: boolean;
    }) =>
      hideSearch ? null : (
        <SearchBar
          value={searchQuery ?? ""}
          onChange={onSearch ?? (() => {})}
        />
      ),
  };
});
vi.mock("@/components/ui/custom/BottomNav", () => ({
  BottomNav: () => null,
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
  useAuth: () => ({
    user: null,
    isAdmin: false,
    adminStatus: "not-admin",
    loading: false,
    isPasswordRecovery: false,
  }),
}));
// Referencia ESTAVEL: a SearchBar tem efeitos que dependem de `products`.
const catalogo = vi.hoisted(() => [
  {
    id: "produto-A",
    name: "Vestido Azul",
    description: "",
    category: "Vestidos",
    price: 100,
    images: [],
    stock: 5,
    sold: 0,
    isActive: true,
    isBestseller: false,
    freeShipping: false,
  },
]);
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: catalogo, loading: false }),
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
    // A troca de tela espera o pedaco de codigo da tela: aqui ele demora 40 ms,
    // como num celular lento. E' nessa janela, com o termo ja digitado e a
    // tela ainda a antiga, que uma limpeza presa ao TERMO (e nao a troca de
    // tela) apagaria o campo.
    prefetchViewPromise: () =>
      new Promise<void>((resolve) => setTimeout(resolve, 40)),
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

describe("a busca do topo nao apaga o que a cliente digita fora da Home", () => {
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  // Espera de RELOGIO, FORA do `act`: dentro de um `act` assincrono o React
  // segura todas as atualizacoes ate o fim da espera e junta tudo num render
  // so -- o tempo em que o termo ja existe e a tela ainda e a antiga some, e o
  // teste nao enxerga a limpeza precoce que e' o defeito.
  const esperar = async (ms: number) => {
    // @ts-expect-error — bandeira interna do React para o `act`
    globalThis.IS_REACT_ACT_ENVIRONMENT = false;
    try {
      await new Promise((resolve) => setTimeout(resolve, ms));
    } finally {
      // @ts-expect-error — bandeira interna do React para o `act`
      globalThis.IS_REACT_ACT_ENVIRONMENT = true;
    }
    await act(async () => {});
  };
  const assentar = async (voltas = 10) => {
    for (let i = 0; i < voltas; i++) {
      await act(async () => {
        await Promise.resolve();
        await new Promise((resolve) => setTimeout(resolve, 0));
      });
    }
  };
  const abrir = async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };
  const clicar = async (marca: string) => {
    const botao = container?.querySelector<HTMLButtonElement>(
      `[data-testid="${marca}"]`,
    );
    if (!botao) throw new Error(`botão ${marca} não encontrado`);
    await act(async () => {
      botao.click();
    });
    await assentar();
  };
  const campo = () => {
    const input = container?.querySelector<HTMLInputElement>(
      'input[name="search"]',
    );
    if (!input) throw new Error("campo de busca não encontrado");
    return input;
  };
  const digitar = async (texto: string) => {
    const setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      campo().focus();
      setter?.call(campo(), texto);
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
  };
  /** Digita e espera mais que os 150 ms em que a barra repassa o termo. */
  const digitarEEsperar = async (texto: string) => {
    await digitar(texto);
    await esperar(300);
    await assentar();
  };
  const termoDaHome = () =>
    container
      ?.querySelector('[data-testid="home"]')
      ?.getAttribute("data-busca");
  const caminho = () => globalThis.location.pathname;

  it("no carrinho, o termo NAO some e a cliente cai na Home com ele", async () => {
    await abrir();
    await clicar("carrinho");
    expect(caminho()).toBe("/cart");

    await digitarEEsperar("vestido");

    expect(campo().value).toBe("vestido");
    expect(caminho()).toBe("/");
    expect(termoDaHome()).toBe("vestido");
  });

  it("no produto, o termo NAO some e a cliente cai na Home com ele", async () => {
    await abrir();
    await clicar("produto");
    expect(caminho()).toBe("/product-detail");

    await digitarEEsperar("vestido");

    expect(campo().value).toBe("vestido");
    expect(caminho()).toBe("/");
    expect(termoDaHome()).toBe("vestido");
  });

  it("apertar Enter fora da Home tambem leva a Home com o termo", async () => {
    await abrir();
    await clicar("carrinho");

    await digitar("vestido");
    await act(async () => {
      campo().dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    await assentar();

    expect(caminho()).toBe("/");
    expect(termoDaHome()).toBe("vestido");
  });

  it("na Home o termo continua valendo e a Home nao navega", async () => {
    await abrir();
    const empurrar = vi.spyOn(globalThis.history, "pushState");

    await digitarEEsperar("vestido");

    expect(campo().value).toBe("vestido");
    expect(termoDaHome()).toBe("vestido");
    expect(caminho()).toBe("/");
    expect(empurrar).not.toHaveBeenCalled();
  });

  it("digitar letra por letra fora da Home cria UMA entrada de historico, nao uma por termo", async () => {
    await abrir();
    await clicar("carrinho");
    const empurrar = vi.spyOn(globalThis.history, "pushState");

    await digitarEEsperar("ve");
    await digitarEEsperar("ves");
    await digitarEEsperar("vest");
    await digitarEEsperar("vesti");

    expect(termoDaHome()).toBe("vesti");
    expect(campo().value).toBe("vesti");
    expect(empurrar).toHaveBeenCalledTimes(1);
  });

  it("campo so com espacos fora da Home nao navega para lugar nenhum", async () => {
    await abrir();
    await clicar("carrinho");
    await digitar("   ");
    await esperar(300);
    await assentar();

    expect(caminho()).toBe("/cart");
  });

  it("trocar de tela SEM buscar limpa a busca, como antes", async () => {
    await abrir();
    await digitarEEsperar("vestido");
    expect(termoDaHome()).toBe("vestido");

    await clicar("carrinho");

    expect(caminho()).toBe("/cart");
    expect(campo().value).toBe("");
    expect(termoDaHome()).toBe("");
  });

  it("sair da Home para o produto tambem limpa", async () => {
    await abrir();
    await digitarEEsperar("vestido");

    await clicar("produto");

    expect(caminho()).toBe("/product-detail");
    expect(campo().value).toBe("");
  });
});
