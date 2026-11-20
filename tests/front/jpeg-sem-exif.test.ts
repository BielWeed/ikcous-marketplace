import { limparExifJpeg } from "@/lib/jpeg-sem-exif";
import { describe, expect, it } from "vitest";
import { comExif, exifComGps, jpegSintetico } from "./fixtures/jpeg-com-gps";

describe("JPEG sem localização EXIF", () => {
  it("retira todos os EXIF, inclusive o GPS, sem tocar no SOI, DQT, APP1 não-EXIF e EOI", () => {
    const outroApp1 = new Uint8Array([0xff, 0xe1, 0, 5, 1, 2, 3]);
    const semExif = comExif(jpegSintetico, outroApp1);
    const original = comExif(semExif, exifComGps(), exifComGps(1, false));
    expect(limparExifJpeg(original)).toEqual(semExif);
    expect(original[4]).toBe(0);
    expect(original[5]).toBe(88);
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
