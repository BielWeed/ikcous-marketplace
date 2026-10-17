import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import type { View } from "@/types";
import { BarChart3, ChevronRight, TrendingUp, Wallet } from "lucide-react";
import { CARTAO_INICIO, SeloDoInicio, TituloDoInicio } from "./visualDoInicio";

const BOTOES_GRANDES = [
  {
    destino: "admin-crm",
    titulo: NOMES_DO_PAINEL["admin-crm"],
    descricao: "Clientes e métricas",
    icone: BarChart3,
    tom: "azul",
  },
  {
    destino: "admin-financeiro",
    titulo: NOMES_DO_PAINEL["admin-financeiro"],
    descricao: "Caixa e contas",
    icone: Wallet,
    tom: "teal",
  },
] as const;

/** As mesmas duas portas; mantém o aquecimento por hover, foco e toque. */
export function AtalhosDoInicio({
  onNavigate,
  aoPrepararDestino,
}: Readonly<{
  onNavigate: (view: View) => void;
  aoPrepararDestino?: (view: View) => void;
}>) {
  return (
    <nav aria-label="Atalhos do painel" className="min-w-0">
      <TituloDoInicio id="inicio-atalhos-titulo" icone={TrendingUp} tom="ceu">
        Acessos rápidos
      </TituloDoInicio>
      <div className="grid grid-cols-2 gap-3">
        {BOTOES_GRANDES.map((botao) => (
          <button
            key={botao.destino}
            type="button"
            onClick={() => onNavigate(botao.destino)}
            onMouseEnter={() => aoPrepararDestino?.(botao.destino)}
            onFocus={() => aoPrepararDestino?.(botao.destino)}
            onTouchStart={() => aoPrepararDestino?.(botao.destino)}
            className={`${CARTAO_INICIO} group min-h-[88px] text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300`}
          >
            <span className="flex flex-wrap items-center gap-2">
              <SeloDoInicio icone={botao.icone} tom={botao.tom} />
              <span className="min-w-0 flex-1 break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
                {botao.titulo}
              </span>
              <ChevronRight
                className="size-4 shrink-0 text-zinc-400"
                aria-hidden="true"
              />
            </span>
            <span className="mt-2 block text-xs leading-relaxed text-zinc-400">
              {botao.descricao}
            </span>
          </button>
        ))}
      </div>
    </nav>
  );
}
