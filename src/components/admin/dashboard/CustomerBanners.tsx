import type { View } from "@/types";
import { ArrowUpRight, Headset } from "lucide-react";
import { memo } from "react";

interface CustomerBannersProps {
  onNavigate: (view: View, id?: string) => void;
}

/**
 * O cartao "Engajamento / Disparo Push" saiu daqui em 24/08/2026.
 *
 * Ele chamava `onNavigate("admin-push")` SEM id — ou seja, entregava
 * exatamente a mesma tela que o sino da barra de cima ja entrega, e o sino
 * esta em TODA tela do painel. Duas portas identicas para o mesmo lugar,
 * uma delas comendo metade da faixa de cima de uma tela que ja e' cheia.
 *
 * O que NAO saiu, de proposito: o item "Notificacao Push" do menu de cada
 * cliente, em `AdminCustomersView.tsx`. Aquele passa `customer.id` e a tela
 * muda de modo com ele (avisar UMA pessoa, nao a base inteira) — e' outra
 * funcao, nao a mesma porta repetida.
 */
export const CustomerBanners = memo(function CustomerBanners({
  onNavigate,
}: CustomerBannersProps) {
  return (
    <div className="grid grid-cols-1 gap-3">
      {/* Support Channels / Canais de Atendimento Card */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onNavigate("admin-whatsapp-config")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onNavigate("admin-whatsapp-config");
          }
        }}
        className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/5 bg-zinc-950/40 p-3.5 shadow-lg transition-all duration-500 hover:border-admin-gold/30 hover:bg-zinc-900/30 active:scale-[0.98]"
      >
        {/* Ambient glow */}
        <div className="absolute -bottom-4 -right-4 size-12 rounded-full bg-admin-gold/5 blur-xl transition-all duration-700 group-hover:bg-admin-gold/15" />

        <div className="relative flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-admin-gold/20 bg-admin-gold/15 text-admin-gold transition-colors duration-300 group-hover:bg-admin-gold group-hover:text-black">
              <Headset className="size-4" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <span className="mb-0.5 block text-[8px] font-black uppercase leading-none tracking-widest text-admin-gold/60">
                Configurações
              </span>
              <h3 className="truncate text-xs font-black leading-tight tracking-tight text-white">
                Canais de Atendimento
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
