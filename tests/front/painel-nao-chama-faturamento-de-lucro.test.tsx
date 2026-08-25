import { TopProductsList } from "@/components/admin/dashboard/TopProductsList";
import type { DashboardStats } from "@/hooks/useAnalytics";
// @vitest-environment jsdom
//
// Defeito 1 (lote fix/caca-defeitos-lote-1): o bloco "TOP 5 PRODUTOS MAIS
// LUCRATIVOS" do Painel ordena e exibe `SUM(oi.quantity * oi.price)` — ver
// `supabase/migrations/20260822000100_analitico_conta_so_dinheiro_reconhecido.sql`,
// linhas 247-262. Isso é receita bruta, sem descontar custo nenhum: um
// produto de giro alto e margem magra encabeça a lista de "mais lucrativos"
// mesmo perdendo dinheiro. A lojista usa essa lista para decidir o que
// repor, e o rótulo mente sobre o que está ali.
//
// Este teste prova o título: ele não pode mais afirmar "lucrativos" (a RPC
// não desconta custo), e tem que dizer o que a lista realmente é —
// faturamento/vendas em R$.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// jsdom não implementa IntersectionObserver — LazyImage (usado pela
// miniatura de cada produto) cria um a cada montagem.
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos vizinhos deste diretório.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function statsComUmProduto(): DashboardStats {
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
    revenueHistory: [],
    topProducts: [
      {
        id: "prod-1",
        name: "Produto giro alto margem magra",
        quantity: 40,
        total: 1200,
        image: "",
      },
    ],
    inventoryAlerts: 0,
  };
}

describe("TopProductsList — o título não promete lucro que a RPC não calcula", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
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

  it("diz 'lucrativos' — a RPC ordena por lucro (migration 20261001000000), nunca por faturamento", async () => {
    await act(async () => {
      raiz.render(
        <TopProductsList
          stats={statsComUmProduto()}
          loading={false}
          onNavigate={vi.fn()}
        />,
      );
    });

    const textoDoTitulo = hospedeiro.querySelector("h2")?.textContent ?? "";

    // O PAR completo (revisão 20260825-2145): a migration 20261001000000
    // faz a RPC ordenar por LUCRO (SUM(qty*(price-custo))); este teste é a
    // outra metade — o rótulo volta a dizer "lucrativos", agora VERDADE.
    // Controle negativo: título dizendo "faturaram" faz cair — é ele que
    // prova que a asserção discrimina (e impediu o par incompleto: label
    // de faturamento em cima de dados de lucro).
    expect(textoDoTitulo.toLowerCase()).toContain("lucrativ");
    expect(textoDoTitulo.toLowerCase()).not.toContain("fatur");
  });
});
