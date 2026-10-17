import { ChipDeVariacao } from "@/components/admin/crm/ChipDeVariacao";
import { AlertTriangle, type LucideIcon, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

export const CARTAO_INICIO =
  "min-w-0 rounded-[22px] border border-white/10 bg-zinc-900/50 p-4";
export const BOTAO_INICIO =
  "flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-white/15 bg-white/[0.06] px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-50";
export const ACAO_PRINCIPAL_INICIO =
  "flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-amber-300 to-yellow-500 px-4 py-3 text-base font-bold text-zinc-950 shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white";
export const LINHA_INICIO =
  "flex min-h-11 w-full items-center gap-3 rounded-2xl py-3 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";
export const VALOR_INICIO =
  "break-words font-bold tabular-nums tracking-tight text-white [overflow-wrap:anywhere]";

const TONS = {
  azul: "border-blue-400/25 bg-blue-400/10 text-blue-300",
  ceu: "border-sky-400/25 bg-sky-400/10 text-sky-300",
  verde: "border-emerald-400/25 bg-emerald-400/10 text-emerald-300",
  teal: "border-teal-400/25 bg-teal-400/10 text-teal-300",
  roxo: "border-violet-400/25 bg-violet-400/10 text-violet-300",
  laranja: "border-orange-300/25 bg-orange-300/10 text-orange-300",
  rosa: "border-pink-400/25 bg-pink-400/10 text-pink-300",
} as const;
export type TomDoInicio = keyof typeof TONS;

export function SeloDoInicio({
  icone: Icone,
  tom,
}: Readonly<{ icone: LucideIcon; tom: TomDoInicio }>) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-9 shrink-0 items-center justify-center rounded-xl border ${TONS[tom]}`}
    >
      <Icone className="size-5" />
    </span>
  );
}

export function TituloDoInicio({
  id,
  icone,
  tom,
  children,
}: Readonly<{
  id: string;
  icone: LucideIcon;
  tom: TomDoInicio;
  children: ReactNode;
}>) {
  return (
    <h2
      id={id}
      className="mb-3 flex items-center gap-2.5 text-lg font-bold leading-snug text-white"
    >
      <SeloDoInicio icone={icone} tom={tom} />
      {children}
    </h2>
  );
}

export function FalhaDoInicio({
  children,
  onTentarDeNovo,
}: Readonly<{ children: ReactNode; onTentarDeNovo?: () => void }>) {
  return (
    <div className={`${CARTAO_INICIO} space-y-3`} role="alert">
      <div className="flex items-start gap-3">
        <SeloDoInicio icone={AlertTriangle} tom="rosa" />
        <div className="min-w-0 space-y-1">
          <p className="text-base font-bold text-white">Falha Operacional</p>
          <div className="text-sm leading-relaxed text-zinc-400">
            {children}
          </div>
        </div>
      </div>
      {onTentarDeNovo ? (
        <button type="button" onClick={onTentarDeNovo} className={BOTAO_INICIO}>
          <RefreshCw className="size-5" aria-hidden="true" />
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}

export function VariacaoDoInicio({
  pct,
  comparacao,
  children,
}: Readonly<{ pct: number | null; comparacao: string; children?: ReactNode }>) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <ChipDeVariacao
          pct={pct}
          comparacao={comparacao}
          className={`max-w-full flex-wrap text-sm [&_span.font-semibold]:hidden ${pct == null ? "text-zinc-400" : ""}`}
        />
        {children}
      </div>
      {pct != null ? (
        <p aria-hidden="true" className="text-sm text-zinc-400">
          {comparacao}
        </p>
      ) : null}
    </div>
  );
}
