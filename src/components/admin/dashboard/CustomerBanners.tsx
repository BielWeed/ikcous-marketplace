import type { View } from "@/types";
import { ArrowUpRight, Headset, Send } from "lucide-react";
import { memo } from "react";

interface CustomerBannersProps {
  onNavigate: (view: View, id?: string) => void;
}

/**
 * Histórico das portas desta faixa:
 *
 * - 24/08/2026: o cartão "Engajamento / Disparo Push" saiu daqui — chamava
 *   `onNavigate("admin-push")` SEM id, a mesma tela que o sino da barra de
 *   cima entregava, e o sino estava em TODA tela do painel (porta
 *   duplicada). O que NÃO saiu, de propósito: o item "Notificação Push" do
 *   menu de cada cliente em `AdminCustomersView.tsx`, que passa
 *   `customer.id` e muda a tela de modo (avisar UMA pessoa) — outra função.
 * - Depois, o sino parou de abrir `admin-push` (leva sempre às
 *   Notificações do lojista, a tela que RECEBE aviso) e a porta de ENVIO
 *   acabou renascendo longe, em Ajustes.
 * - 30/08/2026: decisão do Gabriel com print na mão — a porta "Avisar
 *   clientes" VOLTOU para cá, ao lado de "Canais de Atendimento", porque
 *   avisar cliente é operação da tela de Clientes. Ajustes ficou sem ela.
 *   O Voltar de `admin-push` é sensível à origem (pai-da-tela-do-admin):
 *   entrou daqui, volta para cá.
 */
export const CustomerBanners = memo(function CustomerBanners({
  onNavigate,
}: CustomerBannersProps) {
  return (
    <div className="grid grid-cols-2 gap-3">
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

      {/* Engajamento / Avisar clientes Card — porta de ENVIO de push para a
          base (sem id). A porta por cliente (com id) continua no menu de
          cada cliente, que é outra função. */}
      <div
        role="button"
        tabIndex={0}
        onClick={() => onNavigate("admin-push")}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onNavigate("admin-push");
          }
        }}
        className="group relative cursor-pointer overflow-hidden rounded-2xl border border-white/5 bg-zinc-950/40 p-3.5 shadow-lg transition-all duration-500 hover:border-blue-500/30 hover:bg-zinc-900/30 active:scale-[0.98]"
      >
        {/* Ambient glow */}
        <div className="absolute -bottom-4 -right-4 size-12 rounded-full bg-blue-500/5 blur-xl transition-all duration-700 group-hover:bg-blue-500/15" />

        <div className="relative flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex size-8 shrink-0 items-center justify-center rounded-xl border border-blue-500/20 bg-blue-500/15 text-blue-400 transition-colors duration-300 group-hover:bg-blue-500 group-hover:text-black">
              <Send className="size-4" strokeWidth={2.5} />
            </div>
            <div className="min-w-0">
              <span className="mb-0.5 block text-[8px] font-black uppercase leading-none tracking-widest text-blue-500/60">
                Engajamento
              </span>
              <h3 className="truncate text-xs font-black leading-tight tracking-tight text-white">
                Avisar clientes
              </h3>
            </div>
          </div>
          <div className="flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/5 bg-white/5 text-zinc-400 transition-all duration-300 group-hover:border-transparent group-hover:bg-blue-500 group-hover:text-black">
            <ArrowUpRight className="size-3.5 stroke-[2.5]" />
          </div>
        </div>
      </div>
    </div>
  );
});
