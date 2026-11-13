// @vitest-environment jsdom
//
// Relatórios › Histórico da loja — dois números que discordavam do que a
// própria tela mostra:
//  1. O selo "vs. 30 dias antes" vinha da RPC (últimos 30 dias até a HORA de
//     agora), enquanto o gráfico e o resumo contam DIAS DE CALENDÁRIO. Uma
//     venda na borda entre as duas janelas fazia o selo dizer "+100%" ao lado
//     de "R$ 0 e nenhum pedido" (e escondia/errava um crescimento legítimo).
//     Com 60 dias de histórico, o selo sai do PRÓPRIO histórico; a RPC só
//     serve de reserva quando o histórico é curto.
//  2. "Valor médio" somava reais em ponto flutuante: 10,00 + 10,01 = 20,009999…
//     ÷ 2 = 10,004999… e aparecia R$ 10,00 onde o resumo do banco diz R$ 10,01.
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { act, cloneElement } from "react";
import type { ReactElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// O jsdom não mede layout: sem tamanho o recharts não desenha nada.
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

const SEM_NBSP = (t: string | null | undefined) =>
  (t ?? "").split(String.fromCharCode(160)).join(" ").replace(/\s+/g, " ");

type Dia = {
  date: string;
  full_date: string;
  revenue: number;
  orders: number;
  profit: number;
  cost_sold: number;
};

/** N dias seguidos de calendário terminando em 13/11/2026 (o último é hoje). */
function calendario(receitas: number[]): Dia[] {
  return receitas.map((revenue, i) => {
    const data = new Date(Date.UTC(2026, 10, 13));
    data.setUTCDate(data.getUTCDate() - (receitas.length - 1 - i));
    const iso = data.toISOString().slice(0, 10);
    const [, mes, dia] = iso.split("-");
    return {
      date: iso,
      full_date: `${dia}/${mes}`,
      revenue,
      orders: revenue > 0 ? 1 : 0,
      profit: 0,
      cost_sold: 0,
    };
  });
}

/** 60 dias zerados com as vendas pedidas nas posições dadas (0 = o mais
 * antigo, 29 = último dos "30 dias antes", 30 = primeiro dos "últimos 30"). */
function sessentaDias(vendas: Record<number, number>): Dia[] {
  const receitas = Array<number>(60).fill(0);
  for (const [posicao, valor] of Object.entries(vendas)) {
    receitas[Number(posicao)] = valor;
  }
  return calendario(receitas);
}

function stats(historico: Dia[], growth?: number): DashboardStats {
  return {
    growth,
    revenueHistory: historico,
    topProducts: [],
    inventory: { totalCost: 0 },
  } as unknown as DashboardStats;
}

describe("Histórico da loja: selo e valor médio ao centavo", () => {
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

  async function montar(s: DashboardStats) {
    await act(async () => {
      raiz.render(
        <OperationalPerformanceChart stats={s} loading={false} active />,
      );
    });
  }
  const selo = () =>
    hospedeiro.querySelector<HTMLElement>("[data-selo-de-crescimento]");
  const textoDoSelo = () => SEM_NBSP(selo()?.textContent);

  describe("selo de crescimento: concorda com o gráfico", () => {
    it("venda na borda que a RPC põe nos últimos 30 dias: nunca +100% ao lado de 'R$ 0'", async () => {
      // R$ 100 no ÚLTIMO dia dos "30 dias antes" (posição 29). Pelo relógio a
      // RPC a conta nos últimos 30 dias (growth 100); pelo calendário ela está
      // fora do período do gráfico, que mostra R$ 0 e nenhum pedido.
      await montar(stats(sessentaDias({ 29: 100 }), 100));
      expect(hospedeiro.textContent).not.toContain("+100");
      expect(textoDoSelo()).toContain("−100,0%");
      expect(textoDoSelo()).toContain("vs. 30 dias antes");
      expect(SEM_NBSP(hospedeiro.textContent)).toContain("R$ 0,00");
    });

    it("a mesma venda ao contrário (borda do outro lado): sem base, sem selo", async () => {
      // R$ 100 no PRIMEIRO dia dos últimos 30 (posição 30): a RPC a conta nos
      // 30 dias antes (growth -100), mas pelo calendário os 30 dias antes são
      // zero — "de zero para algo" não é crescimento.
      await montar(stats(sessentaDias({ 30: 100 }), -100));
      expect(selo()).toBeNull();
    });

    it("crescimento legítimo (R$ 100 para R$ 200) aparece mesmo se a RPC discorda", async () => {
      await montar(stats(sessentaDias({ 10: 100, 50: 200 }), 0));
      expect(textoDoSelo()).toContain("+100,0%");
    });

    it("queda legítima sai do histórico, em vermelho", async () => {
      await montar(stats(sessentaDias({ 10: 200, 50: 100 }), 7));
      expect(textoDoSelo()).toContain("−50,0%");
      expect(selo()?.innerHTML).toContain("text-red-");
    });

    it("crescimento fracionado: R$ 300 para R$ 400 é +33,3%", async () => {
      await montar(stats(sessentaDias({ 5: 100, 6: 200, 40: 400 }), 0));
      expect(textoDoSelo()).toContain("+33,3%");
    });

    it("histórico sem venda nos 60 dias: nenhum selo, mesmo com a RPC dizendo 0", async () => {
      await montar(stats(sessentaDias({}), 0));
      expect(selo()).toBeNull();
    });

    it("vendeu igual nos dois períodos: 0% de verdade continua aparecendo", async () => {
      await montar(stats(sessentaDias({ 10: 80, 50: 80 })));
      expect(textoDoSelo()).toContain("0,0%");
      expect(textoDoSelo()).not.toMatch(/[+−]0,0/);
    });

    it("com 60 dias o histórico manda até quando a RPC nem veio", async () => {
      await montar(stats(sessentaDias({ 10: 100, 50: 150 })));
      expect(textoDoSelo()).toContain("+50,0%");
    });

    it("histórico maior que 60 dias (Tudo): só os últimos 60 entram na conta", async () => {
      // 100 dias: um R$ 9.999 antigo, fora das duas janelas, não pode pesar.
      const receitas = Array<number>(100).fill(0);
      receitas[0] = 9999;
      receitas[60] = 100; // 40 dias antes de hoje: janela "antes"
      receitas[95] = 300; // últimos 30
      await montar(stats(calendario(receitas), 0));
      expect(textoDoSelo()).toContain("+200,0%");
    });

    it("enquanto carrega, nenhum selo (nem com histórico de 60 dias)", async () => {
      await act(async () => {
        raiz.render(
          <OperationalPerformanceChart
            stats={stats(sessentaDias({ 10: 100, 50: 200 }), 100)}
            loading
            active
          />,
        );
      });
      expect(selo()).toBeNull();
    });

    it("histórico curto (menos de 60 dias) cai na reserva da RPC", async () => {
      await montar(stats(calendario(Array<number>(20).fill(50)), 8));
      expect(textoDoSelo()).toContain("+8,0%");
    });

    it("59 dias ainda é histórico curto: a RPC manda", async () => {
      // Pelo histórico, seria +100%; a RPC diz 8 — com 59 dias não há base
      // completa de 30 + 30, então vale a RPC.
      const receitas = Array<number>(59).fill(0);
      receitas[10] = 100;
      receitas[50] = 200;
      await montar(stats(calendario(receitas), 8));
      expect(textoDoSelo()).toContain("+8,0%");
    });

    it("reserva mantém a guarda: +100 da RPC sem venda antes no histórico curto, sem selo", async () => {
      await montar(stats(calendario(Array<number>(20).fill(50)), 100));
      expect(selo()).toBeNull();
    });

    it("reserva mantém a guarda: 0 da RPC com histórico curto sem venda, sem selo", async () => {
      await montar(stats(calendario(Array<number>(20).fill(0)), 0));
      expect(selo()).toBeNull();
    });
  });

  describe("valor médio: soma em centavos inteiros", () => {
    const valorMedio = () => {
      const rotulo = [...hospedeiro.querySelectorAll("p")].find(
        (p) => p.textContent === "Valor médio",
      );
      return SEM_NBSP(rotulo?.nextElementSibling?.textContent);
    };
    const faturamento = () => {
      const rotulo = [...hospedeiro.querySelectorAll("p")].find(
        (p) => p.textContent === "Faturamento",
      );
      return SEM_NBSP(rotulo?.nextElementSibling?.textContent);
    };

    it("R$ 10,00 e R$ 10,01 em dois pedidos: valor médio R$ 10,01, como o banco", async () => {
      await montar(stats(calendario([10, 10.01])));
      expect(valorMedio()).toBe("R$ 10,01");
      expect(faturamento()).toBe("R$ 20,01");
    });

    it("quatro pedidos em dois dias, R$ 99,99 + R$ 0,01: média exata de R$ 25,00", async () => {
      const dias = calendario([99.99, 0.01]);
      dias[0].orders = 3;
      await montar(stats(dias));
      expect(faturamento()).toBe("R$ 100,00");
      expect(valorMedio()).toBe("R$ 25,00");
    });

    it("meio centavo na média sobe, como o ROUND do banco: R$ 0,01 + R$ 0,58 em 2 pedidos = R$ 0,30", async () => {
      // 1 + 58 centavos = 59 ÷ 2 = 29,5 → 30. Em reais com vírgula flutuante
      // (0,01*100 + 0,58*100 = 58,99999999999999) a média caía para R$ 0,29.
      await montar(stats(calendario([0.01, 0.58])));
      expect(valorMedio()).toBe("R$ 0,30");
    });

    it("dias vazios: o valor médio é '—', nunca R$ 0,00", async () => {
      await montar(stats(calendario([0, 0, 0])));
      expect(valorMedio()).toBe("—");
    });

    it("valor médio redondo continua redondo", async () => {
      await montar(stats(calendario([100, 50])));
      expect(valorMedio()).toBe("R$ 75,00");
    });
  });
});
