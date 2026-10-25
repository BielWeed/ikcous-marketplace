// @vitest-environment jsdom
//
// Defeito (O2 da revisão da tela Pedidos): "Preparar pedidos" no Início abria a
// tela Pedidos com o filtro, a busca e o período que a lojista deixou salvos
// no aparelho da última vez. Quem tocava num atalho que promete "os pedidos
// para preparar" via uma lista vazia ou de outro assunto e concluía que os
// pedidos tinham sumido.
//
// O conserto separa duas portas: o ATALHO do Início abre Pedidos limpo (Em
// aberto, sem busca, sem período, sem pagamento nem canal, página 1); o MENU
// continua abrindo como a lojista deixou (a preferência salva é dela).
//
// O teste monta as duas telas lado a lado, como o painel faz (as abas ficam
// montadas e só trocam o `active`), e olha o que a tela Pedidos PEDE ao banco:
// nenhum pedido de lista com o filtro antigo pode sair depois do atalho.
import type { View } from "@/types";
import { act, useEffect, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  respostas: new Map<string, { data: unknown; error: unknown }>(),
  // Cada chamada de `loadOrders` da tela Pedidos, com os argumentos na ordem
  // do hook: (página, tamanho, status, busca, início, fim, silencioso,
  // pagamento, canal).
  cargas: [] as unknown[][],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) =>
      Promise.resolve(h.respostas.get(nome) ?? { data: null, error: null }),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: () => {
      const canal = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({
    session: { user: { id: "adm-1" } },
    profile: { full_name: "Gabriel Dono" },
    isAdmin: true,
  }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { storeName: "Loja do Gabriel" },
    isLoaded: true,
    products: [{ isActive: true }],
    loadingProducts: false,
    updateConfig: vi.fn(),
  }),
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({
    ref: { current: null },
    saveScroll: vi.fn(),
    resetRestored: vi.fn(),
  }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Funções estáveis entre renders: a tela refaz a carga quando a identidade
// delas muda, e o que se mede aqui é a carga, não o render.
const loadOrdersEstavel = (...args: unknown[]) => {
  h.cargas.push(args);
};
const retornoDoUseOrders = {
  orders: [],
  loadOrders: loadOrdersEstavel,
  updateOrderStatus: vi.fn(),
  // Total alto: a tela volta sozinha para a página 1 quando a página salva
  // passa do total (trava legítima dela), e o teste do menu precisa que a
  // página 4 salva continue existindo.
  totalOrders: 100,
  isLoaded: true,
  loading: false,
};
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => retornoDoUseOrders,
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorFalso {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const texto = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\u00a0/g, " ");

async function esperarAte(condicao: () => boolean, timeoutMs = 3000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: não aconteceu em ${timeoutMs}ms — corpo: ${texto(document.body).slice(0, 300)}`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

const PAINEL_COM_PEDIDOS = {
  hoje: { receita: 0, online: 0, presencial: 0, pedidos: 0 },
  mes: { receita: 0, pedidos: 3, ticket_medio: 0, lucro_estimado: 0 },
  saldo_total: 0,
  a_receber_7d: 0,
  a_pagar_7d: 0,
  contas_vencidas: 0,
  pendencias: {
    pedidos_para_preparar: 5,
    devolucoes_abertas: 0,
    caixa_aberto: false,
    estoque_baixo: 0,
  },
  serie_14d: [],
};

// O que a lojista deixou salvo no aparelho na última visita a Pedidos.
function salvarFiltrosAntigos() {
  const guardar = (chave: string, valor: unknown) =>
    window.localStorage.setItem(chave, JSON.stringify(valor));
  guardar("admin_orders_filter_v2", "delivered");
  guardar("admin_orders_payment_filter", "pago");
  guardar("admin_orders_canal_filter", "presencial");
  guardar("admin_orders_search_query", "maria");
  guardar("admin_orders_date_range", {
    start: "2026-10-01",
    end: "2026-10-10",
  });
  guardar("admin_orders_current_page", 3);
}

function botaoPorTexto(raiz: ParentNode, alvo: string) {
  const botao = Array.from(raiz.querySelectorAll("button")).find((b) =>
    texto(b).includes(alvo),
  );
  if (!botao) throw new Error(`botão "${alvo}" não encontrado`);
  return botao;
}

describe("Início → Pedidos: o atalho abre limpo, o menu respeita o que ficou salvo", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ObservadorFalso);
    vi.stubGlobal("IntersectionObserver", ObservadorFalso);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    Element.prototype.scrollIntoView = vi.fn();
    // O cache do Início é de módulo: cada teste começa com módulos novos (e,
    // junto, sem pedido de "abrir limpo" esquecido pelo teste anterior).
    vi.resetModules();
    h.respostas.clear();
    h.cargas.length = 0;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montarAsDuasTelas() {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    // Mesmo desenho do painel: as duas abas ficam montadas, só uma ativa.
    // `abrirPeloMenu` é a porta do menu de baixo: troca de aba sem passar
    // pelo Início.
    const menu = { abrir: () => {} };
    function Casa() {
      const [tela, setTela] = useState<View>("admin-dashboard");
      useEffect(() => {
        menu.abrir = () => setTela("admin-orders");
      }, []);
      return (
        <>
          <AdminDashboardView
            active={tela === "admin-dashboard"}
            onNavigate={(destino) => setTela(destino)}
          />
          <AdminOrdersView
            active={tela === "admin-orders"}
            onNavigate={(destino) => setTela(destino)}
          />
        </>
      );
    }
    await act(async () => {
      raiz.render(<Casa />);
    });
    return { abrirPeloMenu: () => act(async () => menu.abrir()) };
  }

  it("'Preparar pedidos' do Início abre Pedidos em 'Em aberto', sem busca, período, pagamento nem canal salvos", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL_COM_PEDIDOS, error: null });
    salvarFiltrosAntigos();
    await montarAsDuasTelas();
    await esperarAte(() => texto(hospedeiro).includes("Preparar pedidos"));

    await act(async () => {
      botaoPorTexto(hospedeiro, "Preparar pedidos").click();
    });
    await esperarAte(() => h.cargas.length > 0);

    // Nenhum pedido de lista saiu com o filtro antigo (o que a lojista via
    // era a lista errada, não só a lista certa depois da errada).
    expect(h.cargas.some((c) => c[2] === "delivered")).toBe(false);
    expect(h.cargas.some((c) => c[3] === "maria")).toBe(false);

    const ultima = h.cargas.at(-1);
    expect(ultima?.[0]).toBe(0); // página 1
    expect(ultima?.[2]).toBe("open"); // Em aberto
    expect(ultima?.[3] ?? "").toBe(""); // sem busca
    expect(ultima?.[4] ?? "").toBe(""); // sem início de período
    expect(ultima?.[5] ?? "").toBe(""); // sem fim de período
    expect(ultima?.[7]).toBe("all"); // qualquer pagamento
    expect(ultima?.[8]).toBe("all"); // qualquer canal

    // E o aparelho passa a guardar o estado limpo (a tela não volta ao filtro
    // antigo ao recarregar).
    expect(window.localStorage.getItem("admin_orders_filter_v2")).toBe(
      '"open"',
    );
    expect(window.localStorage.getItem("admin_orders_search_query")).toBe('""');
    expect(window.localStorage.getItem("admin_orders_current_page")).toBe("0");
  });

  it("a linha 'Pedidos para preparar' do Para fazer (quando o Início não tem os números) também abre limpo", async () => {
    // Sem resposta do banco o Início não tem contagem: o botão grande some e
    // a linha do Para fazer, com o traço no lugar do número, é a porta.
    h.respostas.set("painel_inicio", {
      data: null,
      error: { code: "PGRST202", message: "Could not find the function" },
    });
    salvarFiltrosAntigos();
    await montarAsDuasTelas();
    await esperarAte(
      () =>
        hospedeiro.querySelector('[aria-label^="Pedidos para preparar:"]') !==
        null,
    );

    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          '[aria-label^="Pedidos para preparar:"]',
        )
        ?.click();
    });
    await esperarAte(() => h.cargas.length > 0);

    expect(h.cargas.some((c) => c[2] === "delivered")).toBe(false);
    expect(h.cargas.at(-1)?.[2]).toBe("open");
    expect(h.cargas.at(-1)?.[7]).toBe("all");
  });

  it("abrir Pedidos pelo MENU mantém o filtro, a busca e a página que a lojista deixou", async () => {
    h.respostas.set("painel_inicio", { data: PAINEL_COM_PEDIDOS, error: null });
    salvarFiltrosAntigos();
    const { abrirPeloMenu } = await montarAsDuasTelas();

    await abrirPeloMenu();
    await esperarAte(() => h.cargas.length > 0);

    const ultima = h.cargas.at(-1);
    expect(ultima?.[0]).toBe(3);
    expect(ultima?.[2]).toBe("delivered");
    expect(ultima?.[3]).toBe("maria");
    expect(ultima?.[7]).toBe("pago");
    expect(ultima?.[8]).toBe("presencial");
    expect(window.localStorage.getItem("admin_orders_filter_v2")).toBe(
      '"delivered"',
    );
  });
});

describe("pedido de 'abrir Pedidos limpo' (o recado do Início para a tela Pedidos)", () => {
  it("vale uma vez só", async () => {
    vi.resetModules();
    const lib = await import("@/lib/atalho-do-inicio-para-pedidos");
    lib.pedirPedidosSemFiltroAntigo(1_000);
    expect(lib.consumirPedidoDePedidosSemFiltroAntigo(1_500)).toBe(true);
    expect(lib.consumirPedidoDePedidosSemFiltroAntigo(1_600)).toBe(false);
  });

  it("sem pedido nenhum, não limpa nada", async () => {
    vi.resetModules();
    const lib = await import("@/lib/atalho-do-inicio-para-pedidos");
    expect(lib.consumirPedidoDePedidosSemFiltroAntigo(1_000)).toBe(false);
  });

  it("pedido esquecido (a tela nunca abriu) vence: abrir Pedidos pelo menu horas depois não limpa nada", async () => {
    vi.resetModules();
    const lib = await import("@/lib/atalho-do-inicio-para-pedidos");
    lib.pedirPedidosSemFiltroAntigo(1_000);
    const duasHorasDepois = 1_000 + 2 * 60 * 60 * 1000;
    expect(lib.consumirPedidoDePedidosSemFiltroAntigo(duasHorasDepois)).toBe(
      false,
    );
  });
});
