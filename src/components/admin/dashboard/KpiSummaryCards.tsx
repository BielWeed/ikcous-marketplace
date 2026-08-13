import {
  AdminKpiCarousel,
  type KpiCardConfig,
} from "@/components/admin/AdminKpiCarousel";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { ShoppingBag, Star, TrendingUp, Users } from "lucide-react";
import { memo, useMemo } from "react";

interface KpiSummaryCardsProps {
  stats: DashboardStats | null;
  loading?: boolean;
  active?: boolean;
}

/**
 * Monta a config dos quatro cards a partir de `stats`. Extraída como função
 * pura (#104) para dar para testar o RÓTULO do card "Volume Total" sem
 * montar `AdminKpiCarousel` inteiro (embla-carousel-react + framer-motion).
 *
 * O texto do "Volume Total" mudou de "Volume bruto de vendas" para "Total
 * líquido de descontos": o valor vem de
 * `SUM(marketplace_orders.total)` (RPC `get_admin_analytics_v2`), que JÁ é
 * líquido de desconto — "bruto" dizia o oposto do que o número é. Isso é só
 * o rótulo; o cálculo não mudou (decisão do brief da Trilha 4/#104: não
 * mexer em número de dinheiro para resolver um problema de rótulo).
 */
export function buildKpiCards(
  stats: DashboardStats | null,
): readonly KpiCardConfig[] {
  return [
    {
      id: "volume",
      label: "Volume Total",
      value: `R$ ${(stats?.executive?.totalRevenue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      subValue: "Total líquido de descontos",
      icon: ShoppingBag,
      accent: "text-admin-gold",
    },
    {
      id: "pedidos",
      label: "Total de Pedidos",
      value: (stats?.executive?.totalOrders || 0).toString(),
      subValue: "Transações realizadas",
      icon: TrendingUp,
      accent: "text-emerald-500",
    },
    {
      id: "ticket",
      label: "Ticket Médio",
      value: `R$ ${(stats?.executive?.avgTicket || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
      subValue: "Média por transação",
      icon: Star,
      accent: "text-blue-500",
    },
    {
      id: "clientes",
      label: "Clientes Únicos",
      value: (stats?.executive?.activeCustomers || 0).toString(),
      subValue: "Compradores ativos",
      icon: Users,
      accent: "text-purple-500",
    },
  ];
}

export const KpiSummaryCards = memo(function KpiSummaryCards({
  stats,
  loading,
  active,
}: KpiSummaryCardsProps) {
  const kpiCards = useMemo<readonly KpiCardConfig[]>(
    () => buildKpiCards(stats),
    [stats],
  );

  return (
    <div className="w-full px-0 sm:px-6">
      <AdminKpiCarousel
        cards={kpiCards}
        loading={loading}
        active={active}
        title="Métricas Principais"
      />
    </div>
  );
});
