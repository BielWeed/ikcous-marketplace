// O File que o recorte do `ImageAdjuster` vira no upload (achado
// AdminProductFormView-499, replicado no banner — follow-up 17/09): na época
// o ImageAdjuster exportava `image/webp`, mas cada tela embrulhava o blob
// por conta própria — e a de banners mentia com nome/tipo FIXOS
// `.jpg`/`image/jpeg` sobre um conteúdo webp. Desde o #2075 ele pede
// `image/jpeg` (iPhone com iOS 13 ou mais velho não abre WebP), e o
// `canvasParaBlobNoFormato` fica com o tipo que o navegador devolver se não
// for JPEG (PNG, por exemplo): o tipo do blob continua variando.
//
// A mentira não é estética: o upload deriva a extensão do bucket a partir
// do NOME (`pronto.name.split(".").pop()` no useProducts) e o Storage serve
// o objeto com o Content-Type do `File.type`. O transformador de imagem do
// Storage decodifica pelo Content-Type DECLARADO, não pelos bytes — um
// ".jpg" que é webp por dentro falha na transformação e o LazyImage cai no
// fallback da imagem ORIGINAL (sem redimensionar) em toda a vitrine.
//
// Função pura, sem DOM nem canvas: mesma casa de
// geometria-do-recorte.ts (extraída do componente para poder ser testada
// caso a caso). Cada tela passa o SEU prefixo de nome — o sufixo honesto
// (extensão casando com o tipo real do blob) é daqui.

/** Extensão honesta para o Content-Type: webp/png/jpg. Sem tipo
 * reconhecido (ex.: `Blob.type` vazio em algum ambiente), cai em webp, o
 * formato que o ImageAdjuster exportava quando isto foi escrito; hoje ele
 * produz JPEG (ou PNG), então esse caso não acompanha o que ele exporta. */
function extensaoDoContentType(tipo: string): string {
  switch (tipo) {
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    case "image/jpeg":
      return "jpg";
    default:
      return "webp";
  }
}

/** Embrulha o blob recortado num File cujo nome e Content-Type dizem a
 * verdade sobre o conteúdo. `prefixoDoNome` é de quem chama
 * (ex.: "product-image-", "banner-image-"); a extensão vem do tipo REAL do
 * blob. */
export function arquivoDaImagemRecortada(
  croppedBlob: Blob,
  prefixoDoNome: string,
): File {
  const tipo = croppedBlob.type || "image/webp";
  const extensao = extensaoDoContentType(tipo);
  return new File([croppedBlob], `${prefixoDoNome}${Date.now()}.${extensao}`, {
    type: tipo,
  });
}
