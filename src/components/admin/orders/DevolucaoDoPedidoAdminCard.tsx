import { ArrowUpRight, RotateCcw } from "lucide-react";

import {
  SeloDoStatus,
  SeloDoTipo,
} from "@/components/admin/devolucoes/SelosDaDevolucao";
import { useDevolucoesDoPedidoAdmin } from "@/hooks/useDevolucoesAdmin";
import {
  ehStatusAberto,
  formatarDia,
  formatarReais,
  rotuloMetodo,
  rotuloResolucao,
} from "@/lib/devolucao";
import { cn } from "@/lib/utils";

/**
 * Devolução de PRODUTO deste pedido, na ficha do lojista (logo antes da
 * devolução de dinheiro — `EstornoCard`). Só resume: quem decide e age é a
 * tela de Devoluções, para onde o botão leva com a devolução já aberta.
 * Sem devolução, o card não existe.
 */
export function DevolucaoDoPedidoAdminCard({
  orderId,
  onAbrirDevolucoes,
}: Readonly<{
  orderId: string;
  /** Navega para `admin-devolucoes` (sem ele, o card só informa). */
  onAbrirDevolucoes?: (id: string) => void;
}>) {
  const { devolucoes, erro, recarregar } = useDevolucoesDoPedidoAdmin(
    orderId,
    true,
  );

  if (erro) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-white">
        <p className="text-xs font-medium text-zinc-400">
          Não consegui conferir as devoluções deste pedido.
        </p>
        <button
          type="button"
          onClick={recarregar}
          className="min-h-11 shrink-0 rounded-xl border border-white/10 bg-white/5 px-3 text-xs font-medium text-zinc-200"
        >
          Tentar de novo
        </button>
      </div>
    );
  }

  if (devolucoes.length === 0) return null;

  function abrir(id: string) {
    if (!onAbrirDevolucoes) return;
    onAbrirDevolucoes(id);
  }

  return (
    <section
      data-testid="devolucao-do-pedido-admin"
      className="space-y-3 rounded-2xl border border-white/5 bg-white/[0.03] p-4 text-white sm:p-5"
    >
      <h3 className="flex items-center gap-2 text-sm font-medium text-zinc-200">
        <RotateCcw className="size-4" />
        Devolução do produto
      </h3>
      <ul className="space-y-2">
        {devolucoes.map((d) => {
          const aberta = ehStatusAberto(d.status);
          return (
            <li key={d.id}>
              <button
                type="button"
                onClick={() => abrir(d.id)}
                disabled={!onAbrirDevolucoes}
                className={cn(
                  "group flex min-h-11 w-full items-center gap-3 rounded-xl border p-3 text-left transition-colors disabled:cursor-default",
                  d.status === "solicitada"
                    ? "border-amber-500/30 bg-amber-500/[0.06]"
                    : "border-white/5 bg-zinc-950/40 hover:border-white/10",
                )}
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-xs font-black tracking-wide">
                      {d.protocolo}
                    </span>
                    <SeloDoStatus status={d.status} />
                    <SeloDoTipo tipo={d.tipo} />
                  </div>
                  <p className="text-xs text-zinc-400">
                    {rotuloResolucao(d.resolucao_desejada)} ·{" "}
                    {rotuloMetodo(d.metodo_retorno)} ·{" "}
                    <span className="tabular-nums">
                      {formatarReais(d.valor_itens)}
                    </span>{" "}
                    · {formatarDia(d.created_at)}
                  </p>
                  {d.status === "solicitada" && (
                    <p className="text-xs font-medium text-amber-300">
                      Aguardando a sua resposta
                    </p>
                  )}
                </div>
                {onAbrirDevolucoes && (
                  <ArrowUpRight
                    className={cn(
                      "size-4 shrink-0 transition-colors group-hover:text-admin-gold",
                      aberta ? "text-admin-gold" : "text-zinc-500",
                    )}
                  />
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
