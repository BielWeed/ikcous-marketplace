// Trilha 4 (#104): o card "Volume Total" usa
// `SUM(marketplace_orders.total)`, que já é líquido de desconto — mas o
// rótulo dizia "Volume bruto de vendas", o oposto do que o número
// representa. A decisão registrada no brief é não mexer em cálculo de
// dinheiro para resolver um problema de rótulo, então o conserto é só o
// texto.
//
// Isolamos `buildKpiCards` (função pura exportada por KpiSummaryCards.tsx)
// em vez de montar o carrossel inteiro: `AdminKpiCarousel` arrasta
// embla-carousel-react e framer-motion, e nenhum dos dois é o que esta
// tarefa muda.
import type { DashboardStats } from "@/hooks/useAnalytics";
import { describe, expect, it } from "vitest";

function statsComTotal(totalRevenue: number): DashboardStats {
  return {
    today: {
      revenue: 0,
      count: 0,
      pending: 0,
      revenueTrend: 0,
      countTrend: 0,
    },
    month: { revenue: 0, count: 0, revenueTrend: 0, countTrend: 0 },
    executive: {
      totalRevenue,
      totalOrders: 0,
      revenueTrend: 0,
      ordersTrend: 0,
      avgTicket: 0,
      avgTicketTrend: 0,
      activeCustomers: 0,
      activeCustomersTrend: 0,
    },
    revenueHistory: [],
    topProducts: [],
    inventoryAlerts: 0,
  };
}

describe("buildKpiCards — rótulo do card Volume Total (#104)", () => {
  it("não chama o total de 'bruto': o valor já é líquido de desconto no banco", async () => {
    const { buildKpiCards } = await import(
      "@/components/admin/dashboard/KpiSummaryCards"
    );

    const cards = buildKpiCards(statsComTotal(1000));
    const volume = cards.find((c) => c.id === "volume");

    expect(volume?.subValue).not.toMatch(/bruto/i);
    expect(volume?.subValue).toMatch(/líquido/i);
  });
});
