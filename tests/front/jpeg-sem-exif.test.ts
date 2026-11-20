import { limparExifJpeg } from "@/lib/jpeg-sem-exif";
import { describe, expect, it } from "vitest";
import { comExif, exifComGps, jpegSintetico } from "./fixtures/jpeg-com-gps";

function segmento(marcador: number, conteudo: string) {
  const dados = new TextEncoder().encode(conteudo);
  const tamanho = dados.length + 2;
  return new Uint8Array([
    0xff,
    marcador,
    tamanho >> 8,
    tamanho & 255,
    ...dados,
  ]);
}

describe("JPEG sem metadados de localização", () => {
  it("retira todos os EXIF, inclusive o GPS, sem tocar em SOI, DQT e EOI", () => {
    const original = comExif(jpegSintetico, exifComGps(), exifComGps(1, false));
    expect(limparExifJpeg(original)).toEqual(jpegSintetico);
    expect(original[4]).toBe(0);
    expect(original[5]).toBe(88);
  });

  it("remove XMP, IPTC, comentário e APP desconhecido, preservando JFIF, ICC e Adobe", () => {
    const jfif = segmento(0xe0, "JFIF\0\x01\x02\0\0\x01\0\x01\0\0");
    const perfil = segmento(0xe2, "ICC_PROFILE\0\x01\x01perfil");
    const adobe = segmento(0xee, "Adobe\0\x64\0\0\0\0\x01");
    const xmp = segmento(
      0xe1,
      "http://ns.adobe.com/xap/1.0/\0<exif:GPSLatitude>12,34N</exif:GPSLatitude>",
    );
    const iptc = segmento(0xed, "Photoshop 3.0\0Rua Exemplo, 42");
    const comentario = segmento(0xfe, "Rua Exemplo, 42");
    const outroApp = segmento(0xe3, "Rua Exemplo, 42");
    const original = comExif(
      jpegSintetico,
      jfif,
      xmp,
      perfil,
      iptc,
      adobe,
      comentario,
      outroApp,
    );

    const limpo = limparExifJpeg(original);
    expect(limpo).toEqual(comExif(jpegSintetico, jfif, perfil, adobe));
    const texto = new TextDecoder().decode(limpo);
    expect(texto).not.toContain("GPSLatitude");
    expect(texto).not.toContain("Rua Exemplo, 42");
  });

  it("descarta o índice MPF e a segunda imagem com GPS", () => {
    const mpf = segmento(0xe2, "MPF\0MM\0*");
    const principal = comExif(jpegSintetico, mpf);
    const adicional = comExif(jpegSintetico, exifComGps());
    const original = new Uint8Array([...principal, ...adicional]);
    expect(limparExifJpeg(original)).toEqual(jpegSintetico);
  });

  it("descarta bytes depois do primeiro EOI mesmo sem índice MPF", () => {
    const original = new Uint8Array([...jpegSintetico, ...exifComGps()]);
    expect(limparExifJpeg(original)).toEqual(jpegSintetico);
  });

  it.each([true, false])(
    "mantém só a orientação 6 (TIFF little-endian: %s)",
    (little) => {
      // TIFF big-endian canônico, uma entrada Orientation=6, sem IFD seguinte.
      const soOrientacao = new Uint8Array([
        0xff, 0xe1, 0, 34, 69, 120, 105, 102, 0, 0, 0x4d, 0x4d, 0, 42, 0, 0, 0,
        8, 0, 1, 1, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0,
      ]);
      const original = comExif(
        jpegSintetico,
        exifComGps(6, little),
        exifComGps(),
      );
      expect(limparExifJpeg(original)).toEqual(
        comExif(jpegSintetico, soOrientacao),
      );
    },
  );

  it("limpa EXIF entre varreduras de JPEG progressivo sem confundir dados e marcadores", () => {
    const scan = [
      0xff, 0xda, 0, 8, 1, 1, 0, 0, 0, 0, 5, 0xff, 0, 0xe1, 0xff, 0xd0, 7,
    ];
    const cabecalho = jpegSintetico.subarray(0, -2);
    const esperado = new Uint8Array([
      ...cabecalho,
      ...scan,
      ...scan,
      0xff,
      0xd9,
    ]);
    const original = new Uint8Array([
      ...cabecalho,
      ...scan,
      ...exifComGps(),
      ...scan,
      0xff,
      0xd9,
    ]);
    expect(limparExifJpeg(original)).toEqual(esperado);
  });

  it("devolve os próprios bytes quando não é JPEG ou quando não tem EXIF", () => {
    const png = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(limparExifJpeg(png)).toBe(png);
    expect(limparExifJpeg(jpegSintetico)).toBe(jpegSintetico);
  });

  it("devolve os próprios bytes quando um segmento posterior está truncado", () => {
    const original = comExif(jpegSintetico, exifComGps()).slice(0, 105);
    expect(limparExifJpeg(original)).toBe(original);
  });

  it("mantém o original sem marcador de fim, mesmo se já encontrou EXIF", () => {
    const original = comExif(jpegSintetico, exifComGps()).slice(0, -2);
    expect(limparExifJpeg(original)).toBe(original);
  });
});
