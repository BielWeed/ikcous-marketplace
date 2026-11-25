// Medidor do limite do MEI: "quanto do teto do ano você já usou, e o que acontece se passar".
//
// Função pura (sem rede, relógio ou React). Os números e as regras vêm de
// `parametros-da-lei.ts` (conferidos em fonte oficial em 24/11/2026; ver
// docs/fiscal/2026-11-24-parametros-conferidos.md, itens L1, L2 e L3):
//   - o teto é o do ano inteiro, ou, no ANO DE ABERTURA, R$ 6.750 vezes os meses de
//     atividade, contando o mês da abertura inteiro (fração de mês = mês inteiro);
//   - até 100% do teto: dentro. Mais de 100% e até 120%: excesso de até 20%. Mais de
//     120%: excesso de mais de 20%. Exatamente 100% e exatamente 120% ficam na faixa de
//     baixo ("ultrapassar" é passar do valor).
//
// Ano sem parâmetro conferido não calcula: devolve `sem_conta` e a tela mostra um aviso
// no lugar do número (nunca o teto de 2026 emprestado a outro ano).
//
// Dinheiro entra como `number` em reais; a conta é feita em CENTAVOS inteiros (como o
// resto do Financeiro), então "um centavo a mais" muda a faixa e a soma de ponto
// flutuante que passa de raspão não engana.

import { ehDataIso, paraCentavos } from "@/lib/financeiro";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import { parametrosDoAno } from "@/lib/fiscal/parametros-da-lei";

export type FaixaDoMei = "dentro" | "excesso_ate_20" | "excesso_acima_20";

/** Por que não há conta. Estável: a tela e o teste leem o motivo, não o texto. */
export type MotivoSemContaDoMedidor =
  | "ano_nao_conferido"
  | "receita_invalida"
  | "abertura_invalida"
  | "abertura_depois_do_ano";

export interface EntradaDoMedidorDoMei {
  /** Receita bruta acumulada do ano até agora, em reais. Pode vir negativa (devoluções). */
  readonly receitaAcumulada: number;
  /** O ano-calendário medido. */
  readonly ano: number;
  /** Só a data de abertura importa aqui; ela é opcional no cadastro. */
  readonly cadastro: Pick<CadastroFiscal, "abertaEm">;
}

export type MedidorDoMei =
  | {
      readonly estado: "com_conta";
      /**
       * Quanto do teto já foi usado, em pontos percentuais (50 = metade), SEM arredondar e
       * nunca negativo. Quem mostra arredonda; a `faixa` é que diz se passou, e ela é
       * decidida em centavos: 100,004% mostra "100%" e continua sendo excesso.
       */
      readonly percentual: number;
      readonly faixa: FaixaDoMei;
      /** O teto contra o qual se mediu, em reais (o proporcional no ano de abertura). */
      readonly tetoUsado: number;
      /** `true` no ano de abertura (teto = valor por mês x meses de atividade). */
      readonly tetoProporcional: boolean;
      /** Meses de atividade contados no ano: 12 no ano cheio. */
      readonly mesesDeAtividade: number;
      /** O que acontece com o enquadramento nesta faixa, em texto simples. */
      readonly efeito: string;
    }
  | {
      readonly estado: "sem_conta";
      readonly motivo: MotivoSemContaDoMedidor;
    };

/**
 * O efeito de cada faixa, conforme a LC 123 art. 18-A §7º, III e IV (e §§9º e 10) e a
 * Resolução CGSN 140/2018 art. 115 §2º, II, "a". A lei nova (LC 238/2026) não mexeu
 * nisso. O prazo para avisar é "até o último dia útil do mês seguinte ao do excesso".
 */
function efeitoDaFaixa(faixa: FaixaDoMei, anoDeAbertura: boolean): string {
  if (faixa === "dentro") {
    return "Dentro do limite: nada muda no seu enquadramento como MEI por causa da receita.";
  }
  const prazo =
    "Avise a Receita até o último dia útil do mês seguinte ao do excesso.";
  if (faixa === "excesso_ate_20") {
    return anoDeAbertura
      ? `Passou do limite proporcional em até 20%. Você deixa de ser MEI a partir de 1º de janeiro do ano seguinte. ${prazo}`
      : `Passou do limite em até 20%. Você deixa de ser MEI a partir de 1º de janeiro do ano seguinte, e a diferença é paga, sem acréscimos, junto com o DAS de janeiro. ${prazo}`;
  }
  return anoDeAbertura
    ? `Passou do limite proporcional em mais de 20%. Você deixa de ser MEI com efeito retroativo ao início da atividade e passa a pagar pelo Simples Nacional normal. ${prazo}`
    : `Passou do limite em mais de 20%. Você deixa de ser MEI com efeito retroativo a 1º de janeiro do ano do excesso e passa a pagar pelo Simples Nacional normal. ${prazo}`;
}

/**
 * Mede a receita acumulada do ano contra o teto do MEI. Nunca assume nada que o
 * cadastro não diz: sem data de abertura, o teto é o do ano inteiro.
 */
export function medirLimiteDoMei(entrada: EntradaDoMedidorDoMei): MedidorDoMei {
  const parametros = parametrosDoAno(entrada.ano);
  if (!parametros.conferido) {
    return { estado: "sem_conta", motivo: "ano_nao_conferido" };
  }
  if (!Number.isFinite(entrada.receitaAcumulada)) {
    return { estado: "sem_conta", motivo: "receita_invalida" };
  }

  // Meses de atividade no ano: 12, ou do mês de abertura até dezembro (inclusive).
  let mesesDeAtividade = 12;
  let anoDeAbertura = false;
  const abertaEm = entrada.cadastro.abertaEm;
  if (abertaEm !== null) {
    if (!ehDataIso(abertaEm)) {
      return { estado: "sem_conta", motivo: "abertura_invalida" };
    }
    const anoAberto = Number(abertaEm.slice(0, 4));
    if (anoAberto > entrada.ano) {
      return { estado: "sem_conta", motivo: "abertura_depois_do_ano" };
    }
    if (anoAberto === entrada.ano) {
      anoDeAbertura = true;
      mesesDeAtividade = 12 - Number(abertaEm.slice(5, 7)) + 1;
    }
  }

  const { mei } = parametros;
  const tetoEmCentavos = anoDeAbertura
    ? paraCentavos(mei.tetoPorMesDeAtividade) * mesesDeAtividade
    : paraCentavos(mei.tetoAnual);
  // Devolução maior que a venda deixa o acumulado negativo: o medidor mostra 0%.
  const receitaEmCentavos = Math.max(0, paraCentavos(entrada.receitaAcumulada));

  // Comparação em inteiros: receita/teto > L% vira receita x 100 > teto x L.
  const { dentroAtePercentual, excessoToleradoAtePercentual } = mei.faixas;
  let faixa: FaixaDoMei;
  if (receitaEmCentavos * 100 <= tetoEmCentavos * dentroAtePercentual) {
    faixa = "dentro";
  } else if (
    receitaEmCentavos * 100 <=
    tetoEmCentavos * excessoToleradoAtePercentual
  ) {
    faixa = "excesso_ate_20";
  } else {
    faixa = "excesso_acima_20";
  }

  return {
    estado: "com_conta",
    percentual: (receitaEmCentavos / tetoEmCentavos) * 100,
    faixa,
    tetoUsado: tetoEmCentavos / 100,
    tetoProporcional: anoDeAbertura,
    mesesDeAtividade,
    efeito: efeitoDaFaixa(faixa, anoDeAbertura),
  };
}
