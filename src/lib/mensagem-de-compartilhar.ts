// A mensagem de compartilhar de um produto, num módulo pequeno e sem
// dependências: a vitrine (ProductView, pacote do cliente) e a prévia do painel
// usam a MESMA função, e a vitrine não pode carregar os modelos do painel.

/**
 * A mensagem de compartilhar de UM produto — a única fonte da vitrine
 * (ProductView) e da prévia de Minha loja, para a lojista aprovar o que o
 * cliente de fato manda.
 *
 * Texto COM marcador ([nome], [preco], [link]) é a mensagem completa da
 * lojista; SEM marcador (o texto padrão) nome e preço vão colados na frente.
 * `temLink` diz se `[link]` já pôs o endereço dentro de `texto`; quando não,
 * `completa` traz o endereço por último (é o que a vitrine copia).
 */
export function montarMensagemDeCompartilhar(
  modelo: string,
  dados: { nome: string; preco: string; link: string },
): { texto: string; temLink: boolean; completa: string } {
  const temMarcador = /\[(nome|preco|link)\]/i.test(modelo);
  const temLink = /\[link\]/i.test(modelo);
  const texto = temMarcador
    ? // Uma passada só, com FUNÇÃO: string no lugar do valor faria "$&"/"$1"
      // do nome virarem padrão de substituição, e o nome com "[preco]"
      // seria trocado de novo pela etapa seguinte.
      modelo.replace(/\[(nome|preco|link)\]/gi, (_marcador, qual: string) => {
        const tipo = qual.toLowerCase();
        if (tipo === "nome") return dados.nome;
        if (tipo === "preco") return dados.preco;
        return dados.link;
      })
    : `${modelo} ${dados.nome} por ${dados.preco}`.trimStart();
  return {
    texto,
    temLink,
    completa: temLink ? texto : `${texto} - ${dados.link}`,
  };
}
