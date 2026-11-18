/**
 * Aparo dos dias vazios do INÍCIO do histórico de faturamento do painel.
 *
 * A RPC do dashboard devolve uma linha por dia da janela pedida — inclusive
 * os dias antes da primeira venda da loja, todos zerados. Com a janela de
 * "Tudo" cobrindo anos, desenhar esses dias à frente do primeiro dia com
 * movimento viraria uma parede de barras vazias à esquerda do gráfico.
 *
 * Movimento é receita, pedidos OU lucro diferente de zero. O lucro entra
 * porque a RPC admite o dia de venda 100% estornada sem recuperar a peça:
 * receita 0, pedidos 0 e lucro NEGATIVO. Aparar esse dia fazia o "Tudo"
 * somar um lucro diferente do "30 dias" para a mesma loja.
 *
 * Só a CABEÇA é aparada: dia sem venda NO MEIO do histórico é informação
 * (loja parada, feriado) e continua no gráfico. Histórico sem movimento
 * algum é devolvido como veio — zerar tudo não é motivo para sumir com o
 * gráfico inteiro.
 */
export function desdeOPrimeiroDiaDeMovimento<
  T extends {
    revenue?: number | null;
    orders?: number | null;
    profit?: number | null;
  },
>(dias: T[]): T[] {
  const primeiro = dias.findIndex(
    (d) =>
      (d.revenue ?? 0) !== 0 || (d.orders ?? 0) !== 0 || (d.profit ?? 0) !== 0,
  );
  // -1: nenhum dia com movimento — devolve como veio.
  // 0: o histórico já começa com movimento — nada a aparar.
  if (primeiro <= 0) return dias;
  return dias.slice(primeiro);
}
