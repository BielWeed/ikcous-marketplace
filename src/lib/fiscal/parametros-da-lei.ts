// Os valores da lei que a aba Impostos usa, num lugar só para TODAS as lojas.
//
// REGRAS DESTE ARQUIVO (é dinheiro mostrado a lojista):
//   1. Só entra número CONFERIDO em fonte oficial. Cada um carrega, em `fontes`, o
//      artigo, a URL e a data da conferência. Conferência feita em 24/11/2026; o
//      levantamento completo está em docs/fiscal/2026-11-24-parametros-conferidos.md.
//   2. Só 2026 tem número. Qualquer outro ano devolve `conferido: false` e NENHUM valor
//      de conta: a tela mostra "valores de 2026; os de ano X ainda não foram
//      conferidos" no lugar do número, em vez de calcular com valor velho.
//   3. Fica FORA daquilo que o levantamento deixou como condicional ou não conferido:
//      teto do MEI de 2027 em diante (LC 238 art. 3º depende da lei orçamentária e o
//      CGSN não regulamentou), DAS-MEI de 2027, Anexo I de 2027 (a tabela da R-196 não
//      foi aberta) e a regra nova de RBT12 de 2027. NÃO são "valor provisório": não existem.
//   4. Nada aqui lê rede, relógio ou banco. Nenhum número de loja específica.
//
// Para somar um ano novo: conferir cada valor em fonte oficial, acrescentar o ano em
// `PARAMETROS_POR_ANO` com as fontes e subir `ULTIMO_ANO_CONFERIDO`. O teste exige fonte
// e data em todo número novo.

import type { DataIso } from "@/types/financeiro";

/** O único ano com tudo conferido. Ano fora desta lista nunca devolve número. */
export const ULTIMO_ANO_CONFERIDO = 2026;

/** Dia em que cada valor abaixo foi conferido na fonte oficial. */
export const DATA_DA_CONFERENCIA: DataIso = "2026-11-24";

/** De onde veio um valor: o artigo, a página oficial e quando foi conferido. */
export interface FonteDaLei {
  readonly artigo: string;
  readonly url: string;
  readonly conferidoEm: DataIso;
}

/** Uma linha da tabela do Anexo I do Simples. `aliquota` em pontos percentuais (7,3 = 7,30%). */
export interface FaixaDoAnexoI {
  /** Receita bruta dos 12 meses (RBT12), em reais, até a qual a faixa vale (inclusive). */
  readonly ate: number;
  readonly aliquota: number;
  /** Parcela a deduzir, em reais (0 na 1ª faixa: a tabela da lei traz "—"). */
  readonly deduzir: number;
}

/**
 * Faixas do medidor do MEI, como percentual do teto: até 100% está dentro; de 100% a
 * 120% é "excesso de até 20%"; acima de 120% é "excesso de mais de 20%". A lei trata
 * os dois excessos de formas diferentes (LC 123 art. 18-A §7º, III e IV; R-140 art.
 * 115 §2º, II, "a"): até 20% o desenquadramento vale no ano seguinte, acima de 20% é
 * retroativo. Exatamente 120% ainda é "até 20%".
 */
export const LIMITES_DA_FAIXA_DO_MEI = Object.freeze({
  dentroAtePercentual: 100,
  excessoToleradoAtePercentual: 120,
});

/** DAS (MEI e Simples) vence no dia 20 do mês seguinte à receita (R-140 art. 40, caput; MEI: art. 104 §2º). */
export const VENCIMENTO_DO_DAS_DIA = 20;

export interface ParametrosConferidos {
  readonly conferido: true;
  readonly ano: number;
  /** O ano-calendário em que estes valores valem. Não vale antes do dia 1º. */
  readonly vigencia: { readonly inicio: DataIso; readonly fim: DataIso };
  readonly mei: {
    /** Receita bruta máxima do ano inteiro, em reais. */
    readonly tetoAnual: number;
    /** No ano de abertura o teto é este valor vezes os meses de atividade (fração de mês = mês inteiro). */
    readonly tetoPorMesDeAtividade: number;
    /** DAS-MEI mensal, em reais, por tipo de atividade. */
    readonly dasPorAtividade: {
      readonly comercio: number;
      readonly servico: number;
      readonly comercioEServico: number;
    };
    readonly faixas: typeof LIMITES_DA_FAIXA_DO_MEI;
  };
  readonly simples: {
    readonly anexoI: readonly FaixaDoAnexoI[];
    /** Teto do Simples (EPP), em reais por ano. */
    readonly tetoSimples: number;
    /** Sublimite de ICMS/ISS: acima dele o ICMS sai do DAS e a conta do Anexo I deixa de valer. */
    readonly sublimite: number;
    /** RBT12 igual a zero é tratada como este valor, em reais, na fórmula. */
    readonly rbt12QuandoZero: number;
    /** A RBT12 soma os 12 meses anteriores ao mês da apuração. */
    readonly mesesDaRbt12: number;
    readonly vencimentoDia: number;
  };
  /**
   * Fonte de cada valor, pelo caminho (`mei.tetoAnual`). Uma fonte vale para o caminho e
   * para tudo que está debaixo dele (`simples.anexoI` cobre todas as faixas). Use
   * `fonteDoValor` para achar a mais específica.
   */
  readonly fontes: Readonly<Record<string, FonteDaLei>>;
}

export interface ParametrosNaoConferidos {
  readonly conferido: false;
  readonly ultimoAnoConferido: number;
}

const URL_LC_123 = "https://www.planalto.gov.br/ccivil_03/leis/lcp/lcp123.htm";
const URL_R_140 =
  "https://normasinternet2.receita.fazenda.gov.br/#/consulta/externa/92278/visao/vigente";
const URL_DAS_MEI_2026 =
  "https://www8.receita.fazenda.gov.br/simplesnacional/Noticias/NoticiaCompleta.aspx?id=c3b2044c-ff97-432a-b33c-ecf2a3df6dc3";

const fonte = (artigo: string, url: string): FonteDaLei => ({
  artigo,
  url,
  conferidoEm: DATA_DA_CONFERENCIA,
});

// Valores de 2026. O texto compilado da LC 123 no Planalto ainda mostra a redação antiga
// do art. 18-A (R$ 81.000 e R$ 6.750), que é a que vale em 2026; a LC 238/2026 só muda
// isso a partir de 2027/2028 e por isso NÃO entra aqui.
const PARAMETROS_2026: ParametrosConferidos = {
  conferido: true,
  ano: 2026,
  vigencia: { inicio: "2026-01-01", fim: "2026-12-31" },
  mei: {
    tetoAnual: 81_000,
    tetoPorMesDeAtividade: 6_750,
    // INSS 5% de R$ 1.621,00 (salário mínimo de 2026) = R$ 81,05, mais R$ 1,00 de ICMS
    // e/ou R$ 5,00 de ISS: 81,05 + 1 = 82,05; 81,05 + 5 = 86,05; 81,05 + 1 + 5 = 87,05.
    dasPorAtividade: {
      comercio: 82.05,
      servico: 86.05,
      comercioEServico: 87.05,
    },
    faixas: LIMITES_DA_FAIXA_DO_MEI,
  },
  simples: {
    anexoI: [
      { ate: 180_000, aliquota: 4, deduzir: 0 },
      { ate: 360_000, aliquota: 7.3, deduzir: 5_940 },
      { ate: 720_000, aliquota: 9.5, deduzir: 13_860 },
      { ate: 1_800_000, aliquota: 10.7, deduzir: 22_500 },
      { ate: 3_600_000, aliquota: 14.3, deduzir: 87_300 },
      { ate: 4_800_000, aliquota: 19, deduzir: 378_000 },
    ],
    tetoSimples: 4_800_000,
    sublimite: 3_600_000,
    rbt12QuandoZero: 1,
    mesesDaRbt12: 12,
    vencimentoDia: VENCIMENTO_DO_DAS_DIA,
  },
  fontes: {
    "mei.tetoAnual": fonte(
      "LC 123/2006, art. 18-A, §1º (valor da LC 155/2016); Resolução CGSN 140/2018, art. 100, caput",
      URL_LC_123,
    ),
    "mei.tetoPorMesDeAtividade": fonte(
      "LC 123/2006, art. 18-A, §2º (redação da LC 155/2016); Resolução CGSN 140/2018, art. 100, §1º",
      URL_LC_123,
    ),
    "mei.dasPorAtividade": fonte(
      "Resolução CGSN 140/2018, art. 101; Decreto 12.797/2025, art. 1º (salário mínimo de R$ 1.621,00); Portal do Simples Nacional, MEI 2026 (02/01/2026)",
      URL_DAS_MEI_2026,
    ),
    "mei.faixas": fonte(
      "LC 123/2006, art. 18-A, §7º, III e IV; Resolução CGSN 140/2018, art. 115, §2º, II, 'a'",
      URL_LC_123,
    ),
    "simples.anexoI": fonte(
      "LC 123/2006, Anexo I (redação da LC 155/2016, vigente desde 01/01/2018)",
      URL_LC_123,
    ),
    "simples.tetoSimples": fonte(
      "LC 123/2006, art. 3º, II (redação da LC 155/2016); Resolução CGSN 140/2018, art. 2º, I, 'b'",
      URL_LC_123,
    ),
    "simples.sublimite": fonte(
      "LC 123/2006, art. 13-A e art. 19, §4º; Resolução CGSN 140/2018, art. 2º, I",
      URL_LC_123,
    ),
    "simples.rbt12QuandoZero": fonte(
      "Resolução CGSN 140/2018, art. 21, parágrafo único",
      URL_R_140,
    ),
    "simples.mesesDaRbt12": fonte(
      "LC 123/2006, art. 18, §1º e §1º-A; Resolução CGSN 140/2018, art. 21, II (12 meses anteriores ao mês, regra de 2026)",
      URL_LC_123,
    ),
    "simples.vencimentoDia": fonte(
      "Resolução CGSN 140/2018, art. 40, caput (Simples) e art. 104, §2º (MEI)",
      URL_R_140,
    ),
  },
};

/** Congela objeto e filhos: quem recebe os parâmetros não pode mexer no número da lei. */
function congelarTudo<T extends object>(objeto: T): T {
  for (const filho of Object.values(objeto)) {
    if (typeof filho === "object" && filho !== null) congelarTudo(filho);
  }
  return Object.freeze(objeto);
}

const PARAMETROS_POR_ANO: ReadonlyMap<number, ParametrosConferidos> = new Map([
  [PARAMETROS_2026.ano, congelarTudo(PARAMETROS_2026)],
]);

/**
 * Os valores da lei do ano. Ano sem conferência (qualquer um além de 2026, ou um número
 * que nem é ano) devolve só `conferido: false` e o último ano conferido: NENHUM valor
 * que sirva de conta, nem o de 2026 emprestado.
 */
export function parametrosDoAno(
  ano: number,
): ParametrosConferidos | ParametrosNaoConferidos {
  return (
    PARAMETROS_POR_ANO.get(ano) ?? {
      conferido: false,
      ultimoAnoConferido: ULTIMO_ANO_CONFERIDO,
    }
  );
}

/**
 * A fonte do valor no `caminho` (`mei.tetoAnual`, `simples.anexoI.2.aliquota`): a mais
 * específica, subindo pelo caminho. `null` se nenhum valor com esse caminho tem fonte.
 */
export function fonteDoValor(
  parametros: ParametrosConferidos,
  caminho: string,
): FonteDaLei | null {
  let atual = caminho;
  while (atual !== "") {
    // `find` e não `fontes[atual]`: o caminho vem de fora, e assim "constructor" ou
    // "__proto__" nunca viram uma "fonte" herdada do objeto.
    const achada = Object.entries(parametros.fontes).find(
      ([chave]) => chave === atual,
    );
    if (achada) return achada[1];
    const ponto = atual.lastIndexOf(".");
    if (ponto < 0) return null;
    atual = atual.slice(0, ponto);
  }
  return null;
}

const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * Vencimento SUGERIDO do DAS de uma competência (`yyyy-mm`, o mês da receita): dia 20 do
 * mês seguinte; se cair em sábado ou domingo, vai para a segunda-feira. `null` se a
 * competência não for um `yyyy-mm` de verdade.
 *
 * É sugestão editável, não a data oficial: a regra (Resolução CGSN 140/2018, art. 40,
 * §3º) manda passar para o próximo dia "sem expediente bancário", e feriado bancário
 * (nacional, estadual ou municipal) NÃO é calculado aqui. A lojista confere e corrige
 * ao lançar a guia. Também há prorrogação por calamidade pública (art. 40-A), que
 * este cálculo não conhece.
 *
 * Vale para qualquer competência, não só as de 2026: é regra de calendário, e a
 * resolução não mostra mudança agendada para esse artigo.
 *
 * PENDENTE PARA A ATUALIZAÇÃO DE JANEIRO DE 2027 (parecer do sócio, 25/11/2026, item 6):
 * 20 de novembro (Dia da Consciência Negra, feriado nacional desde 2024) ainda NÃO conta
 * como dia sem expediente aqui; entra junto da conferência dos valores de 2027. Hoje o
 * erro só vai para o lado seguro (a data sugerida é igual ou ANTERIOR à real, e a lojista
 * confere e corrige ao lançar a guia). O sócio data o primeiro erro real em novembro de
 * 2028. É só este lembrete: nenhum comportamento muda por ele, e nenhum aviso novo é
 * mostrado na tela.
 */
export function vencimentoDoDas(competencia: string): DataIso | null {
  const partes = COMPETENCIA.exec(competencia);
  if (!partes) return null;
  const ano = Number(partes[1]);
  const mes = Number(partes[2]); // 1 a 12; como índice de mês é justamente o mês seguinte
  const dia20 = new Date(Date.UTC(ano, mes, VENCIMENTO_DO_DAS_DIA));
  const diaDaSemana = dia20.getUTCDay(); // 0 = domingo, 6 = sábado
  if (diaDaSemana === 6) dia20.setUTCDate(dia20.getUTCDate() + 2);
  else if (diaDaSemana === 0) dia20.setUTCDate(dia20.getUTCDate() + 1);
  return dia20.toISOString().slice(0, 10);
}
