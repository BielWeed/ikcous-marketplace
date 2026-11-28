// `canvas.toBlob(cb, formato)` não é uma ordem, é um pedido: o navegador pode
// devolver outro tipo sem avisar. Este arquivo nasceu quando o ImageAdjuster
// pedia `image/webp`: o Safari do iPhone (e todo navegador de iPhone, que usa
// o motor dele) não gera WebP e devolvia PNG, que numa foto de câmera pesa
// alguns MB e o envio seguinte (`redimensionarImagem`) não consegue reduzir.
// Desde o #2075 o ImageAdjuster pede `image/jpeg` (iPhone com iOS 13 ou mais
// velho não abre WebP); a conferência segue valendo para qualquer formato.
//
// Aqui confere-se o tipo que VOLTOU. Se não é o pedido, tenta-se JPEG (o
// canvas do editor já tem fundo opaco, então não há transparência a perder)
// e fica o menor dos dois; se o JPEG não sair, fica o que voltou (PNG, por
// exemplo). O nome e o Content-Type do arquivo continuam honestos porque
// `arquivoDaImagemRecortada` os deriva do tipo real do blob.

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
