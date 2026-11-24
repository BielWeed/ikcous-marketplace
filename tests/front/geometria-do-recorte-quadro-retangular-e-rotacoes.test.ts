// Caça de provas fracas (mutação) na geometria do recorte, 24/11/2026.
//
// Todos os casos de `geometria-do-recorte.test.ts` usam viewport QUADRADO
// (500x500), e nesse quadro trocar largura por altura não muda nada: a escala
// que cobre o quadro é a mesma com ou sem rotação, e a altura do arquivo
// exportado é igual à largura. Resultado medido: oito mutações sobreviviam
// (ignorar a rotação de 270°, trocar a razão altura/largura do arquivo,
// arredondar para baixo, desenhar a altura com a largura natural...) e o
// banner do painel (quadro 2:1) sairia cortado errado sem nenhum teste cair.
//
// Aqui o quadro é de banner (2:1) e as imagens não são quadradas, com contas
// feitas à mão, para que cada eixo tenha um número diferente.
import { describe, expect, it } from "vitest";

import {
  calcularParametrosDeRecorte,
  clampOffset,
  getBaseScale,
} from "@/lib/geometria-do-recorte";

describe("getBaseScale — quadro retangular", () => {
  const retrato = { naturalWidth: 1000, naturalHeight: 2000 };
  const banner = { viewportWidth: 800, viewportHeight: 400 };

  it("sem rotação e a 180°, a largura manda: 800/1000 = 0,8", () => {
    expect(getBaseScale({ ...retrato, ...banner, rotation: 0 })).toBe(0.8);
    expect(getBaseScale({ ...retrato, ...banner, rotation: 180 })).toBe(0.8);
  });

  it("a 90° e a 270° os eixos trocam: a imagem vira 2000x1000 e a escala cai para 0,4", () => {
    expect(getBaseScale({ ...retrato, ...banner, rotation: 90 })).toBe(0.4);
    expect(getBaseScale({ ...retrato, ...banner, rotation: 270 })).toBe(0.4);
  });

  it("basta UMA das duas dimensões naturais zerada para valer 1 (não vira Infinity)", () => {
    expect(
      getBaseScale({
        naturalWidth: 0,
        naturalHeight: 800,
        ...banner,
        rotation: 0,
      }),
    ).toBe(1);
    expect(
      getBaseScale({
        naturalWidth: 600,
        naturalHeight: 0,
        ...banner,
        rotation: 0,
      }),
    ).toBe(1);
  });
});

describe("clampOffset — quadro retangular e as duas rotações de lado", () => {
  // Imagem 2000x1000 em quadro 800x400, escala 0,8, zoom 1.
  const base = {
    naturalWidth: 2000,
    naturalHeight: 1000,
    viewportWidth: 800,
    viewportHeight: 400,
    baseScale: 0.8,
    zoom: 1,
  };

  it("sem rotação: largura 1600 e altura 800 dão folga nos dois eixos", () => {
    // minX = 800 - 1600/2 - 1000 = -1000; maxX = 1600/2 - 1000 = -200
    // minY = 400 - 800/2 - 500  = -500;  maxY = 800/2 - 500  = -100
    expect(clampOffset({ ...base, rotation: 0, x: -9999, y: -9999 })).toEqual({
      x: -1000,
      y: -500,
    });
    expect(clampOffset({ ...base, rotation: 0, x: 9999, y: 9999 })).toEqual({
      x: -200,
      y: -100,
    });
  });

  it.each([90, 270] as const)(
    "a %i° a imagem ocupa 800x1600: X fica cravado em -600 e Y tem folga de -900 a 300",
    (rotation) => {
      // largura = 1000*0,8 = 800 (cobre o quadro sem folga); altura = 2000*0,8 = 1600
      // minX = 800 - 800/2 - 1000 = -600; maxX = 800/2 - 1000 = -600
      // minY = 400 - 1600/2 - 500 = -900; maxY = 1600/2 - 500 = 300
      expect(clampOffset({ ...base, rotation, x: 9999, y: 9999 })).toEqual({
        x: -600,
        y: 300,
      });
      expect(clampOffset({ ...base, rotation, x: -9999, y: -9999 })).toEqual({
        x: -600,
        y: -900,
      });
    },
  );
});

describe("calcularParametrosDeRecorte — quadro de banner 2:1", () => {
  const entrada = {
    naturalWidth: 2000,
    naturalHeight: 1000,
    viewportWidth: 800,
    viewportHeight: 400,
    exportWidth: 1600,
    baseScale: 0.5,
    zoom: 1.5,
    offset: { x: -100, y: 20 },
    rotation: 0,
    fineRotation: 0,
  };

  it("o arquivo sai com a MESMA proporção do quadro: 1600 de largura pedem 800 de altura", () => {
    const r = calcularParametrosDeRecorte(entrada);

    expect(r.targetWidth).toBe(1600);
    expect(r.targetHeight).toBe(800);
    expect(r.scaleCanvas).toBe(2);
  });

  it("o centro do canvas usa a altura DO CANVAS (400), não a largura (800)", () => {
    const r = calcularParametrosDeRecorte(entrada);

    expect(r.translateParaCentro).toEqual({ x: 800, y: 400 });
  });

  it("a imagem é desenhada com a altura natural (1000), não com a largura, sobre a escala 0,5*1,5*2", () => {
    const r = calcularParametrosDeRecorte(entrada);

    // physScale = 0,5 * 1,5 * 2 = 1,5
    expect(r.desenho).toEqual({
      x: -1500,
      y: -750,
      largura: 3000,
      altura: 1500,
    });
  });

  it("o deslocamento sai do centro do quadro: x = (-100+1000-400)*2, y = (20+500-200)*2", () => {
    const r = calcularParametrosDeRecorte(entrada);

    expect(r.translateAntesDaRotacao).toEqual({ x: 1000, y: 640 });
  });

  it("altura do arquivo é ARREDONDADA, não cortada: 1000 x (400/600) = 666,67 vira 667", () => {
    const r = calcularParametrosDeRecorte({
      ...entrada,
      viewportWidth: 600,
      viewportHeight: 400,
      exportWidth: 1000,
    });

    expect(r.targetHeight).toBe(667);
  });
});
