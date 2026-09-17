// @vitest-environment jsdom
//
// C4.4 — chip "Balcão" no filtro da lista (filtrando NO BANCO) e selo
// "Balcão" no card. `canal` entra como NONA posição de `ConsultaAdmin`
// (useOrders.ts) e é repassado como `p_canal` para `get_admin_orders_paged`
// (migration 20261163000000 — C1.4), pelo mesmo contrato do filtro de
// pagamento que já existe (p_payment_status).
//
// Duas famílias de prova aqui:
//   1. as duas funções PURAS de useOrders.ts que leem `ConsultaAdmin`
//      posicionalmente — `escolherRecargaDeReconexao` e
//      `decidirRealtimeInsertAdmin` — precisam repassar/considerar a nona
//      posição sem quebrar a leitura de tupla ANTIGA (8 posições, sem
//      canal), porque as duas desestruturam por posição a partir do início.
//   2. o card do painel (AdminOrdersView) mostra o selo "Balcão" só quando
//      `order.canal === "presencial"`.
//
// Mesmo padrão de mock de admin-orders-payment-filter.test.tsx: importar
// o hook de verdade (ou até só o módulo de AdminOrdersView) instancia o
// cliente Supabase, que lê env var ausente e explode por design — por isso
// `@/lib/supabase` é sempre mocado antes de qualquer import.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import {
  type ConsultaAdmin,
  decidirRealtimeInsertAdmin,
  escolherRecargaDeReconexao,
} from "@/hooks/useOrders";

/** Pedido mínimo, só com os campos que `decidirRealtimeInsertAdmin` olha —
 * mesmo molde de use-orders-realtime-insert-respeita-filtro.test.tsx. */
function pedido(overrides: Partial<Order> = {}): Order {
  return {
    id: "pedido-novo",
    userId: undefined,
    customer: { name: "João da Silva" } as Order["customer"],
    items: [],
    total: 100,
    subtotal: 100,
    shipping: 0,
    discount: 0,
    paymentMethod: "cash",
    paymentStatus: null,
    status: "pending",
    createdAt: "2026-09-16T12:00:00.000Z",
    updatedAt: "2026-09-16T12:00:00.000Z",
    ...overrides,
  } as Order;
}

describe("ConsultaAdmin ganha o canal como NONA posição (C4.4)", () => {
  it("escolherRecargaDeReconexao: reconectar com o chip 'Balcão' ligado recarrega ainda filtrado por balcão", async () => {
    const fetchUserOrders = vi.fn().mockResolvedValue([]);
    const loadOrders = vi.fn().mockResolvedValue({ orders: [], total: 0 });

    // Consulta completa, 9 posições: página 2, sem status/busca/período,
    // sem filtro de pagamento, canal "presencial".
    const ultimaConsultaAdmin: ConsultaAdmin = [
      2,
      12,
      "all",
      "",
      "",
      "",
      false,
      "all",
      "presencial",
    ];

    const recarregar = escolherRecargaDeReconexao({
      isAdmin: true,
      fetchUserOrders,
      loadOrders,
      ultimaConsultaAdmin,
    });
    await recarregar();

    expect(loadOrders).toHaveBeenCalledTimes(1);
    // 9º argumento posicional (índice 8) é o canal repassado.
    expect(loadOrders.mock.calls[0][8]).toBe("presencial");
    // As oito posições de sempre continuam intactas.
    expect(loadOrders.mock.calls[0].slice(0, 6)).toEqual([
      2,
      12,
      "all",
      "",
      "",
      "",
    ]);
    expect(loadOrders.mock.calls[0][6]).toBe(true); // silent forçado
  });

  it("escolherRecargaDeReconexao: consulta ANTIGA de 8 posições (sem canal) continua sendo lida sem erro — canal vira undefined", async () => {
    const fetchUserOrders = vi.fn().mockResolvedValue([]);
    const loadOrders = vi.fn().mockResolvedValue({ orders: [], total: 0 });

    const consultaAntiga = [
      0,
      20,
      "pending",
      "maria",
      "2026-08-01",
      "2026-08-18",
      false,
      "all",
    ] as ConsultaAdmin;

    const recarregar = escolherRecargaDeReconexao({
      isAdmin: true,
      fetchUserOrders,
      loadOrders,
      ultimaConsultaAdmin: consultaAntiga,
    });
    await recarregar();

    expect(loadOrders).toHaveBeenCalledTimes(1);
    expect(loadOrders.mock.calls[0][8]).toBeUndefined();
  });

  it("decidirRealtimeInsertAdmin: canal ativo devolve 'recarregar' mesmo na página 0 — a RPC decide, sem repetir a regra aqui", () => {
    const consultaComCanal: ConsultaAdmin = [
      0,
      12,
      "all",
      undefined,
      undefined,
      undefined,
      false,
      "all",
      "presencial",
    ];

    const decisao = decidirRealtimeInsertAdmin(
      pedido({ status: "pending" }),
      consultaComCanal,
    );

    expect(decisao).toBe("recarregar");
  });

  it("decidirRealtimeInsertAdmin: canal 'all' não conta como filtro — mantém a decisão de hoje ('inserir' na página 0)", () => {
    const consultaSemFiltroDeCanal: ConsultaAdmin = [
      0,
      12,
      "all",
      undefined,
      undefined,
      undefined,
      false,
      "all",
      "all",
    ];

    const decisao = decidirRealtimeInsertAdmin(
      pedido({ status: "pending" }),
      consultaSemFiltroDeCanal,
    );

    expect(decisao).toBe("inserir");
  });

  it("decidirRealtimeInsertAdmin: tupla de 8 posições (código antigo) continua sendo lida sem erro — canal vira undefined, comportamento de antes", () => {
    const consultaAntiga = [
      0,
      12,
      "all",
      undefined,
      undefined,
      undefined,
      false,
      "all",
    ] as ConsultaAdmin;

    expect(
      decidirRealtimeInsertAdmin(pedido({ status: "pending" }), consultaAntiga),
    ).toBe("inserir");
  });
});

// -----------------------------------------------------------------------
// Selo "Balcão" no card (PASSO 4) — monta AdminOrdersView com uma lista em
// memória, mesmo padrão de admin-orders-payment-filter.test.tsx (describe
// "estado vazio", que também usa `active={false}` para não arrastar
// AdminKpiCarousel/embla).
// -----------------------------------------------------------------------

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

let mockOrders: Order[] = [];
let mockTotalOrders = 0;
// C4.4 (rodada de correção, achado "ANTES DE CRESCER" sobre a ligação
// tela→hook): tem de ser um espião ESTÁVEL, declarado FORA da fábrica do
// `useOrders()`. Um `vi.fn()` criado dentro do objeto devolvido nasceria de
// novo a cada render, e nenhum teste conseguiria inspecionar os argumentos
// de uma chamada já acontecida — foi exatamente por isso que a ligação
// tela→hook do chip ficou sem prova nenhuma.
const espiaoLoadOrders = vi.fn();
// Mesma razão do espião acima, para o lado da EXPORTAÇÃO: `canal:
// canalFilter` em `buscarPedidosDoFiltroParaExportar` (AdminOrdersView.tsx)
// tem a mesma classe de risco — some sem nenhum teste reclamar.
const espiaoExportar = vi.fn().mockResolvedValue([]);

vi.mock("@/hooks/useOrders", async () => {
  const real =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    ...real,
    useOrders: () => ({
      orders: mockOrders,
      loadOrders: espiaoLoadOrders,
      buscarPedidosDoFiltroParaExportar: espiaoExportar,
      updateOrderStatus: vi.fn(),
      totalOrders: mockTotalOrders,
      isLoaded: true,
      loading: false,
    }),
  };
});

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoDoCard(overrides: Partial<Order> = {}): Order {
  return {
    id: "pedido-do-card",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    paymentStatus: "recebido_na_entrega",
    status: "delivered",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
    ...overrides,
  } as Order;
}

describe("AdminOrdersView — selo 'Balcão' no card (C4.4)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // jsdom deste ambiente não traz localStorage utilizável — mesmo dublê
    // em Map dos outros testes de AdminOrdersView.
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockOrders = [];
    mockTotalOrders = 0;
    espiaoLoadOrders.mockClear();
    espiaoExportar.mockClear();
  });

  /**
   * O texto "Balcão" também rotula o botão novo da gaveta de filtros
   * (fechada por padrão neste render). Medir `hospedeiro.textContent` da
   * árvore inteira dá falso positivo se algum dia a gaveta ganhar
   * `forceMount` ou um teste vizinho abrir o dropdown no mesmo render — e
   * a tela tem OUTROS elementos com `role="button"` (os atalhos de
   * Feedback/Dúvidas), então nem esse seletor bastava. Por isso a prova
   * consulta só o subárvore do CARD, pelo `data-testid="pedido-card"`
   * acrescentado a ele (achado 6 da rodada de correção).
   *
   * Segunda camada (achado "ANOTADO" da rodada de correção seguinte): mesmo
   * dentro do card, `toContain("Balcão")` no TEXTO ainda seria ambíguo — o
   * `PaymentStatusBadge` vizinho já escreve "Recebido no balcão" (minúsculo
   * hoje, mas é `text-transform: uppercase` só em CSS; o `textContent` não
   * muda) para pedido presencial pago. Uma futura capitalização desse rótulo
   * faria a prova passar mesmo sem o selo. Por isso ancora no ELEMENTO
   * (`data-testid="selo-canal"`, acrescentado ao span do selo), não no texto
   * da subárvore.
   */
  function seloCanalDoCard(): Element | null {
    const card = hospedeiro.querySelector('[data-testid="pedido-card"]');
    if (!card) throw new Error("card do pedido não encontrado no DOM");
    return card.querySelector('[data-testid="selo-canal"]');
  }

  it("pedido com canal 'presencial' mostra o selo 'Balcão'", async () => {
    mockOrders = [pedidoDoCard({ id: "ped-balcao", canal: "presencial" })];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    expect(seloCanalDoCard()).toBeTruthy();
    expect(seloCanalDoCard()?.textContent).toContain("Balcão");
  });

  it("pedido com canal 'online' NÃO mostra o selo 'Balcão'", async () => {
    mockOrders = [pedidoDoCard({ id: "ped-online", canal: "online" })];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    expect(seloCanalDoCard()).toBeFalsy();
  });

  it("pedido SEM `canal` (dado antigo) NÃO mostra o selo — mesmo tratamento do mapper (ausente = online)", async () => {
    mockOrders = [pedidoDoCard({ id: "ped-sem-canal" })];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    expect(seloCanalDoCard()).toBeFalsy();
  });

  /**
   * Achado "ANTES DE CRESCER" da rodada de correção: no card DETALHADO, o
   * selo entrava dentro de um `flex flex-col items-end` (empilha
   * VERTICALMENTE) como uma TERCEIRA pill — a coluna, que hoje dita (junto
   * com a miniatura do outro lado) a altura da fileira inteira do grid,
   * ganhava uma linha extra SÓ para pedido de balcão, e a linha do CSS grid
   * estica todos os cards vizinhos para acompanhar. jsdom não faz layout
   * (não dá para medir o "~25px" do laudo), mas dá para provar a decisão
   * estrutural que evita a 3ª linha: o selo mora na MESMA linha do
   * `OrderStatusBadge`, então a coluna continua com exatamente 2 filhos
   * (linha status+canal, depois pagamento) com ou sem venda de balcão.
   */
  it("card DETALHADO: o selo fica na mesma linha do status — a coluna nunca ganha uma 3ª linha", async () => {
    window.localStorage.setItem("admin_orders_view_mode", "detailed");
    mockOrders = [pedidoDoCard({ id: "ped-balcao", canal: "presencial" })];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    const selo = seloCanalDoCard();
    expect(selo).toBeTruthy();
    const coluna = selo?.closest(".flex.flex-col.items-end");
    expect(coluna).toBeTruthy();
    expect(coluna?.children.length).toBe(2);
  });
});

// -----------------------------------------------------------------------
// Bolinha do filtro e estado vazio honesto (achados 3 e 4 da rodada de
// correção, "ANTES DE CRESCER"): o filtro de canal persiste em localStorage
// do mesmo jeito que o de pagamento — precisa da MESMA pista visível
// (bolinha dourada) e do MESMO ramo no estado vazio (senão a lojista lê
// "ainda não tem nenhum pedido" numa loja com dezenas deles).
// -----------------------------------------------------------------------

class ResizeObserverStubCanal {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStubCanal {
  observe() {}
  unobserve() {}
  disconnect() {}
}

describe("AdminOrdersView — bolinha do filtro e estado vazio do canal (C4.4)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

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
    vi.stubGlobal("ResizeObserver", ResizeObserverStubCanal);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStubCanal);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockOrders = [];
    mockTotalOrders = 0;
    espiaoLoadOrders.mockClear();
    espiaoExportar.mockClear();
  });

  it("chip 'Balcão' ligado: a bolinha dourada do ícone de filtro acende (achado 3)", async () => {
    window.localStorage.setItem(
      "admin_orders_canal_filter",
      JSON.stringify("presencial"),
    );
    mockOrders = [pedidoDoCard({ id: "ped-1" })];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    const bolinha = hospedeiro.querySelector(
      'span[aria-hidden="true"].bg-admin-gold',
    );
    expect(bolinha).toBeTruthy();
  });

  it("sem filtro nenhum ligado, a bolinha não aparece", async () => {
    mockOrders = [pedidoDoCard({ id: "ped-1" })];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    const bolinha = hospedeiro.querySelector(
      'span[aria-hidden="true"].bg-admin-gold',
    );
    expect(bolinha).toBeFalsy();
  });

  it("loja com pedidos mas nenhum no canal filtrado: o estado vazio culpa o filtro de canal, não diz 'ainda não tem nenhum pedido' (achado 4)", async () => {
    // Molde de admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx:
    // `active={true}` liga a medição do ABSOLUTO da loja (COUNT sem filtro),
    // que é o que distingue "loja vazia de verdade" de "filtro vazio".
    vi.doMock("@/lib/supabase", () => ({
      supabase: {
        from: () => ({
          select: () => Promise.resolve({ count: 83, error: null }),
        }),
        rpc: vi.fn(),
        functions: { invoke: vi.fn() },
        channel: vi.fn(),
        removeChannel: vi.fn(),
      },
    }));
    window.localStorage.setItem(
      "admin_orders_canal_filter",
      JSON.stringify("presencial"),
    );
    window.localStorage.setItem(
      "admin_orders_filter_v2",
      JSON.stringify("all"),
    );
    mockOrders = [];
    mockTotalOrders = 0;

    vi.resetModules();
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    // Espera a medição assíncrona do total absoluto resolver.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hospedeiro.textContent).toContain("Nenhum pedido nesse canal");
    expect(hospedeiro.textContent).not.toContain("Ainda não tem nenhum pedido");
  });
});

// -----------------------------------------------------------------------
// Ligação TELA → HOOK do chip (achado "ANTES DE CRESCER" da rodada de
// correção): os dois describes acima montam AdminOrdersView, mas o mock de
// `useOrders` devolvia `loadOrders`/`buscarPedidosDoFiltroParaExportar` NOVOS
// a cada render — nenhum teste olhava os argumentos da chamada. Apagar
// `canalFilter,` da chamada de `loadOrders` em `loadAllData`, ou `canal:
// canalFilter` do objeto de `buscarPedidosDoFiltroParaExportar`
// (AdminOrdersView.tsx), deixava a suíte inteira verde, inclusive os 15
// testes de C4.4 já existentes: `canal` virava `undefined`, a RPC recebia
// `p_canal: "all"`, e nenhuma prova reclamava. Este describe usa os espiões
// ESTÁVEIS do módulo (`espiaoLoadOrders`/`espiaoExportar`, ver o mock de
// `@/hooks/useOrders` no topo do arquivo) para fechar esse buraco.
// -----------------------------------------------------------------------

describe("AdminOrdersView — o chip 'Balcão' chega de verdade ao hook (achado 'ANTES DE CRESCER')", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

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
    vi.stubGlobal("ResizeObserver", ResizeObserverStubCanal);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStubCanal);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    espiaoLoadOrders.mockClear();
    espiaoExportar.mockClear();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    mockOrders = [];
    mockTotalOrders = 0;
    espiaoLoadOrders.mockClear();
    espiaoExportar.mockClear();
  });

  it("chip 'Balcão' persistido em localStorage: loadOrders recebe 'presencial' na NONA posição (índice 8)", async () => {
    window.localStorage.setItem(
      "admin_orders_canal_filter",
      JSON.stringify("presencial"),
    );
    mockOrders = [pedidoDoCard({ id: "ped-1", canal: "presencial" })];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    // `loadAllData` é debounced em 320ms (AdminOrdersView.tsx) — espera o
    // temporizador de VERDADE em vez de mockar timers, mesmo padrão de
    // admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(espiaoLoadOrders).toHaveBeenCalled();
    const ultimaChamada = espiaoLoadOrders.mock.calls.at(-1) ?? [];
    expect(ultimaChamada[8]).toBe("presencial");
  });

  it("sem o chip ligado (padrão 'all'): loadOrders recebe 'all', não undefined, na nona posição", async () => {
    mockOrders = [pedidoDoCard({ id: "ped-1" })];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 400));
    });

    expect(espiaoLoadOrders).toHaveBeenCalled();
    const ultimaChamada = espiaoLoadOrders.mock.calls.at(-1) ?? [];
    expect(ultimaChamada[8]).toBe("all");
  });

  it("chip 'Balcão' ligado: exportar CSV chama buscarPedidosDoFiltroParaExportar com canal: 'presencial'", async () => {
    // Mesmo trio de dublês de admin-orders-exporta-csv-do-periodo-inteiro.
    // test.tsx: jsdom não implementa `URL.createObjectURL`, e sem o dublê o
    // clique no botão explode DEPOIS do assert (erro solto, fora do teste).
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn(() => "blob:csv"),
        revokeObjectURL: vi.fn(),
      }),
    );
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});

    window.localStorage.setItem(
      "admin_orders_canal_filter",
      JSON.stringify("presencial"),
    );
    mockOrders = [pedidoDoCard({ id: "ped-1", canal: "presencial" })];
    mockTotalOrders = 1;

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={false} />);
    });

    // Mesmo botão que admin-orders-exportar-csv-rotulo-da-pagina.test.tsx
    // localiza: nome ACESSÍVEL (aria-label/title), não o texto visível "CSV".
    const botaoExportar = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((b) =>
      (b.getAttribute("aria-label") || "").includes("Exportar CSV"),
    );
    expect(botaoExportar).toBeTruthy();

    await act(async () => {
      botaoExportar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      // `exportarCsv` é async — deixa o microtask da chamada rodar.
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(espiaoExportar).toHaveBeenCalled();
    const argumentoDaExportacao = espiaoExportar.mock.calls.at(-1)?.[0];
    expect(argumentoDaExportacao?.canal).toBe("presencial");
  });
});
