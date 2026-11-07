// @vitest-environment jsdom
//
// A capa do perfil aparece numa faixa larga e baixa (120 px de altura, largura
// da tela, `object-cover`). `compressCoverImage` encaixava a foto inteira numa
// caixa de 800x300: uma foto 4:3 virava 400x300 e uma foto em pé ~225x300, e a
// faixa esticava esse arquivo 3 a 5 vezes no celular — capa borrada. A faixa
// só mostra um recorte horizontal de qualquer jeito, então o arquivo tem de
// ser esse recorte (8:3), com 800 px de largura, sem ampliar foto pequena.
//
// O jsdom desta suíte não tem canvas real (ver o teste vizinho do fundo
// branco): o contexto é um dublê que grava o `drawImage` e o tamanho do canvas
// NO INSTANTE do desenho.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function imagemDe(largura: number, altura: number) {
  return class ImagemFalsa {
    width = largura;
    height = altura;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    set src(_: string) {
      setTimeout(() => this.onload?.(), 0);
    }
  };
}

describe("capa do perfil — recorte largo e nítido", () => {
  let drawImage: ReturnType<typeof vi.fn>;
  let canvasNoDesenho: { width: number; height: number } | null;

  beforeEach(() => {
    canvasNoDesenho = null;
    drawImage = vi.fn();
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(
      // `function` de propósito: o `this` é o canvas que pediu o contexto.
      function (this: HTMLCanvasElement) {
        drawImage.mockImplementation(() => {
          canvasNoDesenho = { width: this.width, height: this.height };
        });
        return { fillStyle: "", fillRect: vi.fn(), drawImage } as never;
      },
    );
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(
      (tipo?: string) => `data:${tipo ?? "image/png"};base64,FAKE`,
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function comprimir(largura: number, altura: number) {
    vi.stubGlobal("Image", imagemDe(largura, altura));
    const { compressCoverImage } = await import("@/utils/covers");
    await compressCoverImage("data:image/jpeg;base64,QUALQUERCOISA");
  }

  it("foto 4:3 do celular vira 800x300, recortando o centro (não encolhe para 400x300)", async () => {
    await comprimir(4000, 3000);

    expect(canvasNoDesenho).toEqual({ width: 800, height: 300 });
    // Recorte 8:3 do centro: largura inteira, 1500 de altura, a partir de y=750.
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      750,
      4000,
      1500,
      0,
      0,
      800,
      300,
    );
  });

  it("foto em pé também vira 800x300 (não ~225x300)", async () => {
    await comprimir(3000, 4000);

    expect(canvasNoDesenho).toEqual({ width: 800, height: 300 });
    // Largura inteira, altura 3000*3/8 = 1125, centrada em 4000: y = 1437,5.
    const [, sx, sy, sw, sh] = drawImage.mock.calls[0];
    expect(sx).toBe(0);
    expect(sy).toBeCloseTo(1437.5, 5);
    expect(sw).toBe(3000);
    expect(sh).toBe(1125);
  });

  it("foto panorâmica mais larga que a faixa corta as laterais", async () => {
    await comprimir(4000, 500);

    expect(canvasNoDesenho).toEqual({ width: 800, height: 300 });
    const [, sx, sy, sw, sh] = drawImage.mock.calls[0];
    // Altura inteira (500); largura 500*8/3 ≈ 1333,33, centrada em 4000.
    expect(sy).toBe(0);
    expect(sh).toBe(500);
    expect(sw).toBeCloseTo((500 * 8) / 3, 5);
    expect(sx).toBeCloseTo((4000 - (500 * 8) / 3) / 2, 5);
  });

  it("foto pequena não é ampliada: 400x300 vira 400x150, mantendo o formato da faixa", async () => {
    await comprimir(400, 300);

    expect(canvasNoDesenho).toEqual({ width: 400, height: 150 });
    expect(drawImage).toHaveBeenCalledWith(
      expect.anything(),
      0,
      75,
      400,
      150,
      0,
      0,
      400,
      150,
    );
  });
});
