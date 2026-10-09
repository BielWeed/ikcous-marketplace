import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import type { View } from "@/types";
import { ArrowRight, BarChart3, Landmark, type LucideIcon } from "lucide-react";

interface BotaoGrande {
  readonly destino: View;
  readonly titulo: string;
  readonly descricao: string;
  readonly icone: LucideIcon;
}

const BOTOES_GRANDES: readonly BotaoGrande[] = [
  {
    destino: "admin-crm",
    titulo: NOMES_DO_PAINEL["admin-crm"],
    descricao: "Clientes, canais, funil e todas as métricas",
    icone: BarChart3,
  },
  {
    destino: "admin-financeiro",
    titulo: NOMES_DO_PAINEL["admin-financeiro"],
    descricao: "Caixa, extrato, contas a pagar e receber",
    icone: Landmark,
  },
];

/**
 * As portas do Início: os dois botões grandes (CRM e Financeiro).
 * `aoPrepararDestino` aquece o chunk da tela no hover/toque, antes do
 * clique. A fileira de ações rápidas (Vender, Pedidos, Devoluções) saiu —
 * pedido do Gabriel (27/09/2026): Vender e Pedidos já estão na barra de
 * baixo, e Devoluções tem porta própria na tela de Pedidos
 * (`BotaoDevolucoes` em `AdminOrdersView.tsx`).
 */
export function AtalhosDoInicio({
  onNavigate,
  aoPrepararDestino,
}: Readonly<{
  onNavigate: (view: View) => void;
  aoPrepararDestino?: (view: View) => void;
}>) {
  return (
    <nav aria-label="Atalhos do painel" className="h-full">
      <div className="grid grid-cols-1 gap-3 xs:grid-cols-2 lg:grid-cols-1">
        {BOTOES_GRANDES.map((botao) => (
          <button
            key={botao.destino}
            type="button"
            onClick={() => onNavigate(botao.destino)}
            onMouseEnter={() => aoPrepararDestino?.(botao.destino)}
            onFocus={() => aoPrepararDestino?.(botao.destino)}
            onTouchStart={() => aoPrepararDestino?.(botao.destino)}
            className="group relative flex min-h-[88px] w-full cursor-pointer items-center gap-4 overflow-hidden rounded-2xl border border-admin-gold/20 bg-gradient-to-br from-admin-gold/[0.12] via-zinc-950/60 to-zinc-950 p-4 text-left shadow-lg transition-all duration-500 hover:border-admin-gold/40 hover:from-admin-gold/[0.18] active:scale-[0.98]"
          >
            <span className="flex size-12 shrink-0 items-center justify-center rounded-2xl border border-admin-gold/30 bg-admin-gold/10">
              <botao.icone
                className="size-5 text-admin-gold"
                aria-hidden="true"
              />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-base font-black tracking-tight text-white">
                {botao.titulo}
              </span>
              <span className="mt-0.5 block text-[11px] leading-snug text-zinc-400">
                {botao.descricao}
              </span>
            </span>
            <ArrowRight
              className="size-4 shrink-0 text-admin-gold transition-transform duration-300 group-hover:translate-x-1"
              aria-hidden="true"
            />
          </button>
        ))}
      </div>
    </nav>
  );
}
