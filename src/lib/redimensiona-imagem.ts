// Redimensiona a imagem do produto ANTES do upload (laudo novos ângulos
// 01/09, C2). O Storage recebia o arquivo cru do celular: foto de 12 MP são
// vários MB guardados e servidos a cada consumidor que escapar do pipeline
// de render (`/render/image/`) ou quando a transformação falha — o fallback
// do LazyImage recai para a ORIGINAL. Aqui quem paga o preço é o único
// upload do lojista, não o download de cada cliente.
//
// FAIL-OPEN de propósito: qualquer falha (navegador sem createImageBitmap,
// formato que não decodifica, canvas recusado) devolve o arquivo ORIGINAL —
// o upload nunca deixa de funcionar por causa do redimensionamento.
//
// Só JPEG e PNG são tocados: GIF animado e SVG vetorial não sobrevivem a
// rasterizar, e webp/HEIC têm suporte de encode/decode desigual entre
// navegadores — passar intactos é o comportamento de hoje, sem regressão.

/** Maior lado permitido depois do redimensionamento. */
export const LADO_MAXIMO_UPLOAD = 1600;
/** Abaixo deste peso (bytes), o arquivo passa intacto: não é ele que dói. */
export const PESO_MINIMO_PARA_REDIMENSIONAR = 400 * 1024;

export interface PlanoDeImagem {
  redimensionar: boolean;
  /** Maior lado depois do resize (quando redimensionar). */
  lado: number;
  mime: "image/jpeg" | "image/png";
}

/**
 * A decisão, PURA e testável: dado tipo, peso e dimensões, diz se vale
 * redimensionar, para qual maior lado e em que MIME o canvas grava.
 */
export function planoDaImagem(
  mimeOriginal: string,
  peso: number,
  largura: number,
  altura: number,
): PlanoDeImagem {
  if (mimeOriginal !== "image/jpeg" && mimeOriginal !== "image/png") {
    return {
      redimensionar: false,
      lado: Math.max(largura, altura),
      mime: "image/jpeg",
    };
  }
  const maiorLado = Math.max(largura, altura);
  if (peso < PESO_MINIMO_PARA_REDIMENSIONAR) {
    return { redimensionar: false, lado: maiorLado, mime: mimeOriginal };
  }
  return {
    redimensionar: true,
    lado: Math.min(maiorLado, LADO_MAXIMO_UPLOAD),
    mime: mimeOriginal,
  };
}

/**
 * Devolve a versão redimensionada do arquivo — ou o PRÓPRIO arquivo, quando
 * não vale a pena (tipo não tocável, pequeno demais, falha qualquer).
 * `imageOrientation: "from-image"` é o que preseta a rotação EXIF da câmera
 * no bitmap; sem ela, foto tirada em retrato sai deitada.
 */
export async function redimensionarImagem(file: File): Promise<File> {
  try {
    if (file.type !== "image/jpeg" && file.type !== "image/png") return file;

    const bitmap = await createImageBitmap(file, {
      imageOrientation: "from-image",
    });
    try {
      const plano = planoDaImagem(
        file.type,
        file.size,
        bitmap.width,
        bitmap.height,
      );
      if (!plano.redimensionar) return file;

      const escala = plano.lado / Math.max(bitmap.width, bitmap.height);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * escala);
      canvas.height = Math.round(bitmap.height * escala);
      const ctx = canvas.getContext("2d");
      if (!ctx) return file;
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, plano.mime, 0.82),
      );
      // Um resize que CRESCEN o arquivo é um resize errado (PNG foto, por
      // exemplo): mantém o original.
      if (!blob || blob.size >= file.size) return file;

      return new File([blob], file.name, {
        type: blob.type,
        lastModified: file.lastModified,
      });
    } finally {
      bitmap.close();
    }
  } catch {
    return file;
  }
}
