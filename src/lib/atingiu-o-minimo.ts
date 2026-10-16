/**
 * "O valor chegou ao mínimo?" — comparado em CENTAVOS inteiros.
 *
 * POR QUE EXISTE: dois preços normais somam errado em ponto flutuante
 * (10.10 + 10.20 = 20.299999999999997, que é `< 20.30`). Com `>=` cru, a loja
 * com frete grátis "acima de R$ 20,30" cobrava a entrega de quem comprou
 * exatamente R$ 20,30, enquanto o servidor (que soma em `numeric`) zera —
 * a divergência tela x servidor vira "frete desatualizado" no fechamento.
 *
 * A CONVENÇÃO é a que o repositório já usa (`Math.round(valor * 100)` em
 * guarda-de-frete.ts, reconferirCarrinho.ts e preco-da-grade.ts): preço do
 * banco é `numeric(x,2)`, então centavo inteiro é a unidade real.
 *
 * Valor que não é número (NaN) nunca atinge o mínimo — nunca vira "grátis".
 */
export function atingiuOMinimo(valor: number, minimo: number): boolean {
  return Math.round(valor * 100) >= Math.round(minimo * 100);
}
