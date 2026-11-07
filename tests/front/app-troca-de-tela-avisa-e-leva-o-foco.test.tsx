// @vitest-environment jsdom
//
// Auditoria de acessibilidade (06/11/2026): ao trocar de tela o leitor de tela
// não ouvia nada e o foco ficava perdido (a tela antiga some; o foco cai no
// <body>). Agora uma região fixa e invisível diz o nome da tela nova e o foco
// vai para o <main> -- sem roubar o foco de quem está digitando, nem da barra
// de baixo (quem toca nas abas segue de aba em aba).
//
// Mesmo cenário-base de app-endereco-desconhecido-volta-para-a-home (App
// inteiro, só as pontas dubladas).
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
// O portão de acesso é dublado; navegação, foco e aviso vêm do App real.
// O destino interno é o mesmo elemento focável exposto pelo AdminLayout.
vi.mock("@/components/layouts/AdminAreaGate", () => ({
  AdminAreaGate: ({
    currentView,
    onNavigate,
    setIsAdminDirty,
  }: {
    currentView: string;
    onNavigate: (view: string) => void;
    setIsAdminDirty: (dirty: boolean) => void;
  }) => (
    <div data-testid="painel" data-view={currentView}>
      <nav>
        <button
          type="button"
          data-testid="menu-clientes"
          onClick={() => onNavigate("admin-customers")}
        >
          Clientes
        </button>
      </nav>
      <main id="conteudo-do-painel" tabIndex={-1}>
        <input data-testid="campo-do-painel" />
        <button
          type="button"
          data-testid="ficha-cliente"
          onClick={() => onNavigate("admin-user-detail")}
        >
          Abrir ficha
        </button>
        <button
          type="button"
          data-testid="voltar-clientes"
          onClick={() => onNavigate("admin-customers")}
        >
          Voltar
        </button>
        <button
          type="button"
          data-testid="sujar-painel"
          onClick={() => setIsAdminDirty(true)}
        >
          Editar
        </button>
      </main>
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
// A busca do topo continua montada ao trocar de tela: é o campo de texto que
// pode estar com o foco no meio da troca.
vi.mock("@/components/ui/custom/Header", () => ({
  Header: () => <input data-testid="busca-do-topo" aria-label="Buscar" />,
}));
vi.mock("@/components/ui/custom/BottomNav", () => ({
  BottomNav: ({
    onNavigate,
  }: { readonly onNavigate: (view: string) => void }) => (
    <nav aria-label="Navegação principal">
      <button
        type="button"
        data-testid="aba-inicio"
        onClick={() => onNavigate("home")}
      >
        Início
      </button>
      <button
        type="button"
        data-testid="aba-carrinho"
        onClick={() => onNavigate("cart")}
      >
        Carrinho
      </button>
    </nav>
  ),
}));
vi.mock("@/components/ui/custom/CartReminder", () => ({
  CartReminder: () => null,
}));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("sonner", () => ({
  toast: Object.assign(() => {}, {
    error: () => {},
    success: vi.fn(),
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
const estadoDoLink = vi.hoisted(() => ({
  vencido: false,
  confirmacaoVencida: false,
  admin: false,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: estadoDoLink.admin ? { id: "lojista-ficticio" } : null,
    isAdmin: estadoDoLink.admin,
    adminStatus: estadoDoLink.admin ? "admin" : "not-admin",
    loading: false,
    isPasswordRecovery: false,
    linkDeRecuperacaoVencido: estadoDoLink.vencido,
    linkDeConfirmacaoVencido: estadoDoLink.confirmacaoVencida,
  }),
}));
vi.mock("@/views/shared/AuthView", () => ({
  AuthView: () => <div data-testid="tela-auth" />,
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
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: catalogo.products,
    loading: false,
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
import { toast } from "sonner";

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

describe("App — trocar de tela avisa em voz alta e leva o foco", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    catalogo.products = [{ id: "produto-A" }];
    catalogo.fetchProducts = () => {};
    estadoDoLink.vencido = false;
    estadoDoLink.confirmacaoVencida = false;
    estadoDoLink.admin = false;
    vi.mocked(toast.success).mockClear();
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    globalThis.history.replaceState(null, "", "/");
  });

  const assentar = async (voltas = 20) => {
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
  const principal = () =>
    container?.querySelector<HTMLElement>("main#conteudo") ?? null;
  const aviso = () =>
    container?.querySelector<HTMLElement>(
      '[role="status"][aria-live="polite"].sr-only',
    ) ?? null;
  const tocar = async (testid: string, comFoco = false) => {
    const botao = container?.querySelector<HTMLButtonElement>(
      `[data-testid="${testid}"]`,
    );
    expect(botao, testid).not.toBeNull();
    if (comFoco) botao?.focus();
    await act(async () => {
      botao?.click();
    });
    await assentar();
  };

  it("a região de aviso fica fora do <main> e começa com o nome da tela de entrada, sem puxar o foco", async () => {
    await abrir();
    expect(aviso()).not.toBeNull();
    expect(principal()?.contains(aviso())).toBe(false);
    expect(aviso()?.textContent).toBe("Início");
    expect(document.activeElement).not.toBe(principal());
  });

  it("Home -> Carrinho por um botão da tela: o aviso diz 'Carrinho' e o foco vai para o <main>", async () => {
    await abrir();
    await tocar("carrinho");
    expect(
      container?.querySelector('[data-testid="tela-carrinho"]'),
    ).not.toBeNull();
    expect(aviso()?.textContent).toBe("Carrinho");
    expect(document.activeElement).toBe(principal());
  });

  it("antes de qualquer toque (abertura direta por endereço) o foco NÃO vai para o <main>, mas o aviso é dado", async () => {
    // Chrome: userActivation.hasBeenActive é false até a pessoa tocar/teclar.
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { hasBeenActive: false, isActive: false },
    });
    try {
      await abrir();
      await tocar("carrinho");
      expect(aviso()?.textContent).toBe("Carrinho");
      expect(document.activeElement).not.toBe(principal());
    } finally {
      Reflect.deleteProperty(navigator, "userActivation");
    }
  });

  it("quem está digitando não perde o foco: a busca do topo segue focada, mas o aviso é dado", async () => {
    await abrir();
    const busca = container?.querySelector<HTMLInputElement>(
      '[data-testid="busca-do-topo"]',
    );
    busca?.focus();
    expect(document.activeElement).toBe(busca);
    await tocar("carrinho");
    expect(aviso()?.textContent).toBe("Carrinho");
    expect(document.activeElement).toBe(busca);
  });

  it("troca pela barra de baixo: o aviso é dado e o foco fica na aba tocada", async () => {
    await abrir();
    await tocar("aba-carrinho", true);
    expect(aviso()?.textContent).toBe("Carrinho");
    expect(document.activeElement).toBe(
      container?.querySelector('[data-testid="aba-carrinho"]'),
    );
  });

  const abrirPainel = async () => {
    estadoDoLink.admin = true;
    globalThis.history.replaceState(null, "", "/admin-customers");
    await abrir();
  };
  const conteudoDoPainel = () =>
    container?.querySelector<HTMLElement>("#conteudo-do-painel");
  const atalho = async (key: string, repeat = false) => {
    await act(async () => {
      globalThis.dispatchEvent(
        new KeyboardEvent("keydown", {
          key,
          ctrlKey: true,
          altKey: true,
          repeat,
          cancelable: true,
        }),
      );
    });
    await assentar();
  };

  it("painel: entrada direta anuncia Clientes, mas não puxa o foco", async () => {
    await abrirPainel();
    expect(aviso()?.textContent).toBe("Clientes");
    expect(document.activeElement).not.toBe(conteudoDoPainel());
  });

  it("painel: abrir a ficha e voltar anuncia a tela e pula a lateral", async () => {
    await abrirPainel();
    await tocar("ficha-cliente", true);
    expect(aviso()?.textContent).toBe("Ficha do cliente");
    expect(document.activeElement).toBe(conteudoDoPainel());
    await tocar("voltar-clientes", true);
    expect(aviso()?.textContent).toBe("Clientes");
    expect(document.activeElement).toBe(conteudoDoPainel());
  });

  it("painel: sem interação anterior não puxa o foco ao trocar", async () => {
    Object.defineProperty(navigator, "userActivation", {
      configurable: true,
      value: { hasBeenActive: false, isActive: false },
    });
    try {
      await abrirPainel();
      await tocar("ficha-cliente");
      expect(aviso()?.textContent).toBe("Ficha do cliente");
      expect(document.activeElement).not.toBe(conteudoDoPainel());
    } finally {
      Reflect.deleteProperty(navigator, "userActivation");
    }
  });

  it("painel: Pular para o conteúdo pula também o menu lateral", async () => {
    await abrirPainel();
    await act(async () => {
      container
        ?.querySelector<HTMLAnchorElement>('a[href="#conteudo"]')
        ?.click();
    });
    expect(document.activeElement).toBe(conteudoDoPainel());
  });

  it.each(["campo", "menu", "dialogo"])(
    "painel: preserva o foco em %s durante a troca",
    async (origem) => {
      await abrirPainel();
      let dialogo: HTMLDivElement | undefined;
      const alvo =
        origem === "campo"
          ? container?.querySelector<HTMLElement>(
              '[data-testid="campo-do-painel"]',
            )
          : origem === "menu"
            ? container?.querySelector<HTMLElement>(
                '[data-testid="menu-clientes"]',
              )
            : (dialogo = document.createElement("div"));
      if (dialogo) {
        dialogo.setAttribute("role", "dialog");
        dialogo.tabIndex = -1;
        document.body.append(dialogo);
      }
      try {
        alvo?.focus();
        await tocar("ficha-cliente");
        expect(aviso()?.textContent).toBe("Ficha do cliente");
        expect(document.activeElement).toBe(alvo);
      } finally {
        dialogo?.remove();
      }
    },
  );

  it.each(["atual", "alterações"])(
    "painel: atalho barrado por tela %s não anuncia abertura falsa",
    async (caso) => {
      await abrirPainel();
      if (caso === "alterações") await tocar("sujar-painel");
      await atalho(caso === "atual" ? "c" : "p");
      expect(
        container
          ?.querySelector('[data-testid="painel"]')
          ?.getAttribute("data-view"),
      ).toBe("admin-customers");
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    },
  );

  it("painel: tecla segurada não navega nem repete aviso; toque simples navega", async () => {
    await abrirPainel();
    await atalho("p", true);
    expect(
      container
        ?.querySelector('[data-testid="painel"]')
        ?.getAttribute("data-view"),
    ).toBe("admin-customers");
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    await atalho("p");
    expect(
      container
        ?.querySelector('[data-testid="painel"]')
        ?.getAttribute("data-view"),
    ).toBe("admin-products");
    expect(aviso()?.textContent).toBe("Produtos");
  });

  it("tela sem nome na lista (produto) esvazia o aviso", async () => {
    await abrir();
    await tocar("produto");
    expect(
      container?.querySelector('[data-testid="tela-produto"]'),
    ).not.toBeNull();
    expect(aviso()?.textContent).toBe("");
  });
});
