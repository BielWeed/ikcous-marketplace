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
//   - POUCOS MESES DE VENDAS NO APP (decisão do sócio, 25/11/2026): quando o app mediu só
//     parte dos meses que a regra pede (a loja começou a usar o app há pouco, e antes disso
//     vendia por fora), a estimativa sai a partir de 1 mês medido ANTES da competência (ou
//     seja, a partir do SEGUNDO mês de vendas), com a RBT12 deduzida pela média desses meses
//     x 12 (a mesma conta da empresa nova). Com 0 meses medidos (a competência é o próprio
//     mês em que o app começou a vender) não há estimativa. O resultado carrega
//     `mesesNaMedia`, e a tela diz "de N meses de vendas" ("1 mês", no singular). Se a loja
//     vendia muito por fora, a faixa deduzida fica baixa e a estimativa pode ficar ABAIXO da
//     guia: é o lado do erro, e a tela avisa.
//   - acima do sublimite de R$ 3,6 mi o ICMS sai do DAS e a conta do Anexo I deixa de
//     valer; acima do teto de R$ 4,8 mi a empresa sai do Simples. Nos dois casos, sem estimativa.
//
// A REGRA DE OURO: nunca estimar com série furada. O app só mede os meses em que a loja
// vendeu por ele (`vendeNoAppDesde`). Mês anterior ao início das vendas no app é mês NÃO
// MEDIDO: a leitura que devolve "0" para ele não o transforma em "vendeu zero", e ele nunca
// entra na conta (nem na soma, nem na contagem de meses). Já mês que o app DEVIA ter medido
// (do início das vendas em diante) e que não está na série, ou veio com valor que não é
// número, é buraco: `faltam_meses`, e nunca se estima por cima dele.
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
      /**
       * SÓ quando a RBT12 foi deduzida pela média de poucos meses medidos pelo app (menos
       * dos que a regra pede): de quantos meses ela saiu (sempre 1 ou mais). Ausente = a
       * conta usou todos os meses que a regra pede.
       */
      readonly mesesNaMedia?: number;
    }
  | {
      readonly estado: "sem_estimativa";
      readonly motivo: "faltam_meses";
      /**
       * Quantos meses de venda medida faltam: para completar o 1 mês que a estimativa pede
       * (0 meses medidos), ou os meses que a série não trouxe (buraco).
       */
      readonly faltam: number;
    }
  | {
      readonly estado: "sem_estimativa";
      readonly motivo: "acima_do_sublimite" | "acima_do_teto";
      /**
       * SÓ quando a RBT12 que passou do limite é PROJEÇÃO (média dos meses medidos x 12, ou
       * o 1º mês de atividade x 12), e não a soma de 12 meses medidos: a tela não pode dizer
       * "as vendas dos últimos 12 meses". Ausente = a soma de 12 meses de verdade.
       */
      readonly projecao?: true;
    }
  | {
      readonly estado: "sem_estimativa";
      readonly motivo: Exclude<
        MotivoSemEstimativa,
        "faltam_meses" | "acima_do_sublimite" | "acima_do_teto"
      >;
    };

type ParametrosDoSimples = ParametrosConferidos["simples"];

const semEstimativa = (
  motivo: Exclude<MotivoSemEstimativa, "faltam_meses">,
): EstimativaDoSimples => ({ estado: "sem_estimativa", motivo });

/** Acima do sublimite ou do teto, com a marca de projeção só quando a RBT12 é projeção. */
const acimaDoLimite = (
  motivo: "acima_do_sublimite" | "acima_do_teto",
  projecao: boolean,
): EstimativaDoSimples =>
  projecao
    ? { estado: "sem_estimativa", motivo, projecao: true }
    : { estado: "sem_estimativa", motivo };

const COMPETENCIA = /^\d{4}-(0[1-9]|1[0-2])$/;

/**
 * Menos que isto de meses medidos ANTES da competência e não há de onde tirar a média: sem
 * estimativa. 1 mês medido já estima = a estimativa começa no SEGUNDO mês de vendas (decisão
 * do sócio, 25/11/2026). Anda junto com `MENOS_MESES_DA_MEDIA` (textos.ts), que guarda a base
 * que a tela aceita descrever, e com o texto de recusa de SemEstimativa.tsx.
 */
const MESES_MINIMOS_MEDIDOS = 1;

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

interface JanelaLida {
  /** Meses da janela anteriores ao início das vendas no app: não medidos, fora da conta. */
  readonly antesDoApp: number;
  /** Meses medidos (do início das vendas em diante) que a série trouxe com número de verdade. */
  readonly medidos: number;
  /** Meses medidos que a série NÃO trouxe, ou trouxe com valor que não é número. */
  readonly buracos: number;
  /** Soma dos meses medidos, em centavos (mês negativo vale zero). */
  readonly somaEmCentavos: number;
}

/** Lê os meses `de..ate` (índices, inclusive): quais o app mediu, quais faltam e quanto somam. */
function lerJanela(
  de: number,
  ate: number,
  receitas: ReadonlyMap<string, number>,
  inicioDasVendas: string,
): JanelaLida {
  let antesDoApp = 0;
  let medidos = 0;
  let buracos = 0;
  let somaEmCentavos = 0;
  for (let i = de; i <= ate; i += 1) {
    const chave = chaveDoMes(i);
    if (chave < inicioDasVendas) {
      antesDoApp += 1;
      continue;
    }
    const valor = receitas.get(chave);
    if (typeof valor !== "number" || !Number.isFinite(valor)) {
      buracos += 1;
    } else {
      // Mês com devolução maior que a venda vale zero, nunca abate a RBT12.
      somaEmCentavos += Math.max(0, paraCentavos(valor));
      medidos += 1;
    }
  }
  return { antesDoApp, medidos, buracos, somaEmCentavos };
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
  // Só preenchido quando a RBT12 saiu da média de poucos meses medidos pelo app.
  let mesesNaMedia: number | undefined;
  // A RBT12 é projeção (média x 12) em todo caminho menos o da soma de 12 meses medidos.
  let projecao = true;
  if (k === 1) {
    // L8: no 1º mês de atividade, o próprio mês anualizado.
    numerador = mesEmCentavos * simples.mesesDaRbt12;
  } else {
    // Os meses que a regra pede: os 12 anteriores (L7) ou, na empresa com menos de 12
    // meses de atividade, os anteriores da vida dela (L8; 13º mês em diante é a regra geral).
    const pedidos =
      k !== null && k <= simples.mesesDaRbt12 ? k - 1 : simples.mesesDaRbt12;
    const lidos = lerJanela(
      mesDaApuracao - pedidos,
      mesDaApuracao - 1,
      receitas,
      inicioDasVendas,
    );
    if (lidos.buracos > 0) {
      return {
        estado: "sem_estimativa",
        motivo: "faltam_meses",
        faltam: lidos.buracos,
      };
    }
    if (lidos.antesDoApp === 0) {
      // Todos os meses que a regra pede foram medidos: a conta cheia.
      if (pedidos === simples.mesesDaRbt12) {
        numerador = lidos.somaEmCentavos;
        projecao = false;
      } else {
        numerador = lidos.somaEmCentavos * simples.mesesDaRbt12;
        denominador = pedidos;
      }
    } else {
      // O app mediu só parte: média dos meses medidos x 12, a partir de 1 mês medido.
      if (lidos.medidos < MESES_MINIMOS_MEDIDOS) {
        return {
          estado: "sem_estimativa",
          motivo: "faltam_meses",
          faltam: MESES_MINIMOS_MEDIDOS - lidos.medidos,
        };
      }
      numerador = lidos.somaEmCentavos * simples.mesesDaRbt12;
      denominador = lidos.medidos;
      mesesNaMedia = lidos.medidos;
    }
  }
  if (numerador === 0) {
    // RBT12 zero conta como R$ 1,00 (Resolução CGSN 140/2018, art. 21, parágrafo único).
    numerador = paraCentavos(simples.rbt12QuandoZero);
    denominador = 1;
  }

  if (numerador > paraCentavos(simples.tetoSimples) * denominador) {
    return acimaDoLimite("acima_do_teto", projecao);
  }
  if (numerador > paraCentavos(simples.sublimite) * denominador) {
    return acimaDoLimite("acima_do_sublimite", projecao);
  }
  const achada = acharFaixa(numerador, denominador, simples.anexoI);
  // Não acontece (o teto é a última faixa), mas sem faixa nunca se inventa alíquota.
  if (!achada) return acimaDoLimite("acima_do_teto", projecao);

  const valor = dasDaFaixaEmDezenas(
    mesEmCentavos,
    numerador,
    denominador,
    achada.faixa.aliquota,
    achada.faixa.deduzir,
  );
  return mesesNaMedia === undefined
    ? { estado: "com_estimativa", valor }
    : { estado: "com_estimativa", valor, mesesNaMedia };
}
