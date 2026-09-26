import type { View } from "@/types";
import {
  ArrowRight,
  BarChart3,
  Landmark,
  type LucideIcon,
  RotateCcw,
  ScanBarcode,
  ShoppingBag,
} from "lucide-react";

interface BotaoGrande {
  readonly destino: View;
  readonly titulo: string;
  readonly descricao: string;
  readonly icone: LucideIcon;
}

const BOTOES_GRANDES: readonly BotaoGrande[] = [
  {
    destino: "admin-crm",
    titulo: "Dashboard CRM",
    descricao: "Clientes, canais, funil e todas as métricas",
    icone: BarChart3,
  },
  {
    destino: "admin-financeiro",
    titulo: "Financeiro",
    descricao: "Caixa, extrato, contas a pagar e receber",
    icone: Landmark,
  },
];

const ACOES_RAPIDAS: readonly {
  readonly destino: View;
  readonly rotulo: string;
  readonly icone: LucideIcon;
}[] = [
  { destino: "admin-pdv", rotulo: "Vender", icone: ScanBarcode },
  { destino: "admin-orders", rotulo: "Pedidos", icone: ShoppingBag },
  { destino: "admin-devolucoes", rotulo: "Devoluções", icone: RotateCcw },
];

/**
 * As portas do Início: os dois botões grandes (CRM e Financeiro) e as ações
 * rápidas do dia a dia. `aoPrepararDestino` aquece o chunk da tela no
 * hover/toque, antes do clique.
 */
export function AtalhosDoInicio({
  onNavigate,
  aoPrepararDestino,
}: Readonly<{
  onNavigate: (view: View) => void;
  aoPrepararDestino?: (view: View) => void;
}>) {
  return (
    <nav aria-label="Atalhos do painel" className="h-full space-y-3">
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

      <div className="grid grid-cols-3 gap-2">
        {ACOES_RAPIDAS.map((acao) => (
          <button
            key={acao.destino}
            type="button"
            onClick={() => onNavigate(acao.destino)}
            onMouseEnter={() => aoPrepararDestino?.(acao.destino)}
            onFocus={() => aoPrepararDestino?.(acao.destino)}
            className="group flex min-h-[64px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-2xl border border-white/5 bg-zinc-950/40 p-2 shadow-lg transition-all duration-500 hover:border-admin-gold/30 hover:bg-zinc-900/30 active:scale-[0.98]"
          >
            <acao.icone
              className="size-4 text-zinc-300 transition-colors group-hover:text-admin-gold"
              aria-hidden="true"
            />
            <span className="text-[10px] font-black uppercase tracking-widest text-zinc-300">
              {acao.rotulo}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
