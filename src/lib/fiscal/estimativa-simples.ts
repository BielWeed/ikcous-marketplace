// Estimativa do DAS do mês para quem é Simples Nacional + SÓ comércio (Anexo I).
//
// É uma ESTIMATIVA: aparece só na tela, arredondada, com o aviso fixo (que mora na tela,
// não aqui). NUNCA é gravada: este módulo não importa nada que grave lançamento nem que
// fale com o banco (o teste confere o texto do arquivo).
//
// Função pura (sem rede, relógio ou React). Regras de 2026, conferidas em fonte oficial em
// 24/11/2026 (docs/fiscal/2026-11-24-parametros-conferidos.md, itens L6 a L10):
//   - alíquota efetiva = (RBT12 x alíquota nominal - parcela a deduzir) / RBT12, com a
//     faixa escolhida pela RBT12 (receita bruta dos 12 meses anteriores ao mês);
//   - DAS do mês = alíquota efetiva x receita do mês;
//   - RBT12 igual a zero conta como R$ 1,00;
//   - empresa com menos de 12 meses de atividade: no 1º mês, RBT12 = receita do mês x 12;
//     do 2º ao 12º, média da receita dos meses anteriores x 12; do 13º em diante, a regra
//     geral;
//   - acima do sublimite de R$ 3,6 mi o ICMS sai do DAS e a conta do Anexo I deixa de
//     valer; acima do teto de R$ 4,8 mi a empresa sai do Simples. Nos dois casos, sem estimativa.
//
// A REGRA DE OURO: nunca estimar com série incompleta. O app só mede os meses em que a loja
// vendeu por ele (`vendeNoAppDesde`). Mês que não está na série, mês anterior ao início das
// vendas no app e valor que não é número são meses NÃO MEDIDOS, e a leitura que devolve
// "0" para eles não os transforma em "vendeu zero". Faltou mês: `faltam_meses`.
//
// Ano sem parâmetro conferido (qualquer um além de 2026) não calcula nada.
//
// O QUE ESTA ESTIMATIVA NÃO MODELA (por isso é "cerca de"): cancelamento de nota em mês
// posterior (a regra manda deduzir no mês original), saldo de devolução que passa da
// receita do mês e vira dedução nos meses seguintes (aqui o mês negativo vale zero), regime
// de caixa x competência, a opção de quem começou a empresa antes da opção pelo Simples, e
// a redução do DAS sobre produtos com imposto já recolhido (substituição tributária ou
// monofásico), que costuma deixar o DAS real MENOR que a estimativa.
//
// Dinheiro entra em reais e a conta é exata: centavos inteiros e BigInt na multiplicação
// final (receita do mês x RBT12 x alíquota passa de 2^53), para a metade de uma dezena
// (R$ 405,00) subir sempre, sem erro de ponto flutuante.

import { ehDataIso, paraCentavos } from "@/lib/financeiro";
import {
  type CadastroFiscal,
  type MotivoSemConta,
  quemTemConta,
} from "@/lib/fiscal/cadastro";
import {
  type FaixaDoAnexoI,
  type ParametrosConferidos,
  parametrosDoAno,
} from "@/lib/fiscal/parametros-da-lei";

export interface EntradaDaEstimativa {
  /** Regime e atividade vêm só daqui; a data de abertura e o início das vendas no app também. */
  readonly cadastro: Pick<
    CadastroFiscal,
    "regime" | "atividade" | "abertaEm" | "vendeNoAppDesde"
  >;
  /** O mês das vendas (`yyyy-mm`); o DAS vence no mês seguinte. */
  readonly competencia: string;
  /** Receita bruta do mês da competência, em reais (vendas menos devoluções; abaixo de zero vale zero). */
  readonly receitaDoMes: number;
  /**
   * Receita de cada mês JÁ MEDIDO pelo app (`yyyy-mm` -> reais). Mês ausente = não medido;
   * mês presente com 0 = vendeu zero. Meses anteriores a `vendeNoAppDesde` são ignorados
   * mesmo se vierem aqui.
   */
  readonly receitasMensais: Readonly<Record<string, number>>;
}

export type MotivoSemEstimativa =
  | MotivoSemConta
  | "mei"
  | "competencia_invalida"
  | "ano_nao_conferido"
  | "receita_invalida"
  | "sem_mes_de_inicio_das_vendas"
  | "abertura_invalida"
  | "competencia_antes_da_abertura"
  | "mes_antes_das_vendas_no_app"
  | "faltam_meses"
  | "acima_do_sublimite"
  | "acima_do_teto";

export type EstimativaDoSimples =
  | {
      readonly estado: "com_estimativa";
      /** Reais, arredondado para a dezena (410), sem centavos. */
      readonly valor: number;
    }
  | {
      readonly estado: "sem_estimativa";
      readonly motivo: "faltam_meses";
      /** Quantos meses de venda medida faltam para fechar a conta. */
      readonly faltam: number;
    }
  | {
      readonly estado: "sem_estimativa";
      readonly motivo: Exclude<MotivoSemEstimativa, "faltam_meses">;
    };

type ParametrosDoSimples = ParametrosConferidos["simples"];

const semEstimativa = (
  motivo: Exclude<MotivoSemEstimativa, "faltam_meses">,
): EstimativaDoSimples => ({ estado: "sem_estimativa", motivo });

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

/** `yyyy-mm` (ou data que comece assim) como número de meses desde o ano 0: dá para subtrair. */
const indiceDoMes = (texto: string): number =>
  Number(texto.slice(0, 4)) * 12 + Number(texto.slice(5, 7)) - 1;

const chaveDoMes = (indice: number): string =>
  `${Math.floor(indice / 12)}-${String((indice % 12) + 1).padStart(2, "0")}`;

/**
 * A faixa do Anexo I (e a posição dela, 1 = primeira) para uma RBT12 de
 * `numerador / denominador` centavos, ou `null` se passa da última faixa. A fronteira é
 * inclusiva ("até R$ 180.000,00"). Comparação em inteiros: nunca divide.
 */
function acharFaixa(
  numerador: number,
  denominador: number,
  faixas: ParametrosDoSimples["anexoI"],
): { posicao: number; faixa: FaixaDoAnexoI } | null {
  for (const [indice, faixa] of faixas.entries()) {
    if (numerador <= paraCentavos(faixa.ate) * denominador) {
      return { posicao: indice + 1, faixa };
    }
  }
  return null;
}

/**
 * A faixa (1 = primeira) e a alíquota efetiva, em pontos percentuais (5,32 = 5,32%), do
 * Anexo I para uma RBT12 em reais. RBT12 zero (ou negativa) conta como R$ 1,00. `null` se
 * a RBT12 passa da última faixa (teto do Simples). Serve à tela para explicar a conta e ao
 * teste para provar cada fronteira; o DAS em si é calculado em aritmética exata mais abaixo.
 */
export function aliquotaEfetivaDoAnexoI(
  rbt12: number,
  simples: ParametrosDoSimples,
): { faixa: number; aliquotaEfetivaPercentual: number } | null {
  const centavos = paraCentavos(rbt12);
  const base = centavos > 0 ? centavos : paraCentavos(simples.rbt12QuandoZero);
  const achada = acharFaixa(base, 1, simples.anexoI);
  if (!achada) return null;
  const { posicao, faixa } = achada;
  const reais = base / 100;
  const efetiva = (reais * (faixa.aliquota / 100) - faixa.deduzir) / reais;
  return { faixa: posicao, aliquotaEfetivaPercentual: efetiva * 100 };
}

/**
 * DAS do mês, em reais e arredondado para a dezena (metade para cima), da receita do mês
 * `mesEmCentavos` com RBT12 = `numerador / denominador` centavos (a média da empresa nova
 * é uma fração; o denominador some na conta final).
 *
 * Tudo em centavos: R = n/d (RBT12), A = alíquota em centésimos de ponto percentual
 * (7,30% = 730) e PD = parcela a deduzir. Então
 *   efetiva = (R x A/10000 - PD) / R = (n x A - 10000 x PD x d) / (10000 x n)
 * e o DAS é o mês multiplicado por isso (o `d` cancela).
 */
function dasDaFaixaEmDezenas(
  mesEmCentavos: number,
  numerador: number,
  denominador: number,
  aliquota: number,
  deduzir: number,
): number {
  const centesimosDePonto = BigInt(Math.round(aliquota * 100));
  const n = BigInt(numerador);
  const d = BigInt(denominador);
  const pd = BigInt(paraCentavos(deduzir));
  const num =
    BigInt(mesEmCentavos) * (n * centesimosDePonto - 10_000n * pd * d);
  const den = 10_000n * n;
  // num/den são centavos. Dezena de reais = 1.000 centavos; metade para cima:
  // floor(X / 1000 + 1/2) = floor((2 x num + 1000 x den) / (2000 x den)).
  const dezenas = (2n * num + 1_000n * den) / (2_000n * den);
  return Number(dezenas) * 10;
}

/** Quantos dos meses `de..ate` (índices, inclusive) o app NÃO mediu, e a soma dos que mediu, em centavos. */
function lerMesesMedidos(
  de: number,
  ate: number,
  receitas: ReadonlyMap<string, number>,
  inicioDasVendas: string,
): { faltam: number; somaEmCentavos: number } {
  let faltam = 0;
  let somaEmCentavos = 0;
  for (let i = de; i <= ate; i += 1) {
    const chave = chaveDoMes(i);
    const valor = receitas.get(chave);
    if (
      chave < inicioDasVendas ||
      typeof valor !== "number" ||
      !Number.isFinite(valor)
    ) {
      faltam += 1;
    } else {
      // Mês com devolução maior que a venda vale zero, nunca abate a RBT12.
      somaEmCentavos += Math.max(0, paraCentavos(valor));
    }
  }
  return { faltam, somaEmCentavos };
}

export function estimarDasDoSimples(
  entrada: EntradaDaEstimativa,
): EstimativaDoSimples {
  const conta = quemTemConta(entrada.cadastro);
  if (conta.tipo === "mei") return semEstimativa("mei");
  if (conta.tipo === "nenhuma") return semEstimativa(conta.motivo);

  if (!COMPETENCIA.test(entrada.competencia)) {
    return semEstimativa("competencia_invalida");
  }
  const parametros = parametrosDoAno(Number(entrada.competencia.slice(0, 4)));
  if (!parametros.conferido) return semEstimativa("ano_nao_conferido");
  if (!Number.isFinite(entrada.receitaDoMes)) {
    return semEstimativa("receita_invalida");
  }

  // Sem saber desde quando o app mede, uma série cheia de zeros não prova nada.
  const { vendeNoAppDesde, abertaEm } = entrada.cadastro;
  if (vendeNoAppDesde === null || !ehDataIso(vendeNoAppDesde)) {
    return semEstimativa("sem_mes_de_inicio_das_vendas");
  }
  if (abertaEm !== null && !ehDataIso(abertaEm)) {
    return semEstimativa("abertura_invalida");
  }

  const { simples } = parametros;
  const mesDaApuracao = indiceDoMes(entrada.competencia);
  // k = qual mês de atividade é a competência (1 = o mês da abertura, inteiro).
  const k =
    abertaEm === null ? null : mesDaApuracao - indiceDoMes(abertaEm) + 1;
  if (k !== null && k < 1)
    return semEstimativa("competencia_antes_da_abertura");

  const inicioDasVendas = vendeNoAppDesde.slice(0, 7);
  if (entrada.competencia < inicioDasVendas) {
    return semEstimativa("mes_antes_das_vendas_no_app");
  }

  const mesEmCentavos = Math.max(0, paraCentavos(entrada.receitaDoMes));
  // Mapa e não `receitasMensais[chave]`: a série vem de fora, e assim um mês nunca
  // "acha" uma propriedade herdada do objeto.
  const receitas = new Map(Object.entries(entrada.receitasMensais));

  // RBT12 como fração numerador/denominador, em centavos.
  let numerador: number;
  let denominador = 1;
  if (k !== null && k <= simples.mesesDaRbt12) {
    // L8: empresa com menos de 12 meses de atividade.
    if (k === 1) {
      numerador = mesEmCentavos * simples.mesesDaRbt12;
    } else {
      const lidos = lerMesesMedidos(
        mesDaApuracao - (k - 1),
        mesDaApuracao - 1,
        receitas,
        inicioDasVendas,
      );
      if (lidos.faltam > 0) {
        return {
          estado: "sem_estimativa",
          motivo: "faltam_meses",
          faltam: lidos.faltam,
        };
      }
      numerador = lidos.somaEmCentavos * simples.mesesDaRbt12;
      denominador = k - 1;
    }
  } else {
    // L7: regra geral, os 12 meses anteriores ao mês, todos medidos.
    const lidos = lerMesesMedidos(
      mesDaApuracao - simples.mesesDaRbt12,
      mesDaApuracao - 1,
      receitas,
      inicioDasVendas,
    );
    if (lidos.faltam > 0) {
      return {
        estado: "sem_estimativa",
        motivo: "faltam_meses",
        faltam: lidos.faltam,
      };
    }
    numerador = lidos.somaEmCentavos;
  }
  if (numerador === 0) {
    // RBT12 zero conta como R$ 1,00 (Resolução CGSN 140/2018, art. 21, parágrafo único).
    numerador = paraCentavos(simples.rbt12QuandoZero);
    denominador = 1;
  }

  if (numerador > paraCentavos(simples.tetoSimples) * denominador) {
    return semEstimativa("acima_do_teto");
  }
  if (numerador > paraCentavos(simples.sublimite) * denominador) {
    return semEstimativa("acima_do_sublimite");
  }
  const achada = acharFaixa(numerador, denominador, simples.anexoI);
  // Não acontece (o teto é a última faixa), mas sem faixa nunca se inventa alíquota.
  if (!achada) return semEstimativa("acima_do_teto");

  return {
    estado: "com_estimativa",
    valor: dasDaFaixaEmDezenas(
      mesEmCentavos,
      numerador,
      denominador,
      achada.faixa.aliquota,
      achada.faixa.deduzir,
    ),
  };
}
