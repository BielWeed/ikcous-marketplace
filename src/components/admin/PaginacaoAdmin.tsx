import { Button } from "@/components/ui/button";
import { formatarInteiro } from "@/lib/crm";
import { cn } from "@/lib/utils";
import { ChevronLeft, ChevronRight } from "lucide-react";

/**
 * Paginação única do painel — Missão 06, C2 (aprovada pelo dono): substitui os
 * três desenhos inline (Pedidos "Perfil do Setor", Produtos "Exibindo...",
 * Clientes "Segmento X de Y") por um só, com o retorno honesto de total.
 * A linha "Exibindo X - Y de Z" aparece SEMPRE que houver item (é o contador
 * que faltava); os botões só nascem com mais de uma página.
 * `pagina` é 0-based como o estado das três telas.
 */
export function PaginacaoAdmin({
  pagina,
  totalPaginas,
  totalItens,
  itensPorPagina,
  aoMudar,
  className,
  aparencia,
}: {
  pagina: number;
  totalPaginas: number;
  totalItens: number;
  itensPorPagina: number;
  aoMudar: (novaPagina: number) => void;
  className?: string;
  aparencia?: "clientes";
}) {
  if (totalItens <= 0) return null;

  // Defesa de 1 frame (achado 2, revisão 5.3): quando a lista encolhe e a
  // página salva passa do fim, o reset das views roda depois da pintura —
  // sem o clamp, o contador chega a pintar "Exibindo 25 - 12 de 12".
  const paginaEfetiva = Math.min(pagina, Math.max(0, totalPaginas - 1));
  const primeiro = paginaEfetiva * itensPorPagina + 1;
  const ultimo = Math.min((paginaEfetiva + 1) * itensPorPagina, totalItens);

  return (
    <div
      data-testid="paginacao-admin"
      className={cn(
        "mt-6 flex select-none items-center justify-between",
        aparencia === "clientes" && "flex-col gap-2 text-center",
        className,
      )}
    >
      <p
        className={
          aparencia === "clientes"
            ? "text-xs text-zinc-400"
            : "text-[11px] font-bold uppercase tracking-widest text-zinc-500"
        }
      >
        Exibindo {formatarInteiro(primeiro)} - {formatarInteiro(ultimo)} de{" "}
        {formatarInteiro(totalItens)}
      </p>
      {totalPaginas > 1 && (
        <div
          className={cn(
            "flex gap-2",
            aparencia === "clientes" && "w-full items-center justify-between",
          )}
        >
          <Button
            variant="outline"
            size="sm"
            onClick={() => aoMudar(Math.max(0, paginaEfetiva - 1))}
            disabled={paginaEfetiva === 0}
            className={cn(
              "h-11 rounded-xl border-white/5 bg-zinc-950/60 px-4 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-white",
              aparencia === "clientes" &&
                "disabled:opacity-100 focus-visible:ring-sky-300",
            )}
          >
            <ChevronLeft className="mr-1.5 size-4" /> Anterior
          </Button>
          {aparencia === "clientes" && (
            <span className="text-xs font-semibold text-zinc-100">
              {paginaEfetiva + 1} de {totalPaginas}
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              aoMudar(Math.min(totalPaginas - 1, paginaEfetiva + 1))
            }
            disabled={paginaEfetiva >= totalPaginas - 1}
            className={cn(
              "h-11 rounded-xl border-white/5 bg-zinc-950/60 px-4 text-zinc-400 transition-all hover:bg-zinc-800 hover:text-white",
              aparencia === "clientes" &&
                "bg-[#1E1E24] text-zinc-100 disabled:opacity-100 focus-visible:ring-sky-300",
            )}
          >
            Próximo <ChevronRight className="ml-1.5 size-4" />
          </Button>
        </div>
      )}
      {aparencia === "clientes" &&
        (paginaEfetiva === 0 || paginaEfetiva >= totalPaginas - 1) && (
          <p className="text-[11px] text-zinc-400">
            {paginaEfetiva === 0
              ? "Primeira página · Anterior indisponível"
              : "Última página · Próximo indisponível"}
          </p>
        )}
    </div>
  );
}
