/**
 * O preço próprio que o formulário grava na variação (`price_override`).
 *
 * O servidor cobra `COALESCE(price_override, preco_venda)`: só NULL cai no
 * preço do produto, e zero cobra zero. Já o campo de moeda do formulário nunca
 * fica vazio ao apagar (o "0,05" apagado vira "0,00"), então um "0.00" que
 * chega aqui quase sempre é o campo apagado — não um brinde. O Preço de Venda
 * do produto também exige maior que zero, então zero não é aceito como preço
 * próprio novo: vira "sem preço próprio" e a variação segue o do produto.
 *
 * Única exceção: a variação que JÁ estava salva com zero. Reabrir e salvar sem
 * mexer não muda o dado dela; para voltar ao preço do produto basta apagar o
 * campo (aí o texto chega vazio).
 *
 * @param textoLimpo o texto do campo já limpo ("49.90"; vazio = sem preço).
 * @param jaEstavaEmZero a variação que está sendo editada já tinha preço zero.
 */
export function precoProprioDaVariacao(
  textoLimpo: string,
  jaEstavaEmZero = false,
): number | undefined {
  if (textoLimpo.trim() === "") return undefined;
  const numero = Number.parseFloat(textoLimpo);
  if (Number.isNaN(numero)) return undefined;
  if (numero > 0) return numero;
  return numero === 0 && jaEstavaEmZero ? 0 : undefined;
}
