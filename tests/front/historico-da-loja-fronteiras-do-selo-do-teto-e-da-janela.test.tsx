// @vitest-environment jsdom
//
// "Histórico da loja" do painel — fronteiras que nenhum teste segurava
// (achadas por mutação em 24/11/2026):
//  - o teto do cartão "Sobre o estoque de hoje" é ">999%" só ACIMA de 999:
//    exatamente 999% (e −999%) ainda é o número;
//  - sem custo de estoque cadastrado (R$ 0) o cartão "Sobre o estoque de hoje"
//    nem aparece (dividir por zero daria ">999%");
//  - dia só com pedido de R$ 0 (brinde com cupom de 100%) é movimento: o gráfico
//    não diz "Nenhuma venda paga" (que só vale com tudo zerado);
//  - em "Retorno do estoque" a janela de 30 dias tem 30 dias, contando hoje:
//    o lucro do 31º dia para trás não entra no "Lucro acumulado".
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import type { DashboardStats } from "@/hooks/useAnalytics";
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

type DiaDoHistorico = DashboardStats["revenueHistory"][number];

function diaDe(
  indice: number,
  parte: Partial<DiaDoHistorico> = {},
): DiaDoHistorico {
  const data = new Date(Date.UTC(2026, 8, 1 + indice)).toISOString();
  return {
    date: data.slice(0, 10),
    full_date: data.slice(0, 10),
    revenue: 0,
    orders: 0,
    profit: 0,
    cost_sold: 0,
    ...parte,
  };
}

function statsCom(
  revenueHistory: DiaDoHistorico[],
  custoDoEstoque = 0,
): DashboardStats {
  return {
    revenueHistory,
    topProducts: [],
    inventoryAlerts: 0,
    inventory: { totalCost: custoDoEstoque },
  } as unknown as DashboardStats;
}

describe("Histórico da loja: fronteiras", () => {
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

  async function montar(stats: DashboardStats) {
    await act(async () => {
      raiz.render(
        <OperationalPerformanceChart stats={stats} loading={false} active />,
      );
    });
  }

  async function abrirRetornoDoEstoque() {
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Retorno do estoque"),
    );
    await act(async () => {
      botao?.click();
    });
  }

  /** O valor do cartão que vem logo depois do rótulo, sem espaços especiais. */
  const cartao = (rotulo: string) =>
    (
      Array.from(hospedeiro.querySelectorAll("p")).find(
        (p) => p.textContent === rotulo,
      )?.nextElementSibling?.textContent ?? ""
    )
      .replaceAll(String.fromCharCode(160), " ")
      .replace(/\s+/g, " ")
      .trim();

  /** O gráfico só sai do esqueleto 250 ms depois de montado. */
  async function esperarOGraficoFicarPronto() {
    await act(async () => {
      await new Promise((resolver) => setTimeout(resolver, 320));
    });
  }

  it("dia só com pedido de R$ 0 (brinde) é movimento: o gráfico não diz 'Nenhuma venda paga'", async () => {
    // 30 dias fechados + hoje (parcial, fora da janela): o brinde é o último fechado.
    const brinde = Array.from({ length: 31 }, (_, i) =>
      diaDe(i, i === 29 ? { revenue: 0, orders: 2 } : {}),
    );
    await montar(statsCom(brinde));
    await esperarOGraficoFicarPronto();
    expect(hospedeiro.textContent).not.toContain(
      "Nenhuma venda paga neste período",
    );
  });

  it("histórico todo zerado: o gráfico diz 'Nenhuma venda paga'", async () => {
    await montar(statsCom(Array.from({ length: 31 }, (_, i) => diaDe(i))));
    await esperarOGraficoFicarPronto();
    expect(hospedeiro.textContent).toContain(
      "Nenhuma venda paga neste período",
    );
  });

  it("estoque sem custo cadastrado (R$ 0): o cartão 'Sobre o estoque de hoje' não aparece", async () => {
    await montar(statsCom([diaDe(0, { revenue: 1, profit: 100 })], 0));
    await abrirRetornoDoEstoque();
    expect(hospedeiro.textContent).toContain("Lucro acumulado");
    expect(hospedeiro.textContent).not.toContain("Sobre o estoque de hoje");
  });

  it("'Sobre o estoque de hoje': 999% exato é número; 1000% vira '>999%'", async () => {
    await montar(statsCom([diaDe(0, { revenue: 1, profit: 9990 })], 1000));
    await abrirRetornoDoEstoque();
    expect(cartao("Sobre o estoque de hoje")).toBe("999%");

    await montar(statsCom([diaDe(0, { revenue: 1, profit: 9999 })], 1000));
    expect(cartao("Sobre o estoque de hoje")).toBe(">999%");
  });

  it("'Sobre o estoque de hoje': −999% exato é número; −1000% vira '<-999%'", async () => {
    await montar(statsCom([diaDe(0, { revenue: 1, profit: -9990 })], 1000));
    await abrirRetornoDoEstoque();
    expect(cartao("Sobre o estoque de hoje")).toBe("-999%");

    await montar(statsCom([diaDe(0, { revenue: 1, profit: -9999 })], 1000));
    expect(cartao("Sobre o estoque de hoje")).toBe("<-999%");
  });

  it("Retorno do estoque, janela de 30 dias: o lucro do 31º dia para trás não entra", async () => {
    // 40 dias; o lucro de R$ 1.000 está no 31º dia contando de hoje para trás.
    const historico = Array.from({ length: 40 }, (_, i) =>
      diaDe(i, {
        revenue: 10,
        orders: 1,
        profit: i === 40 - 31 ? 1000 : i === 40 - 30 ? 250 : 0,
      }),
    );
    await montar(statsCom(historico, 500));
    await abrirRetornoDoEstoque();
    const lucro = cartao("Lucro acumulado");
    // Só os R$ 250 do 30º dia: com a janela de 31 dias seria R$ 1.250.
    expect(lucro).toMatch(/^R\$ 250(,00)?$/);
  });
});
