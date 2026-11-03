// @vitest-environment jsdom

import {
  haEnvioDoCheckoutEmCurso,
  marcarEnvioDoCheckout,
} from "@/lib/envio-do-checkout-em-curso";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

//
// Caça 8 (03/11/2026) — tocar numa aba da barra de baixo com o pedido NO AR.
//
// RELATO (medido): na tela de checkout, com o círculo girando (até 30 s em rede
// lenta), a cliente toca em "Início" ou "Carrinho". A tela do checkout
// desmonta; a resposta de sucesso chega com a tela morta, é descartada sem
// esvaziar o carrinho nem esquecer a chave do pedido, e o cupom de uso único
// já gasto volta recusado -> total e impressão digital mudam -> nasce OUTRO
// pedido, sem desconto.
//
// CORREÇÃO: `handleNavigate` não sai do checkout enquanto a bandeira
// `haEnvioDoCheckoutEmCurso()` estiver ligada — avisa (mesma frase do Voltar) e
// fica. Cobre a barra de baixo, o cabeçalho e qualquer caminho que passe por
// `handleNavigate`. Este arquivo prova o lado do ROTEADOR (App real + BottomNav
// real); o lado da tela (liga e solta a bandeira) está em
// checkout-envio-liga-a-bandeira-de-navegacao.test.tsx.
//
// Harness copiado de checkout-seta-voltar-so-fecha-painel-primeiro-toque.test.tsx.
// O CheckoutView é um dublê mínimo que expõe só o contrato com o roteador: a
// bandeira e um botão "Início" da confirmação (navega por onNavigate, como a
// tela de sucesso de verdade).

const { toastInfo } = vi.hoisted(() => ({ toastInfo: vi.fn() }));

vi.mock("framer-motion", async () => {
  const ReactMod = await import("react");
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
      return ReactMod.createElement(tag, limpo, children as React.ReactNode);
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
    return ReactMod.createElement(
      ReactMod.Fragment,
      null,
      children as React.ReactNode,
    );
  }
  return { motion, AnimatePresence, useReducedMotion: () => true };
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

// Dublê MÍNIMO do CheckoutView: o que importa para o roteador é a bandeira.
// "Iniciar envio" liga, "Terminar envio" solta (sucesso ou falha), e "Início da
// confirmação" é o botão da tela de sucesso, que navega por `onNavigate`.
vi.mock("@/views/customer/CheckoutView", () => ({
  CheckoutView: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string) => void;
  }) => (
    <div data-testid="tela-checkout">
      <button
        type="button"
        data-testid="iniciar-envio"
        onClick={() => marcarEnvioDoCheckout(true)}
      >
        Iniciar envio
      </button>
      <button
        type="button"
        data-testid="terminar-envio"
        onClick={() => marcarEnvioDoCheckout(false)}
      >
        Terminar envio
      </button>
      <button
        type="button"
        data-testid="inicio-da-confirmacao"
        onClick={() => onNavigate("home")}
      >
        Início da confirmação
      </button>
    </div>
  ),
}));

// Dublê do cabeçalho: um botão que navega por `onNavigate`, como a logo/atalhos.
vi.mock("@/components/ui/custom/Header", () => ({
  Header: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string) => void;
  }) => (
    <button
      type="button"
      data-testid="cabecalho-inicio"
      onClick={() => onNavigate("home")}
    >
      Cabeçalho
    </button>
  ),
  HEADER_CENTER_SLOT_ID: "header-center-slot-teste",
}));

vi.mock("@/components/debug/DebugPanel", () => ({ DebugPanel: () => null }));
vi.mock("@/components/pwa/PushNotificationBanner", () => ({
  PushNotificationBanner: () => null,
}));
vi.mock("@/components/pwa/UpdateNotification", () => ({
  UpdateNotification: () => null,
}));
vi.mock("@/components/ui/custom/CartReminder", () => ({
  CartReminder: () => null,
}));
vi.mock("@/components/ui/sonner", () => ({ Toaster: () => null }));
vi.mock("sonner", () => ({
  toast: Object.assign(() => {}, {
    error: () => {},
    success: () => {},
    info: toastInfo,
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
  useStore: () => ({ config: null, isLoaded: true }),
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
  useCart: () => ({
    cart: [],
    cartTotal: 0,
    shippingFee: 0,
    cartCount: 0,
    addToCart: () => {},
    clearCart: () => {},
    selectedShippingOption: null,
    shippingCep: null,
    setSelectedShippingOption: () => {},
    setShippingCep: () => {},
    freteIndefinido: false,
    freteGratis: false,
  }),
  useCartState: () => ({ cartCount: 0 }),
  useCartActions: () => ({ addToCart: () => {} }),
}));
// `user` estável (fora da factory): objeto novo a cada chamada de `useAuth()`
// faz efeitos do App entrarem em loop de render.
const mockUser = null;
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
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
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

const AVISO = "Aguarde, estamos enviando seu pedido.";

describe("checkout: tocar numa aba com o pedido no ar não desmonta a tela", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    marcarEnvioDoCheckout(false);
    toastInfo.mockReset();
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

    globalThis.history.replaceState(null, "", "/checkout");

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
    marcarEnvioDoCheckout(false);
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

  const naTelaDeCheckout = () =>
    container?.querySelector('[data-testid="tela-checkout"]') !== null;
  const naHome = () =>
    container?.querySelector('[data-testid="home"]') !== null;

  const abrir = async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
    await esperarAte(() => naTelaDeCheckout() === true);
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

  /** Aba da barra de baixo (BottomNav REAL), achada pelo texto do rótulo. */
  const tocarAba = async (rotulo: string) => {
    const aba = [
      ...(container?.querySelectorAll<HTMLButtonElement>("nav button") ?? []),
    ].find((b) => b.textContent?.includes(rotulo));
    if (!aba) throw new Error(`aba ${rotulo} não encontrada`);
    await act(async () => {
      aba.click();
    });
    await assentar();
  };

  it("chega no checkout pela URL direta", async () => {
    await abrir();
    expect(naTelaDeCheckout()).toBe(true);
  });

  it("com o pedido no ar, tocar em Início NÃO sai do checkout e avisa", async () => {
    await abrir();
    await clicar("iniciar-envio");

    await tocarAba("Início");

    expect(naTelaDeCheckout()).toBe(true);
    expect(naHome()).toBe(false);
    expect(toastInfo).toHaveBeenCalledWith(AVISO);
    expect(globalThis.location.pathname).toBe("/checkout");
  });

  it("com o pedido no ar, tocar em Carrinho também NÃO sai do checkout", async () => {
    await abrir();
    await clicar("iniciar-envio");

    await tocarAba("Carrinho");

    expect(naTelaDeCheckout()).toBe(true);
    expect(
      container?.querySelector('[data-testid="tela-carrinho"]'),
    ).toBeNull();
    expect(toastInfo).toHaveBeenCalledWith(AVISO);
  });

  it("o cabeçalho também passa pelo mesmo portão (qualquer caminho de handleNavigate)", async () => {
    await abrir();
    await clicar("iniciar-envio");

    await clicar("cabecalho-inicio");

    expect(naTelaDeCheckout()).toBe(true);
    expect(toastInfo).toHaveBeenCalledWith(AVISO);
  });

  it("depois que o envio termina (sucesso OU falha), a navegação volta a funcionar", async () => {
    await abrir();
    await clicar("iniciar-envio");
    await tocarAba("Início");
    expect(naTelaDeCheckout()).toBe(true);

    await clicar("terminar-envio");
    toastInfo.mockClear();
    await tocarAba("Início");

    await esperarAte(() => naHome() === true);
    expect(naTelaDeCheckout()).toBe(false);
    expect(toastInfo).not.toHaveBeenCalledWith(AVISO);
  });

  it("SEM envio em curso, sair do checkout pela aba continua funcionando como sempre", async () => {
    await abrir();
    expect(haEnvioDoCheckoutEmCurso()).toBe(false);

    await tocarAba("Início");

    await esperarAte(() => naHome() === true);
    expect(naTelaDeCheckout()).toBe(false);
    expect(toastInfo).not.toHaveBeenCalledWith(AVISO);
  });

  it("o sucesso do envio não barra a si mesmo: a bandeira solta e o botão da confirmação navega", async () => {
    await abrir();
    await clicar("iniciar-envio");
    // O envio termina: a tela mostra a confirmação (bandeira já solta).
    await clicar("terminar-envio");

    await clicar("inicio-da-confirmacao");

    await esperarAte(() => naHome() === true);
    expect(naTelaDeCheckout()).toBe(false);
    expect(toastInfo).not.toHaveBeenCalledWith(AVISO);
  });
});
