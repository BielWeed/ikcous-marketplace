// @vitest-environment jsdom
//
// Histórico da loja: cada botão da janela ("30 dias", "90 dias", "Tudo") tem
// de mostrar o faturamento, os pedidos e o valor médio DAQUELE período. Um
// "90 dias" que continua mostrando os 30 dias deixa a lojista decidindo em
// cima de um número que não é o que ela pediu.
//
// Os três períodos são desenhados para NUNCA coincidirem: 30 dias recentes
// (R$ 100 e 1 pedido por dia), os 60 anteriores (R$ 70 e 2 pedidos) e os 60
// mais antigos (R$ 20 e 3 pedidos). Os testes vizinhos só conferem os 30 dias
// iniciais, ou clicam nos botões olhando o selo de crescimento.
import { OperationalPerformanceChart } from "@/components/admin/dashboard/OperationalPerformanceChart";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

/** `quantos` dias seguidos, o último a `diasAntesDoFim` dias de 2026-10-31. */
function periodo(
  quantos: number,
  diasAntesDoFim: number,
  revenue: number,
  orders: number,
) {
  return Array.from({ length: quantos }, (_, i) => {
    const data = new Date("2026-10-31T00:00:00.000Z");
    data.setUTCDate(data.getUTCDate() - (diasAntesDoFim + quantos - 1 - i));
    const iso = data.toISOString().slice(0, 10);
    return {
      date: iso,
      full_date: iso.split("-").reverse().slice(0, 2).join("/"),
      revenue,
      orders,
      profit: revenue * 0.4,
      cost_sold: revenue * 0.6,
    };
  });
}

function stats(): DashboardStats {
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
    // Do mais antigo para o mais novo: 60 + 60 + 30 = 150 dias.
    revenueHistory: [
      ...periodo(60, 90, 20, 3),
      ...periodo(60, 30, 70, 2),
      ...periodo(30, 0, 100, 1),
    ],
    topProducts: [],
    inventoryAlerts: 0,
  } as unknown as DashboardStats;
}

describe("Histórico da loja: o período clicado troca os números do resumo", () => {
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

  /** O número que aparece embaixo do rótulo ("Faturamento", "Pedidos"...). */
  function numeroDe(rotulo: string) {
    const nome = [...hospedeiro.querySelectorAll("p")].find(
      (p) => p.textContent?.trim() === rotulo,
    );
    // O Intl põe espaço inseparável depois de "R$".
    return nome?.nextElementSibling?.textContent?.replace(/\s/g, " ");
  }

  const botaoDoPeriodo = (rotulo: string) =>
    [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === rotulo,
    );

  // Receita = soma dos dias; valor médio = receita / pedidos, em centavos.
  const PERIODOS = [
    {
      rotulo: "30 dias",
      faturamento: "R$ 3.000,00", // 30 x 100
      pedidos: "30",
      medio: "R$ 100,00",
    },
    {
      rotulo: "90 dias",
      faturamento: "R$ 7.200,00", // 3.000 + 60 x 70
      pedidos: "150", // 30 + 60 x 2
      medio: "R$ 48,00",
    },
    {
      rotulo: "Tudo",
      faturamento: "R$ 8.400,00", // 7.200 + 60 x 20
      pedidos: "330", // 150 + 60 x 3
      medio: "R$ 25,45",
    },
  ] as const;

  it("30, 90 e Tudo mostram, cada um, o faturamento, os pedidos e o valor médio do período", async () => {
    await act(async () => {
      raiz.render(
        <OperationalPerformanceChart stats={stats()} loading={false} active />,
      );
    });

    // Ida e volta: a ordem prova que o botão manda, não que o estado "sobrou".
    for (const p of [...PERIODOS, PERIODOS[0], PERIODOS[2], PERIODOS[1]]) {
      const botao = botaoDoPeriodo(p.rotulo);
      expect(botao, `botão "${p.rotulo}"`).toBeDefined();
      await act(async () => botao?.click());

      expect(botao?.getAttribute("aria-pressed"), p.rotulo).toBe("true");
      expect(numeroDe("Faturamento"), `faturamento em ${p.rotulo}`).toBe(
        p.faturamento,
      );
      expect(numeroDe("Pedidos"), `pedidos em ${p.rotulo}`).toBe(p.pedidos);
      expect(numeroDe("Valor médio"), `valor médio em ${p.rotulo}`).toBe(
        p.medio,
      );
    }
  });
});
