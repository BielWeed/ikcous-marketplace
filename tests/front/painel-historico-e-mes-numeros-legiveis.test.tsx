// @vitest-environment jsdom
//
// Como o número aparece (não a conta):
//   - "Histórico da loja" (Relatórios): Faturamento e Valor médio com
//     centavos, como a "Receita" lá de cima; pedidos com ponto de milhar;
//     média de zero vendas é "—", não "R$ 0".
//   - "Este mês" (Início): "valor médio por venda" sem venda é "—".
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import { NumerosDoMes } from "@/components/admin/inicio/NumerosDoMes";
import type { DashboardStats } from "@/hooks/useAnalytics";
import type { PainelInicio } from "@/types/painel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const texto = (el: Element | null) =>
  (el?.textContent ?? "").replace(/\s/g, " ");

/** Dias recentes (últimos 30) com a receita e os pedidos dados no dia mais
 * recente; os demais dias vêm zerados. */
function statsComUmDia(revenue: number, orders: number): DashboardStats {
  const dias = [];
  for (let i = 29; i >= 0; i--) {
    const data = new Date();
    data.setUTCDate(data.getUTCDate() - i);
    const iso = data.toISOString().slice(0, 10);
    const ultimo = i === 0;
    dias.push({
      date: iso,
      full_date: iso.split("-").reverse().slice(0, 2).join("/"),
      revenue: ultimo ? revenue : 0,
      orders: ultimo ? orders : 0,
      profit: 0,
      cost_sold: 0,
    });
  }
  return {
    today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
    month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    executive: {
      totalRevenue: revenue,
      totalOrders: orders,
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicket: 0,
      avgTicketTrend: 0,
      activeCustomers: 0,
      activeCustomersTrend: 0,
    },
    revenueHistory: dias,
    topProducts: [],
    inventoryAlerts: 0,
  };
}

let tela: HTMLDivElement;
let raiz: Root;
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
  tela = document.createElement("div");
  document.body.appendChild(tela);
  raiz = createRoot(tela);
});
afterEach(() => {
  act(() => raiz.unmount());
  tela.remove();
  vi.unstubAllGlobals();
});

async function montarHistorico(stats: DashboardStats) {
  await act(async () => {
    raiz.render(
      <OperationalPerformanceChart stats={stats} loading={false} active />,
    );
  });
}

describe("Relatórios, 'Histórico da loja': números legíveis", () => {
  it("faturamento e valor médio mostram centavos (venda de R$ 49,90)", async () => {
    await montarHistorico(statsComUmDia(49.9, 1));
    const corpo = texto(tela);
    expect(corpo).toContain("R$ 49,90");
    // Faturamento e Valor médio: os dois com centavos (o texto não separa
    // rótulo e valor).
    expect(corpo).toContain("FaturamentoR$ 49,90");
    expect(corpo).toContain("Valor médioR$ 49,90");
  });

  it("venda de R$ 0,01 não vira R$ 0", async () => {
    await montarHistorico(statsComUmDia(0.01, 1));
    expect(texto(tela)).toContain("R$ 0,01");
  });

  it("pedidos com ponto de milhar", async () => {
    await montarHistorico(statsComUmDia(12000, 12345));
    expect(texto(tela)).toContain("12.345");
    expect(texto(tela)).not.toContain("12345");
  });

  it("sem nenhuma venda no período, o valor médio é '—', não R$ 0", async () => {
    await montarHistorico(statsComUmDia(0, 0));
    const corpo = texto(tela);
    expect(corpo).toContain("Valor médio—");
    expect(corpo).not.toContain("Valor médioR$");
  });
});

function painelDoMes(pedidos: number, ticketMedio: number): PainelInicio {
  return {
    hoje: {
      receita: 0,
      online: 0,
      presencial: 0,
      pedidos: 0,
      receitaSemanaPassada: 0,
    },
    mes: {
      receita: 0,
      receitaMesAnterior: 0,
      pedidos,
      ticketMedio,
      lucroEstimado: 0,
    },
    saldoTotal: 0,
    aReceber7d: 0,
    aPagar7d: 0,
    contasVencidas: 0,
    pendencias: {
      pedidosParaPreparar: 0,
      devolucoesAbertas: 0,
      caixaAberto: false,
      estoqueBaixo: 0,
    },
    serie14d: [],
  };
}

describe("Início, 'Este mês': valor médio sem venda", () => {
  it("nenhuma venda no mês: valor médio por venda é '—'", async () => {
    await act(async () => {
      raiz.render(
        <NumerosDoMes painel={painelDoMes(0, 0)} carregando={false} />,
      );
    });
    const corpo = texto(tela);
    expect(corpo).toContain("valor médio por venda —");
    expect(corpo).not.toMatch(/valor médio por venda R\$ 0/);
  });

  it("com vendas, o valor médio aparece normal", async () => {
    await act(async () => {
      raiz.render(
        <NumerosDoMes painel={painelDoMes(3, 66.67)} carregando={false} />,
      );
    });
    expect(texto(tela)).toContain("valor médio por venda R$ 66,67");
  });
});
