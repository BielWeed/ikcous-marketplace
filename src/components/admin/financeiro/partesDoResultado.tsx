// Peças visuais da aba Resultado (a demonstração do resultado). Só desenho:
// valores, sinais e percentuais vêm de `src/lib/financeiro.ts` e da `fin_dre`.
// Tudo que mostra dinheiro passa por <Dinheiro> (o botão Ocultar depende dele).

import { Skeleton } from "@/components/ui/skeleton";
import { formatarBRL } from "@/lib/financeiro";
import { classeDoTexto, tomDoValor } from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import type { ReactNode } from "react";
import {
  CLASSE_CASCA_DO_CARTAO,
  CLASSE_ROTULO_DO_CARTAO,
  Dinheiro,
} from "./partes";

/** Frase curta que aparece nos quadros e na linha do custo. */
export const AVISO_CURTO_DE_CUSTO_ESTIMADO = "Inclui estimativa de custo";

/** A explicação inteira, escrita uma vez embaixo do resultado. */
export const AVISO_CUSTO_ESTIMADO =
  "Inclui estimativa: usa o custo de hoje do produto, ou R$ 0 se ele não tem custo cadastrado";

/**
 * Cor do valor pelo sinal: verde positivo, vermelho negativo, cinza no zero.
 * O arredondamento em centavos evita "verde" para uma sobra de 0,0000001.
 */
export function corDoResultado(valor: number): string {
  return classeDoTexto(tomDoValor(Math.round(valor * 100)));
}

/** Número de caracteres do valor como a tela o escreve (com sinal, se houver). */
function comprimentoDoValor(valor: number): number {
  return formatarBRL(valor).length + (valor < 0 ? 1 : 0);
}

/**
 * Valor em dinheiro NUNCA quebra de linha (`whitespace-nowrap`): quem se ajusta
 * é o tamanho da letra, pelo número de caracteres do texto já formatado.
 * Faixas das metades da tela de 338px (as mesmas medidas da Visão): 22px
 * normal, 20px, 18px quando longo, e daí para baixo.
 */
const TAMANHOS_DO_VALOR_NO_QUADRO: readonly (readonly [number, string])[] = [
  [8, "text-[22px] leading-tight"],
  [9, "text-[20px] leading-tight"],
  [10, "text-[18px] leading-tight"],
  [12, "text-[15px] leading-tight"],
  [14, "text-[13px] leading-tight"],
];

export function classeDoValorDoQuadro(valor: number): string {
  const n = comprimentoDoValor(valor);
  const faixa = TAMANHOS_DO_VALOR_NO_QUADRO.find(([ate]) => n <= ate);
  return cn(
    "whitespace-nowrap font-bold tracking-tight",
    faixa?.[1] ?? "text-xs leading-tight",
  );
}

/** Valor na coluna da tabela: 14px; menor só quando o texto é muito longo. */
export function classeDoValorNaTabela(valor: number, destaque = false): string {
  const n = comprimentoDoValor(valor);
  const normal = destaque ? "text-base" : "text-sm";
  const medio = destaque ? "text-sm" : "text-[13px]";
  return cn(
    "whitespace-nowrap tabular-nums",
    n <= 11 ? normal : n <= 13 ? medio : "text-xs",
  );
}

/** Selo âmbar do custo estimado: a explicação inteira fica no `title`. */
export function AvisoDeCustoEstimado() {
  return (
    <span
      data-aviso-de-estimativa=""
      title={AVISO_CUSTO_ESTIMADO}
      className={cn(
        "inline-flex w-fit max-w-full items-center rounded-full bg-amber-400/10 px-2.5 py-1 text-xs font-bold leading-tight",
        classeDoTexto("atencao"),
      )}
    >
      {AVISO_CURTO_DE_CUSTO_ESTIMADO}
    </span>
  );
}

/**
 * Quadro de um número do resultado: rótulo, valor grande (cor pelo sinal),
 * um detalhe em cinza e, se couber, o selo de estimativa.
 */
export function QuadroDoResultado({
  rotulo,
  valor,
  detalhe,
  comAviso = false,
  neutro = false,
}: {
  readonly rotulo: string;
  readonly valor: number;
  readonly detalhe?: ReactNode;
  readonly comAviso?: boolean;
  /** Número-base (não é resultado): fica em texto comum, sem cor de sinal. */
  readonly neutro?: boolean;
}) {
  return (
    <div
      data-quadro-do-resultado=""
      className={cn(
        "flex min-w-0 flex-col gap-2 p-3.5",
        CLASSE_CASCA_DO_CARTAO,
      )}
    >
      <span
        data-rotulo-do-kpi=""
        className={cn("min-w-0 break-words", CLASSE_ROTULO_DO_CARTAO)}
      >
        {rotulo}
      </span>
      <div className="min-w-0">
        <Dinheiro
          valor={valor}
          className={cn(
            classeDoValorDoQuadro(valor),
            neutro ? "text-white" : corDoResultado(valor),
          )}
        />
      </div>
      {detalhe ? (
        <div className="min-w-0 text-xs font-medium leading-tight text-zinc-400">
          {detalhe}
        </div>
      ) : null}
      {comAviso ? <AvisoDeCustoEstimado /> : null}
    </div>
  );
}

/** Esqueleto com a mesma pegada da tela pronta (sem salto de layout). */
export function EsqueletoDoResultado() {
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-[7.5rem] rounded-2xl bg-white/5" />
        ))}
      </div>
      <Skeleton className="h-[34rem] rounded-3xl bg-white/5" />
    </div>
  );
}
