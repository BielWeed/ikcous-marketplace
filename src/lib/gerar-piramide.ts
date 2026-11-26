// Gera, no navegador da lojista, as 3 cópias reduzidas da foto (maior lado
// 240, 480 e 960 px) que sobem ANTES da original marcada -- plano das
// miniaturas, 26/11/2026; os nomes moram em `piramide-da-foto-nomes.ts`.
//
// SÓ O PAINEL importa este arquivo (as telas de produto e de banner o entregam
// ao envio como `opcoes.piramide`). Os hooks de envio não o importam: eles
// também são usados pela vitrine, e o canvas não tem o que fazer lá.
//
// `null` quer dizer "sobe a original sem marca, como hoje", e é a resposta a
// qualquer dúvida:
//   - tipo que o canvas não regrava (GIF pode ser animado, SVG é vetor, HEIC
//     e tipo desconhecido) -- a mesma lista do redimensionamento do envio;
//   - WebP/AVIF animado (o canvas guardaria só o 1º quadro);
//   - decodificação, contexto ou gravação que falha.
// Cópias em WebP (marca `w`). O navegador que não grava WebP (Safari antigo
// devolve PNG no lugar) leva as 3 em JPEG (marca `j`), com fundo branco onde a
// foto era transparente (JPEG não tem transparência: sem o fundo ela sairia
// preta). Nunca amplia: foto menor que o lado fica do tamanho dela.
import {
  type CopiaDaPiramide,
  LADOS,
  type LadoDaCopia,
  type MarcaDaPiramide,
  type Piramide,
} from "./piramide-da-foto-nomes";
import { MIME_DE_SAIDA, ehAnimada } from "./redimensiona-imagem";

const QUALIDADE = 0.8;

/** Uma cópia, já no MIME da marca, ou `null` se o navegador gravou outro. */
async function desenhar(
  bitmap: ImageBitmap,
  lado: LadoDaCopia,
  marca: MarcaDaPiramide,
): Promise<Blob | null> {
  const escala = Math.min(1, lado / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * escala));
  canvas.height = Math.max(1, Math.round(bitmap.height * escala));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (marca === "j") {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const mime = marca === "w" ? "image/webp" : "image/jpeg";
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, mime, QUALIDADE),
  );
  return blob && blob.type === mime ? blob : null;
}

/** As 3 cópias da foto, ou `null` (a original sobe sem marca, como hoje). */
export async function gerarPiramide(arquivo: File): Promise<Piramide | null> {
  try {
    if (!MIME_DE_SAIDA.has(arquivo.type)) return null;
    if (
      (arquivo.type === "image/webp" || arquivo.type === "image/avif") &&
      (await ehAnimada(arquivo))
    ) {
      return null;
    }
    const bitmap = await createImageBitmap(arquivo, {
      imageOrientation: "from-image",
    });
    try {
      if (!(bitmap.width > 0 && bitmap.height > 0)) return null;
      let marca: MarcaDaPiramide = "w";
      const copias: CopiaDaPiramide[] = [];
      for (const lado of LADOS) {
        let copia = await desenhar(bitmap, lado, marca);
        // A PRIMEIRA cópia decide o formato das três: WebP recusado vira JPEG.
        if (!copia && marca === "w" && copias.length === 0) {
          marca = "j";
          copia = await desenhar(bitmap, lado, marca);
        }
        if (!copia) return null;
        copias.push({ lado, arquivo: copia });
      }
      return { marca, copias };
    } finally {
      bitmap.close();
    }
  } catch {
    return null;
  }
}
