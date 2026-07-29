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

export const KpiSummaryCards = memo(function KpiSummaryCards({
  stats,
  loading,
  active,
}: KpiSummaryCardsProps) {
  const kpiCards = useMemo<readonly KpiCardConfig[]>(
    () => [
      {
        id: "volume",
        label: "Volume Total",
        value: `R$ ${(stats?.executive?.totalRevenue || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })}`,
        subValue: "Volume bruto de vendas",
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
    ],
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
