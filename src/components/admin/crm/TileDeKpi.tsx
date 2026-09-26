import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Um número do painel: rótulo · valor · (variação ou linha de apoio).
 * No celular o valor pode trocar para a forma compacta ("R$ 12,3 mil") —
 * só uma das duas formas fica visível por vez, então o leitor de tela lê
 * uma só.
 */
export function TileDeKpi({
  rotulo,
  valor,
  valorCompacto,
  icone: Icone,
  corDoIcone = "text-admin-gold",
  rodape,
  carregando = false,
  className,
}: Readonly<{
  rotulo: string;
  valor: string;
  valorCompacto?: string;
  icone: LucideIcon;
  corDoIcone?: string;
  rodape?: ReactNode;
  carregando?: boolean;
  className?: string;
}>) {
  return (
    <div
      className={cn(
        "flex min-h-[112px] flex-col justify-between gap-2 rounded-2xl border border-white/[0.04] bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-3 shadow-lg sm:p-4",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-[10px] font-black uppercase leading-tight tracking-widest text-zinc-400">
          {rotulo}
        </p>
        <Icone
          className={cn("size-4 shrink-0", corDoIcone)}
          aria-hidden="true"
        />
      </div>
      {carregando ? (
        <div className="space-y-2" aria-hidden="true">
          <div className="premium-shimmer h-6 w-3/4 rounded-lg" />
          <div className="premium-shimmer h-3 w-1/2 rounded-md" />
        </div>
      ) : (
        <div className="min-w-0 space-y-1">
          <p className="truncate text-lg font-black tracking-tight text-white sm:text-2xl">
            {valorCompacto && valorCompacto !== valor ? (
              <>
                <span className="sm:hidden">{valorCompacto}</span>
                <span className="hidden sm:inline">{valor}</span>
              </>
            ) : (
              valor
            )}
          </p>
          {rodape ? (
            <div className="min-h-4 text-[11px] text-zinc-400">{rodape}</div>
          ) : null}
        </div>
      )}
    </div>
  );
}
