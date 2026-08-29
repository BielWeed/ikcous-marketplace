import { LazyImage } from "@/components/LazyImage";
import { Skeleton } from "@/components/ui/skeleton";
import type { DashboardStats } from "@/hooks/useAnalytics";
import { cn } from "@/lib/utils";
import { motion } from "framer-motion";
import { ChevronRight, TrendingUp, Trophy } from "lucide-react";
import { memo } from "react";

interface TopProductsListProps {
  stats: DashboardStats | null;
  loading: boolean;
  onNavigate: (view: any, id?: string) => void;
}

const SectionTitle = ({ title, icon: Icon }: { title: string; icon: any }) => (
  <div className="mb-4 flex items-center gap-3 px-2">
    <div className="relative">
      <div className="h-6 w-1.5 rounded-full bg-admin-gold shadow-[0_0_15px_rgba(234,179,8,0.6)]" />
      <div className="absolute -left-1 top-0 h-6 w-3.5 animate-pulse rounded-full bg-admin-gold/20 blur-md" />
    </div>
    <Icon className="size-5 animate-pulse text-admin-gold" />
    <h2 className="text-sm font-black uppercase tracking-[0.25em] text-white/90 drop-shadow-sm">
      {title}
    </h2>
  </div>
);

export const TopProductsList = memo(function TopProductsList({
  stats,
  loading,
  onNavigate,
}: TopProductsListProps) {
  const products = stats?.topProducts || [];
  const maxTotal =
    products.length > 0
      ? Math.max(...products.map((p) => Number(p.total || 0)))
      : 0;

  const itemVariants = {
    hidden: { x: -20, opacity: 0 },
    visible: { x: 0, opacity: 1 },
  };

  return (
    <div className="space-y-3">
      {/* PAR com a migration 20261001000000 (revisão 20260825-2145): a RPC
          ordena por LUCRO (preço menos custo) — o rótulo "mais lucrativos"
          é verdade desde a migration. As duas metades aplicam juntas
          (branch com o front primeiro, clique da migration logo depois);
          sozinha, qualquer uma delas faz a tela mentir. */}
      <SectionTitle title="top 5 produtos mais lucrativos" icon={Trophy} />

      <div className="relative">
        {/* Decorative background element */}
        <div className="pointer-events-none absolute -right-20 -top-20 size-64 rounded-full bg-admin-gold/5 blur-[100px]" />

        <div className="admin-glass relative overflow-hidden border border-white/5 shadow-2xl sm:rounded-[2rem]">
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-b from-admin-gold/[0.03] via-transparent to-transparent" />

          <div className="relative z-10 space-y-1 p-2.5 sm:p-4">
            {loading ? (
              <div className="space-y-1.5">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between px-3 py-2"
                  >
                    <div className="flex items-center gap-3">
                      <Skeleton className="size-5 rounded-full bg-white/5" />
                      <Skeleton className="size-9 rounded-lg bg-white/5" />
                      <div className="space-y-1.5">
                        <Skeleton className="h-3.5 w-24 bg-white/5 sm:w-32" />
                        <Skeleton className="h-2 w-16 bg-white/5 sm:w-20" />
                      </div>
                    </div>
                    <Skeleton className="h-4 w-16 bg-white/5" />
                  </div>
                ))}
              </div>
            ) : products.length === 0 ? (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-2xl border border-white/5 bg-white/[0.01] py-10 text-center"
              >
                <TrendingUp className="mx-auto mb-2 size-8 text-zinc-500/50" />
                <p className="text-[9px] font-black uppercase tracking-[0.25em] text-zinc-400">
                  Nenhum dado de vendas disponível
                </p>
              </motion.div>
            ) : (
              <motion.div
                initial={false}
                animate="visible"
                className="space-y-1"
              >
                {products.map((item, idx) => {
                  const isFirst = idx === 0;
                  const sharePercentage =
                    maxTotal > 0
                      ? (Number(item.total || 0) / maxTotal) * 100
                      : 0;
                  const displayName = item.name || "Produto sem nome";

                  return (
                    <motion.div
                      key={item.id}
                      variants={itemVariants}
                      onClick={() => onNavigate("admin-products", item.id)}
                      className={cn(
                        "group relative flex items-center justify-between py-2 px-3 rounded-xl transition-all cursor-pointer border border-transparent overflow-hidden",
                        isFirst
                          ? "bg-gradient-to-r from-admin-gold/[0.06] to-transparent border-admin-gold/10 shadow-sm shadow-admin-gold/5"
                          : "hover:bg-white/[0.02] hover:border-white/5",
                      )}
                    >
                      {/* Progress background bar effect */}
                      <div
                        className="absolute bottom-0 left-0 h-[2px] bg-admin-gold/10 transition-all duration-1000"
                        style={{ width: `${sharePercentage}%` }}
                      />

                      <div className="relative z-10 flex min-w-0 items-center gap-3">
                        {/* Rank indicators */}
                        <div className="relative flex size-5 shrink-0 items-center justify-center">
                          {idx === 0 ? (
                            <div className="flex size-5 select-none items-center justify-center rounded-full bg-gradient-to-br from-amber-400 via-yellow-500 to-amber-600 text-[9px] font-black text-zinc-950 shadow-[0_0_8px_rgba(234,179,8,0.3)]">
                              01
                            </div>
                          ) : idx === 1 ? (
                            <div className="flex size-5 select-none items-center justify-center rounded-full bg-gradient-to-br from-zinc-300 via-zinc-400 to-zinc-500 text-[9px] font-black text-zinc-950">
                              02
                            </div>
                          ) : idx === 2 ? (
                            <div className="flex size-5 select-none items-center justify-center rounded-full bg-gradient-to-br from-amber-700 via-amber-800 to-amber-900 text-[9px] font-black text-amber-100">
                              03
                            </div>
                          ) : (
                            <div className="flex size-5 select-none items-center justify-center text-[10px] font-bold text-zinc-500 group-hover:text-zinc-400">
                              {(idx + 1).toString().padStart(2, "0")}
                            </div>
                          )}
                        </div>

                        <div
                          className={cn(
                            "w-9 h-9 rounded-lg bg-zinc-950 overflow-hidden border relative group-hover:scale-105 transition-transform duration-500 shadow-md shrink-0",
                            isFirst ? "border-admin-gold/30" : "border-white/5",
                          )}
                        >
                          <LazyImage
                            src={
                              item.image ||
                              `https://placehold.co/100x100/18181b/d4af37?text=${encodeURIComponent(displayName.substring(0, 2))}`
                            }
                            alt={displayName}
                            className="size-full object-cover transition-opacity group-hover:opacity-80"
                          />
                        </div>

                        <div className="flex min-w-0 flex-col">
                          <h4
                            className={cn(
                              "text-xs font-semibold transition-all tracking-tight leading-tight truncate pr-2",
                              isFirst
                                ? "text-white"
                                : "text-zinc-400 group-hover:text-zinc-100",
                            )}
                          >
                            {displayName}
                          </h4>

                          <div className="mt-0.5 flex items-center gap-1.5">
                            <span className="shrink-0 text-[9px] font-bold uppercase tracking-wider text-admin-gold/90">
                              {item.quantity}{" "}
                              {item.quantity === 1 ? "venda" : "vendas"}
                            </span>
                            <span className="shrink-0 text-[9px] text-zinc-700">
                              •
                            </span>
                            <div className="h-[3px] w-12 shrink-0 overflow-hidden rounded-full bg-white/5 sm:w-20">
                              <div
                                className={cn(
                                  "h-full rounded-full bg-admin-gold",
                                  isFirst
                                    ? "shadow-[0_0_6px_rgba(234,179,8,0.5)]"
                                    : "",
                                )}
                                style={{ width: `${sharePercentage}%` }}
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="relative z-10 ml-2 flex shrink-0 items-center gap-1.5">
                        <div className="flex flex-col items-end text-right">
                          <span
                            className={cn(
                              "text-xs sm:text-sm font-black tracking-tight",
                              isFirst
                                ? "text-admin-gold font-extrabold"
                                : "text-zinc-100 group-hover:text-white",
                            )}
                          >
                            R${" "}
                            {Number(item.total || 0).toLocaleString("pt-BR", {
                              minimumFractionDigits: 2,
                            })}
                          </span>
                        </div>
                        <ChevronRight className="size-3.5 translate-x-[-3px] transform text-zinc-600 opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:text-admin-gold group-hover:opacity-100" />
                      </div>
                    </motion.div>
                  );
                })}
              </motion.div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
});
