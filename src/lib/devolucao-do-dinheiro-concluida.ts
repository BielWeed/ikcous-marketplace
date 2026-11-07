import { paraCentavos } from "@/lib/devolucao";

/**
 * PROVA de que um pedido `estornado` foi devolvido por inteiro pelo próprio
 * app (devolução concluída), e não perdido numa contestação no cartão
 * (chargeback) — as duas origens deixam o MESMO par de status
 * (`payment_status = estornado`), e só o livro `order_refunds` as separa.
 *
 * Quem pergunta é o painel da lojista: devolução concluída é caso resolvido
 * (selo neutro); chargeback perdido é mercadoria E dinheiro perdidos e a
 * lojista precisa saber (selo de atenção). Por isso a regra é POSITIVA e o
 * padrão, na dúvida, é "não provado":
 *
 *   Σ das linhas `concluido` pedidas por PESSOA (`lojista` ou `cliente`) >=
 *   total do pedido.
 *
 *  - A linha da contestação nasce com `solicitado_por = 'sistema'`
 *    (migration 20261196000000) e NUNCA conta como devolução.
 *  - Devolução só parcial + contestação no resto não fecha o total: segue
 *    alerta. Como o banco nunca devolve mais que o total, somar o total em
 *    linhas de pessoa não deixa espaço para contestação alguma.
 *  - Pedido antigo (antes do livro, 04/10/2026) que virou `estornado` por
 *    contestação não tem linha: não prova, segue alerta. NÃO se usa a regra
 *    inversa ("neutro a menos que exista linha de contestação"), que deixaria
 *    esses pedidos neutros por falta de informação.
 *  - Total zero (cupom de 100%) não tem o que provar: não prova.
 */

/** Quem pede uma devolução de verdade — o que NÃO é `sistema`, de propósito
 * por lista fechada: valor desconhecido não prova nada. */
const PEDIDO_POR_PESSOA: readonly string[] = ["lojista", "cliente"];

export interface LinhaDoLivro {
  amount: number | string | null;
  status: string | null;
  solicitado_por: string | null;
}

export function devolucaoConcluidaPorInteiro(
  linhas: readonly LinhaDoLivro[] | null | undefined,
  totalDoPedido: number,
): boolean {
  const total = paraCentavos(Number(totalDoPedido) || 0);
  if (total <= 0 || !linhas) return false;
  let devolvido = 0;
  for (const linha of linhas) {
    if (linha.status !== "concluido") continue;
    if (!PEDIDO_POR_PESSOA.includes(linha.solicitado_por ?? "")) continue;
    const centavos = paraCentavos(Number(linha.amount) || 0);
    if (centavos > 0) devolvido += centavos;
  }
  return devolvido >= total;
}
