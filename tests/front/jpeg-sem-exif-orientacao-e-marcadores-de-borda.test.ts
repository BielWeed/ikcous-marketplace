// Caça de provas fracas (mutação) em `limparExifJpeg`, 24/11/2026. É a função
// que tira o GPS (e o resto do EXIF) da foto antes de ela ir para o armazenamento
// público; a fixture de `jpeg-sem-exif.test.ts` tem UMA IFD de duas entradas,
// com a orientação sempre em primeiro lugar, e 12 trocas sobreviviam. As que
// importam para quem tira foto no celular:
//
//  - a orientação vem DEPOIS de muitas outras entradas na IFD de uma câmera
//    real (aqui, a 7ª e última): se o laço parar cedo, a foto em retrato sobe
//    deitada;
//  - orientação só vale como SHORT, contagem 1 e valor de 2 a 8 (9 e 0xFFFF
//    não podem ser gravados no arquivo limpo; 8 tem de ser);
//  - TIFF sem a ordem de bytes "II"/"MM" ou cortado antes do endereço da
//    próxima IFD é ignorado, e o EXIF sai do mesmo jeito;
//  - JFXX (miniatura embutida) é APP0 mas NÃO é JFIF: sai; JFIF que só tem a
//    assinatura continua;
//  - bytes de preenchimento (0xFF 0xFF) antes de um marcador são válidos e não
//    podem esconder o EXIF com GPS;
//  - os OITO marcadores de reinício (RST0..RST7) dentro do scan são dado, não
//    fim: um scan com RST7 não pode devolver o original com o GPS dentro;
//  - arquivo que não começa com 0xFF 0xD8 devolve os mesmos bytes.
import { limparExifJpeg } from "@/lib/jpeg-sem-exif";
import { describe, expect, it } from "vitest";
import {
  cabecalhoJpegSintetico,
  comExif,
  exifComGps,
  jpegSintetico,
} from "./fixtures/jpeg-com-gps";

const ASSINATURA_EXIF = [69, 120, 105, 102, 0, 0]; // "Exif\0\0"

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

/** Uma entrada de IFD (12 bytes). SHORT guarda o valor em 2 bytes. */
function entrada(
  tag: number,
  tipo: number,
  contagem: number,
  valor: number,
  little: boolean,
) {
  const e = new Uint8Array(12);
  const v = new DataView(e.buffer);
  v.setUint16(0, tag, little);
  v.setUint16(2, tipo, little);
  v.setUint32(4, contagem, little);
  if (tipo === 3) v.setUint16(8, valor, little);
  else v.setUint32(8, valor, little);
  return e;
}

/** APP1/Exif com uma IFD só, no formato que se quer (sem GPS: o assunto é a orientação). */
function app1ComIfd(
  entradas: Uint8Array[],
  {
    little = false,
    ordem,
    semProximaIfd = false,
  }: { little?: boolean; ordem?: number[]; semProximaIfd?: boolean } = {},
) {
  const tamanhoDoTiff = 8 + 2 + entradas.length * 12 + (semProximaIfd ? 0 : 4);
  const total = 2 + 2 + ASSINATURA_EXIF.length + tamanhoDoTiff;
  const seg = new Uint8Array(total);
  const v = new DataView(seg.buffer);
  seg.set([0xff, 0xe1]);
  v.setUint16(2, total - 2);
  seg.set(ASSINATURA_EXIF, 4);
  const tiff = 4 + ASSINATURA_EXIF.length;
  seg.set(ordem ?? (little ? [0x49, 0x49] : [0x4d, 0x4d]), tiff);
  v.setUint16(tiff + 2, 42, little);
  v.setUint32(tiff + 4, 8, little);
  v.setUint16(tiff + 8, entradas.length, little);
  entradas.forEach((e, i) => seg.set(e, tiff + 10 + i * 12));
  return seg;
}

/** O que a limpeza grava no lugar do EXIF: uma entrada só, com a orientação. */
function exifSoComOrientacao(valor: number) {
  return new Uint8Array([
    0xff,
    0xe1,
    0,
    34,
    69,
    120,
    105,
    102,
    0,
    0,
    0x4d,
    0x4d,
    0,
    42,
    0,
    0,
    0,
    8,
    0,
    1,
    1,
    0x12,
    0,
    3,
    0,
    0,
    0,
    1,
    0,
    valor,
    0,
    0,
    0,
    0,
    0,
    0,
  ]);
}

/** Seis entradas à frente da orientação (que fecha a IFD), como numa câmera de verdade. */
const TAGS_ANTES_DA_ORIENTACAO = [
  0x0100, 0x0101, 0x010e, 0x010f, 0x0110, 0x0111,
];
function ifdDeCamera(valorDaOrientacao: number, little: boolean) {
  return [
    ...TAGS_ANTES_DA_ORIENTACAO.map((tag) => entrada(tag, 3, 1, 1, little)),
    entrada(0x0112, 3, 1, valorDaOrientacao, little),
  ];
}

describe("orientação dentro de uma IFD de câmera (várias entradas)", () => {
  it.each([true, false])(
    "orientação 6 como 7ª e última entrada da IFD é mantida (TIFF little-endian: %s)",
    (little) => {
      const original = comExif(
        jpegSintetico,
        app1ComIfd(ifdDeCamera(6, little), { little }),
      );

      expect(limparExifJpeg(original)).toEqual(
        comExif(jpegSintetico, exifSoComOrientacao(6)),
      );
    },
  );

  it.each([2, 3, 4, 5, 6, 7, 8])(
    "orientação %i (inclusive o limite 8) é regravada no arquivo limpo",
    (valor) => {
      const original = comExif(
        jpegSintetico,
        app1ComIfd([entrada(0x0112, 3, 1, valor, false)]),
      );

      expect(limparExifJpeg(original)).toEqual(
        comExif(jpegSintetico, exifSoComOrientacao(valor)),
      );
    },
  );

  it.each([
    ["orientação 0", 0, 3, 1],
    ["orientação 9", 9, 3, 1],
    ["orientação 65535", 0xffff, 3, 1],
    // LONG guarda o número nos 4 bytes; 6 << 16 deixa o "6" onde um SHORT o leria.
    ["tipo LONG em vez de SHORT", 6 << 16, 4, 1],
    ["contagem 2", 6, 3, 2],
  ])(
    "%s é ignorada: o EXIF sai e nenhuma orientação é gravada",
    (_motivo, valor, tipo, contagem) => {
      const original = comExif(
        jpegSintetico,
        app1ComIfd([entrada(0x0112, tipo, contagem, valor, false)]),
      );

      expect(limparExifJpeg(original)).toEqual(jpegSintetico);
    },
  );

  it("TIFF sem a ordem de bytes 'II' ou 'MM' é ignorado: o EXIF sai", () => {
    const original = comExif(
      jpegSintetico,
      app1ComIfd([entrada(0x0112, 3, 1, 6, false)], { ordem: [0x58, 0x58] }),
    );

    expect(limparExifJpeg(original)).toEqual(jpegSintetico);
  });

  it("TIFF cortado antes do endereço da próxima IFD é ignorado: o EXIF sai", () => {
    const original = comExif(
      jpegSintetico,
      app1ComIfd([entrada(0x0112, 3, 1, 6, false)], { semProximaIfd: true }),
    );

    expect(limparExifJpeg(original)).toEqual(jpegSintetico);
  });
});

describe("APP0 e marcadores de preenchimento", () => {
  it("JFXX (miniatura embutida) não é JFIF: sai junto com o EXIF", () => {
    const jfxx = segmento(0xe0, "JFXX\0\x10miniatura");

    expect(limparExifJpeg(comExif(jpegSintetico, jfxx, exifComGps()))).toEqual(
      jpegSintetico,
    );
  });

  it("JFIF que traz só a assinatura continua no arquivo", () => {
    const jfifMinimo = segmento(0xe0, "JFIF\0");

    expect(
      limparExifJpeg(comExif(jpegSintetico, jfifMinimo, exifComGps())),
    ).toEqual(comExif(jpegSintetico, jfifMinimo));
  });

  it("bytes 0xFF de preenchimento antes do marcador do EXIF não o escondem", () => {
    const comPreenchimento = new Uint8Array([0xff, ...exifComGps()]);
    const limpo = limparExifJpeg(comExif(jpegSintetico, comPreenchimento));

    // O preenchimento é inofensivo e fica; o que importa é o GPS ter saído.
    expect(limpo).toEqual(
      new Uint8Array([0xff, 0xd8, 0xff, ...jpegSintetico.subarray(2)]),
    );
  });
});

describe("scan com todos os marcadores de reinício", () => {
  it("RST0 a RST7 dentro do scan são dado de imagem: o GPS sai e o scan fica inteiro", () => {
    const reinicios = Array.from({ length: 8 }, (_, i) => [
      0xff,
      0xd0 + i,
      i + 1,
    ]);
    const jpeg = new Uint8Array([
      ...cabecalhoJpegSintetico,
      0xff,
      0xda,
      0,
      8,
      1,
      1,
      0,
      0,
      63,
      0,
      0x3f,
      ...reinicios.flat(),
      0xff,
      0xd9,
    ]);

    expect(limparExifJpeg(comExif(jpeg, exifComGps()))).toEqual(jpeg);
  });
});

describe("o que não é JPEG", () => {
  it.each([
    ["primeiro byte errado", 0],
    ["segundo byte errado", 1],
  ])(
    "%s: devolve os mesmos bytes, mesmo com um EXIF dentro",
    (_motivo, indice) => {
      const original = comExif(jpegSintetico, exifComGps()).slice();
      original.fill(0x00, indice, indice + 1);

      expect(limparExifJpeg(original)).toBe(original);
    },
  );
});

describe("estrutura do quadro e do scan: o que é válido limpa, o que é malformado fica como veio", () => {
  const SOS = [0xff, 0xda, 0, 8, 1, 1, 0, 0, 63, 0];
  const FIM_DO_SCAN = [0x3f, 0xff, 0xd9];
  const seguro = (jpeg: Uint8Array) => comExif(jpeg, exifComGps());

  /** O JPEG sintético, trocando o SOF (13 bytes, do 0xFF ao último byte) por outro. */
  function comSof(...novoSof: number[]) {
    const inicio = jpegSintetico.indexOf(0xc0) - 1;
    return new Uint8Array([
      ...jpegSintetico.subarray(0, inicio),
      ...novoSof,
      ...jpegSintetico.subarray(inicio + 13),
    ]);
  }

  /** O JPEG sintético, trocando o cabeçalho do SOS por outro. */
  function comSos(...novoSos: number[]) {
    return new Uint8Array([
      ...cabecalhoJpegSintetico,
      ...novoSos,
      ...FIM_DO_SCAN,
    ]);
  }

  it("marcador TEM (0xFF 0x01, sem comprimento) no meio do arquivo não impede a limpeza", () => {
    const comTem = new Uint8Array([
      0xff,
      0xd8,
      0xff,
      0x01,
      ...jpegSintetico.subarray(2),
    ]);

    expect(limparExifJpeg(seguro(comTem))).toEqual(comTem);
  });

  it("segmento vazio mas válido (COM de comprimento 2) é removido junto com o EXIF", () => {
    const comentarioVazio = new Uint8Array([0xff, 0xfe, 0, 2]);

    expect(
      limparExifJpeg(comExif(jpegSintetico, comentarioVazio, exifComGps())),
    ).toEqual(jpegSintetico);
  });

  it("SOF15 (o último marcador de quadro) vale como quadro: o EXIF sai", () => {
    const jpeg = jpegSintetico.slice();
    jpeg[jpeg.indexOf(0xc0)] = 0xcf;

    expect(limparExifJpeg(seguro(jpeg))).toEqual(jpeg);
  });

  it("segmento que anuncia mais bytes do que o arquivo tem: devolve o original, sem lançar", () => {
    const original = new Uint8Array([
      0xff,
      0xd8,
      ...exifComGps(),
      0xff,
      0xc0,
      0,
      11,
      8,
      0,
    ]);

    expect(limparExifJpeg(original)).toBe(original);
  });

  it("SOF com largura zero é malformado: devolve o original", () => {
    const jpeg = jpegSintetico.slice();
    jpeg[jpeg.indexOf(0xc0) + 7] = 0; // byte baixo da largura (era 1)
    const original = seguro(jpeg);

    expect(limparExifJpeg(original)).toBe(original);
  });

  it("SOF com um byte a mais do que os componentes explicam é malformado: devolve o original", () => {
    const original = seguro(
      comSof(0xff, 0xc0, 0, 12, 8, 0, 1, 0, 1, 1, 1, 0x11, 0, 0),
    );

    expect(limparExifJpeg(original)).toBe(original);
  });

  it("dois quadros: os componentes do primeiro não valem para o scan do segundo", () => {
    // Primeiro quadro com o componente 1, segundo com o componente 2; o scan
    // pede o componente 1, que o quadro vigente (o segundo) não tem.
    const original = seguro(
      comSof(
        0xff,
        0xc0,
        0,
        11,
        8,
        0,
        1,
        0,
        1,
        1,
        1,
        0x11,
        0,
        0xff,
        0xc0,
        0,
        11,
        8,
        0,
        1,
        0,
        1,
        1,
        2,
        0x11,
        0,
      ),
    );

    expect(limparExifJpeg(original)).toBe(original);
  });

  it("SOS que lista o mesmo componente duas vezes (mais componentes que o quadro): devolve o original", () => {
    const original = seguro(comSos(0xff, 0xda, 0, 10, 2, 1, 0, 1, 0, 0, 63, 0));

    expect(limparExifJpeg(original)).toBe(original);
  });

  it("SOS com um byte a mais no cabeçalho é malformado: devolve o original", () => {
    const original = seguro(comSos(0xff, 0xda, 0, 9, 1, 1, 0, 0, 63, 0, 0));

    expect(limparExifJpeg(original)).toBe(original);
  });

  it("scan cujo único dado é um byte 0xFF estufado (FF 00) conta como dado: o EXIF sai", () => {
    const jpeg = new Uint8Array([
      ...cabecalhoJpegSintetico,
      ...SOS,
      0xff,
      0x00,
      0xff,
      0xd9,
    ]);

    expect(limparExifJpeg(seguro(jpeg))).toEqual(jpeg);
  });

  it("o mesmo SOS bem formado, como controle, é limpo", () => {
    const jpeg = comSos(...SOS);

    expect(limparExifJpeg(seguro(jpeg))).toEqual(jpeg);
  });
});

describe("APP que não é APP1 não empresta orientação, e APP15 sai", () => {
  it("TIFF com orientação dentro de um APP3 não vira a orientação do arquivo", () => {
    const tiffNoApp1 = app1ComIfd([entrada(0x0112, 3, 1, 6, false)]);
    const noApp3 = tiffNoApp1.slice();
    noApp3[1] = 0xe3;

    expect(limparExifJpeg(comExif(jpegSintetico, noApp3))).toEqual(
      jpegSintetico,
    );
  });

  it("APP15 (último APPn) é removido", () => {
    const app15 = segmento(0xef, "Rua Exemplo, 42");

    expect(limparExifJpeg(comExif(jpegSintetico, app15))).toEqual(
      jpegSintetico,
    );
  });
});
