/**
 * Tipo de conta na língua da loja.
 *
 * O banco guarda `profiles.role` em texto cru (o CHECK só aceita quatro
 * valores) e a lista de Clientes e a ficha imprimiam esse valor tal qual:
 * "customer" aparecia na tela. A lojista lê "Cliente".
 *
 * Só EXIBIÇÃO: a ordenação por papel (`handleSort("role")`) e qualquer
 * regra de permissão continuam usando o valor cru do banco.
 *
 * Valor vazio ou desconhecido cai em "Cliente" — o papel mais comum e o de
 * menor poder; nunca devolve o texto cru.
 */
const ROTULOS_DO_PAPEL = new Map<string, string>([
  ["admin", "Administrador"],
  ["gerente", "Gerente"],
  ["vendedor", "Vendedor"],
  ["customer", "Cliente"],
]);

export function rotuloDoPapel(role: string | null | undefined): string {
  return ROTULOS_DO_PAPEL.get(role ?? "") ?? "Cliente";
}
