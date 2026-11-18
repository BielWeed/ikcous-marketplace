/** Aviso após salvar o produto quando alguma variação não pôde ser excluída. */
export function textoVariacoesNaoExcluidas(
  quais: string,
  quantidade: number,
): string {
  const orientacao =
    quantidade > 1
      ? "Se elas já têm vendas, desligue-as"
      : "Se ela já tem vendas, desligue-a";
  return `O produto e as outras variações foram salvos, mas não consegui excluir ${quais}. ${orientacao} no botão de ligar/desligar da linha em vez de excluir.`;
}
