// @vitest-environment jsdom
//
// Voltar do aparelho depois de finalizar o pedido NÃO pode abrir o checkout
// vazio. O histórico da compra fica [carrinho, checkout, guarda do envio (também
// /checkout), pedidos]; o Voltar a partir de "Meus pedidos" pousa na guarda, o
// App lia só o endereço e montava a tela "Finalizar compra" inteira — formulário,
// sem itens, sem resumo, com o botão apagado e sem explicar por quê.
//
// Agora, quem CHEGA ao checkout pelo histórico (popstate, vindo de outra tela)
// com o carrinho vazio e sem pedido a retomar é levada ao carrinho, trocando a
// entrada do histórico (replaceState: nenhuma entrada nova). Ficam de fora, e
// provados aqui como controle: carrinho com itens, pagamento retomado, quem já
// está dentro do checkout (a guarda do envio desfaz sem expulsar da tela de
// pagamento/sucesso) e a recarga da página no endereço /checkout.
//
// App inteiro, só as pontas dubladas (harness de
// app-endereco-desconhecido-volta-para-a-home).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Carrinho do dublê: um armazém de verdade (useSyncExternalStore), para o teste
// esvaziar o carrinho DEPOIS da tela montada, como o sucesso do pedido faz.
const carrinho = vi.hoisted(() => {
  let itens: { id: string; quantity: number }[] = [];
  const ouvintes = new Set<() => void>();
  return {
    ler: () => itens,
    gravar: (novos: { id: string; quantity: number }[]) => {
      itens = novos;
      for (const ouvinte of ouvintes) ouvinte();
    },
    assinar: (ouvinte: () => void) => {
      ouvintes.add(ouvinte);
      return () => {
        ouvintes.delete(ouvinte);
      };
    },
  };
});

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
// Carrinho e "Meus pedidos" são a mesma tela no App (`initialTab`).
vi.mock("@/views/customer/CartView", () => ({
  CartView: ({
    initialTab,
    onNavigate,
  }: {
    readonly initialTab: string;
    readonly onNavigate: (view: string) => void;
  }) => (
    <div data-testid="tela-carrinho" data-aba={initialTab}>
      <button
        type="button"
        data-testid="ir-ao-checkout"
        onClick={() => onNavigate("checkout")}
      >
        Finalizar compra
      </button>
    </div>
  ),
}));
vi.mock("@/views/customer/CheckoutView", () => ({
  CheckoutView: ({
    retomarPedidoId,
  }: {
    readonly retomarPedidoId?: string;
  }) => (
    <div data-testid="tela-checkout" data-retomada={retomarPedidoId ?? ""} />
  ),
}));
vi.mock("@/views/customer/OrderDetailsView", () => ({
  OrderDetailsView: ({
    onRetomarPagamento,
  }: {
    readonly onRetomarPagamento: (pedidoId: string) => void;
  }) => (
    <button
      type="button"
      data-testid="retomar-pagamento"
      onClick={() => onRetomarPagamento("pedido-7")}
    >
      Retomar pagamento
    </button>
  ),
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
vi.mock("@/contexts/CartContext", async () => {
  const React = await import("react");
  const useCartState = () => {
    const cart = React.useSyncExternalStore(carrinho.assinar, carrinho.ler);
    return { cart, cartCount: cart.length };
  };
  return {
    CartProvider: ({ children }: { readonly children?: unknown }) =>
      children as never,
    useCartState,
    useCartActions: () => ({ addToCart: () => {} }),
    useCartContext: () => ({ cartCount: 0, addToCart: () => {} }),
  };
});
vi.mock("@/contexts/FavoritesContext", () => ({
  FavoritesProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
}));

vi.mock("@/hooks/useCart", async () => {
  const React = await import("react");
  const useCartState = () => {
    const cart = React.useSyncExternalStore(carrinho.assinar, carrinho.ler);
    return { cart, cartCount: cart.length };
  };
  return {
    useCart: () => ({ cartCount: 0, addToCart: () => {} }),
    useCartState,
    useCartActions: () => ({ addToCart: () => {} }),
  };
});
const mockUser = { id: "cliente-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    isAdmin: false,
    adminStatus: "not-admin",
    loading: false,
    isPasswordRecovery: false,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [], loading: false }),
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
vi.mock("@/hooks/usePrefetchOnHover", () => {
  // Estável de propósito: o hook real devolve funções estáveis.
  const api = {
    prefetchView: () => {},
    prefetchAll: () => {},
    prefetchViewPromise: () => Promise.resolve(),
  };
  return { usePrefetchOnHover: () => api };
});
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

const UM_ITEM = [{ id: "produto-A", quantity: 1 }];

describe("Voltar depois de finalizar o pedido não abre o checkout vazio", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    carrinho.gravar([]);
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
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

  const esperarAte = async (
    condicao: () => boolean,
    { timeoutMs = 10000, passoMs = 10 } = {},
  ) => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, passoMs));
      });
    }
  };

  const checkout = () =>
    container?.querySelector<HTMLElement>('[data-testid="tela-checkout"]') ??
    null;
  const carrinhoNaTela = () =>
    container?.querySelector<HTMLElement>('[data-testid="tela-carrinho"]') ??
    null;
  const rota = () => globalThis.location.pathname + globalThis.location.search;

  const montar = async (
    pilha: ReadonlyArray<{ caminho: string; estado: Record<string, unknown> }>,
  ) => {
    pilha.forEach(({ caminho, estado }, i) => {
      if (i === 0) globalThis.history.replaceState(estado, "", caminho);
      else globalThis.history.pushState(estado, "", caminho);
    });
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };

  const clicar = async (testId: string) => {
    const botao = container?.querySelector<HTMLButtonElement>(
      `[data-testid="${testId}"]`,
    );
    if (!botao) throw new Error(`botão ${testId} não encontrado`);
    await act(async () => {
      botao.click();
    });
    await assentar();
  };

  const voltarDoAparelho = async () => {
    await act(async () => {
      globalThis.history.back();
    });
    await assentar(20);
  };

  const avancarDoAparelho = async () => {
    await act(async () => {
      globalThis.history.forward();
    });
    await assentar(20);
  };

  const CARRINHO = { caminho: "/cart", estado: { view: "cart" } };
  const CHECKOUT = {
    caminho: "/checkout",
    estado: { view: "checkout", from: "cart" },
  };
  // A guarda que o CheckoutView empurra enquanto o pedido é enviado: mesma URL.
  const GUARDA = {
    caminho: "/checkout",
    estado: { view: "checkout", from: "cart" },
  };

  it("Voltar de 'Meus pedidos' depois do pedido: vai ao carrinho, sem abrir o checkout vazio", async () => {
    await montar([
      CARRINHO,
      CHECKOUT,
      GUARDA,
      { caminho: "/orders", estado: { view: "orders", from: "checkout" } },
    ]);
    expect(carrinhoNaTela()?.getAttribute("data-aba")).toBe("orders");
    expect(checkout()).toBeNull();
    const entradasAntes = globalThis.history.length;

    await voltarDoAparelho();

    // Antes da correção: a tela "Finalizar compra" montava vazia.
    expect(checkout()).toBeNull();
    expect(rota()).toBe("/cart");
    expect(carrinhoNaTela()?.getAttribute("data-aba")).toBe("cart");
    // Trocou a entrada da guarda: nenhuma entrada nova no histórico.
    expect(globalThis.history.length).toBe(entradasAntes);
  });

  it("Voltar da Home depois do pedido: mesmo resultado", async () => {
    await montar([
      CARRINHO,
      CHECKOUT,
      GUARDA,
      { caminho: "/", estado: { view: "home", trap: true } },
    ]);
    expect(container?.querySelector('[data-testid="home"]')).not.toBeNull();

    await voltarDoAparelho();

    expect(checkout()).toBeNull();
    expect(rota()).toBe("/cart");
    expect(carrinhoNaTela()?.getAttribute("data-aba")).toBe("cart");
  });

  it("controle: com itens no carrinho, o Voltar até o checkout abre o checkout", async () => {
    carrinho.gravar(UM_ITEM);
    await montar([
      CARRINHO,
      CHECKOUT,
      { caminho: "/orders", estado: { view: "orders", from: "checkout" } },
    ]);
    expect(checkout()).toBeNull();

    await voltarDoAparelho();

    expect(checkout()).not.toBeNull();
    expect(rota()).toBe("/checkout");
  });

  it("controle: pagamento retomado segue abrindo o checkout, mesmo com o carrinho vazio", async () => {
    await montar([
      {
        caminho: "/order-details?id=pedido-7",
        estado: { view: "order-details", id: "pedido-7", from: "orders" },
      },
    ]);
    await clicar("retomar-pagamento");
    expect(checkout()?.getAttribute("data-retomada")).toBe("pedido-7");

    // Sai do checkout para o pedido e volta pelo histórico: a retomada vale.
    await voltarDoAparelho();
    expect(checkout()).toBeNull();
    await avancarDoAparelho();

    expect(checkout()).not.toBeNull();
    expect(checkout()?.getAttribute("data-retomada")).toBe("pedido-7");
    expect(rota()).toBe("/checkout");
  });

  it("controle: quem já está no checkout não é expulsa quando o carrinho esvazia e a guarda do envio desfaz", async () => {
    carrinho.gravar(UM_ITEM);
    await montar([CARRINHO]);
    await clicar("ir-ao-checkout");
    expect(checkout()).not.toBeNull();
    // A guarda do envio, e então o pedido passa: o carrinho esvazia na própria
    // tela de sucesso.
    globalThis.history.pushState(GUARDA.estado, "", GUARDA.caminho);
    await act(async () => {
      carrinho.gravar([]);
    });
    await assentar();

    await voltarDoAparelho();

    expect(checkout()).not.toBeNull();
    expect(rota()).toBe("/checkout");
  });

  it("controle: recarregar a página em /checkout com o carrinho vazio segue como antes", async () => {
    await montar([CHECKOUT]);
    await esperarAte(() => checkout() !== null);
    expect(rota()).toBe("/checkout");
  });
});
