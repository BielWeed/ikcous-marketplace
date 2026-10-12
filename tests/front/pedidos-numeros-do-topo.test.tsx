// @vitest-environment jsdom
//
// O topo de Pedidos diz "um número, um conceito" — onda F do painel simples
// (F3). Antes: "Receita Hoje", "Ações Pendentes", "Valor médio por venda" e
// "Total Concluído". "Ações Pendentes" vinha de `today_pending` da RPC
// `get_admin_analytics_v2`, SEM filtro de pagamento — contava o PIX que
// espera a cliente e discordava do selo da aba e do Início. Receita e valor
// médio não são números de Pedidos: vivem no Início (`painel_inicio`, pelo
// dia do pagamento), em Clientes e em Relatórios.
//
// Agora os 4 cartões são do fluxo do pedido: "Para preparar" (a regra
// única de `src/lib/pedidos-para-preparar.ts`), "Aguardando pagamento",
// "Em trânsito" e "Finalizados". O dublê do Supabase responde cada contagem
// pela CADEIA que a consulta montou — um filtro trocado devolve outro
// número e o teste cai.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  FILTRO_POSTGREST_PARA_PREPARAR,
  PAGAMENTOS_A_CONFERIR_EM_ABERTO,
  STATUS_PARA_PREPARAR,
} from "@/lib/pedidos-para-preparar";

const PARA_PREPARAR = 5;
const AGUARDANDO_PAGAMENTO = 2;
const EM_TRANSITO = 1;
const FINALIZADOS = 3;

/** As consultas que o dublê respondeu, com a cadeia de filtros de cada uma. */
let cadeias: string[][] = [];
/** Quando verdadeiro, toda contagem em `marketplace_orders` devolve erro. */
let contagensFalham = false;
/** Quando verdadeiro, a construção da consulta lança (dublê incompleto). */
let construcaoLanca = false;
/**
 * Pedidos em aberto com pagamento recusado/estornado (S3 da revisão): saem
 * de "Para preparar" e de todo contador — o aviso sob os cartões os mostra.
 * `null` faz SÓ esta contagem devolver erro.
 */
let abertosAConferir: number | null = 0;
/**
 * Onda J (J2): quando verdadeiro, as três contagens do topo passam de mil,
 * para provar o separador de milhar pt-BR ("1.234", não "1234").
 */
let contagensDeMilhar = false;
const PARA_PREPARAR_MILHAR = 1234;
const AGUARDANDO_PAGAMENTO_MILHAR = 2345;
const EM_TRANSITO_MILHAR = 3456;

const CADEIA_DO_AVISO = `in:payment_status:${PAGAMENTOS_A_CONFERIR_EM_ABERTO.join(",")}`;
const ehDoAviso = (cadeia: string[]) => cadeia.includes(CADEIA_DO_AVISO);

function respostaDaCadeia(cadeia: string[]) {
  const texto = cadeia.join(" ");
  const statusAbertos = `in:status:${STATUS_PARA_PREPARAR.join(",")}`;
  if (texto.includes(statusAbertos)) {
    if (ehDoAviso(cadeia)) return abertosAConferir;
    if (texto.includes(`or:${FILTRO_POSTGREST_PARA_PREPARAR}`)) {
      return contagensDeMilhar ? PARA_PREPARAR_MILHAR : PARA_PREPARAR;
    }
    if (texto.includes("eq:payment_status:aguardando")) {
      return contagensDeMilhar
        ? AGUARDANDO_PAGAMENTO_MILHAR
        : AGUARDANDO_PAGAMENTO;
    }
    // Lista de status sem filtro de pagamento: a conta velha (com PIX).
    return 99;
  }
  if (texto.includes("eq:status:shipping")) {
    return contagensDeMilhar ? EM_TRANSITO_MILHAR : EM_TRANSITO;
  }
  return 77;
}

function criarBuilder(tabela: string) {
  const cadeia: string[] = [`from:${tabela}`];
  cadeias.push(cadeia);
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(
    (_colunas: string, opcoes?: { count?: string; head?: boolean }) => {
      cadeia.push(`select:${opcoes?.count ?? ""}:${String(opcoes?.head)}`);
      return builder;
    },
  );
  builder.in = vi.fn((coluna: string, valores: readonly string[]) => {
    cadeia.push(`in:${coluna}:${valores.join(",")}`);
    return builder;
  });
  builder.eq = vi.fn((coluna: string, valor: string) => {
    cadeia.push(`eq:${coluna}:${valor}`);
    return builder;
  });
  builder.or = vi.fn((filtro: string) => {
    cadeia.push(`or:${filtro}`);
    return builder;
  });
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase — mesmo padrão de admin-layout-cracha-pedidos-pendentes.
  builder.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve(
      contagensFalham || (ehDoAviso(cadeia) && abertosAConferir === null)
        ? { count: null, error: { message: "caiu" } }
        : { count: respostaDaCadeia(cadeia), error: null },
    ).then(resolve as never, reject as never);
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn((tabela: string) => {
      if (construcaoLanca) throw new TypeError("dublê sem from");
      return criarBuilder(tabela);
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

const mockOrders: Order[] = [];
// `loadOrders` espionado prova que a LISTA recarregou (troca de filtro) sem
// que as contagens do topo voltassem a bater no banco; `eventoDeTempoReal`
// é o `onRealtimeEvent` que a view entrega ao `useOrders`.
const { loadOrdersEspiao } = vi.hoisted(() => ({ loadOrdersEspiao: vi.fn() }));
let eventoDeTempoReal: ((payload: unknown) => void) | null = null;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: (
    _ativo: boolean,
    _admin: boolean,
    opcoes?: { onRealtimeEvent?: (payload: unknown) => void },
  ) => {
    eventoDeTempoReal = opcoes?.onRealtimeEvent ?? null;
    return {
      orders: mockOrders,
      loadOrders: loadOrdersEspiao,
      updateOrderStatus: vi.fn(),
      totalOrders: 0,
      isLoaded: true,
      loading: false,
    };
  },
}));

let mockAnalyticsStats: unknown = null;

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: mockAnalyticsStats,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function statsFake() {
  return {
    today: {
      revenue: 1234.5,
      count: 4,
      pending: 9,
      revenueTrend: 0,
      countTrend: 0,
    },
    month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    executive: {
      totalRevenue: 0,
      totalOrders: 0,
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicket: 87.65,
      avgTicketTrend: 0,
      activeCustomers: 0,
      activeCustomersTrend: 0,
    },
    averageTicket: 87.65,
    revenueHistory: [],
    topProducts: [],
    inventoryAlerts: 0,
    deliveredTotal: FINALIZADOS,
    paidOnCancelled: 0,
  };
}

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 20 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
}

describe("AdminOrdersView — o topo diz um número por conceito", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    cadeias = [];
    loadOrdersEspiao.mockClear();
    eventoDeTempoReal = null;
    contagensFalham = false;
    construcaoLanca = false;
    abertosAConferir = 0;
    contagensDeMilhar = false;
    mockAnalyticsStats = statsFake();
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
    vi.stubGlobal("ResizeObserver", ObservadorStub);
    vi.stubGlobal("IntersectionObserver", ObservadorStub);
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
  });

  async function montar() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
  }

  /** O valor (h3) do cartão cujo rótulo é exatamente `rotulo`. */
  function valorDoCartao(rotulo: string): string | null {
    const p = Array.from(hospedeiro.querySelectorAll("p")).find(
      (el) => el.textContent === rotulo,
    );
    if (!p) return null;
    return (
      p.parentElement?.parentElement?.querySelector("h3")?.textContent ?? null
    );
  }

  it("mostra os 4 cartões do fluxo: 5 para preparar, 2 aguardando pagamento, 1 em trânsito, 3 finalizados", async () => {
    await montar();
    await esperarAte(
      () => valorDoCartao("Para preparar") === String(PARA_PREPARAR),
    );

    expect(valorDoCartao("Para preparar")).toBe(String(PARA_PREPARAR));
    expect(valorDoCartao("Aguardando pagamento")).toBe(
      String(AGUARDANDO_PAGAMENTO),
    );
    expect(valorDoCartao("Em trânsito")).toBe(String(EM_TRANSITO));
    expect(valorDoCartao("Finalizados")).toBe(String(FINALIZADOS));
  });

  it("contagens de milhar saem com ponto pt-BR nos três cartões das consultas: 1.234, 2.345, 3.456", async () => {
    contagensDeMilhar = true;
    await montar();
    // Espera os três assentarem (saírem do "—") e só então compara cada um:
    // um cartão sem formatar reprova na SUA asserção, não em timeout.
    await esperarAte(() =>
      ["Para preparar", "Aguardando pagamento", "Em trânsito"].every(
        (rotulo) => {
          const valor = valorDoCartao(rotulo);
          return valor !== null && valor !== "—";
        },
      ),
    );

    expect(valorDoCartao("Para preparar")).toBe("1.234");
    expect(valorDoCartao("Aguardando pagamento")).toBe("2.345");
    expect(valorDoCartao("Em trânsito")).toBe("3.456");
  });

  it("as contagens são só de cabeçalho (head) em marketplace_orders", async () => {
    await montar();
    await esperarAte(
      () => valorDoCartao("Para preparar") === String(PARA_PREPARAR),
    );

    const doTopo = cadeias.filter((c) =>
      c.some((passo) => passo.startsWith("select:exact")),
    );
    expect(doTopo.length).toBeGreaterThanOrEqual(3);
    for (const cadeia of doTopo) {
      expect(cadeia[0]).toBe("from:marketplace_orders");
      expect(cadeia).toContain("select:exact:true");
    }
  });

  it("não existem mais 'Receita Hoje', 'Valor médio por venda' nem 'Ações Pendentes' no topo", async () => {
    await montar();
    await esperarAte(
      () => valorDoCartao("Para preparar") === String(PARA_PREPARAR),
    );

    const rotulos = Array.from(hospedeiro.querySelectorAll("p")).map(
      (p) => p.textContent,
    );
    expect(rotulos).not.toContain("Receita Hoje");
    expect(rotulos).not.toContain("Valor médio por venda");
    expect(rotulos).not.toContain("Ações Pendentes");
    // Os valores que esses cartões mostravam também não aparecem.
    expect(hospedeiro.textContent).not.toContain("1.234,50");
    expect(hospedeiro.textContent).not.toContain("87,65");
  });

  /**
   * Quantas contagens DO TOPO já foram montadas: `head: true` COM filtro de
   * status. Fica de fora a medição "a loja tem pedido nenhum?" da lista
   * vazia (`totalAbsolutoNaLoja`, um COUNT sem filtro, uma vez por vida).
   */
  const contagensFeitas = () =>
    cadeias.filter(
      (c) =>
        c.includes("select:exact:true") &&
        c.some((passo) => /^(in|eq):status:/.test(passo)),
    ).length;

  /**
   * Uma rodada = 3 contagens dos cartões + 1 do aviso de pagamento
   * recusado/estornado em pedido aberto (S3 da revisão).
   */
  const CONTAGENS_POR_RODADA = 4;

  /** Deixa passar o carregamento da lista (`loadAllData`, ~320 ms). */
  async function deixarALista() {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 600));
    });
  }

  it("uma ativação faz exatamente uma rodada (3 cartões + aviso) — o carregamento da lista não repete", async () => {
    await montar();
    await esperarAte(
      () => valorDoCartao("Para preparar") === String(PARA_PREPARAR),
    );
    await deixarALista();

    // A lista carregou (loadAllData rodou) e as contagens não vieram junto.
    expect(loadOrdersEspiao).toHaveBeenCalled();
    expect(contagensFeitas()).toBe(CONTAGENS_POR_RODADA);
  });

  it("trocar o filtro de status recarrega a lista, mas não as contagens do topo", async () => {
    await montar();
    await esperarAte(
      () => valorDoCartao("Para preparar") === String(PARA_PREPARAR),
    );
    await deixarALista();
    const contagensAntes = contagensFeitas();
    const listasAntes = loadOrdersEspiao.mock.calls.length;

    const chip = Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Em Trânsito",
    );
    expect(chip).toBeTruthy();
    await act(async () => {
      chip!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await deixarALista();

    expect(loadOrdersEspiao.mock.calls.length).toBeGreaterThan(listasAntes);
    expect(contagensFeitas()).toBe(contagensAntes);
  });

  it("um evento de tempo real recarrega as contagens do topo", async () => {
    await montar();
    await esperarAte(
      () => valorDoCartao("Para preparar") === String(PARA_PREPARAR),
    );
    await deixarALista();
    expect(eventoDeTempoReal).toBeTruthy();
    const contagensAntes = contagensFeitas();

    await act(async () => {
      eventoDeTempoReal!({ eventType: "DELETE", new: {}, old: { id: "p1" } });
    });
    await esperarAte(
      () => contagensFeitas() === contagensAntes + CONTAGENS_POR_RODADA,
    );
    expect(contagensFeitas()).toBe(contagensAntes + CONTAGENS_POR_RODADA);
  });

  it("rajada de 10 eventos de tempo real em menos de 1 s vira UMA recarga das contagens", async () => {
    await montar();
    await esperarAte(
      () => valorDoCartao("Para preparar") === String(PARA_PREPARAR),
    );
    await deixarALista();
    expect(eventoDeTempoReal).toBeTruthy();
    const contagensAntes = contagensFeitas();

    vi.useFakeTimers();
    try {
      await act(async () => {
        for (let i = 0; i < 10; i++) {
          eventoDeTempoReal!({
            eventType: "DELETE",
            new: {},
            old: { id: `p${i}` },
          });
          vi.advanceTimersByTime(90);
        }
      });
      // 900 ms depois do primeiro evento: a janela ainda não fechou.
      expect(contagensFeitas()).toBe(contagensAntes);

      await act(async () => {
        vi.advanceTimersByTime(100);
      });
      expect(contagensFeitas()).toBe(contagensAntes + CONTAGENS_POR_RODADA);

      // Nada mais fica agendado: a rajada inteira custou uma recarga.
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(contagensFeitas()).toBe(contagensAntes + CONTAGENS_POR_RODADA);
    } finally {
      vi.useRealTimers();
    }
  });

  it("recarga agendada não dispara depois que a tela sai", async () => {
    await montar();
    await esperarAte(
      () => valorDoCartao("Para preparar") === String(PARA_PREPARAR),
    );
    await deixarALista();
    const contagensAntes = contagensFeitas();

    vi.useFakeTimers();
    try {
      await act(async () => {
        eventoDeTempoReal!({ eventType: "DELETE", new: {}, old: { id: "p1" } });
      });
      act(() => {
        raiz.unmount();
      });
      await act(async () => {
        vi.advanceTimersByTime(3000);
      });
      expect(contagensFeitas()).toBe(contagensAntes);
    } finally {
      vi.useRealTimers();
      // O afterEach desmonta de novo; uma raiz nova evita o erro de
      // "unmount de raiz já desmontada".
      raiz = createRoot(hospedeiro);
    }
  });

  // ── S3: pedido aberto com pagamento recusado/estornado ──
  // Ele sai de "Para preparar" (a regra do Início) e de todo contador; sem
  // este aviso sumiria da tela. Só leitura: não entra em cartão nenhum.
  const AVISO_PLURAL =
    "2 pedidos em aberto com pagamento recusado ou estornado — confira no filtro Status de Pagamento.";
  const AVISO_SINGULAR =
    "1 pedido em aberto com pagamento recusado ou estornado — confira no filtro Status de Pagamento.";
  const textoDoAviso = () =>
    hospedeiro
      .querySelector('[data-aviso="pagamento-a-conferir"]')
      ?.textContent?.replace(/\s+/g, " ")
      .trim() ?? null;

  /** Espera a primeira rodada assentar (os 3 cartões com número). */
  async function montarEAssentar() {
    await montar();
    await esperarAte(
      () =>
        valorDoCartao("Para preparar") === String(PARA_PREPARAR) &&
        valorDoCartao("Em trânsito") === String(EM_TRANSITO),
    );
  }

  it("com 2 pedidos abertos de pagamento recusado/estornado, o aviso aparece no plural", async () => {
    abertosAConferir = 2;
    await montarEAssentar();
    await esperarAte(() => textoDoAviso() !== null);

    expect(textoDoAviso()).toBe(AVISO_PLURAL);
    // A consulta é a das duas listas da lib, só cabeçalho.
    const doAviso = cadeias.filter(ehDoAviso);
    expect(doAviso.length).toBeGreaterThan(0);
    for (const cadeia of doAviso) {
      expect(cadeia).toEqual([
        "from:marketplace_orders",
        "select:exact:true",
        `in:status:${STATUS_PARA_PREPARAR.join(",")}`,
        CADEIA_DO_AVISO,
      ]);
    }
  });

  it("com 1, o aviso fala no singular", async () => {
    abertosAConferir = 1;
    await montarEAssentar();
    await esperarAte(() => textoDoAviso() !== null);

    expect(textoDoAviso()).toBe(AVISO_SINGULAR);
  });

  it("o aviso não muda os 4 cartões", async () => {
    abertosAConferir = 2;
    await montarEAssentar();
    await esperarAte(() => textoDoAviso() !== null);

    expect(valorDoCartao("Para preparar")).toBe(String(PARA_PREPARAR));
    expect(valorDoCartao("Aguardando pagamento")).toBe(
      String(AGUARDANDO_PAGAMENTO),
    );
    expect(valorDoCartao("Em trânsito")).toBe(String(EM_TRANSITO));
    expect(valorDoCartao("Finalizados")).toBe(String(FINALIZADOS));
  });

  it("com 0 o aviso não existe", async () => {
    abertosAConferir = 0;
    await montarEAssentar();
    await deixarALista();

    expect(textoDoAviso()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("recusado ou estornado");
  });

  it("consulta do aviso que falha (null) esconde o aviso — nunca mostra '0'", async () => {
    abertosAConferir = null;
    await montarEAssentar();
    await deixarALista();

    expect(textoDoAviso()).toBeNull();
    expect(hospedeiro.textContent).not.toContain("recusado ou estornado");
    // Os cartões seguem com os números deles.
    expect(valorDoCartao("Para preparar")).toBe(String(PARA_PREPARAR));
  });

  it("o aviso segue a coalescência: rajada de tempo real recarrega ele uma vez só", async () => {
    abertosAConferir = 1;
    await montarEAssentar();
    await deixarALista();
    const avisosAntes = cadeias.filter(ehDoAviso).length;
    abertosAConferir = 2;

    vi.useFakeTimers();
    try {
      await act(async () => {
        for (let i = 0; i < 10; i++) {
          eventoDeTempoReal!({
            eventType: "DELETE",
            new: {},
            old: { id: `p${i}` },
          });
          vi.advanceTimersByTime(90);
        }
        vi.advanceTimersByTime(3000);
      });
      expect(cadeias.filter(ehDoAviso).length).toBe(avisosAntes + 1);
    } finally {
      vi.useRealTimers();
    }
    await esperarAte(() => textoDoAviso() === AVISO_PLURAL);
  });

  it("consulta que devolve erro mostra '—', nunca '0'", async () => {
    contagensFalham = true;
    await montar();
    await esperarAte(() => cadeias.length >= 3);

    for (const rotulo of [
      "Para preparar",
      "Aguardando pagamento",
      "Em trânsito",
    ]) {
      expect(valorDoCartao(rotulo)).toBe("—");
      expect(valorDoCartao(rotulo)).not.toBe("0");
    }
  });

  it("construção da consulta que lança também vira '—' e não derruba a tela", async () => {
    construcaoLanca = true;
    await montar();

    for (const rotulo of [
      "Para preparar",
      "Aguardando pagamento",
      "Em trânsito",
    ]) {
      expect(valorDoCartao(rotulo)).toBe("—");
    }
    // Finalizados não depende das contagens novas: segue com a RPC.
    expect(valorDoCartao("Finalizados")).toBe(String(FINALIZADOS));
  });
});

describe("useNumerosDosPedidos — rodada velha não grava número velho", () => {
  it("a rodada que termina por último, mas começou antes, é descartada", async () => {
    const { supabase } = await import("@/lib/supabase");
    const { useNumerosDosPedidos } = await import(
      "@/hooks/useNumerosDosPedidos"
    );

    // Rodada 1 fica presa até liberarmos; rodada 2 responde na hora. Cada
    // rodada monta 4 consultas (3 cartões + o aviso).
    const liberacoes: Array<() => void> = [];
    let rodada = 0;
    (supabase.from as ReturnType<typeof vi.fn>).mockImplementation(() => {
      const minhaRodada = Math.floor(rodada++ / 4) + 1;
      const builder: Record<string, unknown> = {};
      builder.select = () => builder;
      builder.in = () => builder;
      builder.eq = () => builder;
      builder.or = () => builder;
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
      builder.then = (resolve: unknown, reject?: unknown) => {
        const resposta = { count: minhaRodada === 1 ? 111 : 222, error: null };
        if (minhaRodada === 1) {
          return new Promise((r) => liberacoes.push(() => r(resposta))).then(
            resolve as never,
            reject as never,
          );
        }
        return Promise.resolve(resposta).then(
          resolve as never,
          reject as never,
        );
      };
      return builder;
    });

    const leituras: Array<{
      paraPreparar: number | null;
      recarregar: () => Promise<void>;
    }> = [];
    function Sonda() {
      leituras.push(useNumerosDosPedidos(true));
      return null;
    }
    const hospedeiro = document.createElement("div");
    const raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(<Sonda />);
    });
    // Rodada 1 (montagem) está presa; a rodada 2 começa e termina.
    await act(async () => {
      await leituras[leituras.length - 1]?.recarregar();
    });
    expect(leituras[leituras.length - 1]?.paraPreparar).toBe(222);

    // Agora a rodada 1 responde — tarde demais.
    await act(async () => {
      for (const liberar of liberacoes) liberar();
      await new Promise((r) => setTimeout(r, 0));
    });
    expect(leituras[leituras.length - 1]?.paraPreparar).toBe(222);

    act(() => {
      raiz.unmount();
    });
  });
});

// A janela do topo de Pedidos é a mesma dos crachás do AdminLayout (achado
// C4). Fonte lida pelo Vite (`?raw`): em jsdom `import.meta.url` não é
// `file:` — mesmo padrão de pedidos-falam-a-lingua-da-loja.
const FONTE_DO_LAYOUT = import.meta.glob<string>(
  "/src/components/layouts/AdminLayout.tsx",
  { query: "?raw", import: "default", eager: true },
);

describe("useNumerosDosPedidos — mesma janela de coalescência do AdminLayout", () => {
  it("ATRASO_COALESCENCIA_NUMEROS_MS é igual a ATRASO_COALESCENCIA_BADGES_MS", async () => {
    const { ATRASO_COALESCENCIA_NUMEROS_MS } = await import(
      "@/hooks/useNumerosDosPedidos"
    );
    const fonte = Object.values(FONTE_DO_LAYOUT)[0] ?? "";
    const doLayout = /ATRASO_COALESCENCIA_BADGES_MS\s*=\s*(\d+)/.exec(
      fonte,
    )?.[1];
    expect(doLayout).toBeDefined();
    expect(ATRASO_COALESCENCIA_NUMEROS_MS).toBe(Number(doLayout));
  });
});
