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
    minShipping > 0 ? Math.min((totalCartValue / minShipping) * 100, 100) : 0;

  const renderHeadline = () => {
    if (isGoalReached) {
      return (
        <>
          Oba!{" "}
          <span className="text-emerald-400 font-extrabold">
            Frete Grátis Liberado!
          </span>{" "}
          🎉
        </>
      );
    }
    if (totalCartValue > 0) {
      return (
        <>
          Falta pouquinho pro{" "}
          <span className="text-emerald-400 font-extrabold">Frete Grátis!</span>{" "}
          ✨
        </>
      );
    }
    return (
      <>
        Frete{" "}
        <span className="text-emerald-400 font-extrabold italic">Grátis</span>
      </>
    );
  };

  const renderSubtext = () => {
    if (isGoalReached) {
      return "Sua sacola já ganhou entrega grátis!";
    }
    if (totalCartValue > 0) {
      return (
        <>
          Adicione mais{" "}
          <span className="font-bold text-white underline decoration-emerald-500">
            {formatCurrency(remaining)}
          </span>{" "}
          para garantir o frete grátis!
        </>
      );
    }
    return "Faça login para ganhar frete grátis em suas compras.";
  };

  // Estado: Usuário não logado
  if (!user) {
    return (
      <div className="group relative flex h-full items-center justify-between overflow-hidden rounded-[24px] border border-zinc-800 bg-zinc-950 p-3.5 shadow-md transition-all duration-300 hover:border-zinc-700 sm:p-4">
        {/* Glow de fundo sutil */}
        <div className="absolute -right-6 -top-6 size-24 rounded-full bg-emerald-500/10 blur-2xl transition-colors duration-700 group-hover:bg-emerald-500/20" />

        <div className="relative z-10 flex items-center gap-3">
          <div className="flex size-11 flex-shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 shadow-inner transition-transform duration-300 group-hover:scale-105">
            <Truck className="size-5 text-emerald-400" />
          </div>
          <div>
            <h3 className="text-xs font-bold leading-snug text-white sm:text-sm">
              Frete <span className="text-emerald-400 italic">Grátis</span>
            </h3>
            <p className="max-w-[200px] text-[10px] font-medium text-zinc-400 sm:max-w-[240px]">
              Faça login para ganhar frete grátis em suas compras.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNavigate?.("auth")}
          className="relative z-10 flex cursor-pointer items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-950/80 px-4 py-2 shadow-sm transition-all duration-300 hover:bg-emerald-900 active:scale-95"
        >
          <span className="text-[11px] font-extrabold uppercase tracking-wider text-emerald-400">
            ENTRAR
          </span>
          <ArrowRight className="size-3.5 text-emerald-400 transition-transform group-hover:translate-x-0.5" />
        </button>
      </div>
    );
  }

  // Estado: Logado
  return (
    <div className="group relative h-full overflow-hidden rounded-[24px] border border-zinc-800 bg-zinc-950 p-3.5 shadow-md transition-all duration-300 hover:border-zinc-700 sm:p-4">
      {/* Subtle Glow */}
      <div className="absolute -right-6 -top-6 size-24 rounded-full bg-emerald-500/10 blur-2xl transition-all duration-700 group-hover:bg-emerald-500/20" />

      <div className="relative z-10 flex items-center justify-between gap-3">
        {/* Esquerda: Ícone + Copy */}
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="flex size-11 flex-shrink-0 items-center justify-center rounded-2xl border border-zinc-800 bg-zinc-900 shadow-inner transition-transform duration-300 group-hover:scale-105">
            {isGoalReached ? (
              <CheckCircle2 className="size-5 text-emerald-400" />
            ) : (
              <Truck className="size-5 text-emerald-400" />
            )}
          </div>

          <div className="min-w-0 flex-1">
            <div className="mb-0.5 flex items-center gap-1.5 overflow-hidden">
              <span className="whitespace-nowrap text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                Monte Carmelo
              </span>
              <div className="size-1 flex-shrink-0 rounded-full bg-zinc-700" />
              <span className="truncate text-[9px] font-semibold text-zinc-400">
                {isGoalReached ? "Meta Atingida" : "Entrega Grátis"}
              </span>
            </div>

            <h3 className="truncate text-xs font-bold leading-tight text-white sm:text-sm">
              {renderHeadline()}
            </h3>

            <p className="truncate text-[10px] font-medium text-zinc-400">
              {renderSubtext()}
            </p>
          </div>
        </div>

        {/* Direita: Badge do Valor / Progresso */}
        <div className="flex flex-col items-end gap-1 flex-shrink-0">
          {isGoalReached ? (
            <div className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-950/80 px-3 py-1 shadow-2xs">
              <Sparkles className="size-3 text-emerald-400 animate-pulse" />
              <span className="text-[9px] font-bold uppercase tracking-wider text-emerald-400">
                Liberado
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-end">
              <span className="text-[11px] font-bold leading-tight text-white sm:text-xs">
                {formatCurrency(totalCartValue)}
              </span>
              <span className="text-[8px] font-semibold uppercase tracking-wider text-emerald-400">
                {totalCartValue > 0
                  ? `de ${formatCurrency(minShipping)}`
                  : "no carrinho"}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Slim Progress Bar no Rodapé */}
      <div className="absolute inset-x-0 bottom-0 h-1 bg-zinc-900">
        <div
          className="h-full bg-emerald-500 transition-all duration-700"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
