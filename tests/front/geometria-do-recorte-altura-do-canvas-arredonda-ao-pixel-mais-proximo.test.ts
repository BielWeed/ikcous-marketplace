// A foto recortada sai com a LARGURA que a lojista escolheu e a altura na mesma
// proporção do quadro de recorte. Quando a conta não dá pixel inteiro, a altura
// vai para o pixel MAIS PRÓXIMO (333,33 vira 333; 666,67 vira 667; 2,5 vira 3):
// arredondar sempre para cima acrescentaria uma linha de fundo em branco na foto.
import { describe, expect, it } from "vitest";

import { calcularParametrosDeRecorte } from "@/lib/geometria-do-recorte";

function alturaDoCanvas(
  exportWidth: number,
  viewportWidth: number,
  viewportHeight: number,
): number {
  return calcularParametrosDeRecorte({
    exportWidth,
    viewportWidth,
    viewportHeight,
    naturalWidth: 1000,
    naturalHeight: 1000,
    baseScale: 1,
    zoom: 1,
    offset: { x: 0, y: 0 },
    rotation: 0,
    fineRotation: 0,
  }).targetHeight;
}

describe("calcularParametrosDeRecorte: altura do canvas de exportação", () => {
  it.each([
    ["333,33 arredonda para baixo", 1000, 300, 100, 333],
    ["666,67 arredonda para cima", 1000, 300, 200, 667],
    ["meio pixel (2,5) arredonda para cima", 5, 2, 1, 3],
    ["3,33 arredonda para baixo", 10, 3, 1, 3],
    ["conta exata não muda", 800, 400, 300, 600],
    ["quadro quadrado repete a largura", 512, 250, 250, 512],
  ])("%s", (_nome, exportWidth, viewportWidth, viewportHeight, esperada) => {
    expect(alturaDoCanvas(exportWidth, viewportWidth, viewportHeight)).toBe(
      esperada,
    );
  });

  it("a largura do canvas é sempre a escolhida", () => {
    const resultado = calcularParametrosDeRecorte({
      exportWidth: 1000,
      viewportWidth: 300,
      viewportHeight: 100,
      naturalWidth: 1000,
      naturalHeight: 1000,
      baseScale: 1,
      zoom: 1,
      offset: { x: 0, y: 0 },
      rotation: 0,
      fineRotation: 0,
    });

    expect(resultado.targetWidth).toBe(1000);
  });
});
