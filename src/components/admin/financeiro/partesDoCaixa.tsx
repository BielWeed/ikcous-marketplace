// Peças visuais da aba Caixa (desenho aprovado de 22/10/2026): cartão da
// gaveta, linhas da conta do esperado, pílulas de situação e as medidas dos
// valores. Só desenho: o esperado, a quebra e a sobra vêm das mesmas contas
// de sempre (`fin_caixa_atual` + `diferencaDoFechamento`).

import type { ReactNode } from "react";

import {
  formatarDataCurta,
  formatarDataHora,
  formatarHora,
  hojeEmSaoPaulo,
  paraCentavos,
} from "@/lib/financeiro";
import {
  type TomDeEstado,
  classeDoTexto,
  tomDoValor,
} from "@/lib/tons-de-estado";
import { cn } from "@/lib/utils";
import {
  CLASSE_BOTAO_PRIMARIO,
  Dinheiro,
  useValoresEstaoOcultos,
} from "./partes";
import { classeDoValorGrande, comprimentoDoValor } from "./tamanhoDoValor";

// ---------------------------------------------------------------------------
// Superfícies e botões
// ---------------------------------------------------------------------------

/** Cartão do caixa: mesma superfície dos `CartaoSecao`, com respiro maior. */
export const CLASSE_CARTAO_DO_CAIXA =
  "min-w-0 rounded-3xl border border-admin-border bg-admin-surface p-5";

/** Rótulo pequeno em caixa alta (igual ao dos cartões da Visão). */
export const CLASSE_ROTULO_CAIXA_ALTA =
  "text-xs font-semibold uppercase tracking-wide text-zinc-400";

/**
 * Botão secundário da gaveta. `border-solid` explícito: o index.css zera a
 * borda de todo `<button>`. 48px de altura (alvo de toque ≥ 44px).
 */
export const CLASSE_BOTAO_DA_GAVETA =
  "inline-flex min-h-12 items-center justify-center rounded-2xl border border-solid border-admin-border bg-admin-raised px-3 py-2.5 text-center text-sm font-medium leading-tight text-white transition-colors hover:bg-admin-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300 active:scale-[0.98]";

/** Botão principal da gaveta: o primário neutro da casca, com a mesma altura. */
export const CLASSE_BOTAO_PRINCIPAL_DA_GAVETA = cn(
  CLASSE_BOTAO_PRIMARIO,
  "min-h-12 px-3 py-2.5 leading-tight",
);

// ---------------------------------------------------------------------------
// Medidas dos valores (dinheiro NUNCA quebra de linha)
// ---------------------------------------------------------------------------

const FAIXAS_DA_COLUNA: readonly (readonly [number, string])[] = [
  [9, "text-base"],
  [10, "text-[15px]"],
  [11, "text-[13px]"],
  [12, "text-xs"],
  [13, "text-[11px]"],
];

/**
 * Valor de uma das três colunas do histórico (≈83px de largura a 338px de
 * tela): nunca quebra, e é a letra que encolhe conforme o texto cresce, até o
 * piso de 11px da régua visual do painel (acima de R$ 1 milhão a coluna aperta).
 */
export function classeDoValorNaColuna(
  valor: number,
  comSinal: boolean,
  ocultos: boolean,
): string {
  const n = comprimentoDoValor(valor, comSinal, ocultos);
  const faixa = FAIXAS_DA_COLUNA.find(([ate]) => n <= ate);
  return cn(
    "whitespace-nowrap font-bold leading-tight",
    faixa?.[1] ?? "text-[11px]",
  );
}

const FAIXAS_DA_LINHA: readonly (readonly [number, string])[] = [
  [11, "text-base"],
  [13, "text-sm"],
];

/** Valor de uma linha com o rótulo ao lado (conta do esperado, movimentos). */
export function classeDoValorDaLinha(
  valor: number,
  comSinal: boolean,
  ocultos: boolean,
): string {
  const n = comprimentoDoValor(valor, comSinal, ocultos);
  const faixa = FAIXAS_DA_LINHA.find(([ate]) => n <= ate);
  return cn(
    "shrink-0 whitespace-nowrap font-semibold leading-tight",
    faixa?.[1] ?? "text-xs",
  );
}

/** Valor do cartão principal: largura cheia, encolhe só quando muito longo. */
export function classeDoValorDoHeroi(valor: number, ocultos: boolean): string {
  return classeDoValorGrande(comprimentoDoValor(valor, false, ocultos));
}

// ---------------------------------------------------------------------------
// Instantes (hora da loja)
// ---------------------------------------------------------------------------

/** "26/09" e "09:12" de um instante; `null` quando a data não se lê. */
function partesDoInstante(
  instante: string | null | undefined,
): { readonly dia: string; readonly hora: string } | null {
  const [dia, hora] = formatarDataHora(instante).split(/,?\s+/);
  return dia && hora ? { dia, hora } : null;
}

/** Só a hora se foi hoje; senão dia e hora (o caixa pode passar da meia-noite). */
export function quandoCurto(instante: string | null | undefined): string {
  const partes = partesDoInstante(instante);
  if (!partes) return "—";
  return partes.dia === formatarDataCurta(hojeEmSaoPaulo())
    ? formatarHora(instante)
    : `${partes.dia}, ${partes.hora}`;
}

/** "21/10 · 08:00 – 18:30" (ou com a data do fim, se virou o dia). */
export function periodoDaSessao(
  abertoEm: string,
  fechadoEm: string | null,
): string {
  const abertura = partesDoInstante(abertoEm);
  if (!abertura) return "—";
  const inicio = `${abertura.dia} · ${abertura.hora}`;
  if (!fechadoEm) return `${inicio} – em aberto`;
  const fim = partesDoInstante(fechadoEm);
  if (!fim) return inicio;
  return fim.dia === abertura.dia
    ? `${inicio} – ${fim.hora}`
    : `${inicio} – ${fim.dia} · ${fim.hora}`;
}

// ---------------------------------------------------------------------------
// Pílula de situação
// ---------------------------------------------------------------------------

const FUNDO_DA_PILULA: Record<TomDeEstado, string> = {
  positivo: "bg-emerald-400/10",
  negativo: "bg-red-400/10",
  atencao: "bg-amber-400/10",
  info: "bg-sky-400/10",
  neutro: "bg-white/5",
};

/**
 * Pílula de situação ("Aberto", "Bateu", "Quebra −R$ 5,00"): cor só quando
 * significa algo — verde = ok, vermelho = quebra, âmbar = sobra, cinza = nada.
 * O texto sempre diz a situação, então a cor nunca é a única pista.
 */
export function Pilula({
  tom = "neutro",
  children,
  className,
}: {
  readonly tom?: TomDeEstado;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return (
    <span
      data-pilula={tom}
      className={cn(
        "inline-flex w-fit max-w-full shrink-0 items-center gap-1 whitespace-nowrap rounded-full px-3 py-1 text-xs font-bold",
        FUNDO_DA_PILULA[tom],
        classeDoTexto(tom),
        className,
      )}
    >
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Linha da conta do esperado
// ---------------------------------------------------------------------------

/**
 * Uma linha de "Como o esperado é calculado". `sentido` diz se a linha soma
 * (+1) ou tira (−1): verde entra, vermelho sai, cinza no zero. Sem `sentido`
 * (abertura/troco) o valor é neutro. `total`: a linha do esperado.
 */
export function LinhaDaConta({
  rotulo,
  valor,
  sentido,
  total = false,
}: {
  readonly rotulo: string;
  readonly valor: number;
  readonly sentido?: 1 | -1;
  readonly total?: boolean;
}) {
  const ocultos = useValoresEstaoOcultos();
  const centavos = paraCentavos(valor);
  const comSinal = sentido !== undefined && centavos !== 0;
  const tom =
    sentido === undefined
      ? total && centavos < 0
        ? "negativo"
        : null
      : tomDoValor(centavos * sentido);
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-3 border-t border-admin-border py-3 first:border-t-0 first:pt-0",
        total && "border-admin-border-strong pb-0 pt-4",
      )}
    >
      <dt
        className={cn(
          "min-w-0 break-words",
          total ? "text-base font-bold text-white" : "text-sm text-zinc-400",
        )}
      >
        {rotulo}
      </dt>
      <dd
        className={cn(
          classeDoValorDaLinha(valor, comSinal, ocultos),
          total && "font-bold",
          tom ? classeDoTexto(tom) : "text-white",
        )}
      >
        <Dinheiro
          valor={valor}
          sentido={sentido}
          className="whitespace-nowrap"
        />
      </dd>
    </div>
  );
}
