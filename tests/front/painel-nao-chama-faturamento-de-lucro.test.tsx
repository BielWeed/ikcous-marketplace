import { TopProductsList } from "@/components/admin/dashboard/TopProductsList";
import type { DashboardStats } from "@/hooks/useAnalytics";
// @vitest-environment jsdom
//
// HISTÓRIA COMPLETA (para quem abrir este arquivo amanhã):
//
// 1. Defeito original (auditoria de 20/08): o bloco ordenava por
//    `SUM(oi.quantity * oi.price)` — faturamento — com rótulo "mais
//    lucrativos". A lojista decide reposição por essa lista.
// 2. Paliativo de 23/08 (`de3fa05`): trocou o RÓTULO para "que mais
//    faturaram" e deixou por escrito o passo que faltava: "ordenar por
//    lucro de verdade exige mudar a RPC, e isso é banco".
// 3. O passo 2 chegou: a migration `20261001000000` faz a RPC ordenar e
//    exibir `SUM(qty * (price - COALESCE(custo, 0)))` — LUCRO. O par
//    completo (rotulo voltou a "mais lucrativos" + RPC de lucro) é o
//    commit `0de59ae` + `9980271`; a ORDEM de aplicação (front mergeia
//    primeiro, clique da migration depois) está no comentário do
//    TopProductsList e na revisão 20260825-2145.
//
// Este teste guarda a METADE FRONT do par: o título tem que afirmar
// "lucrativos" (verdade desde a migration) e NÃO pode voltar a
// "faturaram" (mentiria sobre o número exibido). A metade RPC é guardada
// pela ficha por consulta no cabeçalho da própria migration.
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

describe("TopProductsList — o título diz 'lucrativos' porque a RPC (20261001000000) calcula lucro", () => {
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
