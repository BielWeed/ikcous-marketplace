import { useCartContext } from "@/contexts/CartContext";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/utils";
import type { View } from "@/types";
import { ArrowRight, CheckCircle2, Sparkles, Truck } from "lucide-react";

interface FreeShippingBlockProps {
  readonly onNavigate?: (view: View) => void;
}

export function FreeShippingBlock({ onNavigate }: FreeShippingBlockProps) {
  const { config } = useStore();
  const { cartTotal } = useCartContext();
  const { user } = useAuth();

  const minShipping = config.freeShippingMin || 100;
  const totalCartValue = cartTotal || 0;
  const remaining = Math.max(0, minShipping - totalCartValue);
  const isGoalReached = totalCartValue >= minShipping && minShipping > 0;

  const progressPercent =
    minShipping > 0
      ? Math.min((totalCartValue / minShipping) * 100, 100)
      : 0;

  const renderHeadline = () => {
    if (isGoalReached) {
      return (
        <>
          Oba, miga! <span className="text-emerald-600">Frete Grátis Liberado!</span> 🎉
        </>
      );
    }
    if (totalCartValue > 0) {
      return (
        <>
          Falta pouquinho pro <span className="text-rose-600">Frete Grátis!</span> ✨
        </>
      );
    }
    return (
      <>
        Frete grátis nas suas comprinhas! <span className="text-rose-500">💖</span>
      </>
    );
  };

  const renderSubtext = () => {
    if (isGoalReached) {
      return "Sua sacola já ganhou entrega grátis em Monte Carmelo!";
    }
    if (totalCartValue > 0) {
      return (
        <>
          Adicione mais{" "}
          <span className="font-bold text-rose-950 underline decoration-rose-300">
            {formatCurrency(remaining)}
          </span>{" "}
          em makes e o frete é grátis!
        </>
      );
    }
    return (
      <>
        Em compras a partir de{" "}
        <span className="font-bold text-rose-950">
          {formatCurrency(minShipping)}
        </span>
        , a entrega é por nossa conta!
      </>
    );
  };

  // Estado: Usuário não logado
  if (!user) {
    return (
      <div className="group relative flex h-full items-center justify-between overflow-hidden rounded-2xl border border-rose-200/60 bg-gradient-to-r from-rose-50/90 via-pink-50/70 to-rose-100/40 p-3 shadow-sm transition-all duration-300 hover:shadow-md sm:p-3.5">
        {/* Glow de fundo sutil */}
        <div className="absolute -right-6 -top-6 size-20 rounded-full bg-rose-400/10 blur-xl transition-colors duration-700 group-hover:bg-rose-400/20" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-xl border border-rose-200/50 bg-white/90 shadow-sm transition-transform duration-300 group-hover:scale-105">
            <Truck className="size-4 text-rose-500" />
          </div>
          <div>
            <div className="mb-0.5 flex items-center gap-1">
              <span className="text-[9px] font-bold uppercase tracking-wider text-rose-500">
                🌸 Monte Carmelo
              </span>
            </div>
            <h3 className="text-xs font-bold leading-snug text-rose-950 sm:text-sm">
              Frete Grátis pra Você! <span className="text-rose-500">💕</span>
            </h3>
            <p className="max-w-[200px] text-[10px] font-medium text-rose-800/80 sm:max-w-[240px]">
              Entra na sua conta pra garantir frete grátis nas suas comprinhas.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigate?.("auth")}
          className="relative z-10 flex cursor-pointer items-center gap-1.5 rounded-full border border-rose-400/30 bg-rose-500 px-3 py-1.5 shadow-sm transition-all duration-300 hover:bg-rose-600 active:scale-95"
        >
          <span className="text-[10px] font-bold uppercase tracking-wider text-white">
            Entrar
          </span>
          <ArrowRight className="size-3 text-white transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    );
  }

  // Estado: Logado
  return (
    <div className="group relative h-full overflow-hidden rounded-2xl border border-rose-200/60 bg-gradient-to-r from-rose-50/90 via-pink-50/80 to-rose-100/50 p-3 shadow-sm transition-all duration-300 hover:shadow-md sm:p-3.5">
      {/* Subtle Glow */}
      <div className="absolute -right-6 -top-6 size-24 rounded-full bg-rose-400/15 blur-2xl transition-all duration-700 group-hover:bg-rose-400/25" />

      <div className="relative z-10 flex items-center justify-between gap-3">
        {/* Esquerda: Ícone + Copy */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex size-10 flex-shrink-0 items-center justify-center rounded-xl border border-rose-200/50 bg-white/95 shadow-sm transition-transform duration-300 group-hover:scale-105">
            {isGoalReached ? (
              <CheckCircle2 className="size-5 text-emerald-500" />
            ) : (
              <Truck className="size-4 text-rose-500" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex items-center gap-1.5 overflow-hidden">
              <span className="whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-rose-500">
                🌸 Monte Carmelo
              </span>
              <div className="size-1 flex-shrink-0 rounded-full bg-rose-300" />
              <span className="truncate text-[9px] font-semibold text-rose-700/80">
                {isGoalReached ? "Meta Atingida" : "Entrega Grátis"}
              </span>
            </div>

            <h3 className="truncate text-xs font-bold leading-tight text-rose-950 sm:text-sm">
              {renderHeadline()}
            </h3>

            <p className="truncate text-[10px] font-medium text-rose-800/80">
              {renderSubtext()}
            </p>
          </div>
        </div>

        {/* Direita: Badge do Valor / Progresso */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {isGoalReached ? (
            <div className="flex items-center gap-1 rounded-full border border-emerald-300 bg-emerald-50 px-2.5 py-1 shadow-2xs">
              <Sparkles className="size-3 text-emerald-600 animate-pulse" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-700">
                Liberado
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-end">
              <span className="text-[11px] font-bold leading-tight text-rose-950 sm:text-xs">
                {formatCurrency(totalCartValue)}
              </span>
              <span className="text-[8px] font-semibold uppercase tracking-wider text-rose-500">
                {totalCartValue > 0 ? `de ${formatCurrency(minShipping)}` : "no carrinho"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Slim Progress Bar no Rodapé */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-rose-200/40">
        <div
          className="h-full bg-gradient-to-r from-rose-400 via-rose-500 to-rose-600 transition-all duration-700"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
