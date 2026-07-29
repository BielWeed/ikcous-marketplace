import { useCartContext } from "@/contexts/CartContext";
import { useStore } from "@/contexts/StoreContext";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/utils";
import type { View } from "@/types";
import { ArrowRight, Truck } from "lucide-react";

interface FreeShippingBlockProps {
  onNavigate?: (view: View) => void;
}

export function FreeShippingBlock({ onNavigate }: FreeShippingBlockProps) {
  const { config } = useStore();
  const { cartTotal } = useCartContext();
  const { user } = useAuth();

  const totalCartValue = cartTotal;

  const progressPercent =
    config.freeShippingMin > 0
      ? Math.min((totalCartValue / config.freeShippingMin) * 100, 100)
      : 0;

  if (!user) {
    return (
      <div className="group relative flex h-full items-center justify-between overflow-hidden rounded-[2rem] border border-white/5 bg-zinc-950 p-4 shadow-2xl">
        <div className="absolute right-0 top-0 size-24 -translate-y-1/2 translate-x-1/2 rounded-full bg-emerald-500/5 blur-2xl transition-colors duration-1000 group-hover:bg-emerald-500/10" />

        <div className="relative z-10 flex items-center gap-4">
          <div className="flex size-12 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5">
            <Truck className="size-5 text-emerald-500/50" />
          </div>
          <div>
            <h3 className="mb-1 text-sm font-black leading-none tracking-tight text-white">
              Frete <span className="italic text-emerald-500">Grátis</span>
            </h3>
            <p className="max-w-[140px] text-[10px] font-medium leading-tight text-zinc-400">
              Faça login para ganhar frete grátis em suas compras.
            </p>
          </div>
        </div>

        <div
          onClick={() => onNavigate?.("auth")}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              onNavigate?.("auth");
            }
          }}
          className="relative z-10 flex cursor-pointer items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-4 py-2 transition-all active:scale-95 group-hover:bg-emerald-500/20"
        >
          <span className="text-[10px] font-black uppercase tracking-widest text-emerald-500">
            Entrar
          </span>
          <ArrowRight className="size-3 text-emerald-500 transition-transform group-hover:translate-x-1" />
        </div>
      </div>
    );
  }

  return (
    <div className="group relative h-full overflow-hidden rounded-[2rem] border border-white/5 bg-zinc-950 p-4 shadow-2xl">
      {/* Subtle Glow */}
      <div className="absolute right-0 top-0 size-24 -translate-y-1/2 translate-x-1/2 rounded-full bg-emerald-500/10 blur-2xl transition-colors duration-1000 group-hover:bg-emerald-500/20" />

      <div className="relative z-10 flex items-center gap-4">
        <div className="flex size-12 flex-shrink-0 items-center justify-center rounded-2xl border border-white/10 bg-white/5 transition-transform duration-500 group-hover:scale-105">
          <Truck className="size-5 text-emerald-500" />
        </div>

        <div className="min-w-0 flex-1">
          <div className="mb-1 flex w-full items-center gap-1.5 overflow-hidden sm:gap-2">
            <span className="whitespace-nowrap text-[8px] font-black uppercase tracking-[0.15em] text-emerald-500 sm:text-[9px] sm:tracking-[0.2em]">
              Premium Delivery
            </span>
            <div className="size-0.5 flex-shrink-0 rounded-full bg-zinc-700" />
            <span className="truncate text-[8px] font-black uppercase tracking-widest text-zinc-500 sm:text-[9px]">
              Monte Carmelo
            </span>
          </div>

          <h3 className="mb-1 text-base font-black leading-none tracking-tight text-white">
            Frete Grátis{" "}
            <span className="italic text-emerald-500">Ilimitado</span>
          </h3>

          <p className="text-[10px] font-medium leading-tight text-zinc-400">
            Acumule{" "}
            <span className="font-bold text-zinc-100">
              {formatCurrency(config.freeShippingMin)}
            </span>{" "}
            em itens{" "}
            <span className="font-semibold italic text-emerald-500/80">
              no carrinho
            </span>
            .
          </p>
        </div>

        <div className="flex flex-col items-end gap-1.5">
          <div className="flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-2 py-1">
            <div className="size-1 animate-pulse rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
            <span className="text-[8px] font-black uppercase tracking-widest text-emerald-500">
              Ativo
            </span>
          </div>
          <div className="text-right">
            <p className="text-[12px] font-black leading-none text-white">
              {formatCurrency(totalCartValue)}
            </p>
            <p className="text-[7px] font-black uppercase tracking-widest text-zinc-600">
              No Carrinho
            </p>
          </div>
        </div>
      </div>

      {/* Ultra Slim Progress Bar */}
      <div className="absolute inset-x-0 bottom-0 h-0.5 bg-white/5">
        <div
          className="h-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.5)] transition-all duration-1000"
          style={{ width: `${progressPercent}%` }}
        />
      </div>
    </div>
  );
}
