/** HEIC/HEIF (iPhone/Samsung): o navegador não abre, então não dá para reduzir. */
const ehHeic = (f: File) =>
  /^image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

/**
 * GIF pode ser animado: o canvas só guarda o 1º quadro, então ele NÃO é
 * reduzido no envio (`redimensionarImagem`) e sobe como veio. Como não dá para
 * encolher, o peso é barrado antes, aqui — vai inteiro ao celular da cliente.
 */
export const TETO_DE_GIF = 3 * 1024 * 1024;

const ehGif = (f: File) =>
  f.type === "image/gif" ||
  ((!f.type || f.type === "application/octet-stream") &&
    /\.gif$/i.test(f.name));

/**
 * Por que o arquivo NÃO pode virar foto (produto, banner), ou `null` se pode.
 * Sem tipo (ou tipo genérico), vale a extensão; PDF, planilha e vídeo nunca passam.
 */
export function recusaDeFoto(f: File): string | null {
  if (ehHeic(f)) {
    return `Não conseguimos abrir a foto "${f.name}". Salve como JPG ou PNG e tente de novo.`;
  }
  if (
    f.type && f.type !== "application/octet-stream"
      ? !f.type.startsWith("image/")
      : !/\.(jpe?g|png|webp|gif|avif)$/i.test(f.name)
  ) {
    return "Esse arquivo não é uma foto. Envie JPG, PNG ou WebP.";
  }
  if (ehGif(f) && f.size > TETO_DE_GIF) {
    return `O arquivo "${f.name}" excede o tamanho limite de 3 MB para GIF. Envie uma imagem menor.`;
  }
  if (f.size > 12 * 1024 * 1024) {
    return `O arquivo "${f.name}" excede o tamanho limite de 12 MB. Envie uma imagem menor.`;
  }
  return null;
}
