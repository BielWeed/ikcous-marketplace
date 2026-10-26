// @vitest-environment jsdom
//
// Relatórios › Histórico da loja:
//  - o selo de crescimento diz a verdade: vermelho e com o sinal escrito na
//    queda, verde na alta, "vs. 30 dias antes" (o dado é 30 dias contra os 30
//    anteriores e NÃO muda com os botões 30/90/Tudo), vírgula brasileira, e
//    aparece também no celular;
//  - o eixo do gráfico usa o formatador de moeda do painel ("R$ 1,5 mil", com
//    o menos de verdade), nunca "R$ -1500" nem "R$ 37.5".
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { act, cloneElement } from "react";
import type { ReactElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O jsdom não mede layout: sem tamanho o recharts não desenha eixo nenhum.
vi.mock("recharts", async (original) => {
  const real = await original<typeof import("recharts")>();
  return {
    ...real,
    ResponsiveContainer: ({ children }: { children: ReactElement }) =>
      cloneElement(children, { width: 420, height: 220 } as never),
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function dias(valores: number[]) {
  return valores.map((revenue, i) => ({
    date: `2026-10-${String(i + 1).padStart(2, "0")}`,
    full_date: `${String(i + 1).padStart(2, "0")}/10`,
    revenue,
    orders: 1,
    profit: revenue * 0.4,
    cost_sold: revenue * 0.6,
  }));
}

function stats(extra: Record<string, unknown>, receitas = [100, 200, 300]) {
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
    revenueHistory: dias(receitas),
    topProducts: [],
    inventoryAlerts: 0,
    ...extra,
  } as unknown as DashboardStats;
}

describe("Histórico da loja: selo de crescimento e eixo em reais", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
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
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function montar(s: DashboardStats, modo?: "Retorno do estoque") {
    await act(async () => {
      raiz.render(
        <OperationalPerformanceChart stats={s} loading={false} active />,
      );
    });
    if (modo) {
      const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
        b.textContent?.includes(modo),
      );
      await act(async () => botao?.click());
    }
    // O gráfico só desenha 250 ms depois de a tela ficar ativa.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 320));
    });
  }

  const selo = () =>
    hospedeiro.querySelector<HTMLElement>("[data-selo-de-crescimento]");

  describe("selo de crescimento", () => {
    it("queda: vermelho, menos de verdade, vírgula e a base da comparação", async () => {
      await montar(stats({ growth: -12.3 }));
      const el = selo();
      expect(el).not.toBeNull();
      expect(el?.textContent).toContain("−12,3%");
      expect(el?.textContent).toContain("vs. 30 dias antes");
      expect(el?.textContent).not.toContain("12.3");
      expect(el?.innerHTML).toContain("text-red-");
      expect(el?.innerHTML).not.toContain("text-emerald-");
    });

    it("alta: verde, com o + escrito", async () => {
      await montar(stats({ growth: 8 }));
      const el = selo();
      expect(el?.textContent).toContain("+8,0%");
      expect(el?.innerHTML).toContain("text-emerald-");
      expect(el?.innerHTML).not.toContain("text-red-");
    });

    it("zero (e o que arredonda para zero): neutro, sem sinal", async () => {
      await montar(stats({ growth: 0 }));
      expect(selo()?.textContent).toContain("0,0%");
      expect(selo()?.textContent).not.toMatch(/[+−]0,0/);
      expect(selo()?.innerHTML).not.toContain("text-red-");
      expect(selo()?.innerHTML).not.toContain("text-emerald-");
    });

    it("aparece também no celular (não é mais escondido abaixo de 640 px)", async () => {
      await montar(stats({ growth: -3 }));
      let no: HTMLElement | null = selo();
      while (no && no !== hospedeiro) {
        expect(no.className).not.toMatch(/(^|\s)hidden(\s|$)/);
        no = no.parentElement;
      }
      expect(selo()).not.toBeNull();
    });

    it("lê o crescimento dos 30 dias, nunca o 'hoje contra ontem'", async () => {
      // Sem `growth` não há comparação de 30 dias para mostrar: o selo some em
      // vez de rotular com "30 dias" um número de outro período.
      await montar(
        stats({
          today: {
            revenue: 0,
            count: 0,
            pending: 0,
            revenueTrend: 55,
            countTrend: 0,
          },
        }),
      );
      expect(selo()).toBeNull();
    });

    it("não muda com os botões 30 dias / 90 dias / Tudo", async () => {
      await montar(stats({ growth: -12.3 }));
      for (const rotulo of ["90 dias", "Tudo", "30 dias"]) {
        const botao = [...hospedeiro.querySelectorAll("button")].find(
          (b) => b.textContent?.trim() === rotulo,
        );
        await act(async () => botao?.click());
        expect(selo()?.textContent).toContain("−12,3%");
        expect(selo()?.textContent).toContain("vs. 30 dias antes");
      }
    });

    it("valor que não é número não vira 'NaN%'", async () => {
      await montar(stats({ growth: Number.NaN }));
      expect(hospedeiro.textContent).not.toContain("NaN");
      expect(selo()).toBeNull();
    });
  });

  describe("eixo do gráfico", () => {
    const rotulosDoEixo = () =>
      [...hospedeiro.querySelectorAll(".recharts-yAxis .recharts-text")].map(
        (t) => t.textContent ?? "",
      );

    it("vendas: valores pequenos e grandes saem em reais, com vírgula", async () => {
      await montar(stats({ growth: 1 }, [37.5, 12500, 1500]));
      const rotulos = rotulosDoEixo();
      expect(rotulos.length).toBeGreaterThan(0);
      for (const r of rotulos) {
        expect(r).toMatch(/^[−]?R\$ \d/);
        expect(r).not.toMatch(/\d\.\d/);
        expect(r).not.toContain("R$ -");
      }
      expect(rotulos.some((r) => r.includes("mil"))).toBe(true);
    });

    it("lucro acumulado negativo: menos de verdade, nunca 'R$ -1500'", async () => {
      // Custo maior que a receita: o lucro acumulado fica negativo.
      const s = stats({ growth: 1 }, [100, 100]);
      (
        s as unknown as { revenueHistory: Array<Record<string, number>> }
      ).revenueHistory[0].profit = -1500;
      await montar(s, "Retorno do estoque");
      const rotulos = rotulosDoEixo();
      expect(rotulos.length).toBeGreaterThan(0);
      expect(rotulos.some((r) => r.startsWith("−R$"))).toBe(true);
      for (const r of rotulos) {
        expect(r).not.toContain("R$ -");
        expect(r).not.toMatch(/\d\.\d/);
      }
    });
  });
});
