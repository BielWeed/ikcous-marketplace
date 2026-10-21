import { VariacaoComSeta } from "@/components/admin/primitivos/EstadoComPonto";
import {
  type TomDeEstado,
  classeDoIcone,
  classeDoTexto,
} from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ComponentType, ReactNode } from "react";

// Regra das cores do Início (decisão do dono, 21/10/2026): cor só quando
// significa algo (verde positivo, vermelho negativo, âmbar atenção, azul
// informação, cinza inativo) e só em dose pequena — pontinho + texto, o
// número importante e o glifo. Cartões e tiles são neutros; nunca bloco
// pintado.
export const CARTAO_INICIO =
  "min-w-0 rounded-[22px] border border-admin-border bg-admin-surface p-4";
/** Cartão de lista: as linhas levam o próprio respiro vertical. */
export const CARTAO_LISTA_INICIO =
  "min-w-0 rounded-[22px] border border-admin-border bg-admin-surface px-3";
export const BOTAO_INICIO =
  "flex min-h-11 w-full items-center justify-center gap-2 rounded-2xl border border-admin-border-strong bg-white/[0.06] px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:opacity-50";
/** O único botão cheio do Início: branco, sem cor de marca. */
export const ACAO_PRINCIPAL_INICIO =
  "flex min-h-14 w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-3 text-base font-bold text-zinc-950 transition-colors hover:brightness-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";
export const LINHA_INICIO =
  "flex min-h-11 w-full items-center gap-3 rounded-2xl py-3 text-left transition-colors hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300";
const VALOR_BASE_INICIO =
  "break-words font-bold tabular-nums tracking-tight [overflow-wrap:anywhere]";
export const VALOR_INICIO = `${VALOR_BASE_INICIO} text-white`;
/** Rótulo pequeno em caixa-alta que encima um número grande. */
export const ROTULO_INICIO =
  "text-xs font-semibold uppercase tracking-wider text-zinc-400";

/** Número na cor do sinal (verde/vermelho) ou cinza quando neutro. */
export function valorNaCor(tom: TomDeEstado): string {
  return cn(VALOR_BASE_INICIO, classeDoTexto(tom));
}

// Só os atalhos fixos da barra (Relatórios e Financeiro) mantêm um tile
// colorido — o azul e o teal que já existiam e que o dono pediu para manter.
const TONS = {
  azul: "border-blue-400/25 bg-blue-400/10 text-blue-300",
  teal: "border-teal-400/25 bg-teal-400/10 text-teal-300",
} as const;
export type TomDoInicio = keyof typeof TONS;

export function SeloDoInicio({
  icone: Icone,
  tom,
}: Readonly<{
  icone: ComponentType<{ className?: string }>;
  tom: TomDoInicio;
}>) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-9 shrink-0 items-center justify-center rounded-xl border ${Reflect.get(TONS, tom) as string}`}
    >
      <Icone className="size-5" />
    </span>
  );
}

/** Tile neutro; só o glifo carrega a cor do significado. */
export function TileDoInicio({
  icone: Icone,
  tom = "neutro",
}: Readonly<{
  icone: ComponentType<{ className?: string }>;
  tom?: TomDeEstado;
}>) {
  return (
    <span
      aria-hidden="true"
      className="flex size-10 shrink-0 items-center justify-center rounded-xl border border-admin-border bg-admin-raised"
    >
      <Icone className={cn("size-5", classeDoIcone(tom))} />
    </span>
  );
}

export function TituloDoInicio({
  id,
  lateral,
  children,
}: Readonly<{ id: string; lateral?: ReactNode; children: ReactNode }>) {
  return (
    <div className="mb-3 flex items-baseline justify-between gap-3">
      <h2 id={id} className="text-lg font-bold leading-snug text-white">
        {children}
      </h2>
      {lateral}
    </div>
  );
}

export function FalhaDoInicio({
  children,
  onTentarDeNovo,
}: Readonly<{ children: ReactNode; onTentarDeNovo?: () => void }>) {
  return (
    <div className={`${CARTAO_INICIO} space-y-3`} role="alert">
      <div className="flex items-start gap-3">
        <TileDoInicio icone={AlertTriangle} tom="negativo" />
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

/**
 * "25% a mais que …" com seta e cor do sinal. `referencia` diz com o que se
 * compara, em palavras que não escondem a janela (o banco compara o mesmo dia
 * da semana passada, ou os mesmos dias do mês anterior — nunca "ontem").
 * Sem base honesta, texto cinza neutro.
 */
export function VariacaoDoInicio({
  pct,
  referencia,
  children,
}: Readonly<{ pct: number | null; referencia: string; children?: ReactNode }>) {
  const arredondado = pct == null ? null : Math.round(pct * 10) / 10;
  const numero =
    arredondado == null
      ? ""
      : Math.abs(arredondado).toLocaleString("pt-BR", {
          maximumFractionDigits: 1,
        });
  const texto =
    arredondado == null
      ? "sem base de comparação"
      : arredondado > 0
        ? `${numero}% a mais ${referencia}`
        : arredondado < 0
          ? `${numero}% a menos ${referencia}`
          : `igual ${referencia}`;
  return (
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
      <VariacaoComSeta
        valor={arredondado ?? 0}
        texto={texto}
        className="min-w-0 text-sm"
      />
      {children}
    </div>
  );
}
