import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import type { DashboardStats } from "@/hooks/useAnalytics";
// @vitest-environment jsdom
//
// Defeito 2 (lote fix/caca-defeitos-lote-1): a lojista escolhe "30D" (padrão
// da tela) e lê "Faturamento Total / Pedidos / Ticket Médio" ao lado do
// gráfico. As BARRAS respeitam o período escolhido (`filteredRevenueHistory`,
// fatiado de `stats.revenueHistory`); os três números não — vinham de
// `stats.executive`, que a RPC marca "-- executive stats (all-time)" (linha
// 95 de
// supabase/migrations/20260822000100_analitico_conta_so_dinheiro_reconhecido.sql).
//
// Este teste monta `stats.revenueHistory` com dias FORA e DENTRO da janela
// de 30 dias, com valores desenhados para que a soma "30D" e a soma
// "all-time" não coincidam por acaso. Prova que os três números batem com a
// soma da janela de 30 dias (o que as barras mostram) e não com o total
// all-time de `stats.executive` (o valor antigo, errado).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom não implementa ResizeObserver — recharts (ResponsiveContainer) cria
// um a cada montagem.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos vizinhos deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** Um dia fora da janela de 30D (dia 45 atrás) com valores bem diferentes
 * dos dias recentes, para que a soma "all-time" (`stats.executive`, que
 * inclui este dia) discorde da soma real da janela de 30D. */
const DIA_FORA_DA_JANELA_30D = {
  date: "2026-07-08",
  full_date: "08/07",
  revenue: 100000,
  orders: 500,
  profit: 0,
  cost_sold: 0,
};

/** 30 dias recentes, cada um com R$100 e 1 pedido — soma real da janela:
 * receita 3000, pedidos 30, ticket médio 100. */
function trintaDiasRecentes() {
  const dias = [];
  for (let i = 29; i >= 0; i--) {
    const data = new Date("2026-08-22T00:00:00.000Z");
    data.setUTCDate(data.getUTCDate() - i);
    const iso = data.toISOString().slice(0, 10);
    dias.push({
      date: iso,
      full_date: iso.split("-").reverse().slice(0, 2).join("/"),
      revenue: 100,
      orders: 1,
      profit: 40,
      cost_sold: 60,
    });
  }
  return dias;
}

function statsComHistoricoDivergente(): DashboardStats {
  return {
    today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
    month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    // all-time: inclui o dia fora da janela — se os três números do painel
    // ainda vierem daqui, batem com ESTE total, não com o da janela 30D.
    executive: {
      totalRevenue: 100000 + 30 * 100, // 103000
      totalOrders: 500 + 30, // 530
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicket: (100000 + 30 * 100) / (500 + 30),
      avgTicketTrend: 0,
      activeCustomers: 0,
      activeCustomersTrend: 0,
    },
    revenueHistory: [DIA_FORA_DA_JANELA_30D, ...trintaDiasRecentes()],
    topProducts: [],
    inventoryAlerts: 0,
  };
}

describe("OperationalPerformanceChart — os números ao lado batem com o período escolhido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
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

  it("no padrão 30D, mostra a soma da janela de 30 dias — não o total all-time", async () => {
    await act(async () => {
      raiz.render(
        <OperationalPerformanceChart
          stats={statsComHistoricoDivergente()}
          loading={false}
          active={true}
        />,
      );
    });

    const texto = hospedeiro.textContent ?? "";

    // O que a janela de 30D realmente soma: receita 3.000, 30 pedidos,
    // ticket médio 100.
    expect(texto).toContain("R$ 3.000");
    expect(texto).toContain("30");
    expect(texto).toContain("R$ 100");

    // Controle negativo: o total all-time (103.000 / 530 pedidos) NÃO pode
    // aparecer — é o valor que a tela mostrava antes da correção.
    expect(texto).not.toContain("103.000");
    expect(texto).not.toContain("530");
  });
});
