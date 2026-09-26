import { RotateCcw } from "lucide-react";

import { useDevolucoesAbertas } from "@/hooks/useDevolucoesAdmin";
import { cn } from "@/lib/utils";

/**
 * Porta da tela de Devoluções no cabeçalho de Pedidos, com quantas estão em
 * andamento. O número fica dourado quando há pedido esperando resposta
 * (`solicitada`) — é o único estado em que a bola está com o lojista E o
 * prazo legal corre.
 */
export function BotaoDevolucoes({
  onAbrir,
  ativo = true,
}: Readonly<{ onAbrir: () => void; ativo?: boolean }>) {
  const { abertas, solicitadas } = useDevolucoesAbertas(ativo);
  const rotulo =
    abertas && abertas > 0
      ? `Devoluções (${abertas} em andamento)`
      : "Devoluções";

  return (
    <button
      type="button"
      data-acao="abrir-devolucoes"
      onClick={onAbrir}
      aria-label={rotulo}
      title={rotulo}
      className="flex h-11 min-w-11 items-center justify-center gap-2 rounded-xl border border-white/5 bg-zinc-900/60 px-3 text-[10px] font-black uppercase tracking-widest text-zinc-300 transition-all hover:border-white/10 hover:text-white active:scale-95"
    >
      <RotateCcw className="size-4" />
      <span className="hidden sm:inline">Devoluções</span>
      {abertas !== null && abertas > 0 && (
        <span
          className={cn(
            "rounded-md px-1.5 py-0.5 text-[10px] font-black tabular-nums",
            solicitadas > 0
              ? "bg-admin-gold text-black"
              : "bg-white/10 text-zinc-200",
          )}
        >
          {abertas}
        </span>
      )}
    </button>
  );
}
