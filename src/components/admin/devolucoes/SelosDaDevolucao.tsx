import {
  type TomDoStatus,
  rotuloStatus,
  rotuloTipo,
  tomDoStatus,
} from "@/lib/devolucao";
import { cn } from "@/lib/utils";
import type { StatusDevolucao, TipoDevolucao } from "@/types/devolucao";

/** Status é sempre cor + texto (nunca só cor) — mesma régua do painel. */
export const COR_DO_TOM_NO_PAINEL = new Map<TomDoStatus, string>([
  ["atencao", "border-amber-500/30 bg-amber-500/10 text-amber-300"],
  ["andamento", "border-sky-500/30 bg-sky-500/10 text-sky-300"],
  ["sucesso", "border-emerald-500/30 bg-emerald-500/10 text-emerald-300"],
  ["negativo", "border-red-500/30 bg-red-500/10 text-red-300"],
]);

const COR_DO_TIPO = new Map<TipoDevolucao, string>([
  ["arrependimento", "border-violet-500/30 bg-violet-500/10 text-violet-300"],
  ["vicio", "border-orange-500/30 bg-orange-500/10 text-orange-300"],
  ["troca", "border-zinc-500/30 bg-zinc-500/10 text-zinc-300"],
]);

export function SeloDoStatus({
  status,
  className,
}: Readonly<{ status: StatusDevolucao; className?: string }>) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest",
        COR_DO_TOM_NO_PAINEL.get(tomDoStatus(status)),
        className,
      )}
    >
      {rotuloStatus(status)}
    </span>
  );
}

export function SeloDoTipo({
  tipo,
  className,
}: Readonly<{ tipo: TipoDevolucao; className?: string }>) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-widest",
        COR_DO_TIPO.get(tipo),
        className,
      )}
    >
      {rotuloTipo(tipo)}
    </span>
  );
}
