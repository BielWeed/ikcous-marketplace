// O File que o recorte do `ImageAdjuster` vira no upload (achado
// AdminProductFormView-499, replicado no banner — follow-up 17/09): o
// ImageAdjuster SEMPRE exporta `image/webp` (ImageAdjuster.tsx,
// `canvas.toBlob(cb, "image/webp", ...)`), mas cada tela embrulhava o blob
// por conta própria — e a de banners mentia com nome/tipo FIXOS
// `.jpg`/`image/jpeg` sobre um conteúdo webp.
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
 * reconhecido (ex.: `Blob.type` vazio em algum ambiente), cai no formato
 * que o ImageAdjuster de fato produz hoje — nunca no jpeg mentiroso. */
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
