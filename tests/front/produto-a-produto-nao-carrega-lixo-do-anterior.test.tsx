// @vitest-environment jsdom
/**
 * Trocar de produto pela vitrine "você também pode gostar" tem de abrir a tela
 * LIMPA.
 *
 * O DEFEITO QUE ESTE TESTE PRENDE: em `src/App.tsx`, no `case "product-detail"`
 * de `renderCustomerSecondaryView`, o `<PreloadedOrLazy component={ProductView}>`
 * era montado SEM `key`. Para o React, o mesmo tipo de componente na mesma
 * posição é a MESMA instância — trocar só a prop `product` re-renderiza, não
 * remonta. Todo `useState` interno do ProductView sobrevive: a variação
 * escolhida, a quantidade, o índice da foto. Quem clicava num produto
 * recomendado abria a tela do novo produto com a escolha do anterior ainda
 * marcada — e, se apertasse comprar, o item ia para o carrinho com o NOME DE
 * VARIAÇÃO ERRADO (`ProductView.tsx:591-602` monta `variantNames` a partir do
 * `selectedVariants` que ficou).
 *
 * POR QUE O TESTE MONTA O `<App />` DE VERDADE, E NÃO UM ARREMEDO:
 * um teste que renderizasse `<PreloadedOrLazy>` com uma `key` escrita à mão
 * provaria a reconciliação do React, que não é o que está em dúvida. O que
 * precisa ser provado é que O APP passa a `key`. Por isso a montagem é a real —
 * entrada por URL em `/product-detail?id=<A>`, clique no mesmo `onProductClick`
 * que a vitrine de recomendações usa — e o que é dublê é só a periferia
 * (rede, contextos, telas vizinhas).
 *
 * DUAS ARMADILHAS DESTA MÁQUINA, JÁ CONTORNADAS ABAIXO:
 *  1. o Node 25 expõe um `globalThis.localStorage` experimental SEM `.clear` e
 *     SEM `.key`, que vence o do jsdom mesmo com o docblock acima. Daí o dublê
 *     de `Map` em `vi.stubGlobal` — o mesmo de `auth-admin-check.test.tsx`.
 *  2. o dublê do `framer-motion` guarda os componentes por tag num `Map`. Se
 *     `motion.div` devolvesse uma função NOVA a cada acesso, o React veria um
 *     tipo novo a cada render e remontaria a árvore inteira sozinho — o teste
 *     ficaria verde com ou sem a correção, que é o pior desfecho possível.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";

// `vi.hoisted` porque as fábricas de `vi.mock` sobem para o topo do arquivo e
// não enxergam variáveis normais de módulo.
const ALVO = vi.hoisted(() => ({
  idA: "produto-A-9f2c41",
  idB: "produto-B-7d4e08",
  // Valores que não podem coincidir por acaso: se a asserção final encontrar
  // este texto, ele só pode ter vindo da tela do produto A.
  varianteEscolhidaNoA: "Cor: VERDE-ABACATE-88 / Tamanho: GG",
  varianteZerada: "NENHUMA-VARIACAO-ESCOLHIDA",
}));

// --- A tela sob observação -------------------------------------------------
// Dublê enxuto do ProductView: guarda um estado interno próprio (como o
// `selectedVariants` real guarda) e oferece o mesmo `onProductClick` que a
// faixa "você também pode gostar" chama.
vi.mock("@/views/customer/ProductView", async () => {
  const React = await import("react");
  function ProductView({
    product,
    onProductClick,
  }: {
    readonly product: { id: string };
    readonly onProductClick: (id: string) => void;
  }) {
    const [variante, setVariante] = React.useState(ALVO.varianteZerada);
    return (
      <div data-testid="tela-do-produto">
        <span data-testid="id-do-produto">{product.id}</span>
        <span data-testid="variante-escolhida">{variante}</span>
        <button
          type="button"
          data-testid="escolher-variante"
          onClick={() => setVariante(ALVO.varianteEscolhidaNoA)}
        >
          escolher variação
        </button>
        <button
          type="button"
          data-testid="abrir-o-outro-produto"
          onClick={() => onProductClick(ALVO.idB)}
        >
          você também pode gostar
        </button>
      </div>
    );
  }
  return { ProductView };
});

// --- Periferia: tudo que não é o comportamento sob teste --------------------
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
      // `Object.fromEntries` e não `limpo[chave] = resto[chave]`: indexar por
      // variável dispara `security/detect-object-injection`, e a catraca de
      // lint deste projeto reprova qualquer aviso novo.
      const limpo = Object.fromEntries(
        Object.entries(resto).filter(([chave]) => !PROPS_DE_ANIMACAO.has(chave)),
      );
      return React.createElement(
        tag,
        limpo,
        children as React.ReactNode,
      );
    };
  // O cache é o que mantém o TIPO estável entre renders. Ver o cabeçalho.
  const cache = new Map<string, unknown>();
  const motion = new Proxy({} as Record<string, unknown>, {
    get: (_alvo, tag) => {
      if (typeof tag !== "string") return undefined;
      if (!cache.has(tag)) cache.set(tag, criar(tag));
      return cache.get(tag);
    },
  });
  function AnimatePresence({ children }: { readonly children?: unknown }) {
    return React.createElement(React.Fragment, null, children as React.ReactNode);
  }
  return { motion, AnimatePresence, useReducedMotion: () => true };
});

vi.mock("@/views/customer/HomeView", async () => {
  const React = await import("react");
  return {
    HomeView: () => React.createElement("div", { "data-testid": "home" }),
  };
});

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

// Passa-adiante em vez do de verdade: se algo quebrar dentro da árvore, o teste
// tem de morrer alto, não virar uma tela de erro silenciosa.
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
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({
    products: [{ id: ALVO.idA }, { id: ALVO.idB }],
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

// --- Buracos do jsdom ------------------------------------------------------
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
    // `.at(i)` e não `[i]`: mesmo motivo do `Object.fromEntries` acima — é o
    // idioma que `auth-admin-check.test.tsx` já usa neste mesmo dublê.
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

describe("trocar de produto pela vitrine de recomendados", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    // O `localStorage` do Node 25 não tem `.clear` nem `.key` e vence o do
    // jsdom. Sem este dublê o arquivo inteiro morre em
    // `localStorage.clear is not a function`.
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

    // A pessoa chega direto na tela do produto A, como quem abre um link.
    globalThis.history.replaceState(
      { view: "product-detail", id: ALVO.idA },
      "",
      `/product-detail?id=${ALVO.idA}`,
    );

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
    vi.unstubAllGlobals();
  });

  const assentar = async (voltas = 10) => {
    for (let i = 0; i < voltas; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  };

  const ler = (marca: string) =>
    container?.querySelector(`[data-testid="${marca}"]`)?.textContent ?? null;

  const clicar = async (marca: string) => {
    const botao = container?.querySelector<HTMLButtonElement>(
      `[data-testid="${marca}"]`,
    );
    if (!botao) throw new Error(`botão "${marca}" não está na tela`);
    await act(async () => {
      botao.click();
    });
  };

  it("abre o produto novo sem a variação escolhida no anterior", async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();

    // Ponto de partida: produto A na tela, nada escolhido.
    expect(ler("id-do-produto")).toBe(ALVO.idA);
    expect(ler("variante-escolhida")).toBe(ALVO.varianteZerada);

    // A pessoa escolhe uma variação no produto A.
    await clicar("escolher-variante");
    expect(ler("variante-escolhida")).toBe(ALVO.varianteEscolhidaNoA);

    // E então clica num produto da faixa "você também pode gostar".
    await clicar("abrir-o-outro-produto");
    await assentar();

    // A tela agora é a do produto B...
    expect(ler("id-do-produto")).toBe(ALVO.idB);
    // ...e NADA do produto A pode ter atravessado. É esta linha que cai
    // quando o `key` some do `case "product-detail"` em `src/App.tsx`.
    expect(ler("variante-escolhida")).toBe(ALVO.varianteZerada);
  });
});
