// Comparação "estimativa do app x guia lançada": o quanto a estimativa costuma errar para
// cima ou para baixo em relação à guia de verdade. É o que ensina a lojista a confiar (ou
// não) na estimativa.
//
// Só LÊ: recebe números já prontos e devolve um percentual e uma frase. Não grava nada
// e não fala com o banco (o teste confere o texto do arquivo). Função pura: sem rede,
// relógio nem React.
//
// REGRAS:
//   - só entram os meses que têm AS DUAS coisas: a estimativa e a guia lançada. Mês sem
//     uma delas não é "zero", é "não sabemos", e fica fora da conta e da contagem;
//   - guia igual a zero (o caderno devolve 0 para "sem guia lançada") não entra: dividir
//     por ela não tem sentido. Guia negativa, número que não é número e mês que não é
//     `aaaa-mm` também ficam de fora;
//   - vale a janela dos 3 meses MAIS RECENTES entre os que entram, não os 3 últimos do
//     calendário: um mês sem guia não "gasta" uma vaga da janela;
//   - o percentual é a MÉDIA dos percentuais de cada mês (cada mês pesa igual). A razão
//     entre as somas deixaria um mês grande esconder um mês pequeno;
//   - mês repetido na lista é ambíguo (qual valor vale?), então sai da conta em vez de a
//     função escolher um deles em silêncio. Quem monta a lista tem um item por mês.

import { paraCentavos } from "@/lib/financeiro";

/** Quantos meses (os mais recentes, entre os que têm as duas coisas) entram na média. */
export const MESES_DA_COMPARACAO = 3;

export interface MesParaComparar {
  /** O mês da competência (das vendas), `aaaa-mm`. */
  readonly mes: string;
  /** A estimativa do app em reais, já arredondada. `null` = o app não estimou este mês. */
  readonly estimativa: number | null;
  /** O valor da guia lançada em reais. `null` ou 0 = sem guia lançada. */
  readonly guia: number | null;
}

export type SentidoDaComparacao = "acima" | "abaixo" | "igual";

export interface ComparacaoDaEstimativa {
  /**
   * Percentual médio, inteiro, COM sinal: positivo = a estimativa ficou acima da guia,
   * negativo = abaixo. `0` quando arredonda para zero (e nunca `-0`).
   */
  readonly percentual: number;
  readonly sentido: SentidoDaComparacao;
  /** Quantos meses entraram na média (de 1 a `MESES_DA_COMPARACAO`). */
  readonly meses: number;
  /** A frase pronta, em português simples. */
  readonly frase: string;
}

const MES_VALIDO = /^\d{4}-(0[1-9]|1[0-2])$/;

interface MesCompleto {
  readonly mes: string;
  readonly estimativaEmCentavos: number;
  readonly guiaEmCentavos: number;
}

/** Os dois valores como centavos inteiros, ou `null` se o mês não tem as duas coisas de forma utilizável. */
function mesCompleto(item: MesParaComparar): MesCompleto | null {
  if (!MES_VALIDO.test(item.mes)) return null;
  const { estimativa, guia } = item;
  if (estimativa === null || guia === null) return null;
  if (!Number.isFinite(estimativa) || !Number.isFinite(guia)) return null;
  const estimativaEmCentavos = paraCentavos(estimativa);
  const guiaEmCentavos = paraCentavos(guia);
  // Estimativa 0 é um resultado de verdade (mês sem receita): vale. Guia 0 não: não divide.
  if (estimativaEmCentavos < 0 || guiaEmCentavos <= 0) return null;
  return { mes: item.mes, estimativaEmCentavos, guiaEmCentavos };
}

function fraseDaComparacao(
  meses: number,
  sentido: SentidoDaComparacao,
  percentualSemSinal: number,
): string {
  // "guias lançadas", não "meses": os meses da janela podem ter buracos no calendário
  // (achado 1 da revisão Opus, 24/11/2026) e a frase não pode prometer meses seguidos.
  const quando =
    meses === 1
      ? "Na última guia lançada,"
      : `Nas ${meses} últimas guias lançadas,`;
  const quanto =
    sentido === "igual"
      ? "praticamente igual à guia"
      : `${percentualSemSinal}% ${sentido} da guia`;
  return `${quando} a estimativa do app ficou ${quanto}.`;
}

/**
 * A comparação dos últimos meses que têm estimativa E guia, ou `null` quando nenhum mês
 * tem as duas (nesse caso a tela não mostra frase nenhuma).
 */
export function compararEstimativaComGuia(
  meses: readonly MesParaComparar[],
): ComparacaoDaEstimativa | null {
  const vezesQueOMesApareceu = new Map<string, number>();
  for (const { mes } of meses) {
    vezesQueOMesApareceu.set(mes, (vezesQueOMesApareceu.get(mes) ?? 0) + 1);
  }

  const completos: MesCompleto[] = [];
  for (const item of meses) {
    if ((vezesQueOMesApareceu.get(item.mes) ?? 0) > 1) continue;
    const completo = mesCompleto(item);
    if (completo) completos.push(completo);
  }

  // `aaaa-mm` em ordem de texto é ordem de calendário: do mais antigo ao mais novo.
  completos.sort((a, b) => (a.mes < b.mes ? -1 : a.mes > b.mes ? 1 : 0));
  const daJanela = completos.slice(-MESES_DA_COMPARACAO);
  if (daJanela.length === 0) return null;

  let somaDasRazoes = 0;
  for (const m of daJanela) {
    somaDasRazoes +=
      (m.estimativaEmCentavos - m.guiaEmCentavos) / m.guiaEmCentavos;
  }
  const mediaEmPercentual = (somaDasRazoes / daJanela.length) * 100;

  // `toFixed` tira o ruído de ponto flutuante (18,4999999 que era 18,5) antes de arredondar;
  // o arredondamento é sobre o valor SEM sinal, para +2,5 e -2,5 darem 3 dos dois lados.
  const semSinal = Math.round(Number(Math.abs(mediaEmPercentual).toFixed(6)));
  const sentido: SentidoDaComparacao =
    semSinal === 0 ? "igual" : mediaEmPercentual > 0 ? "acima" : "abaixo";

  return {
    percentual:
      sentido === "igual" ? 0 : sentido === "acima" ? semSinal : -semSinal,
    sentido,
    meses: daJanela.length,
    frase: fraseDaComparacao(daJanela.length, sentido, semSinal),
  };
}
