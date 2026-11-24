// @vitest-environment node
//
// Caça de provas fracas (mutação) em `arquivoJpegSemExif`, 24/11/2026: o
// embrulho que o upload de foto de produto e de banner chama antes de gravar.
// Só o teste de banner o exercitava, e quatro trocas sobreviviam: ler 2 bytes
// em vez de 3 para reconhecer o JPEG (a limpeza do GPS simplesmente não
// acontecia), devolver sempre um arquivo NOVO mesmo sem nada a limpar, e
// perder a data de modificação ou o tipo do arquivo original (tipo vazio
// continua vazio: o formulário aceita foto sem tipo pela extensão).
import { arquivoJpegSemExif } from "@/lib/jpeg-sem-exif";
import { describe, expect, it } from "vitest";
import { comExif, exifComGps, jpegSintetico } from "./fixtures/jpeg-com-gps";

const bytesDe = async (arquivo: File) =>
  new Uint8Array(await arquivo.arrayBuffer());

describe("arquivoJpegSemExif — o File que o upload recebe", () => {
  it("JPEG com GPS volta como arquivo NOVO, sem o GPS e com o mesmo nome, tipo e data", async () => {
    const original = new File(
      [comExif(jpegSintetico, exifComGps())],
      "IMG_7.JPG",
      {
        type: "image/jpeg",
        lastModified: 1_700_000_000_000,
      },
    );

    const limpo = await arquivoJpegSemExif(original);

    expect(limpo).not.toBe(original);
    expect(limpo.name).toBe("IMG_7.JPG");
    expect(limpo.type).toBe("image/jpeg");
    expect(limpo.lastModified).toBe(1_700_000_000_000);
    expect(await bytesDe(limpo)).toEqual(jpegSintetico);
  });

  it("JPEG sem tipo declarado (reconhecido só pelos bytes) é limpo e continua sem tipo", async () => {
    const original = new File(
      [comExif(jpegSintetico, exifComGps())],
      "foto.jpg",
      {
        type: "",
      },
    );

    const limpo = await arquivoJpegSemExif(original);

    expect(limpo.type).toBe("");
    expect(await bytesDe(limpo)).toEqual(jpegSintetico);
  });

  it("JPEG que não tem nada a limpar volta o MESMO arquivo, não uma cópia", async () => {
    const original = new File([jpegSintetico], "limpa.jpg", {
      type: "image/jpeg",
    });

    expect(await arquivoJpegSemExif(original)).toBe(original);
  });

  it.each([
    ["PNG", [137, 80, 78, 71, 13, 10, 26, 10]],
    ["arquivo de 2 bytes (só o começo do JPEG)", [0xff, 0xd8]],
    ["arquivo vazio", []],
  ])("%s volta o mesmo arquivo", async (_nome, bytes) => {
    const original = new File([new Uint8Array(bytes)], "x.jpg", {
      type: "image/jpeg",
    });

    expect(await arquivoJpegSemExif(original)).toBe(original);
  });

  it("se o arquivo não puder ser lido, o upload segue com o original (nunca lança)", async () => {
    const original = new File([comExif(jpegSintetico, exifComGps())], "x.jpg", {
      type: "image/jpeg",
    });
    original.arrayBuffer = () => Promise.reject(new Error("leitura falhou"));
    original.slice = () => {
      throw new Error("leitura falhou");
    };

    expect(await arquivoJpegSemExif(original)).toBe(original);
  });
});
