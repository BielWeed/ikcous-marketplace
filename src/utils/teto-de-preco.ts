/**
 * O maior valor em dinheiro que o formulário de produto aceita num campo.
 *
 * As colunas de custo, preço de venda e preço de antes guardam até
 * R$ 99.999.999,99 (`numeric(10,2)`), e o total do pedido é da mesma
 * grandeza. O teto da tela é dez vezes menor de propósito: dá folga para
 * vários itens no mesmo pedido e ainda deixa passar qualquer preço de loja
 * de verdade. Acima disso quase sempre é dedo a mais ou código de barras
 * digitado no campo errado.
 */
const PRECO_MAXIMO = 9_999_999.99;

export function acimaDoTetoDePreco(
  valor: string | number | null | undefined,
): boolean {
  const numero =
    typeof valor === "number" ? valor : Number.parseFloat(valor ?? "");
  return numero > PRECO_MAXIMO;
}

/** `sujeito` já com o artigo: "O preço de venda", "O preço desta variação". */
export function mensagemDePrecoAcimaDoTeto(sujeito: string): string {
  return `${sujeito} passa do máximo de R$ 9.999.999,99. Use um valor menor.`;
}
