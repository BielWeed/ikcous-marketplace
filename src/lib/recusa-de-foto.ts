/** HEIC/HEIF (iPhone/Samsung): o navegador não abre, então não dá para reduzir. */
const ehHeic = (f: File) =>
  /^image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);

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
  if (f.size > 12 * 1024 * 1024) {
    return `O arquivo "${f.name}" excede o tamanho limite de 12 MB. Envie uma imagem menor.`;
  }
  return null;
}
