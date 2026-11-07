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
// JPEG, PNG, WebP e AVIF ESTÁTICOS são reduzidos. WebP grava WebP; AVIF vira
// WebP (nenhum navegador grava AVIF no canvas, e WebP guarda a transparência).
// Animado (WebP com o selo de animação, AVIF "avis") passa intacto: o canvas
// só guarda o primeiro quadro e a animação sumiria em silêncio. GIF (pode ser
// animado), SVG vetorial e HEIC também passam intactos — o peso do GIF é
// barrado na escolha do arquivo (`recusaDeFoto`), não convertido aqui.
// Se o navegador não sabe gravar WebP, o canvas devolve PNG: o original fica.

/** Maior lado permitido depois do redimensionamento. */
export const LADO_MAXIMO_UPLOAD = 1600;
/** Abaixo deste peso (bytes), o arquivo passa intacto: não é ele que dói. */
export const PESO_MINIMO_PARA_REDIMENSIONAR = 400 * 1024;

export interface PlanoDeImagem {
  redimensionar: boolean;
  /** Maior lado depois do resize (quando redimensionar). */
  lado: number;
  mime: "image/jpeg" | "image/png" | "image/webp";
}

/** Em que MIME o canvas grava cada tipo reduzível (AVIF não grava: vira WebP). */
const MIME_DE_SAIDA = new Map<string, PlanoDeImagem["mime"]>([
  ["image/jpeg", "image/jpeg"],
  ["image/png", "image/png"],
  ["image/webp", "image/webp"],
  ["image/avif", "image/webp"],
]);

const ascii = (bytes: Uint8Array, de: number, ate: number) =>
  String.fromCharCode(...bytes.subarray(de, ate));

/**
 * WebP/AVIF animado? Lê só o começo do arquivo: o WebP animado traz o selo de
 * animação (bit 0x02) no bloco VP8X; o AVIF animado declara a marca "avis" na
 * caixa `ftyp`. Na dúvida (cabeçalho que não bate com nada), diz que não é.
 */
async function ehAnimada(file: File): Promise<boolean> {
  const bytes = new Uint8Array(await file.slice(0, 64).arrayBuffer());
  if (file.type === "image/webp") {
    return (
      ascii(bytes, 0, 4) === "RIFF" &&
      ascii(bytes, 8, 12) === "WEBP" &&
      ascii(bytes, 12, 16) === "VP8X" &&
      (bytes[20] & 0x02) !== 0
    );
  }
  if (ascii(bytes, 4, 8) !== "ftyp") return false;
  const fim = Math.min(new DataView(bytes.buffer).getUint32(0), bytes.length);
  for (let i = 8; i + 4 <= fim; i += 4) {
    if (ascii(bytes, i, i + 4) === "avis") return true;
  }
  return false;
}

/** Troca a extensão quando o tipo mudou (AVIF -> WebP); senão mantém o nome. */
function nomeParaOTipo(nome: string, original: string, novo: string): string {
  if (original === novo) return nome;
  return `${nome.replace(/\.[^./\\]+$/, "")}.webp`;
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
  const mime = MIME_DE_SAIDA.get(mimeOriginal);
  if (!mime) {
    return {
      redimensionar: false,
      lado: Math.max(largura, altura),
      mime: "image/jpeg",
    };
  }
  const maiorLado = Math.max(largura, altura);
  if (peso < PESO_MINIMO_PARA_REDIMENSIONAR) {
    return { redimensionar: false, lado: maiorLado, mime };
  }
  return {
    redimensionar: true,
    lado: Math.min(maiorLado, LADO_MAXIMO_UPLOAD),
    mime,
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
    if (!MIME_DE_SAIDA.has(file.type)) return file;
    // WebP/AVIF animado: o canvas guardaria só o 1º quadro. Intacto.
    if (
      (file.type === "image/webp" || file.type === "image/avif") &&
      (await ehAnimada(file))
    ) {
      return file;
    }

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
      // Navegador que não grava WebP devolve PNG: não troca o tipo à toa.
      if (plano.mime === "image/webp" && blob.type !== "image/webp") {
        return file;
      }

      return new File([blob], nomeParaOTipo(file.name, file.type, blob.type), {
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
