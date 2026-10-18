import { AcaoDaBarra } from "@/components/layouts/AcaoDaBarra";
import { NOMES_DO_PAINEL } from "@/config/nomes-do-painel";
import type { View } from "@/types";
import { BarChart3, Wallet } from "lucide-react";
import { SeloDoInicio } from "./visualDoInicio";

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
  ativa = true,
}: Readonly<{
  onNavigate: (view: View) => void;
  aoPrepararDestino?: (view: View) => void;
  ativa?: boolean;
}>) {
  return (
    <AcaoDaBarra ativa={ativa} aria-label="Atalhos do painel">
      {BOTOES_GRANDES.map((botao) => (
        <button
          key={botao.destino}
          type="button"
          onClick={() => onNavigate(botao.destino)}
          onMouseEnter={() => aoPrepararDestino?.(botao.destino)}
          onFocus={() => aoPrepararDestino?.(botao.destino)}
          onTouchStart={() => aoPrepararDestino?.(botao.destino)}
          className="flex min-h-14 min-w-0 flex-1 items-center justify-center gap-2 rounded-[1.125rem] border border-white/10 bg-[#17171C] p-2 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300"
        >
          <SeloDoInicio icone={botao.icone} tom={botao.tom} />
          <span className="min-w-0 break-words text-sm font-bold text-white [overflow-wrap:anywhere]">
            {botao.titulo}{" "}
            <span className="sr-only text-xs font-normal leading-relaxed text-zinc-400 lg:not-sr-only lg:block">
              {botao.descricao}
            </span>
          </span>
        </button>
      ))}
    </AcaoDaBarra>
  );
}
