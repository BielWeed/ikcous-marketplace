import { ChevronRight, Clock } from "lucide-react";
import { memo } from "react";

import {
  diasAte,
  ehStatusAberto,
  formatarReais,
  rotuloMotivo,
  textoDaIdade,
  textoDoPrazo,
} from "@/lib/devolucao";
import { cn } from "@/lib/utils";
import type { LinhaDevolucaoAdmin } from "@/types/devolucao";

import { SeloDoStatus, SeloDoTipo } from "./SelosDaDevolucao";

/**
 * Um pedido de devolução na lista do painel: protocolo, cliente, tipo,
 * motivo, valor, prazo legal e idade. O prazo só pede atenção enquanto a
 * devolução está em andamento — encerrada, ele é só histórico.
 */
export const CartaoDaDevolucao = memo(function CartaoDaDevolucao({
  linha,
  selecionada,
  agora,
  onAbrir,
}: Readonly<{
  linha: LinhaDevolucaoAdmin;
  selecionada: boolean;
  agora: Date;
  onAbrir: (id: string) => void;
}>) {
  const aberta = ehStatusAberto(linha.status);
  const dias = linha.prazo_ate ? diasAte(linha.prazo_ate, agora) : null;
  const prazoApertado = aberta && dias !== null && dias <= 2;

  return (
    <button
      type="button"
      data-devolucao={linha.id}
      aria-current={selecionada ? "true" : undefined}
      onClick={() => onAbrir(linha.id)}
      className={cn(
        "group flex w-full items-center gap-3 rounded-2xl border p-3.5 text-left transition-all duration-200 active:scale-[0.99]",
        selecionada
          ? "border-admin-gold/40 bg-admin-gold/[0.06]"
          : "border-white/5 bg-zinc-950/40 hover:border-white/10 hover:bg-zinc-900/40",
      )}
    >
      <div className="min-w-0 flex-1 space-y-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="font-mono text-xs font-black tracking-wide text-white">
            {linha.protocolo}
          </span>
          <SeloDoStatus status={linha.status} />
          <SeloDoTipo tipo={linha.tipo} />
        </div>
        <p className="truncate text-sm font-bold text-zinc-200">
          {linha.cliente_nome || "Cliente"}
        </p>
        <p className="truncate text-[11px] text-zinc-400">
          {rotuloMotivo(linha.motivo)}
        </p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-bold text-zinc-500">
          <span className="tabular-nums text-zinc-300">
            {formatarReais(linha.valor_itens)}
          </span>
          {aberta && linha.prazo_ate && (
            <span
              className={cn(
                "inline-flex items-center gap-1 tabular-nums",
                prazoApertado ? "text-red-300" : "text-zinc-500",
              )}
            >
              <Clock className="size-3" />
              Prazo {textoDoPrazo(linha.prazo_ate, agora)}
            </span>
          )}
          <span className="tabular-nums">
            {textoDaIdade(linha.created_at, agora)}
          </span>
        </div>
      </div>
      <ChevronRight className="size-4 shrink-0 text-zinc-600 transition-colors group-hover:text-admin-gold" />
    </button>
  );
});
