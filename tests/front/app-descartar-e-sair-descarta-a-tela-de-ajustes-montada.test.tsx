// @vitest-environment jsdom
//
// "Descartar e Sair" tem que DESCARTAR de verdade a tela de Ajustes, que no
// painel fica MONTADA por baixo quando a lojista vai para outra aba.
//
// O defeito: em Ajustes, a lojista mexe num prazo de "Trocas e devoluções",
// toca em Pedidos, o painel pergunta "Alterações Não Salvas" e ela confirma
// "Descartar e Sair". O diálogo só desligava a guarda e navegava; a tela de
// Ajustes (escondida, não desmontada) guardava o prazo mexido. Ao voltar, o
// campo continuava com o valor que ela mandou jogar fora, a pendência voltava
// a acender e o valor podia ser salvo sem querer.
//
// Provado aqui, com o App, a AdminArea e a tela de Ajustes (e a seção de
// devolução) REAIS: ao confirmar, só a tela que estava suja e está sendo
// deixada volta ao valor salvo; as outras abas montadas seguem como estavam.
//
// Harness do app-descartar-e-sair-apaga-o-rascunho-do-produto (mesmos dublês
// para renderizar o `<App/>`), com o portão do painel reduzido a "monta a
// AdminArea de verdade" e o AdminLayout a dois botões de aba.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Quantas vezes o diálogo de descarte ABRIU (virou de fechado para aberto) e
// quantas vezes a tela de Pedidos (dublê com estado próprio) foi montada.
const prova = vi.hoisted(() => ({
  dialogoAberturas: 0,
  dialogoEstavaAberto: false,
  pedidosMontados: 0,
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

// O portão é liberado, mas a AdminArea REAL continua no caminho: é ela que
// mantém as abas montadas e que tem de receber o sinal de descarte do App.
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

// O mesmo contrato do AdminLayout real: `currentView`, `onNavigate` e os filhos.
vi.mock("@/components/layouts/AdminLayout", () => ({
  AdminLayout: ({
    currentView,
    onNavigate,
    children,
  }: {
    readonly currentView: string;
    readonly onNavigate: (view: string, id?: string) => void;
    readonly children?: ReactNode;
  }) => (
    <div data-testid="admin-area" data-view={currentView}>
      <button
        type="button"
        data-testid="ir-pedidos"
        onClick={() => onNavigate("admin-orders")}
      >
        Pedidos
      </button>
      <button
        type="button"
        data-testid="ir-produto"
        onClick={() => onNavigate("admin-product-form", "p-1")}
      >
        Produto
      </button>
      <button
        type="button"
        data-testid="ir-ajustes"
        onClick={() => onNavigate("admin-settings")}
      >
        Ajustes
      </button>
      {children}
    </div>
  ),
}));

// Pedidos: dublê com ESTADO PRÓPRIO (o filtro digitado) e contagem de
// montagens. Prova que descartar Ajustes não remonta nem zera a outra aba.
vi.mock("@/views/admin/AdminOrdersView", async () => {
  const React = await import("react");
  function AdminOrdersView() {
    const [filtro, setFiltro] = React.useState("");
    React.useEffect(() => {
      prova.pedidosMontados += 1;
    }, []);
    return (
      <input
        data-testid="filtro-de-pedidos"
        value={filtro}
        onChange={(e) => setFiltro(e.target.value)}
      />
    );
  }
  return { AdminOrdersView };
});

// Formulário de produto: dublê que expõe só o contrato que o App usa
// (`onSetDirty`); o rascunho em si é do App descartar.
vi.mock("@/views/admin/AdminProductFormView", () => ({
  AdminProductFormView: ({
    onSetDirty,
  }: {
    readonly onSetDirty: (dirty: boolean) => void;
  }) => (
    <button
      type="button"
      data-testid="sujar-produto"
      onClick={() => onSetDirty(true)}
    >
      Editar produto
    </button>
  ),
}));

vi.mock("@/views/customer/HomeView", () => ({
  HomeView: () => <div data-testid="home" />,
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

// O diálogo RENDERIZADO só quando `open`, com "Permanecer" e "Descartar e Sair"
// como botões de verdade; como no Radix, Cancel e Action rodam o `onClick` e
// depois fecham (`onOpenChange(false)`). Conta as aberturas.
vi.mock("@/components/ui/alert-dialog", async () => {
  const React = await import("react");
  type MudarAberto = (aberto: boolean) => void;
  const ContextoDoDialogo = React.createContext<MudarAberto>(() => {});
  function AlertDialog({
    children,
    open,
    onOpenChange,
  }: {
    readonly children?: unknown;
    readonly open?: boolean;
    readonly onOpenChange?: MudarAberto;
  }) {
    if (open && !prova.dialogoEstavaAberto) prova.dialogoAberturas += 1;
    prova.dialogoEstavaAberto = !!open;
    if (!open) return null;
    return React.createElement(
      ContextoDoDialogo.Provider,
      { value: onOpenChange ?? (() => {}) },
      children as React.ReactNode,
    );
  }
  function BotaoDoDialogo({
    children,
    onClick,
  }: {
    readonly children?: unknown;
    readonly onClick?: () => void;
  }) {
    return (
      <ContextoDoDialogo.Consumer>
        {(mudarAberto) => (
          <button
            type="button"
            onClick={() => {
              onClick?.();
              mudarAberto(false);
            }}
          >
            {children as React.ReactNode}
          </button>
        )}
      </ContextoDoDialogo.Consumer>
    );
  }
  const passaFilhos = ({ children }: { readonly children?: unknown }) => (
    <>{children as React.ReactNode}</>
  );
  const nada = () => null;
  return {
    AlertDialog,
    AlertDialogAction: BotaoDoDialogo,
    AlertDialogCancel: BotaoDoDialogo,
    AlertDialogContent: passaFilhos,
    AlertDialogDescription: nada,
    AlertDialogFooter: passaFilhos,
    AlertDialogHeader: nada,
    AlertDialogTitle: nada,
  };
});

// `useStore` serve ao App (que só lê `config`) e à tela de Ajustes.
vi.mock("@/contexts/StoreContext", () => {
  const loja = {
    config: { storeCity: "Monte Carmelo", storeState: "MG" },
    isLoaded: true,
    updateConfig: () => {},
  };
  return {
    StoreProvider: ({ children }: { readonly children?: unknown }) =>
      children as never,
    useStore: () => loja,
  };
});
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
  useProducts: () => ({ products: [], loading: false }),
}));
vi.mock("@/hooks/useCategories", () => ({
  useCategories: () => ({ categories: [] }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
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
// Estável de propósito: `handleNavigate` depende dele.
vi.mock("@/hooks/usePrefetchOnHover", () => {
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

// A política SALVA no banco: prazo de troca 30. É o "valor salvo" a que a
// tela tem de voltar depois do descarte.
const POLITICA_SALVA = {
  id: 1,
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
  updated_at: "2026-10-17T10:00:00Z",
  updated_by: null,
};

vi.mock("@/lib/supabase", () => {
  const consulta = (tabela: string) => {
    const c: Record<string, unknown> = {};
    c.select = () => c;
    c.eq = () => c;
    c.limit = () => c;
    c.order = () => c;
    c.single = () => Promise.resolve({ data: null, error: null });
    c.maybeSingle = () =>
      Promise.resolve({
        data: tabela === "politica_devolucao" ? POLITICA_SALVA : null,
        error: null,
      });
    return c;
  };
  return {
    supabase: {
      from: (tabela: string) => consulta(tabela),
      rpc: () => Promise.resolve({ data: false, error: null }),
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
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

const CHAVE_DO_P1 = "ikcous_product_form_draft_edit_p-1:lojista-1";

describe("Descartar e Sair descarta de verdade a tela que continua montada", () => {
  let raiz: Root | null = null;
  let container: HTMLDivElement | null = null;

  beforeEach(() => {
    prova.dialogoAberturas = 0;
    prova.dialogoEstavaAberto = false;
    prova.pedidosMontados = 0;
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

  const view = () =>
    container
      ?.querySelector<HTMLDivElement>('[data-testid="admin-area"]')
      ?.getAttribute("data-view");

  const abrir = async (caminho: string, estado: Record<string, unknown>) => {
    globalThis.history.replaceState(estado, "", caminho);
    await act(async () => {
      raiz?.render(<App />);
    });
    await assentar();
    await esperarAte(() => view() !== undefined && view() !== null);
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

  const botaoComTexto = (texto: string) =>
    Array.from(container?.querySelectorAll("button") ?? []).find(
      (b) => b.textContent?.trim() === texto,
    );

  const clicarNoTexto = async (texto: string) => {
    const botao = botaoComTexto(texto);
    if (!botao) throw new Error(`botão "${texto}" não encontrado`);
    await act(async () => {
      botao.click();
    });
    await assentar();
  };

  const digitar = async (seletor: string, valor: string) => {
    const campo = container?.querySelector<HTMLInputElement>(seletor);
    if (!campo) throw new Error(`campo ${seletor} não encontrado`);
    const definir = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    await act(async () => {
      campo.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
      definir?.call(campo, valor);
      campo.dispatchEvent(new Event("input", { bubbles: true }));
      campo.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    });
    await assentar();
  };

  const prazoDeTroca = () =>
    container?.querySelector<HTMLInputElement>("#politica-troca")?.value;

  // Em Ajustes: abre o grupo "Regras de troca e devolução" (se ainda estiver
  // fechado), espera o campo da política chegar e exige o valor SALVO (30 dias).
  const abrirAPoliticaEmAjustes = async () => {
    // A tela de Ajustes é um pacote carregado sob demanda.
    const procurar = () =>
      container?.querySelector<HTMLButtonElement>(
        '[data-cabecalho-grupo][aria-label="Regras de troca e devolução"]',
      ) ?? null;
    await esperarAte(() => procurar() !== null);
    if (procurar()?.getAttribute("aria-expanded") !== "true") {
      await act(async () => {
        procurar()?.click();
      });
    }
    await esperarAte(() => prazoDeTroca() !== undefined);
    expect(prazoDeTroca()).toBe("30");
  };

  const sujarOPrazo = async () => {
    await digitar("#politica-troca", "45");
    expect(prazoDeTroca()).toBe("45");
  };

  it("alterar o prazo, tentar sair e Descartar e Sair: ao voltar a Ajustes o prazo é o salvo e a tela não está suja", async () => {
    await abrir("/admin-settings", { view: "admin-settings" });
    await abrirAPoliticaEmAjustes();
    await sujarOPrazo();

    await clicar("ir-pedidos");
    expect(view()).toBe("admin-settings");
    expect(prova.dialogoAberturas).toBe(1);

    await clicarNoTexto("Descartar e Sair");
    await esperarAte(() => view() === "admin-orders");

    await clicar("ir-ajustes");
    await esperarAte(() => view() === "admin-settings");

    // A tela voltou ao começo (grupos fechados): abrindo a política, o valor
    // é o salvo; o 45 jogado fora não sobrevive.
    await abrirAPoliticaEmAjustes();

    // E a tela não está suja: sair de novo NÃO pergunta nada.
    await clicar("ir-pedidos");
    await esperarAte(() => view() === "admin-orders");
    expect(prova.dialogoAberturas).toBe(1);
  });

  it("Permanecer não descarta nada: o prazo mexido fica, a tela segue suja", async () => {
    await abrir("/admin-settings", { view: "admin-settings" });
    await abrirAPoliticaEmAjustes();
    await sujarOPrazo();

    await clicar("ir-pedidos");
    expect(prova.dialogoAberturas).toBe(1);
    await clicarNoTexto("Permanecer");

    expect(view()).toBe("admin-settings");
    expect(prazoDeTroca()).toBe("45");

    // Segue suja: outra tentativa de sair pergunta de novo.
    await clicar("ir-pedidos");
    expect(prova.dialogoAberturas).toBe(2);
    expect(view()).toBe("admin-settings");
    expect(prazoDeTroca()).toBe("45");
  });

  it("descartar Ajustes não remonta nem zera outra aba montada (Pedidos com filtro)", async () => {
    await abrir("/admin-orders", { view: "admin-orders" });
    await digitar('[data-testid="filtro-de-pedidos"]', "maria");
    expect(prova.pedidosMontados).toBe(1);

    await clicar("ir-ajustes");
    await esperarAte(() => view() === "admin-settings");
    await abrirAPoliticaEmAjustes();
    await sujarOPrazo();

    await clicar("ir-pedidos");
    await clicarNoTexto("Descartar e Sair");
    await esperarAte(() => view() === "admin-orders");

    // Pedidos continua a mesma instância, com o filtro que ela tinha.
    expect(prova.pedidosMontados).toBe(1);
    expect(
      container?.querySelector<HTMLInputElement>(
        '[data-testid="filtro-de-pedidos"]',
      )?.value,
    ).toBe("maria");
  });

  it("descartar uma tela montada não mexe em Ajustes que NÃO estava suja", async () => {
    await abrir("/admin-settings", { view: "admin-settings" });
    await abrirAPoliticaEmAjustes();

    // Ajustes limpa: sai sem aviso e o valor segue como estava, sem remontar
    // (a leitura da política não é repetida: o campo não pisca nem fecha).
    await clicar("ir-pedidos");
    await esperarAte(() => view() === "admin-orders");
    expect(prova.dialogoAberturas).toBe(0);
    await clicar("ir-ajustes");
    await esperarAte(() => view() === "admin-settings");
    expect(prazoDeTroca()).toBe("30");
  });

  it("pelo Voltar do aparelho: Descartar e Sair também devolve Ajustes ao valor salvo", async () => {
    await abrir("/admin-orders", { view: "admin-orders" });
    await clicar("ir-ajustes");
    await esperarAte(() => view() === "admin-settings");
    await abrirAPoliticaEmAjustes();
    await sujarOPrazo();

    // O Voltar do aparelho leva ao Pedidos de antes: o App segura e pergunta.
    await act(async () => {
      globalThis.history.back();
    });
    await esperarAte(() => prova.dialogoAberturas === 1);
    expect(view()).toBe("admin-settings");

    await clicarNoTexto("Descartar e Sair");
    await esperarAte(() => view() === "admin-orders");

    await clicar("ir-ajustes");
    await esperarAte(() => view() === "admin-settings");
    await abrirAPoliticaEmAjustes();
    expect(prova.dialogoAberturas).toBe(1);
  });

  it("descartar OUTRA tela suja não remonta Ajustes, que estava limpa e aberta", async () => {
    await abrir("/admin-settings", { view: "admin-settings" });
    await abrirAPoliticaEmAjustes();

    await clicar("ir-produto");
    await esperarAte(() => view() === "admin-product-form");
    await clicar("sujar-produto");
    await clicar("ir-pedidos");
    await clicarNoTexto("Descartar e Sair");
    await esperarAte(() => view() === "admin-orders");

    // Ajustes não foi remontada: segue com o grupo aberto (uma remontagem o
    // fecharia e o campo sairia da tela).
    await clicar("ir-ajustes");
    await esperarAte(() => view() === "admin-settings");
    expect(prazoDeTroca()).toBe("30");
    expect(
      container
        ?.querySelector(
          '[data-cabecalho-grupo][aria-label="Regras de troca e devolução"]',
        )
        ?.getAttribute("aria-expanded"),
    ).toBe("true");
  });

  it("o formulário de produto continua descartando o rascunho dele", async () => {
    localStorage.setItem(CHAVE_DO_P1, JSON.stringify({ name: "rascunho" }));
    await abrir("/admin-product-form?id=p-1", {
      view: "admin-product-form",
      id: "p-1",
    });
    await clicar("sujar-produto");
    await clicar("ir-pedidos");
    expect(localStorage.getItem(CHAVE_DO_P1)).not.toBeNull();

    await clicarNoTexto("Descartar e Sair");

    expect(localStorage.getItem(CHAVE_DO_P1)).toBeNull();
    await esperarAte(() => view() === "admin-orders");
  });
});
