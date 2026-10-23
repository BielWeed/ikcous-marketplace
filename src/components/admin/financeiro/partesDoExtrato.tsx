// Peças visuais das abas Extrato e Pagar e receber (desenho aprovado de
// 23/10/2026). Só aparência: nenhuma conta nova — saldo, sinais e janelas vêm
// de `src/lib/financeiro.ts`, como sempre.
//
// Regra do dono: valor em dinheiro NUNCA quebra de linha. Quem se ajusta é o
// tamanho da letra, pelo número de caracteres do texto já formatado.

import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import type { ContaFinanceira, DataIso } from "@/types/financeiro";
import { CLASSE_CHIP, CLASSE_CHIP_COMUM } from "./partes";
import {
  classeDoValorGrande,
  comprimentoDoValor,
  tamanhoDeMeiaLargura,
} from "./tamanhoDoValor";

/** Rótulo pequeno em caixa alta do cartão de número. */
export const CLASSE_ROTULO_CAIXA_ALTA =
  "text-xs font-semibold uppercase tracking-wide text-zinc-400";

/** Cartão grande do topo da aba (total do período / total a pagar). */
export const CLASSE_CARTAO_DO_TOPO =
  "flex min-w-0 flex-col items-start gap-3 rounded-3xl border border-admin-border bg-admin-surface p-5";

/** Quadro menor dentro do cartão do topo. */
export const CLASSE_QUADRO_INTERNO =
  "min-w-0 rounded-2xl border border-admin-border bg-admin-raised p-3";

/** Quadro "Vencido": só ganha vermelho quando há o que está vencido. */
export const CLASSE_QUADRO_VENCIDO =
  "min-w-0 rounded-2xl border border-red-400/25 bg-red-400/10 p-3";

/** Cartão de um dia do extrato / de uma conta a pagar. */
export const CLASSE_CARTAO_DA_LISTA =
  "min-w-0 rounded-3xl border border-admin-border bg-admin-surface";

/**
 * Botões em pílula de 44px das contas a pagar/receber. `border-solid`
 * explícito: o index.css zera a borda de todo `<button>`. Primário NEUTRO de
 * alto contraste (claro no escuro, escuro no claro); nunca dourado.
 */
const CLASSE_PILULA =
  "inline-flex min-h-11 min-w-0 items-center justify-center rounded-full border border-solid px-4 py-2 text-sm font-bold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 active:scale-[0.98]";
export const CLASSE_PILULA_PRIMARIA = cn(
  CLASSE_PILULA,
  "border-foreground bg-foreground text-background hover:opacity-90",
);
export const CLASSE_PILULA_SECUNDARIA = cn(
  CLASSE_PILULA,
  "border-admin-border bg-admin-raised text-white hover:bg-admin-hover",
);

/**
 * Valor do cartão do topo: largura cheia, encolhe só quando muito longo.
 * `ocultos`: com o "olho" ligado o tamanho não depende do valor real.
 */
export function classeDoValorDoTopo(
  valor: number,
  comSinal: boolean,
  ocultos: boolean,
): string {
  return classeDoValorGrande(comprimentoDoValor(valor, comSinal, ocultos));
}

/** Valor de um quadro de meia largura (Entrou/Saiu, Vencido, Próximos 7 dias). */
export function classeDoValorNoQuadro(
  valor: number,
  comSinal: boolean,
  ocultos: boolean,
): string {
  return cn(
    "whitespace-nowrap font-bold",
    tamanhoDeMeiaLargura(comprimentoDoValor(valor, comSinal, ocultos)),
  );
}

/**
 * Valor à direita de uma linha/cartão de lista: não encolhe (`shrink-0`), é o
 * título que cede e quebra. Letra menor só quando o texto é longo.
 */
export function classeDoValorDaLinha(
  valor: number,
  comSinal: boolean,
  ocultos: boolean,
): string {
  const n = comprimentoDoValor(valor, comSinal, ocultos);
  return cn(
    "shrink-0 whitespace-nowrap text-right font-bold leading-snug",
    n <= 9 ? "text-[18px]" : n <= 12 ? "text-base" : "text-sm",
  );
}

/** Dia anterior (UTC, como o resto das datas de calendário do Financeiro). */
function diaAnterior(iso: DataIso): DataIso {
  const data = new Date(`${iso}T00:00:00Z`);
  data.setUTCDate(data.getUTCDate() - 1);
  return data.toISOString().slice(0, 10);
}

/**
 * Título do cartão do dia: "Hoje · 23 de outubro", "Ontem · 22 de outubro";
 * os outros dias ficam com o texto por extenso de sempre ("Terça-feira, 20 de
 * outubro"). `porExtenso` vem de `formatarDiaPorExtenso`.
 */
export function tituloDoDia(
  dia: DataIso,
  hoje: DataIso,
  porExtenso: string,
): string {
  const rotulo =
    dia === hoje ? "Hoje" : dia === diaAnterior(hoje) ? "Ontem" : "";
  if (!rotulo) return porExtenso;
  const semDiaDaSemana = porExtenso.includes(", ")
    ? porExtenso.slice(porExtenso.indexOf(", ") + 2)
    : porExtenso;
  return `${rotulo} · ${semDiaDaSemana}`;
}

/**
 * Chip "Todas as contas ›" do Extrato: pílula de 44px com o `<select>` de
 * verdade por cima (invisível, mas é ele que recebe o toque e o foco), para o
 * celular abrir a lista nativa.
 */
export function ChipDaConta({
  id,
  valor,
  aoMudar,
  contas,
}: {
  readonly id: string;
  readonly valor: string;
  readonly aoMudar: (id: string) => void;
  readonly contas: readonly ContaFinanceira[];
}) {
  const escolhida = contas.find((c) => c.id === valor);
  return (
    <label
      className={cn(
        CLASSE_CHIP,
        CLASSE_CHIP_COMUM,
        "relative w-fit max-w-full cursor-pointer gap-1.5 text-sm focus-within:ring-2 focus-within:ring-sky-300",
      )}
    >
      <span className="min-w-0 truncate">
        {escolhida ? escolhida.nome : "Todas as contas"}
      </span>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
      <select
        id={id}
        aria-label="Conta"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        className="absolute inset-0 size-full cursor-pointer opacity-0"
      >
        <option value="">Todas as contas</option>
        {contas.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
            {c.ativa ? "" : " (inativa)"}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Esqueleto do cartão do topo: mesma altura, sem número inventado. */
export function EsqueletoDoTopo({
  altura = "h-[10rem]",
}: { readonly altura?: string }) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <Skeleton className={cn("rounded-3xl bg-white/5", altura)} />
    </div>
  );
}

/** Par "rótulo valor" em uma linha (Entrou +R$ 10 · Saiu R$ 0). */
export function ParDoTopo({
  rotulo,
  children,
}: {
  readonly rotulo: string;
  readonly children: ReactNode;
}) {
  return (
    <div className="flex items-baseline gap-2 whitespace-nowrap">
      <dt className="text-sm text-zinc-300">{rotulo}</dt>
      <dd>{children}</dd>
    </div>
  );
}
