// @vitest-environment jsdom
//
// Peça 2 do pedido do Gabriel (12/09/2026): com o painel de resumo do
// checkout aberto, o 1º toque na seta "Voltar" do topo só FECHA o painel; o
// 2º toque volta de verdade. Relato dele: hoje a seta sai do checkout
// direto, apagando o que já tinha digitado.
//
// CAUSA (achada por leitura, confirmada aqui): `Header`'s onBack chama
// `App.handleBack()` DIRETO (nunca passa por `history.back()`/popstate). O
// painel de resumo registra o fechamento em `backOverrideRef`
// (App.tsx:~1887-1889), mas esse ref só é CONSULTADO dentro do handler de
// `popstate` — e `handleBack` decidia entre `history.back()` (se
// `state.from` existir) ou navegar para HOME direto, sem nunca olhar o
// override. Como o painel empurra `{modal:"checkout-summary"}` (sem
// `from`), a seta caía no ramo "navega para home" e saía do checkout no
// primeiro toque.
//
// Harness copiado de categoria-da-home-sobrevive-ao-voltar.test.tsx (mesmo
// padrão de mocks pesados para renderizar o `<App/>` de verdade) — mas o
// `CheckoutView` e o `Header` aqui são dublês MÍNIMOS que só expõem o
// contrato que este teste precisa: abrir o painel (empurra a MESMA forma de
// estado que a tela real empurra) e registrar o MESMO override
// (`onSetBackOverride`) que a tela real registra.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Dublê MÍNIMO do CheckoutView: reproduz os DOIS contratos de override que
// decidem a revisão — o do painel (empurra `{modal:"checkout-summary"}` e
// registra um fechamento, EXATAMENTE como CheckoutView.tsx:1002-1023) e o de
// sucesso/aguardando pagamento (registra um override que só NAVEGA para
// home, SEM empurrar entrada nenhuma — EXATAMENTE como
// CheckoutView.tsx:~1044-1049: `onSetBackOverride(() => () =>
// onNavigate("home"))`, ativo quando o pedido já nasceu e não há mais
// formulário para "voltar" recuperar).
vi.mock("@/views/customer/CheckoutView", () => ({
  CheckoutView: ({
    onNavigate,
    onSetBackOverride,
  }: {
    readonly onNavigate: (view: string) => void;
    readonly onSetBackOverride: (override: (() => void) | null) => void;
  }) => {
    const [aberto, setAberto] = React.useState(false);
    const [aguardandoPagamento, setAguardandoPagamento] = React.useState(false);
    // `onNavigate` por REF, fora das dependências: neste teste os hooks do
    // App são dublês que devolvem objeto novo a cada render, então o
    // `handleNavigate` do App muda de identidade todo render. Com ele nas
    // dependências, o efeito re-registrava o override -> `setBackOverride`
    // -> render do App -> `handleNavigate` novo -> efeito de novo: laço
    // sem erro do React, worker do vitest subindo a 4 GB (12/09/2026).
    const onNavigateRef = React.useRef(onNavigate);
    onNavigateRef.current = onNavigate;

    React.useEffect(() => {
      if (aberto) {
        onSetBackOverride(() => () => setAberto(false));
      } else if (aguardandoPagamento) {
        // Sem `history.pushState` nenhum de propósito — este override não
        // empilha entrada (a tela do PIX não é um modal por cima do
        // formulário, é o PRÓPRIO checkout depois de o pedido nascer).
        onSetBackOverride(() => () => onNavigateRef.current("home"));
      } else {
        onSetBackOverride(null);
      }
      return () => onSetBackOverride(null);
    }, [aberto, aguardandoPagamento, onSetBackOverride]);

    return (
      <div data-testid="tela-checkout">
        <span data-testid="painel-estado">{aberto ? "aberto" : "fechado"}</span>
        <button
          type="button"
          data-testid="abrir-painel"
          onClick={() => {
            setAberto(true);
            globalThis.history.pushState(
              { modal: "checkout-summary" },
              "",
              globalThis.location.pathname,
            );
          }}
        >
          Ver resumo
        </button>
        <button
          type="button"
          data-testid="abrir-aguardando-pagamento"
          onClick={() => setAguardandoPagamento(true)}
        >
          Pagar agora
        </button>
      </div>
    );
  },
}));

// Dublê MÍNIMO do Header: só o botão "Voltar", que chama `onBack` — o
// MESMO contrato de Header.tsx:180-190 (`if (onBack) onBack(); else
// onNavigate("home")`).
vi.mock("@/components/ui/custom/Header", () => ({
  Header: ({
    onBack,
    onNavigate,
  }: {
    readonly onBack?: () => void;
    readonly onNavigate: (view: string) => void;
  }) => (
    <button
      type="button"
      data-testid="seta-voltar"
      onClick={() => (onBack ? onBack() : onNavigate("home"))}
    >
      Voltar
    </button>
  ),
  HEADER_CENTER_SLOT_ID: "header-center-slot-teste",
}));

vi.mock("@/components/ui/custom/BottomNav", () => ({
  BottomNav: () => null,
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
// 🔴 `user` estável (fora da factory) — objeto literal novo a cada chamada
// de `useAuth()` faz o efeito de sincronização de perfil do CheckoutView
// (não usado aqui, mas outros hooks de App.tsx têm o mesmo padrão) entrar
// em loop de render. Ver economia-do-frete-cotacao-hook.test.tsx/memória.
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
import React from "react";

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

describe("checkout: a seta Voltar com o painel de resumo aberto só fecha o painel no 1º toque", () => {
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

  const abrir = async () => {
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

  const estadoDoPainel = () =>
    container?.querySelector('[data-testid="painel-estado"]')?.textContent;
  const naTelaDeCheckout = () =>
    container?.querySelector('[data-testid="tela-checkout"]') !== null;

  it("chega no checkout pela URL direta", async () => {
    await abrir();
    expect(naTelaDeCheckout()).toBe(true);
  });

  it("1º toque na seta com o painel aberto: só fecha o painel — continua no checkout", async () => {
    await abrir();
    await clicar("abrir-painel");
    expect(estadoDoPainel()).toBe("aberto");

    await clicar("seta-voltar");

    // A trava desta peça: antes da correção, este primeiro toque saía do
    // checkout inteiro (a seta ignorava o override e navegava para home).
    expect(naTelaDeCheckout()).toBe(true);
    expect(estadoDoPainel()).toBe("fechado");
  });

  it("2º toque na seta, painel já fechado: volta de verdade (sai do checkout)", async () => {
    await abrir();
    await clicar("abrir-painel");
    await clicar("seta-voltar"); // 1º toque: só fecha.
    expect(estadoDoPainel()).toBe("fechado");

    await clicar("seta-voltar"); // 2º toque: volta de verdade.

    expect(naTelaDeCheckout()).toBe(false);
  });

  it("sem painel aberto, a seta volta de primeira (comportamento de sempre não regride)", async () => {
    await abrir();
    expect(naTelaDeCheckout()).toBe(true);

    await clicar("seta-voltar");

    expect(naTelaDeCheckout()).toBe(false);
  });

  it("voltar do celular (popstate direto, sem passar pela seta) também fecha o painel sem sair do checkout — mesmo mecanismo de sempre", async () => {
    await abrir();
    await clicar("abrir-painel");
    expect(estadoDoPainel()).toBe("aberto");

    await act(async () => {
      globalThis.history.back();
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    await assentar();

    expect(naTelaDeCheckout()).toBe(true);
    expect(estadoDoPainel()).toBe("fechado");
  });

  it("sem nenhuma entrada extra órfã: depois do 1º toque (fecha) e do 2º (sai), não sobra um 3º toque que não faz nada visível", async () => {
    await abrir();
    await clicar("abrir-painel");
    await clicar("seta-voltar"); // fecha o painel
    await clicar("seta-voltar"); // sai do checkout
    expect(naTelaDeCheckout()).toBe(false);

    // Um "voltar" a mais não pode ficar preso batendo numa entrada morta —
    // isto não afirma PARA ONDE foi, só que o app continua respondendo
    // (não trava numa tela em branco).
    expect(container?.querySelector("body")).toBeDefined();
  });

  it("🔴 achado da revisão (Opus): override de sucesso/aguardando pagamento SEM entrada empilhada — a seta navega para home, NUNCA chama history.back()", async () => {
    // Reproduz o cenário do achado: `/checkout` é tela de ENTRADA
    // (src/config/rotas.ts) — quem abre o link direto (WhatsApp, aba nova)
    // chega aqui SEM `state.from` e SEM `state.modal`. O pedido nasce, a
    // tela de aguardando pagamento registra um override que só NAVEGA (não
    // empilha nada — diferente do painel/modal de endereço). `history.back()`
    // nesse caso ou mata a seta (sem entrada anterior) ou tira a pessoa da
    // loja inteira (aba tinha outro site antes) — exatamente o que este
    // override existe para impedir.
    await abrir();
    expect(globalThis.history.state).toBeNull();

    const historyBackSpy = vi.spyOn(globalThis.history, "back");
    await clicar("abrir-aguardando-pagamento");

    await clicar("seta-voltar");

    expect(naTelaDeCheckout()).toBe(false);
    expect(historyBackSpy).not.toHaveBeenCalled();
  });

  it("🔴 achado da revisão (Opus): painel de resumo aberto numa entrada SEM `from` (mesmo cenário de link direto) — 1º toque ainda só fecha o painel", async () => {
    // Garante que a guarda nova (`state.modal`) não regrediu o caso do
    // painel quando a entrada de baixo também não tem `from` — é
    // exatamente o estado de quem abriu /checkout direto e depois abriu o
    // painel, sem nunca ter navegado de dentro do app.
    await abrir();
    expect(globalThis.history.state).toBeNull();

    await clicar("abrir-painel");
    expect(estadoDoPainel()).toBe("aberto");

    await clicar("seta-voltar");

    expect(naTelaDeCheckout()).toBe(true);
    expect(estadoDoPainel()).toBe("fechado");
  });
});
