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
// no lugar do número (nunca o teto de 2026 emprestado a outro ano). A ÚNICA exceção é a
// virada do ano (`qualAnoOMedidorMostra`): em janeiro, até os valores do ano novo serem
// conferidos, o medidor mostra o ano que ACABOU DE FECHAR, com o limite desse ano e o
// rótulo "fechado" (decisão do sócio, 25/11/2026). Nunca um limite maior que o vigente.
//
// Dinheiro entra como `number` em reais; a conta é feita em CENTAVOS inteiros (como o
// resto do Financeiro), então "um centavo a mais" muda a faixa e a soma de ponto
// flutuante que passa de raspão não engana.

import { ehDataIso, paraCentavos } from "@/lib/financeiro";
import type { CadastroFiscal } from "@/lib/fiscal/cadastro";
import { parametrosDoAno } from "@/lib/fiscal/parametros-da-lei";
import { efeitoDoVeredito } from "@/lib/fiscal/textos";
import type { DataIso } from "@/types/financeiro";

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
 * Qual ano o medidor do MEI mede no dia `hoje` (`aaaa-mm-dd`, o dia em São Paulo), e se esse
 * ano já FECHOU. Em janeiro, enquanto os valores do ano novo não foram conferidos e os do
 * ano anterior foram, mostra o ano anterior inteiro ("2026 fechado") com o limite dele, em
 * vez de uma tela de "ano não conferido". De 1º de fevereiro em diante (o prazo para
 * conferir o ano novo) volta a medir o ano do próprio dia, e o núcleo recusa com o aviso de
 * "ano não conferido" se ninguém conferiu: a falta aparece, não fica escondida atrás de um
 * "fechado" que dura para sempre. Só devolve `fechado: true` para um ano que TEM valores
 * conferidos: nunca mostra um limite que o código não conhece.
 *
 * @param anoConferido só para teste: quais anos têm valores conferidos.
 */
export function qualAnoOMedidorMostra(
  hoje: DataIso,
  anoConferido: (ano: number) => boolean = (ano) =>
    parametrosDoAno(ano).conferido,
): { readonly ano: number; readonly fechado: boolean } {
  const ano = Number(hoje.slice(0, 4));
  const mes = Number(hoje.slice(5, 7));
  if (mes === 1 && !anoConferido(ano) && anoConferido(ano - 1)) {
    return { ano: ano - 1, fechado: true };
  }
  return { ano, fechado: false };
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
    efeito: efeitoDoVeredito(faixa, anoDeAbertura),
  };
}

/**
 * Por que o número do app pode não ser o do ano inteiro. Estável: a tela e o teste leem
 * o motivo, não o texto.
 */
export type MotivoDeCoberturaParcial =
  | "sem_data_de_inicio"
  | "comecou_depois_do_inicio";

/**
 * O número que vai ao medidor sai do `fin_dre`, que só enxerga as vendas feitas pelo
 * app. Ele só é a receita do ANO quando o app já vendia desde o começo do período
 * medido; senão é um número PARCIAL e a tela não pode concluir enquadramento sobre ele
 * (o `fin_dre` devolve zero para o que veio antes do app, e zero parece "não vendeu").
 */
export type CoberturaDaReceita =
  | { readonly tipo: "completa" }
  | { readonly tipo: "parcial"; readonly motivo: "sem_data_de_inicio" }
  | {
      readonly tipo: "parcial";
      readonly motivo: "comecou_depois_do_inicio";
      /** A data de `vendeNoAppDesde`: a tela diz "a partir de <mês>". */
      readonly desde: DataIso;
    };

export interface EntradaDaCobertura {
  /** O ano-calendário medido (o mesmo que vai a `medirLimiteDoMei`). */
  readonly ano: number;
  readonly cadastro: Pick<CadastroFiscal, "abertaEm" | "vendeNoAppDesde">;
}

/**
 * Diz se a receita do app cobre o período medido inteiro. O período começa em 1º de
 * janeiro, ou, se a empresa abriu naquele ano, no mês da abertura (antes dela não existe
 * venda a contar). Cobre quando o app já vendia nesse mês ou antes; sem a data de início
 * das vendas no cadastro, nunca se supõe cobertura. A comparação é por mês: o cadastro
 * guarda `vendeNoAppDesde` sempre no dia 1.
 */
export function coberturaDaReceitaDoAno(
  entrada: EntradaDaCobertura,
): CoberturaDaReceita {
  const { abertaEm, vendeNoAppDesde } = entrada.cadastro;
  if (vendeNoAppDesde === null || !ehDataIso(vendeNoAppDesde)) {
    return { tipo: "parcial", motivo: "sem_data_de_inicio" };
  }

  // O mês em que o período medido começa (`aaaa-mm`): janeiro, ou o da abertura se for
  // depois (abertura de ano anterior não adianta nada; ISO se compara como texto).
  let inicioDoPeriodo = `${entrada.ano}-01`;
  if (abertaEm !== null && ehDataIso(abertaEm)) {
    const mesDaAbertura = abertaEm.slice(0, 7);
    if (mesDaAbertura > inicioDoPeriodo) inicioDoPeriodo = mesDaAbertura;
  }

  return vendeNoAppDesde.slice(0, 7) <= inicioDoPeriodo
    ? { tipo: "completa" }
    : {
        tipo: "parcial",
        motivo: "comecou_depois_do_inicio",
        desde: vendeNoAppDesde,
      };
}
