// Bordas do filtro de cor pixel a pixel (caça por mutação): o corte por BAIXO
// entre os passos (valor negativo vira 0 antes do passo seguinte) e botões com
// número negativo, que valem como 0. Os números foram contados à mão.
import { describe, expect, it } from "vitest";

import {
  type FiltrosDeCor,
  aplicarFiltrosDeCor,
} from "@/lib/filtro-de-cor-por-pixel";

const NEUTROS: FiltrosDeCor = {
  brightness: 100,
  contrast: 100,
  saturation: 100,
  grayscale: 0,
  sepia: 0,
};

function aplicar(
  pixel: [number, number, number, number],
  filtros: Partial<FiltrosDeCor>,
): number[] {
  const dados = new Uint8ClampedArray(pixel);
  aplicarFiltrosDeCor(dados, { ...NEUTROS, ...filtros });
  return [...dados];
}

describe("filtro de cor: corte por baixo entre os passos", () => {
  it("contraste 200 joga canal escuro abaixo de zero; o passo seguinte parte de 0, não do negativo", () => {
    // Verde puro: contraste 200% dá R = 0*2 - 0,5 = -0,5 (corta em 0),
    // G = 1*2 - 0,5 = 1,5 (corta em 1), B = -0,5 (corta em 0).
    // Saturação 0%: cada canal vira 0,213*R + 0,715*G + 0,072*B = 0,715
    // -> 0,715 * 255 = 182,3 -> 182. Sem o corte em 0 o R entraria como -0,5
    // e o cinza sairia 0,5725 -> 146.
    expect(aplicar([0, 255, 0, 255], { contrast: 200, saturation: 0 })).toEqual(
      [182, 182, 182, 255],
    );
  });

  it("brilho zero com contraste 150 também parte do teto de zero", () => {
    // Brilho 0% zera tudo; contraste 150%: 0*1,5 + (0,5 - 0,75) = -0,25 -> 0.
    // Saturação 0% de (0,0,0) continua preto.
    expect(
      aplicar([200, 100, 50, 255], {
        brightness: 0,
        contrast: 150,
        saturation: 0,
      }),
    ).toEqual([0, 0, 0, 255]);
  });
});

describe("filtro de cor: botão com número negativo vale como zero", () => {
  it("contraste negativo = contraste 0: tudo vira cinza médio", () => {
    expect(aplicar([200, 100, 50, 255], { contrast: -50 })).toEqual([
      128, 128, 128, 255,
    ]);
    expect(aplicar([200, 100, 50, 255], { contrast: -50 })).toEqual(
      aplicar([200, 100, 50, 255], { contrast: 0 }),
    );
  });

  it("saturação negativa = saturação 0: vermelho puro vira o cinza de 54", () => {
    expect(aplicar([255, 0, 0, 255], { saturation: -100 })).toEqual([
      54, 54, 54, 255,
    ]);
  });

  it("preto e branco e sépia negativos não mexem na cor", () => {
    // Pixel com os três canais diferentes: se o negativo virasse "mais que
    // neutro", os canais se misturariam e a cor mudaria.
    expect(aplicar([200, 100, 50, 255], { grayscale: -50 })).toEqual([
      200, 100, 50, 255,
    ]);
    expect(aplicar([200, 100, 50, 255], { sepia: -50 })).toEqual([
      200, 100, 50, 255,
    ]);
  });

  it("brilho negativo = pixel preto, canal de transparência intacto", () => {
    expect(aplicar([200, 100, 50, 77], { brightness: -50 })).toEqual([
      0, 0, 0, 77,
    ]);
  });
});
