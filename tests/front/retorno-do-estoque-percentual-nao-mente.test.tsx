// @vitest-environment jsdom
//
// Gráfico "Retorno do estoque" (Histórico da loja): o cartão do percentual
// divide o lucro acumulado pelo custo do estoque de HOJE
// (`stats.inventory.totalCost`). Duas consequências visíveis ao lojista:
//   1. lucro minúsculo negativo (ex.: -R$ 0,20 sobre R$ 1.000 de estoque)
//      virava "-0%" (toFixed de um negativo pequeno devolve "-0");
//   2. estoque quase zerado (ex.: R$ 0,01) virava "400000%".
// Além disso o rótulo "Recuperado" prometia mais que a conta: não é quanto do
// investimento voltou, é o lucro do período sobre o estoque que existe hoje.
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

const ROTULO = "Sobre o estoque de hoje";

function stats(lucro: number, custoDoEstoque: number): DashboardStats {
  return {
    today: { revenue: 0, count: 0, pending: 0, revenueTrend: 0, countTrend: 0 },
    month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    executive: {
      totalRevenue: 0,
      totalOrders: 0,
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicket: 0,
      avgTicketTrend: 0,
      activeCustomers: 0,
      activeCustomersTrend: 0,
    },
    revenueHistory: [
      {
        date: "2026-10-10",
        full_date: "10/10",
        revenue: 100,
        orders: 1,
        profit: lucro,
        cost_sold: 60,
      },
    ],
    topProducts: [],
    inventoryAlerts: 0,
    inventory: { totalCost: custoDoEstoque },
  } as unknown as DashboardStats;
}

describe("Retorno do estoque — o percentual não mente", () => {
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

  /** Monta o gráfico, abre "Retorno do estoque" e devolve o valor do cartão
   * do percentual (o <p> logo depois do rótulo) — ou null se não há cartão. */
  async function valorDoCartao(s: DashboardStats): Promise<string | null> {
    await act(async () => {
      raiz.render(
        <OperationalPerformanceChart stats={s} loading={false} active />,
      );
    });
    const botao = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Retorno do estoque"),
    );
    await act(async () => {
      botao?.click();
    });
    // Acha o cartão pelo rótulo novo OU pelo antigo: os testes de valor
    // medem o número, não a troca de nome (essa tem teste próprio abaixo).
    const rotulo = Array.from(hospedeiro.querySelectorAll("p")).find(
      (p) => p.textContent === ROTULO || p.textContent === "Recuperado",
    );
    return (
      (rotulo?.nextElementSibling?.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim() || null
    );
  }

  it("controle: lucro de R$ 40 sobre estoque de R$ 100 = 40%", async () => {
    expect(await valorDoCartao(stats(40, 100))).toBe("40%");
  });

  it("lucro negativo minúsculo não vira -0%", async () => {
    // -0,2 / 1000 = -0,02% → arredonda para 0%
    expect(await valorDoCartao(stats(-0.2, 1000))).toBe("0%");
  });

  it("controle: prejuízo de verdade continua com o sinal", async () => {
    expect(await valorDoCartao(stats(-50, 100))).toBe("-50%");
  });

  it("estoque quase zerado não mostra milhares de por cento", async () => {
    // 40 / 0,01 = 400000%
    const valor = await valorDoCartao(stats(40, 0.01));
    expect(valor).toBe(">999%");
  });

  it("o mesmo teto vale para o prejuízo sobre estoque quase zerado", async () => {
    expect(await valorDoCartao(stats(-40, 0.01))).toBe("<-999%");
  });

  it("o rótulo diz de que conta o percentual sai", async () => {
    await valorDoCartao(stats(40, 100));
    expect(hospedeiro.textContent).toContain(ROTULO);
    expect(hospedeiro.textContent).not.toContain("Recuperado");
  });
});
