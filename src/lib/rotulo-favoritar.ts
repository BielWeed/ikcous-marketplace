// B3 acabamento (laudo do Codex em ProductCard.tsx:383 e
// PremiumOffers.tsx:387, aceito pela hub-f em 08/09): o botão de favoritar
// dizia sempre "Adicionar aos favoritos" / "Remover dos favoritos" -- quem
// percorre a grade por Tab ouve isso repetido sem saber de qual produto é
// cada card. Uma função só para os dois componentes não nascer o padrão
// "dois lugares copiam a mesma regra".
//
// Nome vazio/indefinido cai no rótulo genérico de hoje -- nunca
// "Adicionar  aos favoritos" com espaço duplo.

export function rotuloDeFavoritar(nome: string, favorito: boolean): string {
  const sufixoNome = nome ? ` ${nome}` : "";
  return favorito
    ? `Remover${sufixoNome} dos favoritos`
    : `Adicionar${sufixoNome} aos favoritos`;
}
