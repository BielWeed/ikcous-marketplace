// @vitest-environment jsdom
//
// O PIX PENDENTE SOBREVIVE À RECARGA — a metade do App (04/10/2026).
//
// O CheckoutView guarda SÓ o id do pedido em pagamento no `sessionStorage`,
// sob uma chave com o id do usuário (o CheckoutView tem teste próprio:
// checkout-retomada-recarga.test.tsx). Aqui se prova o que o App faz com
// esse registro:
//   1. Carga da página JÁ em /checkout, logado: o checkout nasce com o pedido
//      guardado como `retomarPedidoId` + `retomadaDaRecarga` — e nunca monta
//      antes, sem ele (nada de checkout vazio piscando).
//   2. Registro de OUTRO usuário na aba: não é lido.
//   3. Visitante: nada é restaurado.
//   4. Carga da página FORA do checkout: o registro da aba é apagado.
//   5. Sair do checkout (ação do cliente) apaga o registro.
//   6. Entrar num checkout NOVO (carrinho → checkout) apaga o registro.
//   7. Storage que lança: o checkout abre no fluxo normal, sem quebrar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  chaveDoPedidoPendenteDoCheckout,
  guardarPedidoPendenteDoCheckout,
  lerPedidoPendenteDoCheckout,
} from "@/lib/pedido-pendente-do-checkout";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

// Cada render do checkout, com as props que importam aqui.
const { rendersDoCheckout } = vi.hoisted(() => ({
  rendersDoCheckout: [] as Array<{
    retomarPedidoId: string | undefined;
    retomadaDaRecarga: boolean | undefined;
  }>,
}));

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
const { estadoAuth } = vi.hoisted(() => ({
  estadoAuth: {
    user: { id: "user-1" } as { id: string } | null,
    isAdmin: false,
    adminStatus: "not-admin",
    loading: false,
    isPasswordRecovery: false,
  },
}));

vi.mock("@/views/customer/HomeView", () => ({
  HomeView: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string, id?: string) => void;
  }) => (
    <div data-testid="home">
      <button
        type="button"
        data-testid="ir-para-checkout"
        onClick={() => onNavigate("checkout")}
      >
        Checkout novo
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
vi.mock("@/views/customer/ProfileView", () => ({
  ProfileView: () => <div data-testid="tela-perfil-proprio" />,
}));
vi.mock("@/views/shared/AuthView", () => ({
  AuthView: () => <div data-testid="tela-login" />,
}));
// Dublê do checkout: registra as props de CADA render e oferece a saída
// que o cliente toca ("Ver meus pedidos", "Voltar à vitrine" — todas passam
// por `onNavigate`).
vi.mock("@/views/customer/CheckoutView", () => ({
  CheckoutView: ({
    onNavigate,
    retomarPedidoId,
    retomadaDaRecarga,
  }: {
    readonly onNavigate: (view: string) => void;
    readonly retomarPedidoId?: string;
    readonly retomadaDaRecarga?: boolean;
  }) => {
    rendersDoCheckout.push({ retomarPedidoId, retomadaDaRecarga });
    return (
      <div data-testid="tela-checkout">
        <button
          type="button"
          data-testid="sair-do-checkout"
          onClick={() => onNavigate("home")}
        >
          Voltar à vitrine
        </button>
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
    dados,
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

describe("App — o checkout volta ao pedido pendente depois da recarga", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;
  let sessao: ReturnType<typeof dubleDeArmazem>;

  beforeEach(() => {
    estadoAuth.user = { id: "user-1" };
    estadoAuth.loading = false;
    rendersDoCheckout.length = 0;
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.stubGlobal("localStorage", dubleDeArmazem());
    sessao = dubleDeArmazem();
    vi.stubGlobal("sessionStorage", sessao);
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
    globalThis.history.replaceState(null, "", "/");
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

  /** A carga da página (o F5): o App nasce na URL dada. */
  const carregarEm = async (caminho: string) => {
    globalThis.history.replaceState(null, "", caminho);
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
  };

  const naTela = (marca: string) =>
    container?.querySelector(`[data-testid="${marca}"]`) ?? null;

  it("recarga em /checkout com o pedido guardado: o checkout nasce JÁ retomando o MESMO pedido, nunca vazio antes", async () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);

    await carregarEm("/checkout");

    expect(naTela("tela-checkout")).not.toBeNull();
    expect(rendersDoCheckout.length).toBeGreaterThan(0);
    // TODO render do checkout já veio com o pedido — nenhum checkout de
    // carrinho vazio montou antes da retomada.
    for (const props of rendersDoCheckout) {
      expect(props).toEqual({
        retomarPedidoId: PEDIDO,
        retomadaDaRecarga: true,
      });
    }
    // O registro fica: quem decide limpar é a leitura do pedido no checkout.
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);
  });

  it("recarga com a sessão ainda carregando: quando ela chega, o checkout monta JÁ com o pedido (nunca vazio antes)", async () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    estadoAuth.loading = true;

    await carregarEm("/checkout");
    expect(rendersDoCheckout).toEqual([]);

    estadoAuth.loading = false;
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();

    expect(naTela("tela-checkout")).not.toBeNull();
    expect(rendersDoCheckout.length).toBeGreaterThan(0);
    for (const props of rendersDoCheckout) {
      expect(props).toEqual({
        retomarPedidoId: PEDIDO,
        retomadaDaRecarga: true,
      });
    }
  });

  it("registro de OUTRO usuário na aba: não é lido — o checkout abre no fluxo normal", async () => {
    guardarPedidoPendenteDoCheckout("user-2", PEDIDO);

    await carregarEm("/checkout");

    expect(naTela("tela-checkout")).not.toBeNull();
    for (const props of rendersDoCheckout) {
      expect(props.retomarPedidoId).toBeUndefined();
      expect(props.retomadaDaRecarga).toBeFalsy();
    }
  });

  it("visitante em /checkout: nada é restaurado", async () => {
    estadoAuth.user = null;
    sessao.dados.set(chaveDoPedidoPendenteDoCheckout(""), PEDIDO);

    await carregarEm("/checkout");

    for (const props of rendersDoCheckout) {
      expect(props.retomarPedidoId).toBeUndefined();
    }
  });

  it("carga da página FORA do checkout: o registro da aba é apagado", async () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    guardarPedidoPendenteDoCheckout("user-2", PEDIDO);
    sessao.dados.set("ikcous-rascunho-do-checkout-v1", "{}");

    await carregarEm("/");

    expect(naTela("home")).not.toBeNull();
    const prefixo = chaveDoPedidoPendenteDoCheckout("");
    expect(
      [...sessao.dados.keys()].filter((chave) => chave.startsWith(prefixo)),
    ).toEqual([]);
    expect(sessao.dados.get("ikcous-rascunho-do-checkout-v1")).toBe("{}");
  });

  it("sair do checkout pela ação do cliente apaga o registro", async () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    await carregarEm("/checkout");
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);

    await clicar("sair-do-checkout");

    expect(naTela("home")).not.toBeNull();
    expect(lerPedidoPendenteDoCheckout("user-1")).toBeNull();
  });

  it("Voltar do navegador (popstate) saindo do checkout apaga o registro", async () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    await carregarEm("/checkout");
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);

    await act(async () => {
      globalThis.history.pushState({ view: "home" }, "", "/");
      globalThis.dispatchEvent(
        new PopStateEvent("popstate", { state: { view: "home" } }),
      );
    });
    await assentar();

    expect(naTela("home")).not.toBeNull();
    expect(lerPedidoPendenteDoCheckout("user-1")).toBeNull();
  });

  it("troca direta de conta (A → B, sem logout no meio) apaga o registro de A", async () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    await carregarEm("/checkout");
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);

    estadoAuth.user = { id: "user-2" };
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();

    expect(lerPedidoPendenteDoCheckout("user-1")).toBeNull();
  });

  it("entrar num checkout NOVO (carrinho → checkout) apaga o registro velho e não herda a retomada", async () => {
    await carregarEm("/");
    // Um registro que sobrou (ex.: saída do checkout pelo Voltar do
    // navegador, que não passa pelo handleNavigate).
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);

    await clicar("ir-para-checkout");

    expect(naTela("tela-checkout")).not.toBeNull();
    expect(lerPedidoPendenteDoCheckout("user-1")).toBeNull();
    for (const props of rendersDoCheckout) {
      expect(props.retomarPedidoId).toBeUndefined();
    }
  });

  it("storage que lança em toda operação do registro: o checkout abre no fluxo normal, sem quebrar", async () => {
    // Lança em TODA operação deste registro (e nas de varredura, que só ele
    // usa). As outras chaves seguem funcionando: o App já lê/grava
    // `splash_shown` sem proteção (App.tsx, efeitos do splash) — anterior e
    // alheio a esta mudança.
    const prefixo = chaveDoPedidoPendenteDoCheckout("");
    const explodeSeForDoRegistro = (chave: string) => {
      if (chave.startsWith(prefixo)) throw new Error("SecurityError");
    };
    sessao.dados.set(chaveDoPedidoPendenteDoCheckout("user-1"), PEDIDO);
    vi.stubGlobal("sessionStorage", {
      getItem: (chave: string) => {
        explodeSeForDoRegistro(chave);
        return sessao.getItem(chave);
      },
      setItem: (chave: string, valor: string) => {
        explodeSeForDoRegistro(chave);
        sessao.setItem(chave, valor);
      },
      removeItem: (chave: string) => {
        explodeSeForDoRegistro(chave);
        sessao.removeItem(chave);
      },
      key: () => {
        throw new Error("SecurityError");
      },
      get length(): number {
        throw new Error("SecurityError");
      },
    });

    await carregarEm("/checkout");

    expect(naTela("tela-checkout")).not.toBeNull();
    for (const props of rendersDoCheckout) {
      expect(props.retomarPedidoId).toBeUndefined();
    }
  });
});
