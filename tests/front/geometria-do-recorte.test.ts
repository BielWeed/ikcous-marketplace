// Achado ImageAdjuster-963 (frente edge-e-imagens, 15/09/2026): a
// matemática de recorte/zoom/rotação do ImageAdjuster (getBaseScale,
// clampOffset, handleCrop) não tinha nenhum teste dedicado — só o scrim de
// contraste era coberto (tests/front/banner-legivel-e-que-para.test.tsx).
// Este arquivo cobre as três funções puras extraídas para
// src/lib/geometria-do-recorte.ts, sem precisar montar o componente nem
// mockar canvas: são só contas com número de entrada e número de saída.
import { describe, expect, it } from "vitest";

import {
  calcularParametrosDeRecorte,
  clampOffset,
  getBaseScale,
} from "@/lib/geometria-do-recorte";

describe("getBaseScale: escala mínima para a imagem cobrir o viewport", () => {
  it("sem imagem carregada ainda (dimensões zeradas): devolve 1, não divide por zero", () => {
    expect(
      getBaseScale({
        naturalWidth: 0,
        naturalHeight: 0,
        viewportWidth: 400,
        viewportHeight: 300,
        rotation: 0,
      }),
    ).toBe(1);
  });

  it("imagem paisagem (mais larga que o viewport) num quadro quadrado: escala pela altura", () => {
    // Imagem 2000x1000 (2:1) num quadro 500x500 (1:1). Para cobrir sem
    // sobrar fundo, o gargalo é a altura: 500/1000 = 0.5. Pela largura
    // daria só 0.25, que deixaria tarja em cima/embaixo — por isso Math.max.
    const escala = getBaseScale({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 500,
      viewportHeight: 500,
      rotation: 0,
    });
    expect(escala).toBe(0.5);
  });

  it("imagem retrato (mais alta que larga) no mesmo quadro quadrado: escala pela largura", () => {
    // Imagem 1000x2000 (1:2) num quadro 500x500. Gargalo agora é a
    // largura: 500/1000 = 0.5 (pela altura daria só 0.25).
    const escala = getBaseScale({
      naturalWidth: 1000,
      naturalHeight: 2000,
      viewportWidth: 500,
      viewportHeight: 500,
      rotation: 0,
    });
    expect(escala).toBe(0.5);
  });

  it("imagem quadrada num quadro retangular: as duas escalas batem", () => {
    const escala = getBaseScale({
      naturalWidth: 1000,
      naturalHeight: 1000,
      viewportWidth: 400,
      viewportHeight: 200,
      rotation: 0,
    });
    // scaleX = 400/1000 = 0.4; scaleY = 200/1000 = 0.2 -> cobre com 0.4
    expect(escala).toBe(0.4);
  });

  it("rotação de 90°: largura e altura naturais trocam de papel antes de comparar com o viewport", () => {
    // Mesma imagem 2000x1000 paisagem de cima, agora girada 90°: o lado
    // que enfrenta a largura do viewport passa a ser o natural-height
    // (1000) e vice-versa — o resultado tem que ser igual ao de uma
    // imagem 1000x2000 SEM rotação no mesmo viewport.
    const comRotacao = getBaseScale({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 500,
      viewportHeight: 500,
      rotation: 90,
    });
    const semRotacaoEquivalente = getBaseScale({
      naturalWidth: 1000,
      naturalHeight: 2000,
      viewportWidth: 500,
      viewportHeight: 500,
      rotation: 0,
    });
    expect(comRotacao).toBe(semRotacaoEquivalente);
  });

  it("rotação de 270°: mesmo efeito de troca de eixos que 90°", () => {
    const com270 = getBaseScale({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 500,
      viewportHeight: 500,
      rotation: 270,
    });
    const com90 = getBaseScale({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 500,
      viewportHeight: 500,
      rotation: 90,
    });
    expect(com270).toBe(com90);
  });

  it("rotação de 180°: NÃO troca eixos (só 90/270 trocam)", () => {
    const com180 = getBaseScale({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 500,
      viewportHeight: 500,
      rotation: 180,
    });
    const semRotacao = getBaseScale({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 500,
      viewportHeight: 500,
      rotation: 0,
    });
    expect(com180).toBe(semRotacao);
  });
});

describe("clampOffset: o pan nunca deixa borda vazia no quadro de recorte", () => {
  // Imagem quadrada 1000x1000 num viewport 500x500 (zoom 1: baseScale
  // cobriria com 0.5, então largura/altura escalada = 500 = viewport;
  // nesse caso min===max===0 nos dois eixos: não há folga nenhuma).
  const base = {
    naturalWidth: 1000,
    naturalHeight: 1000,
    viewportWidth: 500,
    viewportHeight: 500,
    rotation: 0 as const,
  };

  it("zoom 1 sem folga: qualquer tentativa de arrastar é cravada num único ponto", () => {
    // escala = 0.5, largura/altura escaladas = 500 (igual ao viewport).
    // minX = 500 - 500/2 - 1000/2 = 500-250-500 = -250
    // maxX = 500/2 - 1000/2 = 250-500 = -250 -> min===max, sem folga.
    const resultado = clampOffset({
      ...base,
      baseScale: 0.5,
      zoom: 1,
      x: 999,
      y: -999,
    });
    expect(resultado).toEqual({ x: -250, y: -250 });
  });

  it("zoom 3: os 4 cantos ficam dentro do limite calculado (largura/altura escaladas)", () => {
    // baseScale 0.5 * zoom 3 = escala 1.5 -> imagem escalada 1500x1500.
    // minX = viewport(500) - 1500/2 - 1000/2 = 500 - 750 - 500 = -750
    // maxX = 1500/2 - 1000/2 = 750 - 500 = 250 (mesma conta pra Y, é quadrada)
    const params = { ...base, baseScale: 0.5, zoom: 3 };

    const cantoSuperiorEsquerdo = clampOffset({
      ...params,
      x: -9999,
      y: -9999,
    });
    expect(cantoSuperiorEsquerdo).toEqual({ x: -750, y: -750 });

    const cantoInferiorDireito = clampOffset({ ...params, x: 9999, y: 9999 });
    expect(cantoInferiorDireito).toEqual({ x: 250, y: 250 });

    const cantoSuperiorDireito = clampOffset({ ...params, x: 9999, y: -9999 });
    expect(cantoSuperiorDireito).toEqual({ x: 250, y: -750 });

    const cantoInferiorEsquerdo = clampOffset({ ...params, x: -9999, y: 9999 });
    expect(cantoInferiorEsquerdo).toEqual({ x: -750, y: 250 });

    // Um valor já dentro da faixa não é alterado.
    const dentroDaFaixa = clampOffset({ ...params, x: 10, y: -10 });
    expect(dentroDaFaixa).toEqual({ x: 10, y: -10 });
  });

  it("imagem menor que o viewport nesse eixo: centraliza em vez de inverter o clamp", () => {
    // Imagem 200x200 num viewport 500x500, baseScale 1 (sem cobrir de
    // verdade — caso de zoom bem baixo numa foto pequena). largura
    // escalada = 200 < 500: minX > maxX, então centraliza:
    // cx = (500 - 200) / 2 = 150.
    const resultado = clampOffset({
      naturalWidth: 200,
      naturalHeight: 200,
      viewportWidth: 500,
      viewportHeight: 500,
      rotation: 0,
      baseScale: 1,
      zoom: 1,
      x: 999,
      y: -999,
    });
    expect(resultado).toEqual({ x: 150, y: 150 });
  });

  it("rotação de 90°: o limite usa a altura natural no eixo X (eixos trocados)", () => {
    // Imagem 2000x1000 rotacionada 90°, viewport 500x500, baseScale 0.5,
    // zoom 1: rotacionada=true, então "w" usa naturalHeight (1000) e "h"
    // usa naturalWidth (2000). largura escalada = 1000*0.5=500 (bate
    // exato com o viewport -> sem folga em X); altura escalada =
    // 2000*0.5=1000 (tem folga em Y).
    // minX = 500 - 500/2 - 2000/2 = 500-250-1000 = -750 (usa naturalWidth=2000 no /2)
    // maxX = 500/2 - 2000/2 = 250-1000 = -750 -> min===max, sem folga em X
    // minY = 500 - 1000/2 - 1000/2 = 500-500-500 = -500
    // maxY = 1000/2 - 1000/2 = 500-500 = 0
    const resultado = clampOffset({
      naturalWidth: 2000,
      naturalHeight: 1000,
      viewportWidth: 500,
      viewportHeight: 500,
      rotation: 90,
      baseScale: 0.5,
      zoom: 1,
      x: 9999,
      y: 9999,
    });
    expect(resultado.x).toBe(-750);
    expect(resultado.y).toBe(0);
  });
});

describe("calcularParametrosDeRecorte: coordenadas que handleCrop desenha no canvas", () => {
  it("sem zoom, sem offset, sem rotação: a imagem cai centralizada no canvas de exportação", () => {
    // Viewport 500x500 (quadrado), exportWidth 1000 -> canvas 1000x1000,
    // scaleCanvas = 2. Imagem natural 500x500 com baseScale 1 (já cobre o
    // viewport 1:1) e offset (0,0) coincidindo com o centro do viewport.
    const resultado = calcularParametrosDeRecorte({
      naturalWidth: 500,
      naturalHeight: 500,
      viewportWidth: 500,
      viewportHeight: 500,
      exportWidth: 1000,
      baseScale: 1,
      zoom: 1,
      offset: { x: 0, y: 0 },
      rotation: 0,
      fineRotation: 0,
    });

    expect(resultado.targetWidth).toBe(1000);
    expect(resultado.targetHeight).toBe(1000);
    expect(resultado.scaleCanvas).toBe(2);
    expect(resultado.translateParaCentro).toEqual({ x: 500, y: 500 });
    // offset (0,0): imgLeftFromCenter = 0 + 250 - 250 = 0 -> translate 0.
    expect(resultado.translateAntesDaRotacao).toEqual({ x: 0, y: 0 });
    expect(resultado.anguloEmRadianos).toBe(0);
    // physScale = baseScale(1) * zoom(1) * scaleCanvas(2) = 2.
    // imgDrawW/H = 500 * 2 = 1000 -> desenho centrado em -500,-500,1000,1000.
    expect(resultado.desenho).toEqual({
      x: -500,
      y: -500,
      largura: 1000,
      altura: 1000,
    });
  });

  it("zoom 2x: dobra o retângulo de desenho sem mexer nos translates de posição", () => {
    const resultado = calcularParametrosDeRecorte({
      naturalWidth: 500,
      naturalHeight: 500,
      viewportWidth: 500,
      viewportHeight: 500,
      exportWidth: 1000,
      baseScale: 1,
      zoom: 2,
      offset: { x: 0, y: 0 },
      rotation: 0,
      fineRotation: 0,
    });

    // physScale = 1 * 2 * 2 = 4 -> imgDrawW/H = 500*4 = 2000.
    expect(resultado.desenho).toEqual({
      x: -1000,
      y: -1000,
      largura: 2000,
      altura: 2000,
    });
    // Zoom não desloca o centro: o translate de posição continua igual.
    expect(resultado.translateAntesDaRotacao).toEqual({ x: 0, y: 0 });
  });

  it("rotação de 90°: converte para radianos e soma o ajuste fino", () => {
    const resultado = calcularParametrosDeRecorte({
      naturalWidth: 500,
      naturalHeight: 500,
      viewportWidth: 500,
      viewportHeight: 500,
      exportWidth: 1000,
      baseScale: 1,
      zoom: 1,
      offset: { x: 0, y: 0 },
      rotation: 90,
      fineRotation: 5,
    });

    expect(resultado.anguloEmRadianos).toBeCloseTo((95 * Math.PI) / 180, 10);
  });

  it("rotação de 270°: mesma conversão, outro ângulo", () => {
    const resultado = calcularParametrosDeRecorte({
      naturalWidth: 500,
      naturalHeight: 500,
      viewportWidth: 500,
      viewportHeight: 500,
      exportWidth: 1000,
      baseScale: 1,
      zoom: 1,
      offset: { x: 0, y: 0 },
      rotation: 270,
      fineRotation: 0,
    });

    expect(resultado.anguloEmRadianos).toBeCloseTo((270 * Math.PI) / 180, 10);
  });

  it("offset deslocado: o translate de posição acompanha o arrasto, convertido para px de canvas", () => {
    // offset.x = 50 -> imgLeftFromCenter = 50 + 250 - 250 = 50; em px de
    // canvas (scaleCanvas=2): 100.
    const resultado = calcularParametrosDeRecorte({
      naturalWidth: 500,
      naturalHeight: 500,
      viewportWidth: 500,
      viewportHeight: 500,
      exportWidth: 1000,
      baseScale: 1,
      zoom: 1,
      offset: { x: 50, y: -30 },
      rotation: 0,
      fineRotation: 0,
    });

    expect(resultado.translateAntesDaRotacao).toEqual({ x: 100, y: -60 });
  });
});
