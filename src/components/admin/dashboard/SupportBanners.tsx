import type { View } from "@/types";
import { ArrowUpRight, MessageSquare, Star } from "lucide-react";
import { memo } from "react";

interface SupportBannersProps {
  onNavigate: (view: View, id?: string) => void;
}

export const SupportBanners = memo(function SupportBanners({
  onNavigate,
}: SupportBannersProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
      {/* Experience Metrics Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onNavigate("admin-reviews")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onNavigate("admin-reviews");
          }
        }}
        className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/5 bg-zinc-950/40 p-3.5 shadow-lg transition-all duration-500 hover:border-admin-gold/30 hover:bg-zinc-900/30 active:scale-[0.98]"
      >
        {/* Ambient glow */}
        <div className="absolute -bottom-4 -right-4 size-12 rounded-full bg-admin-gold/5 blur-xl transition-all duration-700 group-hover:bg-admin-gold/15" />

        <div className="relative flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-admin-gold/20 bg-admin-gold/15 text-admin-gold transition-colors duration-300 group-hover:bg-admin-gold group-hover:text-black">
              <Star className="size-4 fill-current" />
            </div>
            <div className="min-w-0">
              <span className="mb-0.5 block text-[8px] font-black uppercase leading-none tracking-normal text-admin-gold/60">
                Feedback
              </span>
              <h3 className="truncate text-xs font-black leading-tight tracking-tight text-white">
                Reviews
              </h3>
            </div>
          </div>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-zinc-400 transition-all duration-300 group-hover:border-transparent group-hover:bg-admin-gold group-hover:text-black">
            <ArrowUpRight className="size-3.5 stroke-[2.5]" />
          </div>
        </div>
      </div>

      {/* Consultive Support Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onNavigate("admin-qa")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onNavigate("admin-qa");
          }
        }}
        className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/5 bg-zinc-950/40 p-3.5 shadow-lg transition-all duration-500 hover:border-admin-gold/30 hover:bg-zinc-900/30 active:scale-[0.98]"
      >
        {/* Ambient glow */}
        <div className="absolute -bottom-4 -right-4 size-12 rounded-full bg-admin-gold/5 blur-xl transition-all duration-700 group-hover:bg-admin-gold/15" />

        <div className="relative flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-white/5 bg-white/5 text-zinc-400 transition-all duration-300 group-hover:border-transparent group-hover:bg-admin-gold group-hover:text-black">
              <MessageSquare className="size-4" />
            </div>
            <div className="min-w-0">
              <span className="mb-0.5 block text-[8px] font-black uppercase leading-none tracking-normal text-zinc-500">
                Dúvidas
              </span>
              <h3 className="truncate text-xs font-black leading-tight tracking-tight text-white">
                Suporte
              </h3>
            </div>
          </div>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-zinc-400 transition-all duration-300 group-hover:border-transparent group-hover:bg-admin-gold group-hover:text-black">
            <ArrowUpRight className="size-3.5 stroke-[2.5]" />
          </div>
        </div>
      </div>
    </div>
  );
});
