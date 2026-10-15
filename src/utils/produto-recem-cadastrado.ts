// Aviso de uma via entre o formulário do produto e a lista de produtos.
//
// A lista lembra, no aparelho, a busca, a categoria e a página em que a
// lojista estava. Ao cadastrar um produto NOVO ela volta para a lista, e o
// produto novo é o mais recente (ordem `data_cadastro` decrescente): fica na
// página 1 — que pode não ser a que ela deixou aberta, ou ser filtrada por uma
// busca que não o inclui. O formulário avisa aqui que acabou de cadastrar; a
// lista consome o aviso uma única vez ao ser aberta e mostra a página 1 sem
// busca nem filtro. Abrir a lista de outro jeito continua lembrando tudo.
//
// Fica em memória (módulo) de propósito: vale só para esta abertura do app, e
// não deve sobreviver a recarregar a página.
let cadastrouProdutoNovo = false;

/** O formulário chama quando o produto NOVO foi criado de verdade. */
export function avisarProdutoNovoCadastrado(): void {
  cadastrouProdutoNovo = true;
}

/** A lista chama ao abrir. Devolve `true` uma vez só por cadastro. */
export function consumirProdutoNovoCadastrado(): boolean {
  const havia = cadastrouProdutoNovo;
  cadastrouProdutoNovo = false;
  return havia;
}
