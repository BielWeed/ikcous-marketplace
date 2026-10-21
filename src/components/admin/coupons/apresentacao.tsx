import type { LucideIcon } from "lucide-react";

export const FOCO =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";
export const SECUNDARIO = `inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-admin-border-strong bg-admin-raised px-3 py-2 text-sm font-semibold text-zinc-100 hover:bg-admin-hover disabled:bg-admin-surface disabled:text-zinc-400 ${FOCO}`;
export const PRIMARIO = `inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#F8D25A] to-[#E2A81E] px-4 py-3 text-base font-bold text-[#1B1300] shadow-lg shadow-yellow-500/10 disabled:from-admin-raised disabled:to-admin-raised disabled:text-zinc-400 disabled:shadow-none ${FOCO}`;
export const CAMPO =
  "h-12 w-full min-w-0 rounded-2xl border-admin-border-strong bg-admin-raised text-base text-zinc-50 placeholder:text-zinc-400 focus-visible:ring-sky-300 disabled:opacity-100 disabled:text-zinc-400";
export const INTERRUPTOR =
  "relative h-11 w-12 shrink-0 rounded-2xl border-admin-border-strong bg-admin-raised px-[7px] data-[state=checked]:bg-admin-raised data-[state=unchecked]:bg-admin-raised disabled:opacity-100 before:absolute before:inset-x-[5px] before:top-[9px] before:h-6 before:rounded-full before:bg-zinc-700 data-[state=checked]:before:bg-emerald-400 [&_[data-slot=switch-thumb]]:relative [&_[data-slot=switch-thumb]]:z-10 [&_[data-slot=switch-thumb]]:size-5 [&_[data-slot=switch-thumb]]:bg-zinc-50 [&_[data-state=checked]]:translate-x-[14px] [&_[data-state=unchecked]]:translate-x-0";

export function Selo({
  icone: Icone,
  matiz,
}: { readonly icone: LucideIcon; readonly matiz: string }) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-xl border"
      style={{
        color: matiz,
        backgroundColor: `${matiz}26`,
        borderColor: `${matiz}40`,
      }}
    >
      <Icone className="size-[18px]" strokeWidth={1.8} />
    </span>
  );
}
