// @vitest-environment jsdom
//
// O PIX PENDENTE SOBREVIVE À RECARGA — com a sessão que chega ATRASADA
// (achado R1 da revisão, 04/10/2026).
//
// O defeito: com a rede lenta, o `getSession` do boot perde a corrida de 3 s
// (AuthContext: "Applying late session"). O app solta o carregamento com
// `user` nulo; o App decidia a recarga SEM usuário (sem pedido) e montava o
// checkout de carrinho vazio; quando a sessão chegava, o efeito de gravação
// do CheckoutView via "nenhum pedido em pagamento" e APAGAVA o registro — um
// segundo F5 também caía vazio.
//
// Aqui o AuthProvider, o App e o CheckoutView são os DE VERDADE; os dublês
// são o banco (`supabase`: `getSession` que pendura até o teste soltar, e a
// linha do pedido) e a edge (`criarPagamento`). Tempo: o que se MEDE (os 3 s
// do AuthContext, o teto do App) anda só no relógio falso; a única espera
// real é a de E/S de módulo (`import()`), com teto, e nenhuma ação é refeita.
//
//   1. Sessão que chega depois dos 3 s: nada é apagado, o App ESPERA a
//      sessão (não monta checkout vazio), e quando ela chega o MESMO pedido
//      é retomado; um segundo carregamento ainda acha o registro.
//   2. A sessão não chega dentro do teto: o checkout abre como sempre, mas o
//      registro NÃO é apagado — nem quando a sessão chega depois do teto.
//   3. Sem registro nenhum, o checkout abre no mesmo instante de sempre
//      (nenhum quadro em branco a mais no caminho normal).
import { setTimeout as esperaReal } from "node:timers/promises";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRAZO_DA_SESSAO_NA_RECARGA_MS,
  chaveDoPedidoPendenteDoCheckout,
  guardarPedidoPendenteDoCheckout,
  lerPedidoPendenteDoCheckout,
} from "@/lib/pedido-pendente-do-checkout";

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const QR_DO_PEDIDO = "00020126-copia-e-cola-do-pedido";
const FINALIZE = "Finalize o pagamento";

const { criarPagamento, createOrder, banco } = vi.hoisted(() => ({
  criarPagamento: vi.fn(),
  createOrder: vi.fn(),
  // A "linha" do pedido e o `getSession` que pendura até o teste soltar.
  banco: {
    pedido: null as Record<string, unknown> | null,
    soltarGetSession: (_resposta: unknown) => {},
    getSessionPendura: true,
    sessaoDoGetSession: null as unknown,
  },
}));

vi.mock("framer-motion", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("framer-motion")>();
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
  return { ...real, motion, AnimatePresence, useReducedMotion: () => true };
});

vi.mock("@/views/customer/HomeView", () => ({
  HomeView: () => <div data-testid="home" />,
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
vi.mock("@/components/debug/DebugPanel", () => ({ DebugPanel: () => null }));
vi.mock("@/components/pwa/PushNotificationBanner", () => ({
  PushNotificationBanner: () => null,
}));
vi.mock("@/components/pwa/UpdateNotification", () => ({
  UpdateNotification: () => null,
}));
vi.mock("@/components/ui/custom/Header", async (importarOriginal) => ({
  ...(await importarOriginal<typeof import("@/components/ui/custom/Header")>()),
  Header: () => null,
}));
vi.mock("@/components/ui/custom/BottomNav", () => ({
  BottomNav: () => null,
}));
vi.mock("@/components/ui/custom/CartReminder", () => ({
  CartReminder: () => null,
}));
vi.mock("@/components/ui/custom/ShippingCalculator", () => ({
  ShippingCalculator: () => null,
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
  useStore: () => LOJA,
}));
vi.mock("@/contexts/CartContext", () => ({
  CartProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
}));
vi.mock("@/contexts/FavoritesContext", () => ({
  FavoritesProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
}));

// Referências ESTÁVEIS de propósito: um `[]`/função nova a cada render do
// dublê muda `handleNavigate` do App e põe o checkout em laço de render
// (efeitos que dependem das props e dos hooks).
const {
  CARRINHO_VAZIO,
  SEM_ACAO,
  ATUALIZAR_PEDIDO,
  LOJA,
  PREFETCH,
  REDE,
  FAVORITOS,
  BADGE,
} = vi.hoisted(() => {
  const semAcao = () => {};
  return {
    CARRINHO_VAZIO: [] as unknown[],
    SEM_ACAO: semAcao,
    ATUALIZAR_PEDIDO: () => Promise.resolve(),
    LOJA: {
      config: {
        shippingCoverage: "local",
        originCep: "38500-000",
        enableCoupons: false,
        whatsappNumber: undefined,
      },
      isLoaded: true,
    },
    PREFETCH: {
      prefetchView: semAcao,
      prefetchAll: semAcao,
      prefetchViewPromise: () => Promise.resolve(),
    },
    REDE: { isSlow: () => false },
    FAVORITOS: { favorites: [], toggleFavorite: semAcao, loading: false },
    BADGE: { setBadge: semAcao, clearBadge: semAcao },
  };
});
vi.mock("@/hooks/useCart", async () => {
  const { criarUseCartDeTeste } = await import("./duble-use-cart");
  return {
    useCart: criarUseCartDeTeste(() => ({
      cart: CARRINHO_VAZIO,
      cartTotal: 0,
      shippingFee: 0,
      clearCart: SEM_ACAO,
      addToCart: SEM_ACAO,
      selectedShippingOption: null,
      shippingCep: "38500-000",
    })),
    useCartState: () => ({ cartCount: 0 }),
    useCartActions: () => ({ addToCart: () => {} }),
  };
});
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: CARRINHO_VAZIO,
    fetchAddresses: SEM_ACAO,
    addAddress: SEM_ACAO,
    updateAddress: SEM_ACAO,
    loading: false,
  }),
}));
vi.mock("@/hooks/useCoupons", () => ({
  useCoupons: () => ({ validateCoupon: SEM_ACAO }),
}));
vi.mock("@/hooks/useOrders", async (importarOriginal) => {
  const real = await importarOriginal<typeof import("@/hooks/useOrders")>();
  return {
    ...real,
    useOrders: () => ({
      createOrder,
      updateOrderStatus: ATUALIZAR_PEDIDO,
      criarPagamento,
    }),
  };
});
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useConfigDoCartao", async () => {
  const { estadoPronto } = await import("./duble-use-config-do-cartao");
  return {
    useConfigDoCartao: () =>
      estadoPronto({ credito: true, debito: false, parcelasMax: 1 }),
  };
});
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: [], loading: false }),
}));
vi.mock("@/hooks/useFavorites", () => ({ useFavorites: () => FAVORITOS }));
vi.mock("@/hooks/useAppBadge", () => ({ useAppBadge: () => BADGE }));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => PREFETCH,
}));
vi.mock("@/hooks/useNetworkAdaptive", () => ({
  useNetworkAdaptive: () => REDE,
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

vi.mock("canvas-confetti", () => ({ default: vi.fn() }));
vi.mock("@/lib/flags", () => ({
  pagamentoOnlineLigado: () => true,
  lerFlagPagamentoOnline: (v: string | undefined) => v === "true",
}));

// O banco: o AuthProvider e o CheckoutView falam com o MESMO dublê.
vi.mock("@/lib/supabase", () => {
  const leituraDoPedido = () => ({
    maybeSingle: () => Promise.resolve({ data: banco.pedido, error: null }),
    single: () =>
      Promise.resolve({
        data: banco.pedido ?? { payment_status: "aguardando" },
        error: null,
      }),
    in: () => Promise.resolve({ data: [], error: null }),
  });
  return {
    supabase: {
      auth: {
        getSession: vi.fn(
          () =>
            new Promise((resolve) => {
              if (banco.getSessionPendura) {
                banco.soltarGetSession = resolve;
              } else {
                resolve({ data: { session: banco.sessaoDoGetSession } });
              }
            }),
        ),
        getUser: vi.fn(() =>
          Promise.resolve({ data: { user: { id: "user-1" } }, error: null }),
        ),
        onAuthStateChange: vi.fn(() => ({
          data: { subscription: { unsubscribe: vi.fn() } },
        })),
        signOut: vi.fn(() => Promise.resolve({ error: null })),
      },
      rpc: vi.fn(() => Promise.resolve({ data: null, error: null })),
      from: vi.fn((tabela: string) => ({
        select: () => ({
          eq: () =>
            tabela === "marketplace_orders"
              ? leituraDoPedido()
              : {
                  single: () =>
                    Promise.resolve({
                      data: null,
                      error: { message: "sem perfil" },
                    }),
                },
        }),
      })),
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
    },
  };
});

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

const SESSAO_DO_USER_1 = {
  access_token: "tok-1",
  user: { id: "user-1", email: "cliente@exemplo.com" },
};

// @ts-expect-error — bandeira interna do React para o `act`
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("App + AuthProvider — o PIX pendente sobrevive à recarga com a sessão ATRASADA", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;
  let sessao: ReturnType<typeof dubleDeArmazem>;

  beforeEach(() => {
    criarPagamento.mockReset().mockResolvedValue({
      paymentId: "mp-pix-1",
      statusPagamento: "aguardando",
      expiraEm: new Date(Date.now() + 20 * 60_000).toISOString(),
      qrCode: QR_DO_PEDIDO,
      qrCodeBase64: "iVBORw0KGgo=",
    });
    createOrder.mockReset().mockResolvedValue({ id: PEDIDO });
    banco.pedido = {
      user_id: "user-1",
      total: 120,
      status: "pending",
      payment_status: "aguardando",
      gateway_payment_id: "mp-pix-1",
      metodo_online: "pix",
      expires_at: new Date(Date.now() + 20 * 60_000).toISOString(),
    };
    banco.getSessionPendura = true;
    banco.sessaoDoGetSession = null;
    banco.soltarGetSession = () => {};
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  /** O F5: módulos novos (o `initPromise` do AuthContext é de módulo) e a URL dada. */
  async function carregarEm(caminho: string) {
    // Um segundo F5 no mesmo teste: as importações abaixo são E/S real.
    vi.useRealTimers();
    for (const tag of document.querySelectorAll("script[data-mp-sdk]")) {
      tag.remove();
    }
    vi.resetModules();
    globalThis.history.replaceState(null, "", caminho);
    const { AuthProvider } = await import("@/contexts/AuthContext");
    const { default: App } = await import("@/App");
    // Os módulos lazy entram ANTES do relógio falso: a importação real
    // depende de E/S, que o relógio falso não faz andar.
    await import("@/views/customer/CheckoutView");
    vi.useFakeTimers();
    await act(async () => {
      raiz?.render(
        <AuthProvider>
          <App />
        </AuthProvider>,
      );
    });
    await assentarAEs();
  }

  // O relógio falso não faz andar a E/S REAL (o `import()` do módulo lazy do
  // checkout e a cadeia de promessas da retomada): depois de cada avanço,
  // algumas esperas REAIS curtas (o
  // `timers/promises` do Node não é tocado pelo relógio falso) deixa o lazy
  // terminar e o React assentar. Não mascara nada: o que é medido (relógio
  // do App, do AuthContext) continua só no relógio falso.
  const assentarAEs = async () => {
    for (let i = 0; i < 12; i++) {
      await act(async () => {
        await esperaReal(25);
      });
    }
  };

  // Espera REAL (E/S de módulo: o `PagamentoOnline` e o resto do checkout
  // também entram por `import()` depois do reset de módulos) até o fato
  // existir, com teto. Não é retry de ação: nada é refeito, só se espera o
  // que já foi disparado; se o teto vencer, a asserção seguinte reprova.
  const esperarAte = async (condicao: () => boolean) => {
    for (let i = 0; i < 400 && !condicao(); i++) {
      await act(async () => {
        await esperaReal(25);
      });
    }
  };

  const avancar = async (ms: number) => {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await assentarAEs();
  };

  const textoDaTela = () => container?.textContent ?? "";

  async function sessaoChega() {
    await act(async () => {
      banco.soltarGetSession({ data: { session: SESSAO_DO_USER_1 } });
      await vi.advanceTimersByTimeAsync(0);
    });
    await assentarAEs();
    await avancar(50);
  }

  // O checkout de carrinho vazio (visitante, sem pedido): o formulário de
  // dados e a escolha da forma de pagamento. Era o que a recarga mostrava.
  const checkoutVazioNaTela = () => textoDaTela().includes("Meio de Pagamento");

  const pagamentoRetomadoNaTela = () =>
    textoDaTela().includes(QR_DO_PEDIDO) && textoDaTela().includes(FINALIZE);

  function esperaMesmoPedidoSemCobrancaNova() {
    expect(createOrder).not.toHaveBeenCalled();
    expect(criarPagamento).toHaveBeenCalled();
    for (const [corpo] of criarPagamento.mock.calls) {
      expect(corpo).toEqual({ orderId: PEDIDO, metodo: "pix" });
    }
  }

  it("a sessão chega DEPOIS dos 3 s: nada é apagado, o MESMO pedido é retomado e um segundo carregamento ainda o acha", async () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);

    await carregarEm("/checkout");
    // O boot perde a corrida de 3 s: `user` nulo, carregamento liberado.
    await avancar(3000);

    // 1o render sem usuário: o registro está intacto e o checkout de
    // carrinho vazio NÃO montou (o App espera a sessão).
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);
    expect(checkoutVazioNaTela()).toBe(false);
    expect(criarPagamento).not.toHaveBeenCalled();

    await sessaoChega();

    // A sessão chegou: o MESMO pedido, o MESMO QR, nenhuma cobrança nova.
    await esperarAte(pagamentoRetomadoNaTela);
    expect(pagamentoRetomadoNaTela()).toBe(true);
    expect(checkoutVazioNaTela()).toBe(false);
    esperaMesmoPedidoSemCobrancaNova();
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);

    // O SEGUNDO F5 (sessão lenta de novo): o registro ainda está lá e volta
    // ao mesmo pedido.
    await act(async () => {
      raiz?.render(null);
    });
    criarPagamento.mockClear();
    await carregarEm("/checkout");
    await avancar(3000);
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);
    expect(checkoutVazioNaTela()).toBe(false);
    await sessaoChega();
    await esperarAte(pagamentoRetomadoNaTela);
    expect(pagamentoRetomadoNaTela()).toBe(true);
    esperaMesmoPedidoSemCobrancaNova();
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);
  });

  it("a sessão NÃO chega dentro do teto: o checkout abre como sempre, mas o registro fica — também quando a sessão chega depois do teto", async () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);

    await carregarEm("/checkout");
    await avancar(3000);
    expect(checkoutVazioNaTela()).toBe(false);

    // O teto vence sem sessão: o checkout de sempre (vazio), SEM retomada.
    await avancar(PRAZO_DA_SESSAO_NA_RECARGA_MS);
    expect(checkoutVazioNaTela()).toBe(true);
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);

    // A sessão chega tarde, com o checkout vazio já montado: a ausência de
    // decisão NÃO apaga o registro, e nada é cobrado.
    await sessaoChega();
    expect(lerPedidoPendenteDoCheckout("user-1")).toBe(PEDIDO);
    expect(criarPagamento).not.toHaveBeenCalled();
    expect(createOrder).not.toHaveBeenCalled();
  });

  it("sem registro nenhum: o checkout abre no mesmo instante de sempre (nenhum quadro em branco a mais)", async () => {
    await carregarEm("/checkout");
    await avancar(50);

    // Sem registro não há o que esperar: o checkout monta logo, bem antes
    // do teto de espera da sessão (que aqui nem se aplica).
    expect(checkoutVazioNaTela()).toBe(true);
    expect(criarPagamento).not.toHaveBeenCalled();
  });

  it("sessão guardada no aparelho (usuário já conhecido no boot): retoma o pedido sem esperar teto nenhum", async () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    localStorage.setItem(
      "sb-teste-auth-token",
      JSON.stringify(SESSAO_DO_USER_1),
    );

    await carregarEm("/checkout");
    // Antes de o carregamento do AuthContext liberar, nada de checkout vazio.
    expect(checkoutVazioNaTela()).toBe(false);
    await avancar(3000);

    await esperarAte(pagamentoRetomadoNaTela);
    expect(pagamentoRetomadoNaTela()).toBe(true);
    expect(checkoutVazioNaTela()).toBe(false);
    esperaMesmoPedidoSemCobrancaNova();
  });

  it("sessão que chega RÁPIDO mas depois do primeiro render (sem cache no aparelho): espera a sessão e retoma", async () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    banco.getSessionPendura = false;
    banco.sessaoDoGetSession = SESSAO_DO_USER_1;

    await carregarEm("/checkout");
    await avancar(50);

    await esperarAte(pagamentoRetomadoNaTela);
    expect(pagamentoRetomadoNaTela()).toBe(true);
    expect(checkoutVazioNaTela()).toBe(false);
    esperaMesmoPedidoSemCobrancaNova();
  });

  it("o armazém usa a chave por usuário (sanidade do dublê)", () => {
    guardarPedidoPendenteDoCheckout("user-1", PEDIDO);
    expect(sessao.dados.get(chaveDoPedidoPendenteDoCheckout("user-1"))).toBe(
      PEDIDO,
    );
  });
});
