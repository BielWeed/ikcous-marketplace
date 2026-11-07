// `canvas.toBlob(cb, "image/webp")` não é uma ordem, é um pedido: o Safari do
// iPhone (e todo navegador de iPhone, que usa o motor dele) não gera WebP e
// devolve PNG sem avisar. Uma foto de câmera em PNG pesa alguns MB, e o envio
// seguinte (`redimensionarImagem`) não consegue reduzi-la: PNG recomprimido não
// fica menor e o arquivo grande é mantido. Cada recorte feito no iPhone subia
// pesado para o armazenamento.
//
// Aqui confere-se o tipo que VOLTOU. Se o navegador caiu para outro formato,
// refaz-se em JPEG (o canvas do editor já tem fundo opaco, então não há
// transparência a perder). O nome e o Content-Type do arquivo continuam
// honestos porque `arquivoDaImagemRecortada` os deriva do tipo real do blob.

function pedirBlob(
  canvas: HTMLCanvasElement,
  formato: string,
  qualidade: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, formato, qualidade));
}

/**
 * Exporta o canvas no formato pedido; se o navegador entregar outro tipo
 * (Safari: PNG no lugar de WebP), tenta JPEG e fica com o menor dos dois.
 * Nunca perde a foto: se o JPEG falhar, devolve o blob que já tinha.
 */
export async function canvasParaBlobNoFormato(
  canvas: HTMLCanvasElement,
  formato: string,
  qualidade: number,
): Promise<Blob | null> {
  const blob = await pedirBlob(canvas, formato, qualidade);
  if (!blob || blob.type === formato) return blob;

  const jpeg = await pedirBlob(canvas, "image/jpeg", qualidade);
  if (jpeg && jpeg.type === "image/jpeg" && jpeg.size < blob.size) return jpeg;
  return blob;
}
