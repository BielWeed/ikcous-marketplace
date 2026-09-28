// @vitest-environment jsdom
//
// B1 do item 2 da fila do bastão (19/09): o Voltar do APARELHO no PDV com
// cupom cheio e camada aberta tem de fechar a CAMADA (o override registrado
// pelo AdminPdvView — perda zero, os itens continuam no cupom) e NÃO abrir o
// diálogo "alterações não salvas". Até este conserto, o gate de dirty do
// `handlePopState` corria ANTES da consulta ao `backOverrideRef`: re-empurrava
// o histórico sem a marca `{modal}` (a entrada da camada já tinha sido
// consumida pelo navegador ao apertar Voltar) e marcava `pendingNavigation`
// com a MESMA view — o diálogo abria por cima da camada que continuava
// aberta, sem ninguém ter saído de tela nenhuma (mesmo tema do 94c2638, lado
// do App).
//
// Harness copiado de app-aba-ativa-com-formulario-sujo-nao-desliga-a-guarda
// .test.tsx (mesmo padrão de mocks pesados para renderizar o `<App/>` de
// verdade; `AdminAreaGate` vira dublê mínimo que exõe os MESMOS contratos que
// o AdminPdvView real usa — `setIsAdminDirty` e `setBackOverride`, ambos
// descidos pelo App). O AlertDialog é dublê que CONTA quando renderiza
// `open={true}` — o `open` do diálogo é `!!pendingNavigation` (App.tsx), então
// é a prova direta de que o gate de dirty setou (ou não) a navegação pendente.
//
// Bloco "Devoluções na rota" (frente X2, `?id=` da ficha na URL): a mesma
// máquina de Voltar/dirty, agora com a AdminDevolucoesView REAL (ficha suja +
// Cancelar no Voltar não pode fechar a ficha no Chrome) e a View Transition
// ASSÍNCRONA — o stub de `document.startViewTransition` roda o callback depois
// de um tick, como o navegador. Também prende o que o ramo "só troca a ficha"
// do `handleNavigate` não pode engolir (produto → produto segue pela View
// Transition) e as três listas de `admin-devolucoes` que serializam o `?id=`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Prova compartilhada entre os dublês: quantas vezes o override da camada
// rodou (o "fechamento da camada"), quantas renderizações o AlertDialog fez
// aberto (`open === true` — o diálogo de "alterações não salvas") e quantas
// vezes ele ABRIU (virou de fechado para aberto), que é o que "aparece uma vez"
// mede. `telaReal` escolhe, por teste, entre a AdminDevolucoesView de verdade e
// o dublê de contrato (mais abaixo); `respostas` alimenta as RPCs da tela real.
const prova = vi.hoisted(() => {
  const estado = {
    camadaFechadaPeloOverride: 0,
    dialogoAberto: 0,
    dialogoAberturas: 0,
    dialogoEstavaAberto: false,
    viewTransitions: 0,
    telaReal: false,
    respostas: new Map<string, unknown>(),
    produtos: [{ id: "p-1" }, { id: "p-2" }],
    // Quando preenchida, o chunk da tela de destino "ainda está baixando":
    // a navegação fica presa na trava de transição, com a tela antiga de pé.
    chunkPendente: null as Promise<void> | null,
  };
  // View Transition ASSÍNCRONA, como no Chrome: o callback que troca a tela só
  // roda depois de um tick (o navegador captura o estado antigo antes). O hook
  // real `useViewTransition` decide `isSupported` UMA vez, ao carregar o
  // módulo — por isso o stub nasce aqui, antes de qualquer import. Um dublê
  // síncrono esconde tudo que depende de "o que roda depois de o Voltar já ter
  // sido consumido".
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

// Dublê MÍNIMO do PDV: expõe os mesmos contratos usados pela tela real.
vi.mock("@/views/admin/AdminPdvView", () => ({
  AdminPdvView: ({
    onSetDirty,
    onSetBackOverride,
  }: {
    readonly onSetDirty: (dirty: boolean) => void;
    readonly onSetBackOverride: (fn: (() => void) | null) => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid="sujar-cupom"
        onClick={() => onSetDirty(true)}
      >
        Cupom cheio
      </button>
      <button
        type="button"
        data-testid="abrir-camada"
        onClick={() => {
          window.history.pushState(
            { ...window.history.state, modal: "pdv" },
            "",
            window.location.pathname + window.location.search,
          );
          onSetBackOverride(() => () => {
            prova.camadaFechadaPeloOverride += 1;
          });
        }}
      >
        Abrir camada de cliente
      </button>
    </div>
  ),
}));

// A tela de Devoluções tem DUAS caras, escolhidas por teste em `prova.telaReal`:
// - a REAL (`AdminDevolucoesView` de verdade, com as RPCs respondidas por
//   `prova.respostas`): é o que prova o Voltar do aparelho com a ficha suja;
// - um dublê de CONTRATO, com um botão por gesto que a tela faz no App
//   (trocar de ficha, sujar, registrar o override uma única vez). Ele NÃO se
//   registra sozinho quando o id muda: a tela real re-registra o override a
//   cada ficha nova (o efeito dela depende de `selecionada`), o que esconderia
//   um `setBackOverride(null)` indevido no App — o dublê que registra uma vez
//   só é o que expõe esse defeito.
vi.mock("@/views/admin/AdminDevolucoesView", async (importarOriginal) => {
  const original =
    await importarOriginal<
      typeof import("@/views/admin/AdminDevolucoesView")
    >();
  type Propriedades = React.ComponentProps<typeof original.AdminDevolucoesView>;
  function DubleDeContrato({
    onNavigate,
    selectedDevolucaoId,
    onSetDirty,
    onSetBackOverride,
  }: Propriedades) {
    return (
      <div data-testid="devolucao-id" data-id={selectedDevolucaoId ?? ""}>
        <button
          type="button"
          data-testid="trocar-devolucao"
          onClick={() => onNavigate("admin-devolucoes", "dev-2", true)}
        >
          Trocar devolução
        </button>
        <button
          type="button"
          data-testid="sair-da-tela"
          onClick={() => onNavigate("admin-orders")}
        >
          Ir para Pedidos
        </button>
        <button
          type="button"
          data-testid="registrar-override"
          onClick={() =>
            onSetBackOverride?.(() => () => {
              prova.camadaFechadaPeloOverride += 1;
            })
          }
        >
          Registrar o Voltar da ficha
        </button>
        <button
          type="button"
          data-testid="sujar-devolucao"
          onClick={() => {
            onSetDirty?.(true);
            // O que a tela real faz com a ficha suja: solta o override e deixa
            // o controle de dirty do App cuidar do Voltar.
            onSetBackOverride?.(null);
          }}
        >
          Alterar devolução
        </button>
      </div>
    );
  }
  return {
    AdminDevolucoesView: (props: Propriedades) =>
      prova.telaReal ? (
        <original.AdminDevolucoesView {...props} />
      ) : (
        <DubleDeContrato {...props} />
      ),
  };
});

// Porta do "Ver devolução" do pedido: a tela de Pedidos só chama
// `onNavigate("admin-devolucoes", <id da devolução>)`.
vi.mock("@/views/admin/AdminOrdersView", () => ({
  AdminOrdersView: ({
    onNavigate,
  }: {
    readonly onNavigate: (view: string, id?: string) => void;
  }) => (
    <button
      type="button"
      data-testid="ver-devolucao-do-pedido"
      onClick={() =>
        onNavigate("admin-devolucoes", "5b1f1c1e-6a52-4c7e-9d35-0f2d7c9a4b10")
      }
    >
      Ver devolução
    </button>
  ),
}));

vi.mock("@/views/customer/HomeView", () => ({
  HomeView: () => <div data-testid="home" />,
}));
vi.mock("@/views/customer/CartView", () => ({
  CartView: () => <div data-testid="tela-carrinho" />,
}));
// Dublê do ProductView com a mesma porta da faixa "você também pode gostar":
// `onProductClick` leva a `handleNavigate("product-detail", <outro id>)`.
vi.mock("@/views/customer/ProductView", () => ({
  ProductView: ({
    product,
    onProductClick,
  }: {
    readonly product: { id: string };
    readonly onProductClick: (id: string) => void;
  }) => (
    <div data-testid="tela-produto" data-id={product.id}>
      <button
        type="button"
        data-testid="abrir-outro-produto"
        onClick={() => onProductClick("p-2")}
      >
        Você também pode gostar
      </button>
    </div>
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

// Dublê do AlertDialog que CONTA as renderizações abertas: o App abre o
// diálogo de "alterações não salvas" com `open={!!pendingNavigation}` —
// `dialogoAberto > 0` é a prova de que o gate de dirty capturou o popstate.
vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await import("react");
  function AlertDialog({
    children,
    open,
  }: {
    readonly children?: unknown;
    readonly open?: boolean;
  }) {
    if (open) {
      prova.dialogoAberto += 1;
      if (!prova.dialogoEstavaAberto) prova.dialogoAberturas += 1;
    }
    prova.dialogoEstavaAberto = !!open;
    return React.createElement(
      React.Fragment,
      null,
      children as React.ReactNode,
    );
  }
  const nada = () => null;
  return {
    AlertDialog,
    AlertDialogAction: nada,
    AlertDialogCancel: nada,
    AlertDialogContent: ({ children }: { readonly children?: unknown }) =>
      React.createElement(React.Fragment, null, children as React.ReactNode),
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

vi.mock("@/lib/supabase", () => {
  const consulta: Record<string, unknown> = {};
  consulta.select = () => consulta;
  consulta.eq = () => consulta;
  consulta.single = () => Promise.resolve({ data: null, error: null });
  return {
    supabase: {
      from: () => consulta,
      rpc: (nome: string) =>
        Promise.resolve({
          data: prova.respostas.has(nome) ? prova.respostas.get(nome) : false,
          error: null,
        }),
      functions: { invoke: () => Promise.resolve({ data: {}, error: null }) },
      storage: {
        from: () => ({
          createSignedUrl: () =>
            Promise.resolve({
              data: { signedUrl: "https://assinada/a.jpg" },
              error: null,
            }),
        }),
      },
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

// Uma devolução `recebida` (o lojista inspeciona e conclui): é a ficha que a
// tela real abre pela lista e onde "Nova, sem uso" suja o formulário.
const LINHA = {
  id: "d-1",
  protocolo: "DV260926-ABCDE",
  order_id: "o-1",
  cliente_nome: "Maria",
  cliente_whatsapp: "34999999999",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  status: "recebida",
  resolucao_desejada: "reembolso",
  metodo_retorno: "envio_proprio",
  modalidade: "nacional",
  valor_itens: 199.8,
  prazo_ate: "2026-10-01",
  created_at: "2026-09-26T10:00:00Z",
};

const DETALHE = {
  ...LINHA,
  detalhe: "Ficou apertado.",
  resolucao_final: null,
  valor_frete_ida: 20,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: [],
  codigo_rastreio: "AB123456789BR",
  codigo_postagem: null,
  etiqueta_url: null,
  me_reverse_id: null,
  coleta_em: null,
  mensagem_loja: null,
  observacao_inspecao: null,
  entregue_em: "2026-09-24T15:00:00Z",
  politica: null,
  aprovada_em: "2026-09-26T11:00:00Z",
  postada_em: "2026-09-26T12:00:00Z",
  recebida_em: "2026-09-27T12:00:00Z",
  concluida_em: null,
  encerrada_em: null,
  itens: [
    {
      id: "di-1",
      order_item_id: "oi-1",
      product_id: "p-1",
      variant_id: null,
      product_name: "Tênis",
      image_url: null,
      quantidade: 2,
      valor_unitario: 99.9,
      condicao: null,
      reestocar: null,
      reestocado_em: null,
    },
  ],
  eventos: [
    {
      id: 1,
      de_status: null,
      para_status: "solicitada",
      ator: "cliente",
      nota: null,
      created_at: "2026-09-26T10:00:00Z",
    },
  ],
  pedido: {
    id: "o-1",
    total: 219.8,
    shipping: 20,
    payment_method: "online",
    payment_status: "pago",
    canal: "online",
    customer_name: "Maria",
    whatsapp: "34999999999",
    shipping_label_id: null,
    shipping_option_id: null,
  },
};

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

describe("Voltar do aparelho no PDV: a camada aberta vem antes do gate de dirty", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    prova.camadaFechadaPeloOverride = 0;
    prova.dialogoAberto = 0;
    prova.dialogoAberturas = 0;
    prova.dialogoEstavaAberto = false;
    prova.viewTransitions = 0;
    prova.telaReal = false;
    prova.chunkPendente = null;
    prova.respostas.clear();
    prova.respostas.set("admin_devolucoes_listar", {
      total: 1,
      contagem: { recebida: 1 },
      itens: [LINHA],
    });
    prova.respostas.set("devolucao_detalhe", DETALHE);
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

    globalThis.history.replaceState({ view: "admin-pdv" }, "", "/admin-pdv");

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

  const areaAdmin = () =>
    container?.querySelector<HTMLDivElement>('[data-testid="admin-area"]') ??
    null;

  const abrir = async () => {
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
    await esperarAte(() => areaAdmin() !== null);
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

  it("com cupom cheio e camada aberta, o Voltar fecha a camada e o diálogo de alterações não salvas NÃO abre", async () => {
    await abrir();

    // O cenário do relato: cupom com itens (dirty ligado) e a camada de
    // cliente aberta por cima (override registrado + entrada {modal} no
    // histórico, o mesmo par de gestos do AdminPdvView real).
    await clicar("sujar-cupom");
    await clicar("abrir-camada");
    expect(globalThis.history.state?.modal).toBe("pdv");

    // O Voltar do APARELHO: o navegador consome a entrada {modal} da camada
    // e entrega o popstate — o `history.back()` do jsdom dispara o evento
    // em uma macrotask.
    await act(async () => {
      globalThis.history.back();
    });
    await esperarAte(() => prova.camadaFechadaPeloOverride > 0);

    // A camada fechou pelo override (o Voltar era dela)…
    expect(prova.camadaFechadaPeloOverride).toBe(1);
    // …e o diálogo "alterações não salvas" NUNCA abriu: o gate de dirty não
    // pode roubar o popstate de uma camada que fecha sem perder nada.
    expect(prova.dialogoAberto).toBe(0);
  });

  it("sem camada aberta, o gate de dirty segue valendo: o Voltar com cupom cheio abre o diálogo", async () => {
    await abrir();

    // Cupom cheio, NENHUMA camada aberta (override desregistrado): aqui o
    // Voltar É uma tentativa de sair da tela — o diálogo tem de abrir.
    await clicar("sujar-cupom");

    // O histórico precisa de uma entrada ANTERIOR para o Voltar existir (o
    // `back()` do jsdom com pilha de uma entrada só não dispara popstate) —
    // o caminho de entrada do PDV no app real empurra entradas ao navegar.
    globalThis.history.pushState({ view: "admin-orders" }, "", "/admin-orders");
    await act(async () => {
      globalThis.history.back();
    });
    await esperarAte(() => prova.dialogoAberto > 0);

    expect(prova.dialogoAberto).toBeGreaterThan(0);
    expect(prova.camadaFechadaPeloOverride).toBe(0);
  });

  it("propaga o id da rota pela AdminArea e serializa a troca de ficha no App", async () => {
    globalThis.history.replaceState(
      { view: "admin-devolucoes", id: "dev-1" },
      "",
      "/admin-devolucoes?id=dev-1",
    );
    await abrir();

    const ficha = () =>
      container?.querySelector<HTMLDivElement>('[data-testid="devolucao-id"]');
    await esperarAte(() => ficha()?.dataset.id === "dev-1");
    prova.viewTransitions = 0;

    await clicar("trocar-devolucao");

    expect(ficha()?.dataset.id).toBe("dev-2");
    expect(prova.viewTransitions).toBe(0);
    expect(globalThis.location.pathname + globalThis.location.search).toBe(
      "/admin-devolucoes?id=dev-2",
    );

    await clicar("sujar-devolucao");
    await act(async () => {
      globalThis.history.back();
    });
    await esperarAte(() => prova.dialogoAberto > 0);
    expect(globalThis.location.pathname + globalThis.location.search).toBe(
      "/admin-devolucoes?id=dev-2",
    );
  });
  describe("Devoluções na rota: a ficha aberta pelo App", () => {
    const rota = () =>
      globalThis.location.pathname + globalThis.location.search;
    const ficha = () =>
      container?.querySelector<HTMLDivElement>(
        '[data-testid="detalhe-devolucao"]',
      ) ?? null;
    const dubleDaFicha = () =>
      container?.querySelector<HTMLDivElement>(
        '[data-testid="devolucao-id"]',
      ) ?? null;
    const botaoComTexto = (texto: string) =>
      Array.from(container?.querySelectorAll("button") ?? []).find(
        (b) => b.textContent?.trim() === texto,
      );
    const clicarEm = async (el: Element | null | undefined) => {
      if (!el) throw new Error("elemento não encontrado");
      await act(async () => {
        (el as HTMLElement).click();
      });
      await assentar();
    };
    const montar = async (pronto: () => boolean) => {
      await act(async () => {
        raiz?.render(<App />);
      });
      await assentar();
      await esperarAte(pronto);
    };
    // O Voltar do aparelho: o jsdom entrega o popstate em uma macrotask e a
    // View Transition do teste roda em outra — `assentar` espera as duas.
    const voltar = async () => {
      await act(async () => {
        globalThis.history.back();
      });
      await assentar(20);
    };

    it("com a ficha SUJA, o Voltar não fecha a ficha: o diálogo do App abre uma vez e o que foi escolhido fica", async () => {
      prova.telaReal = true;
      const confirmar = vi.fn(() => false); // o lojista responde "Cancelar"
      vi.stubGlobal("confirm", confirmar);
      globalThis.history.replaceState(
        { view: "admin-devolucoes" },
        "",
        "/admin-devolucoes",
      );
      await montar(
        () => container?.querySelector('[data-devolucao="d-1"]') != null,
      );

      // Abre a devolução pela lista e suja o formulário (concluir → condição).
      await clicarEm(container?.querySelector('[data-devolucao="d-1"]'));
      await esperarAte(() => ficha() !== null);
      expect(rota()).toBe("/admin-devolucoes?id=d-1");
      await clicarEm(botaoComTexto("Concluir"));
      await clicarEm(botaoComTexto("Nova, sem uso"));
      expect(botaoComTexto("Nova, sem uso")?.getAttribute("aria-pressed")).toBe(
        "true",
      );

      await voltar();

      // A ficha continua aberta, com o que o lojista escolheu…
      expect(ficha()).not.toBeNull();
      expect(botaoComTexto("Nova, sem uso")?.getAttribute("aria-pressed")).toBe(
        "true",
      );
      // …a URL segue com o id da ficha…
      expect(rota()).toBe("/admin-devolucoes?id=d-1");
      // …e quem perguntou sobre as alterações não salvas foi o App, uma vez
      // só — não o `confirm` da tela, que rodaria com o Voltar já consumido.
      expect(prova.dialogoAberturas).toBe(1);
      expect(confirmar).not.toHaveBeenCalled();
    });

    it("com a ficha LIMPA, o Voltar fecha a ficha pelo override e não pergunta nada", async () => {
      prova.telaReal = true;
      const confirmar = vi.fn(() => false);
      vi.stubGlobal("confirm", confirmar);
      globalThis.history.replaceState(
        { view: "admin-devolucoes" },
        "",
        "/admin-devolucoes",
      );
      await montar(
        () => container?.querySelector('[data-devolucao="d-1"]') != null,
      );
      await clicarEm(container?.querySelector('[data-devolucao="d-1"]'));
      await esperarAte(() => ficha() !== null);

      await voltar();

      expect(ficha()).toBeNull();
      expect(rota()).toBe("/admin-devolucoes");
      expect(prova.dialogoAberturas).toBe(0);
      expect(confirmar).not.toHaveBeenCalled();
    });

    it("trocar de produto pela vitrine segue pela View Transition: o ramo da ficha não vale fora das Devoluções", async () => {
      globalThis.history.replaceState(
        { view: "product-detail", id: "p-1" },
        "",
        "/product-detail?id=p-1",
      );
      const produtoAberto = () =>
        container?.querySelector<HTMLElement>('[data-testid="tela-produto"]');
      await montar(() => produtoAberto()?.dataset.id === "p-1");
      prova.viewTransitions = 0;

      await clicarEm(
        container?.querySelector('[data-testid="abrir-outro-produto"]'),
      );
      await esperarAte(() => produtoAberto()?.dataset.id === "p-2");

      // É a View Transition que leva a foto do card para a foto principal.
      expect(prova.viewTransitions).toBe(1);
      expect(rota()).toBe("/product-detail?id=p-2");
    });

    it('"Ver devolução" no pedido leva o id da devolução para a URL', async () => {
      globalThis.history.replaceState(
        { view: "admin-orders" },
        "",
        "/admin-orders",
      );
      await montar(() => areaAdmin() !== null);

      await clicarEm(
        container?.querySelector('[data-testid="ver-devolucao-do-pedido"]'),
      );
      await esperarAte(() => dubleDaFicha() !== null);

      const idDaDevolucao = "5b1f1c1e-6a52-4c7e-9d35-0f2d7c9a4b10";
      expect(rota()).toBe(`/admin-devolucoes?id=${idDaDevolucao}`);
      expect(dubleDaFicha()?.dataset.id).toBe(idDaDevolucao);
    });

    it("o Voltar durante a troca de tela devolve a URL da ficha, com o ?id=", async () => {
      globalThis.history.replaceState(
        { view: "admin-orders" },
        "",
        "/admin-orders",
      );
      globalThis.history.pushState(
        { view: "admin-devolucoes", id: "d-1" },
        "",
        "/admin-devolucoes?id=d-1",
      );
      // O chunk de Pedidos não chegou: a trava de transição segura a tela
      // antiga (a ficha d-1) enquanto o lojista aperta Voltar.
      prova.chunkPendente = new Promise<void>(() => {});
      await montar(() => dubleDaFicha()?.dataset.id === "d-1");
      await clicar("sair-da-tela");
      expect(dubleDaFicha()?.dataset.id).toBe("d-1");

      await voltar();

      // O App re-empurra a rota da tela que continua de pé — a ficha inclusive.
      expect(rota()).toBe("/admin-devolucoes?id=d-1");
      expect(dubleDaFicha()?.dataset.id).toBe("d-1");
    });

    it("abrir outra ficha enquanto a troca de tela espera o chunk cancela a troca pendente", async () => {
      globalThis.history.replaceState(
        { view: "admin-orders" },
        "",
        "/admin-orders",
      );
      globalThis.history.pushState(
        { view: "admin-devolucoes", id: "dev-1" },
        "",
        "/admin-devolucoes?id=dev-1",
      );
      let liberarChunk = () => {};
      prova.chunkPendente = new Promise<void>((resolver) => {
        liberarChunk = resolver;
      });
      await montar(() => dubleDaFicha()?.dataset.id === "dev-1");
      await clicar("sair-da-tela");

      // Passa da janela de 400ms da trava: a próxima navegação destrava e
      // segue — a ficha nova é a última intenção do lojista.
      await act(async () => {
        await new Promise((resolver) => setTimeout(resolver, 450));
      });
      await clicar("trocar-devolucao");
      expect(dubleDaFicha()?.dataset.id).toBe("dev-2");

      // O chunk de Pedidos chega tarde: a troca de tela ficou velha.
      liberarChunk();
      await assentar(20);

      expect(dubleDaFicha()?.dataset.id).toBe("dev-2");
      expect(rota()).toBe("/admin-devolucoes?id=dev-2");
    });

    it("trocar de ficha não zera o Voltar que a tela registrou: ele continua fechando a ficha", async () => {
      globalThis.history.replaceState(
        { view: "admin-devolucoes" },
        "",
        "/admin-devolucoes",
      );
      globalThis.history.pushState(
        { view: "admin-devolucoes", id: "dev-1" },
        "",
        "/admin-devolucoes?id=dev-1",
      );
      await montar(() => dubleDaFicha()?.dataset.id === "dev-1");
      await clicar("registrar-override");

      await clicar("trocar-devolucao");
      expect(dubleDaFicha()?.dataset.id).toBe("dev-2");

      await voltar();

      expect(prova.camadaFechadaPeloOverride).toBe(1);
    });
  });
});
