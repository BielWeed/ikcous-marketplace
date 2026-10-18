// Peças visuais do Financeiro v8: superfícies escuras e matiz por função.
// Tudo que mostra dinheiro passa por <Dinheiro>, que obedece ao "olho" do
// cabeçalho — esconder os valores esconde TODOS, não só o saldo.

import { AlertTriangle, Check, RefreshCw, X } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { type ReactNode, createContext, useContext, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { formatarBRL, formatarBRLComSinal } from "@/lib/financeiro";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Valores ocultos
// ---------------------------------------------------------------------------

export const ContextoValoresOcultos = createContext(false);

export const useValoresEstaoOcultos = () => useContext(ContextoValoresOcultos);

export interface ConfirmacaoFinanceira {
  readonly titulo: string;
  readonly descricao: string;
  readonly valor?: number;
  readonly rotuloValor?: string;
  readonly sentido?: 1 | -1 | 0;
  readonly linhas?: readonly {
    readonly rotulo: string;
    readonly texto: string;
  }[];
  readonly nota?: string;
}

export const ContextoConfirmacaoFinanceira = createContext<
  (confirmacao: ConfirmacaoFinanceira) => void
>(() => {});
export const useConfirmacaoFinanceira = () =>
  useContext(ContextoConfirmacaoFinanceira);

export function ReciboFinanceiro({
  confirmacao,
  aoFechar,
}: {
  readonly confirmacao: ConfirmacaoFinanceira;
  readonly aoFechar: () => void;
}) {
  return (
    <section
      role="status"
      aria-label={confirmacao.titulo}
      className="rounded-3xl border border-teal-400/20 bg-[#17171C] p-5"
    >
      <div className="flex items-start gap-3">
        <SeloFinanceiro icone={Check} matiz="#2DD4BF" />
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-xl font-bold text-white">
            {confirmacao.titulo}
          </h2>
          <p className="mt-2 break-words text-sm text-zinc-400">
            {confirmacao.descricao}
          </p>
        </div>
        <button
          type="button"
          onClick={aoFechar}
          aria-label="Fechar confirmação"
          className={`${CLASSE_BOTAO_SECUNDARIO} size-11 shrink-0 p-0`}
        >
          <X aria-hidden="true" className="size-5" />
        </button>
      </div>
      {confirmacao.valor !== undefined ? (
        <div className="mt-5">
          {confirmacao.rotuloValor ? (
            <p className="mb-2 text-xs text-zinc-400">
              {confirmacao.rotuloValor}
            </p>
          ) : null}
          <Dinheiro
            valor={confirmacao.valor}
            sentido={confirmacao.sentido}
            className="block text-3xl font-bold"
          />
        </div>
      ) : null}
      {confirmacao.linhas ? (
        <dl className="mt-5 flex flex-col gap-3 text-sm">
          {confirmacao.linhas.map((linha) => (
            <div
              key={linha.rotulo}
              className="flex flex-wrap justify-between gap-2"
            >
              <dt className="text-zinc-400">{linha.rotulo}</dt>
              <dd className="max-w-full break-words font-bold text-white">
                {linha.texto}
              </dd>
            </div>
          ))}
        </dl>
      ) : null}
      <p className="mt-4 text-xs leading-relaxed text-zinc-400">
        {confirmacao.nota ??
          "Registro confirmado pelo servidor. Os dados da tela foram atualizados."}
      </p>
    </section>
  );
}

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
    <span
      className={cn(
        "break-words tabular-nums [overflow-wrap:anywhere]",
        className,
      )}
    >
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
  "text-base font-bold leading-snug text-white";

export function SeloFinanceiro({
  icone: Icone,
  matiz = "#69C8FF",
}: {
  readonly icone: LucideIcon;
  readonly matiz?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl border"
      style={{
        color: matiz,
        backgroundColor: `${matiz}1A`,
        borderColor: `${matiz}40`,
      }}
    >
      <Icone className="size-5" strokeWidth={1.9} />
    </span>
  );
}

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
        "min-w-0 rounded-3xl border border-white/10 bg-[#101013] p-4 sm:p-5",
        className,
      )}
    >
      {titulo || acao ? (
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            {titulo ? <h2 className={CLASSE_TITULO_SECAO}>{titulo}</h2> : null}
            {subtitulo ? (
              <p className="mt-1 text-xs leading-relaxed text-zinc-400">
                {subtitulo}
              </p>
            ) : null}
          </div>
          {acao ? <div className="w-full sm:w-auto">{acao}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Superfície elevada das métricas, com rótulo de 12px em frase normal. */
export const CLASSE_CASCA_DO_CARTAO =
  "rounded-2xl border border-white/10 bg-[#17171C]";

export const CLASSE_ROTULO_DO_CARTAO =
  "text-xs font-semibold leading-tight text-zinc-300";

/** Linha acionável: superfície, foco azul e seta, sem dourado decorativo. */
export const CLASSE_CASCA_DA_LINHA_BOTAO =
  "group rounded-2xl border border-white/10 bg-[#101013] text-left transition-colors hover:bg-[#1E1E24] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 active:scale-[0.99]";

export const CLASSE_SETA_DA_LINHA_BOTAO =
  "size-5 shrink-0 text-zinc-400 transition-transform group-hover:translate-x-0.5 group-hover:text-white";

/**
 * Piso do cartão de KPI e do esqueleto (uma constante só, para não divergirem).
 * É piso, não altura exata: com detalhe ou rótulo de duas linhas o cartão real
 * passa disso e o conteúdo abaixo ainda se ajusta quando os números chegam.
 */
const ALTURA_MINIMA_DO_KPI = "min-h-[100px]";

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
      // Valores e rótulos podem aumentar a altura do cartão, sem reticências.
      className={`relative flex min-w-0 flex-col gap-3 p-4 ${CLASSE_CASCA_DO_CARTAO} ${ALTURA_MINIMA_DO_KPI}${className ? ` ${className}` : ""}`}
    >
      {/* O ícone fica num selo no canto (nunca some); o rótulo reserva a
          faixa dele (`pr-9`) só quando há ícone, e o valor usa a largura toda. */}
      {Icone ? (
        <span className="absolute right-4 top-4 flex size-8 items-center justify-center rounded-xl border border-white/10 bg-white/[0.06]">
          <Icone
            aria-hidden="true"
            className={cn("size-4 shrink-0", destaque ?? "text-zinc-400")}
          />
        </span>
      ) : null}
      {/* O piso alinha os cartões, sem limitar a quantidade de linhas. */}
      <span
        data-rotulo-do-kpi=""
        className={cn(
          "min-h-[2.5em] min-w-0 break-words",
          CLASSE_ROTULO_DO_CARTAO,
          Icone && "pr-9",
        )}
      >
        {rotulo}
      </span>
      <div className="min-w-0 break-words text-2xl font-black tabular-nums leading-tight tracking-tight text-white">
        {children}
      </div>
      {detalhe ? (
        <div className="min-w-0 text-xs font-medium leading-tight text-zinc-400">
          {detalhe}
        </div>
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
      className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Carregando…</span>
      {Array.from({ length: quantos }, (_, i) => (
        <Skeleton
          key={i}
          className={`${ALTURA_MINIMA_DO_KPI} rounded-2xl bg-white/5`}
        />
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
    <div className="flex flex-col items-start gap-4 rounded-3xl border border-white/10 bg-[#101013] p-5">
      <SeloFinanceiro icone={Icone} matiz="#BA9AFF" />
      <p className="text-xl font-bold text-white">{titulo}</p>
      {texto ? (
        <p className="max-w-md text-sm leading-relaxed text-zinc-400">
          {texto}
        </p>
      ) : null}
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
  const [copia, setCopia] = useState("");
  const instalacao = mensagem.includes("não foi instalado");
  const exigeOutraAcao =
    instalacao ||
    mensagem.includes("administrador") ||
    mensagem.includes("formato");
  const titulo = mensagem.includes("não foi instalado")
    ? "Instalação ausente"
    : mensagem.includes("administrador")
      ? "Acesso restrito"
      : mensagem.includes("formato")
        ? "Atualização necessária"
        : mensagem.includes("conexão") || mensagem.includes("internet")
          ? "Confira a conexão"
          : mensagem.includes("recusou os dados")
            ? "Confira os campos"
            : "Não foi possível concluir";
  return (
    <div
      role="alert"
      className="flex flex-col items-start gap-4 rounded-3xl border border-red-400/25 bg-[#17171C] p-5"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2">
        <SeloFinanceiro icone={AlertTriangle} matiz="#FF9F5A" />
        <div className="min-w-0">
          <h3 className="text-base font-bold text-white">{titulo}</h3>
          <p className="mt-2 break-words text-sm leading-relaxed text-zinc-300">
            {mensagem}
          </p>
        </div>
      </div>
      {instalacao ? (
        <>
          <p className="text-xs leading-relaxed text-zinc-400">
            Entregue esta orientação ao responsável técnico: concluir a
            instalação do Financeiro no banco da loja. Depois, volte ao
            Financeiro.
          </p>
          <button
            type="button"
            className={CLASSE_BOTAO_SECUNDARIO}
            onClick={() => {
              void (async () => {
                try {
                  await navigator.clipboard.writeText(
                    `Concluir a instalação do Financeiro no banco da loja. ${mensagem}`,
                  );
                  setCopia("Orientação copiada.");
                } catch {
                  setCopia("Selecione e copie a orientação acima.");
                }
              })();
            }}
          >
            Copiar orientação técnica
          </button>
          {copia ? (
            <p role="status" className="text-xs text-zinc-300">
              {copia}
            </p>
          ) : null}
        </>
      ) : null}
      {aoTentarDeNovo && !exigeOutraAcao ? (
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
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl bg-gradient-to-b from-[#F9D65B] to-[#EABD28] px-4 py-3 text-sm font-bold text-[#171308] shadow-[0_8px_24px_#EABD2814] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:from-[#26262E] disabled:to-[#26262E] disabled:text-zinc-400 disabled:shadow-none";

export const CLASSE_BOTAO_SECUNDARIO =
  "inline-flex min-h-11 items-center justify-center gap-2 rounded-2xl border border-white/10 bg-[#1E1E24] px-4 py-2.5 text-sm font-bold text-zinc-100 transition-colors hover:bg-[#26262E] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:text-zinc-400";

export const CLASSE_BOTAO_PERIGO =
  "inline-flex min-h-14 items-center justify-center gap-2 rounded-2xl border border-red-400/25 bg-red-400/10 px-4 py-2.5 text-sm font-bold text-red-300 transition-colors hover:bg-red-400/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300 active:scale-[0.98] disabled:cursor-not-allowed disabled:text-zinc-400";

export const CLASSE_CAMPO =
  "min-h-[72px] w-full min-w-0 rounded-2xl border border-white/15 bg-[#1E1E24] px-3 pb-2 pt-7 text-base text-white outline-none transition-colors placeholder:text-zinc-400 focus-visible:ring-2 focus-visible:ring-sky-300 aria-invalid:border-red-400 disabled:cursor-not-allowed disabled:text-zinc-400 [&>option]:bg-[#1E1E24]";

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
    <div
      className={cn(
        "relative flex min-w-0 flex-col gap-2",
        erro &&
          "[&>input]:border-red-400 [&>select]:border-red-400 [&>textarea]:border-red-400",
        className,
      )}
    >
      <label
        htmlFor={id}
        className="absolute inset-x-3 top-3 z-10 text-xs font-medium leading-tight text-zinc-400"
      >
        {rotulo}
      </label>
      {children}
      {ajuda && !erro ? (
        <p className="text-xs leading-relaxed text-zinc-400">{ajuda}</p>
      ) : null}
      {erro ? (
        <p
          id={`${id}-erro`}
          role="alert"
          className="flex items-start gap-1 text-xs font-medium text-red-400"
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
      className={cn("flex gap-1 rounded-2xl bg-[#17171C] p-1", className)}
    >
      {opcoes.map((opcao) => (
        <button
          key={opcao.valor}
          type="button"
          aria-pressed={opcao.valor === valor}
          disabled={opcao.desabilitada}
          onClick={() => aoMudar(opcao.valor)}
          className={cn(
            "min-h-11 min-w-0 flex-1 break-words rounded-xl border border-transparent px-2 py-2 text-xs font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 disabled:cursor-not-allowed disabled:border-white/10 disabled:bg-[#1E1E24] disabled:text-zinc-400",
            opcao.valor === valor
              ? "border-admin-gold/60 bg-admin-gold/10 text-admin-gold"
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
        "inline-flex max-w-full items-center rounded-lg border px-2 py-1 text-xs font-medium",
        tom === "neutro" && "border-white/10 bg-white/5 text-zinc-400",
        tom === "aviso" &&
          "border-orange-400/30 bg-orange-400/10 text-orange-300",
        tom === "perigo" && "border-red-500/30 bg-red-500/10 text-red-300",
        tom === "sucesso" &&
          "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
        tom === "ouro" && "border-white/10 bg-white/5 text-zinc-300",
      )}
    >
      {children}
    </span>
  );
}
