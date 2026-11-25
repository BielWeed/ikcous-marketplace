// Caderno das guias: o que a lojista LANÇOU na categoria de impostos, mês a mês.
//
// Só lê o que ela lançou (a guia que o contador ou o banco mandou); não calcula imposto
// e não grava nada. Função pura: o "hoje" vem de fora, no calendário de São Paulo
// (`hojeEmSaoPaulo`), e as datas e o dinheiro usam as mesmas utilidades do Financeiro.
//
// Quem chama entrega SÓ os lançamentos da categoria de impostos (a consulta já filtra
// por categoria); aqui não se confere a categoria de novo.

import {
  ehDataIso,
  mesesDoIntervalo,
  paraCentavos,
  situacaoDoVencimento,
} from "@/lib/financeiro";
import type { Database } from "@/types/database.types";
import type { DataIso, IntervaloDeDatas } from "@/types/financeiro";

/** Só as colunas de `fin_lancamentos` que o caderno usa (o contrato segue o tipo do banco). */
export type LancamentoDaGuia = Pick<
  Database["public"]["Tables"]["fin_lancamentos"]["Row"],
  "valor" | "status" | "data_competencia" | "data_vencimento"
>;

/** Em que pé o mês está: sem guia lançada, a pagar no prazo, vencida ou paga. */
export type EstadoDoMes = "sem_guia" | "a_pagar" | "vencida" | "paga";

export interface MesDoCaderno {
  /** Mês de COMPETÊNCIA (das vendas), `AAAA-MM`. */
  readonly mes: string;
  /** Soma das guias vivas do mês (a pagar + paga). Cancelada não entra. */
  readonly guia: number;
  /** Parte já baixada (status realizado). */
  readonly pago: number;
  /** Parte ainda por pagar (status previsto). */
  readonly aPagar: number;
  readonly estado: EstadoDoMes;
}

interface Acumulado {
  guia: number;
  pago: number;
  aPagar: number;
  temGuia: boolean;
  /** Algum lançamento ainda previsto, mesmo que o valor seja zero. */
  temAberta: boolean;
  temVencida: boolean;
}

/**
 * @param periodo os meses que o caderno mostra. A guia entra pelo MÊS da competência,
 *   não pela data dentro do período: a competência da guia é o dia 1, então um período
 *   que começa no dia 15 ainda conta a guia desse mês. Guia de competência fora dos
 *   meses do período não aparece.
 * @param hoje o dia de hoje em São Paulo. Vencida = ainda a pagar e o vencimento é
 *   ANTERIOR a hoje (vencer hoje ainda não é atraso).
 */
export function montarCaderno(
  lancamentos: readonly LancamentoDaGuia[],
  periodo: IntervaloDeDatas,
  hoje: DataIso,
): MesDoCaderno[] {
  const meses = mesesDoIntervalo(periodo).map((m) => m.inicio.slice(0, 7));
  const porMes = new Map<string, Acumulado>(
    meses.map((mes) => [
      mes,
      {
        guia: 0,
        pago: 0,
        aPagar: 0,
        temGuia: false,
        temAberta: false,
        temVencida: false,
      },
    ]),
  );

  for (const l of lancamentos) {
    // Cancelado fica fora; status que não conhecemos também (não é guia, e tratar como
    // paga esconderia dinheiro a pagar).
    if (l.status !== "previsto" && l.status !== "realizado") continue;
    const dia =
      typeof l.data_competencia === "string"
        ? l.data_competencia.slice(0, 10)
        : "";
    if (!ehDataIso(dia)) continue; // data malformada não cai em mês nenhum
    const acumulado = porMes.get(dia.slice(0, 7));
    if (!acumulado) continue; // competência fora do período

    const centavos = paraCentavos(l.valor);
    acumulado.temGuia = true;
    acumulado.guia += centavos;
    if (l.status === "realizado") {
      acumulado.pago += centavos;
    } else {
      acumulado.aPagar += centavos;
      acumulado.temAberta = true;
      if (situacaoDoVencimento(l.data_vencimento, hoje) === "vencido") {
        acumulado.temVencida = true;
      }
    }
  }

  return meses.map((mes): MesDoCaderno => {
    const a = porMes.get(mes);
    // `meses` e `porMes` nascem juntos; o ramo só existe para o tipo.
    if (!a) return { mes, guia: 0, pago: 0, aPagar: 0, estado: "sem_guia" };
    return {
      mes,
      guia: a.guia / 100,
      pago: a.pago / 100,
      aPagar: a.aPagar / 100,
      estado: !a.temGuia
        ? "sem_guia"
        : a.temVencida
          ? "vencida"
          : a.temAberta
            ? "a_pagar"
            : "paga",
    };
  });
}
