import { ArrowUpRight, Ticket, Truck } from "lucide-react";
import { memo } from "react";

interface ProductBannersProps {
  onNavigate: (view: any, id?: string) => void;
}

export const ProductBanners = memo(function ProductBanners({
  onNavigate,
}: ProductBannersProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Campaigns Card */}
      <div
        onClick={() => onNavigate("admin-coupons")}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onNavigate("admin-coupons");
          }
        }}
        className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/5 bg-zinc-950/40 p-3.5 shadow-lg transition-all duration-500 hover:border-admin-gold/30 hover:bg-zinc-900/30 active:scale-[0.98]"
      >
        {/* Ambient glow */}
        <div className="absolute -bottom-4 -right-4 size-12 rounded-full bg-admin-gold/5 blur-xl transition-all duration-700 group-hover:bg-admin-gold/15" />

        <div className="relative flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-admin-gold/20 bg-admin-gold/15 text-admin-gold transition-colors duration-300 group-hover:bg-admin-gold group-hover:text-black">
              <Ticket className="size-4" />
            </div>
            <div className="min-w-0">
              <span className="mb-0.5 block text-[8px] font-black uppercase leading-none tracking-widest text-admin-gold/60">
                Campanhas
              </span>
              <h3 className="truncate text-xs font-black leading-tight tracking-tight text-white">
                Gerir Cupons
              </h3>
            </div>
          </div>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-zinc-400 transition-all duration-300 group-hover:border-transparent group-hover:bg-admin-gold group-hover:text-black">
            <ArrowUpRight className="size-3.5 stroke-[2.5]" />
          </div>
        </div>
      </div>

      {/* Logistics/Freight Card */}
      <div
        onClick={() => onNavigate("admin-shipping")}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onNavigate("admin-shipping");
          }
        }}
        className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/5 bg-zinc-950/40 p-3.5 shadow-lg transition-all duration-500 hover:border-emerald-500/30 hover:bg-zinc-900/30 active:scale-[0.98]"
      >
        {/* Ambient glow */}
        <div className="absolute -bottom-4 -right-4 size-12 rounded-full bg-emerald-500/5 blur-xl transition-all duration-700 group-hover:bg-emerald-500/15" />

        <div className="relative flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-emerald-500/20 bg-emerald-500/15 text-emerald-400 transition-colors duration-300 group-hover:bg-emerald-500 group-hover:text-black">
              <Truck className="size-4" />
            </div>
            <div className="min-w-0">
              <span className="mb-0.5 block text-[8px] font-black uppercase leading-none tracking-widest text-emerald-500/60">
                Logística
              </span>
              <h3 className="truncate text-xs font-black leading-tight tracking-tight text-white">
                Gerir Frete
              </h3>
            </div>
          </div>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-zinc-400 transition-all duration-300 group-hover:border-transparent group-hover:bg-emerald-500 group-hover:text-black">
            <ArrowUpRight className="size-3.5 stroke-[2.5]" />
          </div>
        </div>
      </div>
    </div>
  );
});
