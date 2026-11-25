// Pré-preenchimento do "Lançar a guia deste mês": monta os valores iniciais do "Novo
// lançamento" que o Financeiro já tem (`Partial<FormularioDoLancamento>`).
//
// ISTO É DINHEIRO: se a lojista confirmar, o que sai daqui vira lançamento do Financeiro
// (entra no Resultado, no Pagar e receber e no Início). A regra dura:
//
//   O VALOR DE UMA GUIA NUNCA É O VALOR CALCULADO PELO APP.
//
//   - No Simples (e em todo regime sem valor fixo) o valor sai SEMPRE vazio: a lojista
//     digita o da guia que recebeu, e o formulário não deixa gravar sem ele.
//   - A função nem recebe o valor calculado como parâmetro (só o cadastro, o mês e o ano),
//     então não existe caminho para ele chegar ao campo. O texto deste arquivo também não
//     o cita nem importa o módulo que o calcula (o teste confere as duas coisas).
//   - No MEI o valor é o DAS-MEI FIXO da atividade, e só quando o ano está conferido na lei.
//     Ano sem conferência = vazio, nunca o valor de outro ano emprestado.
//
// Este módulo só MONTA o rascunho: não grava, não baixa e não fala com o banco. Quem grava
// é o "Novo lançamento" depois que a lojista confere e confirma.
//
// Função pura: sem rede, relógio nem React.

import type { FormularioDoLancamento } from "@/lib/financeiro";
import {
  type CadastroFiscal,
  type QuemTemConta,
  quemTemConta,
} from "@/lib/fiscal/cadastro";
import {
  type ParametrosConferidos,
  parametrosDoAno,
  vencimentoDoDas,
} from "@/lib/fiscal/parametros-da-lei";
import { CATEGORIA_DE_IMPOSTOS_ID } from "@/lib/fiscal/receita-do-mes";

const COMPETENCIA = /^(\d{4})-(0[1-9]|1[0-2])$/;

/**
 * O DAS-MEI fixo da atividade, em reais. "Só comércio" paga o do comércio. "Tem serviço"
 * paga o de comércio e serviço: a loja vende produtos, e o cadastro não tem "só serviço".
 */
function dasFixoDoMei(
  mei: ParametrosConferidos["mei"],
  atividade: CadastroFiscal["atividade"],
): number {
  return atividade === "comercio"
    ? mei.dasPorAtividade.comercio
    : mei.dasPorAtividade.comercioEServico;
}

/**
 * O valor inicial do campo, como texto que o campo de dinheiro lê ("82.05"). Vazio em todo
 * caso que não é MEI com o ano conferido.
 */
function valorInicial(
  conta: QuemTemConta,
  atividade: CadastroFiscal["atividade"],
  anoDasVendas: number,
  ano: number,
): string {
  if (conta.tipo !== "mei") return "";
  // O ano tem de ser o do mês das vendas: o DAS-MEI vale por ano, e um ano que não bate
  // é erro de quem chamou. Na dúvida fica vazio, e a lojista digita.
  if (ano !== anoDasVendas) return "";
  const lei = parametrosDoAno(ano);
  if (!lei.conferido) return "";
  return dasFixoDoMei(lei.mei, atividade).toFixed(2);
}

/**
 * Os valores iniciais do "Novo lançamento" para a guia do DAS do mês.
 *
 * @param cadastro o cadastro fiscal da loja; `null` = loja sem cadastro (nenhum regime
 *   suposto: o valor sai vazio).
 * @param competencia o mês das VENDAS (`aaaa-mm`); o DAS vence no mês seguinte.
 * @param ano o ano da lei a usar (o do mês das vendas) para o valor fixo do MEI.
 * @returns `null` se a competência não for um `aaaa-mm` de verdade: melhor não abrir o
 *   formulário do que abrir com uma data inventada.
 */
export function guiaDoMes(
  cadastro: Pick<CadastroFiscal, "regime" | "atividade"> | null,
  competencia: string,
  ano: number,
): Partial<FormularioDoLancamento> | null {
  const partes = COMPETENCIA.exec(competencia);
  const vencimento = vencimentoDoDas(competencia);
  if (!partes || vencimento === null) return null;
  const [, anoDasVendas = "", mes = ""] = partes;

  return {
    tipo: "saida",
    situacao: "previsto",
    categoriaId: CATEGORIA_DE_IMPOSTOS_ID,
    dataCompetencia: `${competencia}-01`,
    dataVencimento: vencimento,
    descricao: `DAS ${mes}/${anoDasVendas}`,
    valor: cadastro
      ? valorInicial(
          quemTemConta(cadastro),
          cadastro.atividade,
          Number(anoDasVendas),
          ano,
        )
      : "",
  };
}
