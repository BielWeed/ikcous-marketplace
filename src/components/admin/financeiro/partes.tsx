// Peças visuais do Financeiro, no idioma do painel (fundo #09090b, cartão
// `admin-glass`, título de seção em caixa-alta espaçada, ouro de destaque).
// Tudo que mostra dinheiro passa por <Dinheiro>, que obedece ao "olho" do
// cabeçalho — esconder os valores esconde TODOS, não só o saldo.

import { AlertTriangle, RefreshCw } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type ReactNode, createContext, useContext } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { formatarBRL, formatarBRLComSinal } from "@/lib/financeiro";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Valores ocultos
// ---------------------------------------------------------------------------

export const ContextoValoresOcultos = createContext(false);

export const useValoresEstaoOcultos = () => useContext(ContextoValoresOcultos);

const MASCARA = "R$ ••••••";

/**
 * Dinheiro na tela. `comSinal`: "+R$ 10,00" / "−R$ 10,00" (o sinal é a pista
 * que não depende da cor). `sentido` força o sinal de um valor positivo
 * (entrada = 1, saída = −1) sem o chamador fazer conta.
 */
export function Dinheiro({
  valor,
  comSinal = false,
  sentido,
  className,
}: {
  readonly valor: number;
  readonly comSinal?: boolean;
  readonly sentido?: 1 | -1 | 0;
  readonly className?: string;
}) {
  const ocultos = useValoresEstaoOcultos();
  if (ocultos) {
    return (
      <span className={cn("tabular-nums", className)}>
        <span aria-hidden="true">{MASCARA}</span>
        <span className="sr-only">Valor oculto</span>
      </span>
    );
  }
  let exibido: string;
  if (sentido === 0) exibido = formatarBRL(valor);
  else if (sentido !== undefined) {
    exibido = formatarBRLComSinal(sentido * Math.abs(valor));
  } else if (comSinal || valor < 0) exibido = formatarBRLComSinal(valor);
  else exibido = formatarBRL(valor);
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)}>
      {exibido}
    </span>
  );
}

/** Cor de valor com sinal: verde entra, vermelho sai, neutro zero. */
export function corDoValor(valor: number): string {
  if (Math.round(valor * 100) > 0) return "text-emerald-400";
  if (Math.round(valor * 100) < 0) return "text-red-400";
  return "text-zinc-300";
}

// ---------------------------------------------------------------------------
// Estrutura
// ---------------------------------------------------------------------------

export const CLASSE_TITULO_SECAO =
  "text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500";

export function CartaoSecao({
  titulo,
  subtitulo,
  acao,
  children,
  className,
  id,
}: {
  readonly titulo?: string;
  readonly subtitulo?: ReactNode;
  readonly acao?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
  readonly id?: string;
}) {
  return (
    <section
      id={id}
      aria-label={titulo}
      className={cn(
        "admin-glass rounded-2xl border border-white/5 p-4 shadow-2xl sm:p-6",
        className,
      )}
    >
      {titulo || acao ? (
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="min-w-0">
            {titulo ? <h2 className={CLASSE_TITULO_SECAO}>{titulo}</h2> : null}
            {subtitulo ? (
              <p className="mt-1 text-xs text-zinc-500">{subtitulo}</p>
            ) : null}
          </div>
          {acao ? <div className="shrink-0">{acao}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function BlocoKpi({
  rotulo,
  icone: Icone,
  children,
  detalhe,
  destaque,
  className,
}: {
  readonly rotulo: string;
  readonly icone?: LucideIcon;
  readonly children: ReactNode;
  readonly detalhe?: ReactNode;
  /** Classe de cor do ícone. */
  readonly destaque?: string;
  readonly className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-w-0 flex-col gap-1.5 rounded-2xl border border-white/[0.04] bg-zinc-950 bg-gradient-to-br from-zinc-900/50 to-zinc-950/80 p-3 shadow-lg",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-[10px] font-black uppercase tracking-[0.2em] text-zinc-500">
          {rotulo}
        </span>
        {Icone ? (
          <Icone
            aria-hidden="true"
            className={cn("size-4 shrink-0", destaque ?? "text-zinc-500")}
          />
        ) : null}
      </div>
      <div className="min-w-0 truncate text-lg font-black tabular-nums tracking-tight text-white sm:text-xl">
        {children}
      </div>
      {detalhe ? (
        <div className="min-w-0 text-[11px] text-zinc-500">{detalhe}</div>
      ) : null}
    </div>
  );
}

export function EsqueletoDeLista({ linhas = 4 }: { readonly linhas?: number }) {
  return (
    <div className="flex flex-col gap-2" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: linhas }, (_, i) => (
        <Skeleton key={i} className="h-14 w-full rounded-xl bg-white/5" />
      ))}
    </div>
  );
}

export function EsqueletoDeKpis({
  quantos = 4,
}: { readonly quantos?: number }) {
  return (
    <div
      className="grid grid-cols-2 gap-3 lg:grid-cols-4"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: quantos }, (_, i) => (
        <Skeleton key={i} className="h-[92px] rounded-2xl bg-white/5" />
      ))}
    </div>
  );
}

export function EstadoVazio({
  icone: Icone,
  titulo,
  texto,
  acao,
}: {
  readonly icone: LucideIcon;
  readonly titulo: string;
  readonly texto?: string;
  readonly acao?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-white/10 px-4 py-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-2xl border border-admin-gold/10 bg-admin-gold/5">
        <Icone aria-hidden="true" className="size-5 text-admin-gold/60" />
      </div>
      <p className="text-sm font-bold text-white">{titulo}</p>
      {texto ? <p className="max-w-sm text-xs text-zinc-500">{texto}</p> : null}
      {acao}
    </div>
  );
}

export function EstadoDeErro({
  mensagem,
  aoTentarDeNovo,
}: {
  readonly mensagem: string;
  readonly aoTentarDeNovo?: () => void;
}) {
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-2xl border border-red-500/20 bg-red-500/5 p-4 sm:flex-row sm:items-center"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <AlertTriangle
          aria-hidden="true"
          className="mt-0.5 size-4 shrink-0 text-red-400"
        />
        <p className="text-sm text-red-200">{mensagem}</p>
      </div>
      {aoTentarDeNovo ? (
        <button
          type="button"
          onClick={aoTentarDeNovo}
          className={CLASSE_BOTAO_SECUNDARIO}
        >
          <RefreshCw aria-hidden="true" className="size-4" />
          Tentar de novo
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Botões e campos
// ---------------------------------------------------------------------------

export const CLASSE_BOTAO_PRIMARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-admin-gold px-4 text-sm font-black text-black transition-opacity hover:opacity-90 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export const CLASSE_BOTAO_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 text-sm font-bold text-zinc-200 transition-colors hover:bg-white/10 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export const CLASSE_BOTAO_PERIGO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-4 text-sm font-bold text-red-300 transition-colors hover:bg-red-500/20 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50";

export const CLASSE_CAMPO =
  "min-h-11 w-full rounded-xl border border-white/10 bg-zinc-900 px-3 text-base text-white outline-none transition-colors placeholder:text-zinc-600 focus:border-admin-gold/60 disabled:cursor-not-allowed disabled:opacity-60 sm:text-sm";

export const CLASSE_ROTULO = "text-xs font-bold text-zinc-300";

export function Campo({
  id,
  rotulo,
  erro,
  ajuda,
  children,
  className,
}: {
  readonly id: string;
  readonly rotulo: string;
  readonly erro?: string;
  readonly ajuda?: ReactNode;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className={CLASSE_ROTULO}>
        {rotulo}
      </label>
      {children}
      {ajuda && !erro ? (
        <p className="text-[11px] text-zinc-500">{ajuda}</p>
      ) : null}
      {erro ? (
        <p
          id={`${id}-erro`}
          role="alert"
          className="flex items-center gap-1 text-[11px] font-bold text-red-400"
        >
          <AlertTriangle aria-hidden="true" className="size-3.5 shrink-0" />
          {erro}
        </p>
      ) : null}
    </div>
  );
}

interface OpcaoSegmentada<V extends string> {
  readonly valor: V;
  readonly rotulo: string;
  readonly desabilitada?: boolean;
}

/** Controle segmentado acessível (botões com `aria-pressed`). */
export function Segmentado<V extends string>({
  rotulo,
  opcoes,
  valor,
  aoMudar,
  className,
}: {
  readonly rotulo: string;
  readonly opcoes: readonly OpcaoSegmentada<V>[];
  readonly valor: V;
  readonly aoMudar: (valor: V) => void;
  readonly className?: string;
}) {
  return (
    <div
      role="group"
      aria-label={rotulo}
      className={cn(
        "flex gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1",
        className,
      )}
    >
      {opcoes.map((opcao) => (
        <button
          key={opcao.valor}
          type="button"
          aria-pressed={opcao.valor === valor}
          disabled={opcao.desabilitada}
          onClick={() => aoMudar(opcao.valor)}
          className={cn(
            "min-h-10 flex-1 rounded-lg px-3 text-xs font-black transition-colors disabled:cursor-not-allowed disabled:opacity-40",
            opcao.valor === valor
              ? "bg-white text-black shadow"
              : "text-zinc-400 hover:bg-white/5 hover:text-white",
          )}
        >
          {opcao.rotulo}
        </button>
      ))}
    </div>
  );
}

/** Etiqueta pequena (previsto, cancelado, sistema…). */
export function Etiqueta({
  children,
  tom = "neutro",
}: {
  readonly children: ReactNode;
  readonly tom?: "neutro" | "aviso" | "perigo" | "sucesso" | "ouro";
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center rounded-md border px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider",
        tom === "neutro" && "border-white/10 bg-white/5 text-zinc-400",
        tom === "aviso" && "border-amber-500/30 bg-amber-500/10 text-amber-300",
        tom === "perigo" && "border-red-500/30 bg-red-500/10 text-red-300",
        tom === "sucesso" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        tom === "ouro" &&
          "border-admin-gold/30 bg-admin-gold/10 text-admin-gold",
      )}
    >
      {children}
    </span>
  );
}
