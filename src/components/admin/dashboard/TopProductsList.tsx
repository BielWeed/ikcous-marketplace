import { LazyImage } from "@/components/LazyImage";
import { ExplicacaoDoRelatorio } from "@/components/admin/crm/ExplicacaoDoRelatorio";
import {
  CartaoDoCrm,
  EstadoVazioDoCrm,
} from "@/components/admin/crm/PecasDoCrm";
import type { DashboardStats } from "@/hooks/useAnalytics";
import {
  avisoProdutosSemCusto,
  produtosSemCusto,
} from "@/utils/produtos-sem-custo";
import { memo, useState } from "react";

interface TopProductsListProps {
  stats: DashboardStats | null;
  loading: boolean;
  onNavigate: (view: any, id?: string) => void;
}
export const TopProductsList = memo(function TopProductsList({
  stats,
  loading,
  onNavigate,
}: TopProductsListProps) {
  const products = stats?.topProducts || [];
  const semCusto = produtosSemCusto(stats);
  const [expandido, setExpandido] = useState(false);
  return (
    <CartaoDoCrm
      id="crm-produtos-lucro"
      titulo="Produtos que mais dão lucro"
      descricao="Desde o início · só produto com custo"
      className="relative min-h-[282px] overflow-hidden"
      acao={
        <ExplicacaoDoRelatorio titulo="Produtos que mais dão lucro">
          O valor é o lucro (preço menos custo). Produto sem custo cadastrado
          não entra.
        </ExplicacaoDoRelatorio>
      }
    >
      <div
        className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-admin-gold/5 blur-[100px]"
        aria-hidden="true"
      />
      <div className="relative">
        {loading ? (
          <div
            className="premium-shimmer h-[156px] rounded-xl"
            aria-hidden="true"
          />
        ) : products.length === 0 ? (
          <EstadoVazioDoCrm
            className="min-h-[156px] justify-center"
            titulo={
              semCusto > 0
                ? "Cadastre o custo dos produtos vendidos para ver quais dão mais lucro."
                : "Nenhum dado de vendas disponível"
            }
          />
        ) : (
          <ol className="space-y-1">
            {(expandido ? products : products.slice(0, 3)).map((item, idx) => {
              const displayName = item.name || "Produto sem nome";
              return (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => onNavigate("admin-products", item.id)}
                    className="flex min-h-[52px] w-full items-center gap-2 rounded-xl text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-admin-gold"
                  >
                    <span
                      className={`flex size-[22px] shrink-0 items-center justify-center rounded-full border text-[11px] font-bold ${idx === 0 ? "border-admin-gold text-admin-gold" : "border-admin-border bg-admin-raised text-admin-text-soft"}`}
                    >
                      {idx + 1}
                    </span>
                    <div className="size-[30px] shrink-0 overflow-hidden rounded-lg bg-admin-raised">
                      <LazyImage
                        src={
                          item.image ||
                          `https://placehold.co/100x100/18181b/d4af37?text=${encodeURIComponent(displayName.substring(0, 2))}`
                        }
                        alt={displayName}
                        className="size-full object-cover"
                      />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="break-words text-[13px] font-semibold text-admin-text-2">
                        {displayName}
                      </p>
                      <p className="text-[11px] text-admin-text-soft">
                        {item.quantity}{" "}
                        {item.quantity === 1
                          ? "unidade vendida"
                          : "unidades vendidas"}
                      </p>
                    </div>
                    <span className="text-right text-[13px] font-extrabold tabular-nums text-admin-text">
                      R${" "}
                      {Number(item.total || 0).toLocaleString("pt-BR", {
                        minimumFractionDigits: 2,
                      })}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
        )}
        {products.length > 3 && (
          <button
            type="button"
            aria-expanded={expandido}
            onClick={() => setExpandido(!expandido)}
            className="mt-2 min-h-11 w-full rounded-xl bg-admin-raised text-xs font-bold text-admin-text"
          >
            {expandido ? "Recolher" : "Ver os 5 produtos"}
          </button>
        )}
        {!loading && semCusto > 0 && (
          <div className="pt-2 text-[11px] text-admin-text-soft">
            <p>{avisoProdutosSemCusto(semCusto)}</p>
            <button
              type="button"
              onClick={() => onNavigate("admin-products")}
              className="min-h-11 font-bold text-admin-gold"
            >
              Cadastrar custo
            </button>
          </div>
        )}
      </div>
    </CartaoDoCrm>
  );
});
