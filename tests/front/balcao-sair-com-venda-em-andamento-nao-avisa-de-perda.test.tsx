// @vitest-environment jsdom
//
// Balcão (PDV) dentro do <App/> de VERDADE: com peças no cupom, sair da tela
// NÃO pode abrir "Alterações Não Salvas — serão perdidas permanentemente". É
// falso: a venda em andamento fica guardada no aparelho e volta quando o
// balcão é reaberto. A lojista, com medo de perder a venda, ficava presa na
// tela em vez de ir cadastrar a peça que faltou.
//
// Aqui o App, a AdminArea e a AdminPdvView são as de verdade; o `popstate` é o
// do jsdom. Cada caso prova o EFEITO: a tela muda e a venda continua guardada.
//
// Harness copiado de admin-pdv-voltar-depois-da-venda-no-app-real.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";

const prova = vi.hoisted(() => {
  const estado = {
    dialogoAberto: 0,
    // O que a consulta de código devolve (o teste troca para "não cadastrado").
    respostaDoCodigo: null as unknown,
    codigoBipado: "78912345",
    produtos: [{ id: "p-1" }],
    chunkPendente: null as Promise<void> | null,
    // View Transition ASSÍNCRONA como no Chrome (ver o teste de referência).
    viewTransitions: 0,
  };
  (
    document as unknown as {
      startViewTransition: (atualizar: () => void) => unknown;
    }
  ).startViewTransition = (atualizar: () => void) => {
    estado.viewTransitions += 1;
    const terminou = new Promise<void>((resolver) => {
      setTimeout(() => {
        atualizar();
        resolver();
      }, 0);
    });
    return { ready: terminou, finished: terminou, skip: () => {} };
  };
  return estado;
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

// O portão é liberado no harness, mas a AdminArea real continua no caminho.
// Isso faz a regressão de rota provar também o repasse de selectedProductId
// da AdminArea para a tela de devoluções.
vi.mock("@/components/layouts/AdminAreaGate", async () => {
  const { AdminArea } = await import("@/components/layouts/AdminArea");
  return {
    AdminAreaGate: ({
      fallback: _fallback,
      ...props
    }: Record<string, unknown>) => (
      <AdminArea
        {...(props as unknown as React.ComponentProps<typeof AdminArea>)}
      />
    ),
  };
});

vi.mock("@/components/layouts/AdminLayout", () => ({
  AdminLayout: ({ children }: { readonly children?: unknown }) => (
    <div data-testid="admin-area">{children as React.ReactNode}</div>
  ),
}));

vi.mock("@/views/admin/AdminOrdersView", () => ({
  AdminOrdersView: () => <div data-testid="tela-pedidos" />,
}));

vi.mock("@/views/admin/AdminProductFormView", () => ({
  AdminProductFormView: () => <div data-testid="tela-produto" />,
}));

vi.mock("@/views/customer/HomeView", () => ({
  HomeView: () => <div data-testid="home" />,
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

// Dublê do AlertDialog do App ("alterações não salvas"): conta as renderizações
// abertas. A pergunta de descarte do Financeiro NÃO usa este componente.
vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await import("react");
  function AlertDialog({
    children,
    open,
  }: {
    readonly children?: unknown;
    readonly open?: boolean;
  }) {
    if (open) prova.dialogoAberto += 1;
    if (!open) return null;
    return React.createElement(
      React.Fragment,
      null,
      children as React.ReactNode,
    );
  }
  const passaFilhos = ({ children }: { readonly children?: unknown }) => (
    <>{children as React.ReactNode}</>
  );
  const nada = () => null;
  return {
    AlertDialog,
    AlertDialogAction: passaFilhos,
    AlertDialogCancel: passaFilhos,
    AlertDialogContent: passaFilhos,
    AlertDialogDescription: nada,
    AlertDialogFooter: passaFilhos,
    AlertDialogHeader: nada,
    AlertDialogTitle: nada,
  };
});

vi.mock("@/contexts/StoreContext", () => ({
  StoreProvider: ({ children }: { readonly children?: unknown }) =>
    children as never,
  useStore: () => ({ config: { storeName: "Loja Teste" } }),
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
// Lojista autenticado como admin — é o cenário do relato (PDV do balcão).
const mockUser = { id: "lojista-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    user: mockUser,
    isAdmin: true,
    adminStatus: "admin",
    loading: false,
    isPasswordRecovery: false,
  }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ products: prova.produtos, loading: false }),
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
// Estável de propósito (o hook real devolve funções estáveis): `handleNavigate`
// depende de `prefetchViewPromise`, e a tela real de Devoluções depende de
// `onNavigate` no efeito que registra o Voltar — uma identidade nova a cada
// render vira laço de render entre o App e a tela.
vi.mock("@/hooks/usePrefetchOnHover", () => {
  const api = {
    prefetchView: () => {},
    prefetchAll: () => {},
    prefetchViewPromise: () => prova.chunkPendente ?? Promise.resolve(),
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

const PRODUTO_SIMPLES = {
  encontrado: true,
  origem: "produto" as const,
  codigo: "78912345",
  produto: {
    id: "produto-1",
    nome: "Camiseta Lisa",
    ativo: true,
    preco_venda: 39.9,
    estoque: 10,
    imagem: null,
    codigo_barras: "78912345",
    tem_variantes: false,
  },
  variante: null,
  preco: 39.9,
  estoque: 10,
  variacoes: [],
};

vi.mock("@/lib/supabase", () => {
  const consulta: Record<string, unknown> = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.single = () => Promise.resolve({ data: null, error: null });
  return {
    supabase: {
      from: () => consulta,
      rpc: (nome: string, params: Record<string, unknown>) => {
        if (nome === "buscar_por_codigo_barras") {
          return Promise.resolve({
            data: prova.respostaDoCodigo ?? PRODUTO_SIMPLES,
            error: null,
          });
        }
        if (nome === "registrar_venda_presencial") {
          return Promise.resolve({
            data: {
              ja_existia: false,
              order: {
                id: `pedido-${String(params.p_chave_idempotencia ?? "x")}`,
                created_at: new Date().toISOString(),
                total: 39.9,
                subtotal: 39.9,
                discount: 0,
                payment_method: params.p_pagamento ?? "cash",
                user_id: null,
                customer_name: "Venda no balcão",
                customer_data: { whatsapp: null, canal: "presencial" },
              },
              items: [
                {
                  product_id: "produto-1",
                  variant_id: null,
                  quantity: 1,
                  price: 39.9,
                  product_name: "Camiseta Lisa",
                },
              ],
            },
            error: null,
          });
        }
        return Promise.resolve({ data: { data: [] }, error: null });
      },
      functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
      storage: { from: () => ({}) },
      auth: { getSession: () => Promise.resolve({ data: { session: null } }) },
      channel: () => ({
        on: () => ({ subscribe: () => ({}) }),
        subscribe: () => ({}),
      }),
      removeChannel: () => {},
    },
  };
});

// Sem câmera: um botão "bipar" que lê o código armado pelo teste.
vi.mock("@/components/admin/pdv/LeitorDeCodigo", () => ({
  LeitorDeCodigo: ({
    aberto,
    aoLer,
  }: {
    aberto: boolean;
    aoLer: (leitura: { codigo: string; formato: string }) => void;
  }) =>
    aberto ? (
      <button
        type="button"
        onClick={() => aoLer({ codigo: prova.codigoBipado, formato: "ean_13" })}
      >
        bipar
      </button>
    ) : null,
}));

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

const RASCUNHO = "admin_pdv_venda_draft:lojista-1";

describe("Balcão no App de verdade: sair com a venda em andamento", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    prova.dialogoAberto = 0;
    prova.viewTransitions = 0;
    prova.respostaDoCodigo = null;
    prova.codigoBipado = "78912345";
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

    globalThis.history.replaceState(
      { view: "admin-orders" },
      "",
      "/admin-orders",
    );
    globalThis.history.pushState({ view: "admin-pdv" }, "", "/admin-pdv");

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
    // Nada pode vazar de um caso para o outro.
    expect(haOperacaoSensivel()).toBe(false);
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

  const botao = (rotulo: string) =>
    Array.from(container?.querySelectorAll("button") ?? []).find((b) =>
      (b.textContent ?? "").includes(rotulo),
    );
  const rota = () => globalThis.location.pathname + globalThis.location.search;

  const clicar = async (el: Element | null | undefined) => {
    if (!el) throw new Error("elemento não encontrado");
    await act(async () => {
      (el as HTMLElement).click();
    });
    await assentar();
  };

  const abrirBalcao = async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
    await esperarAte(() => botao("bipar") !== undefined);
  };

  const pecasNoRascunho = (): number => {
    const bruto = localStorage.getItem(RASCUNHO);
    if (!bruto) return 0;
    return (JSON.parse(bruto) as { itens: unknown[] }).itens.length;
  };

  it("com peça no cupom, o Voltar do aparelho sai do balcão sem aviso e a venda continua guardada", async () => {
    await abrirBalcao();
    await clicar(botao("bipar"));
    await esperarAte(() => botao("Fechar venda") !== undefined);

    await act(async () => {
      globalThis.history.back();
    });
    await assentar(20);

    expect(prova.dialogoAberto).toBe(0);
    expect(rota()).toBe("/admin-orders");
    // A venda foi guardada ANTES de sair (mesmo saindo logo após o bipe).
    expect(pecasNoRascunho()).toBe(1);
  });

  it("com peça no cupom e outra não cadastrada, 'Cadastrar produto' leva ao cadastro sem aviso", async () => {
    await abrirBalcao();
    await clicar(botao("bipar"));
    await esperarAte(() => botao("Fechar venda") !== undefined);

    prova.respostaDoCodigo = { encontrado: false };
    prova.codigoBipado = "000111";
    await clicar(botao("bipar"));
    await esperarAte(() => botao("Cadastrar produto") !== undefined);

    await clicar(botao("Cadastrar produto"));
    await esperarAte(
      () => container?.querySelector('[data-testid="tela-produto"]') != null,
    );

    expect(prova.dialogoAberto).toBe(0);
    expect(pecasNoRascunho()).toBe(1);
  });

  it("enquanto há peça no cupom, a atualização do app continua esperando (e solta ao sair)", async () => {
    await abrirBalcao();
    expect(haOperacaoSensivel()).toBe(false);

    await clicar(botao("bipar"));
    await esperarAte(() => botao("Fechar venda") !== undefined);
    expect(haOperacaoSensivel()).toBe(true);

    await act(async () => {
      globalThis.history.back();
    });
    await assentar(20);
    expect(rota()).toBe("/admin-orders");
    expect(haOperacaoSensivel()).toBe(false);
  });
});
