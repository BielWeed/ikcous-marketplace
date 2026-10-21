import { ExplicacaoDoRelatorio } from "@/components/admin/crm/ExplicacaoDoRelatorio";
import {
  CartaoDoCrm,
  EstadoVazioDoCrm,
} from "@/components/admin/crm/PecasDoCrm";
import { formatCurrency } from "@/lib/utils";
import { memo, useMemo, useState } from "react";

export interface CategoryData {
  name: string;
  value: number;
  color?: string;
  avg_ticket?: number;
  orders?: number;
  gradientId?: string;
  solidColor?: string;
  valueType?: "currency" | "number";
}
interface StrategicIntelligenceBlocksProps {
  readonly categoryData: CategoryData[];
  readonly loading: boolean;
  readonly active?: boolean;
  readonly error?: string | null;
  readonly onRetry?: () => void;
}
const PREMIUM_PALETTE = [
  "admin-gold",
  "sky-400",
  "rose-400",
  "emerald-400",
  "violet-400",
  "orange-400",
  "blue-400",
  "zinc-400",
  "lime-400",
  "amber-400",
] as const;
const CORES = [
  "bg-admin-gold",
  "bg-sky-400",
  "bg-rose-400",
  "bg-emerald-400",
  "bg-violet-400",
  "bg-orange-400",
  "bg-blue-400",
  "bg-zinc-400",
  "bg-lime-400",
  "bg-amber-400",
];

export const StrategicIntelligenceBlocks = memo(
  function StrategicIntelligenceBlocks({
    categoryData,
    loading,
    error = null,
    onRetry,
  }: StrategicIntelligenceBlocksProps) {
    const [expandido, setExpandido] = useState(false);
    const safeCategoryData = useMemo(
      () =>
        (categoryData || []).map((item, index) => {
          const safeIndex =
            index >= PREMIUM_PALETTE.length
              ? index + Math.floor(index / PREMIUM_PALETTE.length)
              : index;
          return {
            ...item,
            name: item.name
              ? item.name.charAt(0).toUpperCase() + item.name.slice(1)
              : "",
            value: Number(item.value) || 0,
            cor: CORES[safeIndex % PREMIUM_PALETTE.length],
          };
        }),
      [categoryData],
    );
    const totalRevenue = safeCategoryData.reduce(
      (acc, curr) => acc + (curr.value || 0),
      0,
    );
    return (
      <CartaoDoCrm
        id="crm-categorias"
        titulo="Vendas por categoria"
        descricao="Desde o início da loja · com frete"
        className="min-h-[282px]"
        acao={
          <ExplicacaoDoRelatorio titulo="Vendas por categoria">
            <p>
              Total desta lista = a receita total da loja (rateada por
              categoria, já líquida de desconto e com frete). Só fica abaixo se
              algum pedido tiver todos os produtos excluídos do catálogo.
            </p>
          </ExplicacaoDoRelatorio>
        }
      >
        {loading && categoryData.length === 0 ? (
          <div
            className="premium-shimmer h-[156px] rounded-xl"
            aria-hidden="true"
          />
        ) : !loading && error ? (
          <div
            role="alert"
            className="flex min-h-[156px] flex-col justify-center gap-2 text-rose-300"
          >
            <h3 className="text-sm font-bold">
              Falha ao carregar vendas por categoria
            </h3>
            <p className="text-xs">
              Não foi possível calcular as categorias. {error}
            </p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="min-h-11 rounded-xl border border-solid border-rose-500/30 text-xs font-bold"
              >
                Tentar novamente
              </button>
            )}
          </div>
        ) : safeCategoryData.length === 0 || totalRevenue === 0 ? (
          <EstadoVazioDoCrm
            className="min-h-[156px] justify-center"
            titulo="Sem Dados Registrados"
            texto="Nenhuma categoria registrou faturamento desde o início da loja."
          />
        ) : (
          <>
            <ul className="space-y-1">
              {(expandido
                ? safeCategoryData
                : safeCategoryData.slice(0, 3)
              ).map((entry) => {
                // Mesma divisão e precisão da legenda da rosca, antes da troca por barras.
                const percentage =
                  totalRevenue > 0
                    ? ((entry.value / totalRevenue) * 100).toFixed(1)
                    : "0.0";
                return (
                  <li key={entry.name} className="min-h-[52px]">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 text-[13px] font-semibold text-admin-text-2">
                        {entry.name}
                      </span>
                      <span className="text-right text-[13px] font-extrabold tabular-nums text-admin-text">
                        {formatCurrency(entry.value)}
                      </span>
                    </div>
                    <p className="text-[11px] text-admin-text-soft">
                      {entry.orders != null && <>{entry.orders} pedidos · </>}
                      {percentage}%
                      {expandido && !!entry.avg_ticket && (
                        <>
                          {" "}
                          · Valor médio por venda:{" "}
                          {formatCurrency(entry.avg_ticket)}
                        </>
                      )}
                    </p>
                    <div
                      className="mt-1 h-[5px] overflow-hidden rounded-full bg-admin-raised"
                      aria-hidden="true"
                    >
                      <div
                        className={`h-full rounded-full ${entry.cor}`}
                        style={{ width: `${percentage}%` }}
                      />
                    </div>
                  </li>
                );
              })}
            </ul>
            {safeCategoryData.length > 0 && (
              <button
                type="button"
                aria-expanded={expandido}
                onClick={() => setExpandido(!expandido)}
                className="mt-2 min-h-11 w-full rounded-xl bg-admin-raised text-xs font-bold text-admin-text"
              >
                {expandido
                  ? "Recolher"
                  : `Ver todas as ${safeCategoryData.length} categorias`}
              </button>
            )}
            {expandido && (
              <p className="mt-2 text-[11px] text-admin-text-soft">
                Faturamento Total: {formatCurrency(totalRevenue)}
              </p>
            )}
          </>
        )}
      </CartaoDoCrm>
    );
  },
);
