// No iPhone o canvas do Safari não tem `ctx.filter`: a prévia do editor de foto
// (filtro CSS) mostra P&B/Vívido/brilho, mas a foto salva saía com as cores
// originais e o aviso dizia "Imagem ajustada com sucesso". `aplicarFiltrosDeCor`
// refaz o mesmo filtro pixel a pixel, na ORDEM e com as MATRIZES do filtro CSS
// (brightness, contrast, saturate, grayscale, sepia), cortando em 0–255 a cada
// passo como o navegador faz. Função pura: o teste olha o número do pixel.
import { describe, expect, it } from "vitest";

import {
  type FiltrosDeCor,
  aplicarFiltrosDeCor,
  canvasAplicaFiltro,
  filtrosDeCorSaoNeutros,
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

describe("filtrosDeCorSaoNeutros", () => {
  it("100/100/100/0/0 é neutro; qualquer botão fora disso não é", () => {
    expect(filtrosDeCorSaoNeutros(NEUTROS)).toBe(true);
    expect(filtrosDeCorSaoNeutros({ ...NEUTROS, brightness: 101 })).toBe(false);
    expect(filtrosDeCorSaoNeutros({ ...NEUTROS, contrast: 99 })).toBe(false);
    expect(filtrosDeCorSaoNeutros({ ...NEUTROS, saturation: 0 })).toBe(false);
    expect(filtrosDeCorSaoNeutros({ ...NEUTROS, grayscale: 1 })).toBe(false);
    expect(filtrosDeCorSaoNeutros({ ...NEUTROS, sepia: 15 })).toBe(false);
  });
});

describe("canvasAplicaFiltro", () => {
  it("canvas que tem `filter` (Chrome, Firefox) aplica; o do Safari, sem a propriedade, não", () => {
    expect(canvasAplicaFiltro({ filter: "none" })).toBe(true);
    expect(canvasAplicaFiltro({})).toBe(false);
  });

  it("a checagem tem de vir ANTES da atribuição: no Safari atribuir cria a propriedade e a checagem passaria a mentir", () => {
    const ctxDoSafari: { filter?: string } = {};
    const antes = canvasAplicaFiltro(ctxDoSafari);
    ctxDoSafari.filter = "grayscale(100%)";
    const depois = canvasAplicaFiltro(ctxDoSafari);
    expect(antes).toBe(false);
    expect(depois).toBe(true);
  });
});

describe("aplicarFiltrosDeCor — cada filtro, com o número do pixel", () => {
  it("neutro não mexe em nenhum pixel", () => {
    expect(aplicar([200, 100, 50, 255], {})).toEqual([200, 100, 50, 255]);
  });

  it("brightness 50% escurece pela metade; 150% clareia e corta em 255", () => {
    expect(aplicar([200, 100, 50, 255], { brightness: 50 })).toEqual([
      100, 50, 25, 255,
    ]);
    expect(aplicar([200, 100, 50, 255], { brightness: 150 })).toEqual([
      255, 150, 75, 255,
    ]);
  });

  it("contrast 150% afasta do cinza médio; 0% deixa tudo cinza médio", () => {
    expect(aplicar([200, 100, 50, 255], { contrast: 150 })).toEqual([
      236, 86, 11, 255,
    ]);
    expect(aplicar([200, 100, 50, 255], { contrast: 0 })).toEqual([
      128, 128, 128, 255,
    ]);
  });

  it("saturate 0% tira a cor (matriz do CSS); 200% acentua", () => {
    expect(aplicar([255, 0, 0, 255], { saturation: 0 })).toEqual([
      54, 54, 54, 255,
    ]);
    // 200%: G = (0.213-0.213*2)*200 + (0.715+0.285*2)*100 + (0.072-0.072*2)*50 = 82; R estoura (255), B fica negativo (0)
    expect(aplicar([200, 100, 50, 255], { saturation: 200 })).toEqual([
      255, 82, 0, 255,
    ]);
  });

  it("grayscale 100% usa os pesos 0.2126/0.7152/0.0722; 50% fica no meio do caminho", () => {
    expect(aplicar([255, 0, 0, 255], { grayscale: 100 })).toEqual([
      54, 54, 54, 255,
    ]);
    expect(aplicar([0, 255, 0, 255], { grayscale: 100 })).toEqual([
      182, 182, 182, 255,
    ]);
    expect(aplicar([255, 0, 0, 255], { grayscale: 50 })).toEqual([
      155, 27, 27, 255,
    ]);
  });

  it("grayscale e sepia acima de 100% valem 100% (o CSS corta em 1)", () => {
    expect(aplicar([255, 0, 0, 255], { grayscale: 150 })).toEqual(
      aplicar([255, 0, 0, 255], { grayscale: 100 }),
    );
    expect(aplicar([255, 0, 0, 255], { sepia: 150 })).toEqual(
      aplicar([255, 0, 0, 255], { sepia: 100 }),
    );
  });

  it("sepia 100% no branco dá o tom de papel velho (azul cai); 15% mexe pouco", () => {
    expect(aplicar([255, 255, 255, 255], { sepia: 100 })).toEqual([
      255, 255, 239, 255,
    ]);
    expect(aplicar([255, 255, 255, 255], { sepia: 15 })).toEqual([
      255, 255, 253, 255,
    ]);
  });
});

describe("aplicarFiltrosDeCor — ordem e corte entre os passos (o que faz bater com o CSS)", () => {
  it("a ordem é brightness → contrast: o inverso daria outro número", () => {
    // 100/255 = 0,392. brightness 150 → 0,588; contrast 150 → 0,632 → 161.
    // (contrast primeiro: 0,338; brightness depois: 0,507 → 129.)
    expect(
      aplicar([100, 100, 100, 255], { brightness: 150, contrast: 150 }),
    ).toEqual([161, 161, 161, 255]);
  });

  it("corta em 1 a cada passo, não só no fim: brightness 200 estoura, contrast 50 parte do teto", () => {
    // Sem corte no meio: 200/255*2 = 1,57 → *0,5+0,25 = 1,03 → 255.
    // Com corte no meio (o do navegador): 1,0 → 0,75 → 191.
    expect(
      aplicar([200, 200, 200, 255], { brightness: 200, contrast: 50 }),
    ).toEqual([191, 191, 191, 255]);
  });

  it("preset P&B do editor (105/120/0/100/0): cinza igual nos três canais", () => {
    const [r, g, b, a] = aplicar([200, 120, 40, 255], {
      brightness: 105,
      contrast: 120,
      saturation: 0,
      grayscale: 100,
    });
    expect(r).toBe(g);
    expect(g).toBe(b);
    expect(a).toBe(255);
  });
});

describe("aplicarFiltrosDeCor — bordas", () => {
  it("o canal de transparência nunca muda (inclusive pixel totalmente transparente)", () => {
    expect(aplicar([10, 20, 30, 77], { brightness: 150 })[3]).toBe(77);
    expect(aplicar([10, 20, 30, 0], { grayscale: 100 })[3]).toBe(0);
  });

  it("vários pixels: cada um é filtrado por conta própria", () => {
    const dados = new Uint8ClampedArray([
      255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255,
    ]);
    aplicarFiltrosDeCor(dados, { ...NEUTROS, grayscale: 100 });
    expect([...dados]).toEqual([
      54, 54, 54, 255, 182, 182, 182, 255, 18, 18, 18, 255,
    ]);
  });

  it("lista vazia não dá erro; resto que não completa um pixel é ignorado", () => {
    expect(() =>
      aplicarFiltrosDeCor(new Uint8ClampedArray(0), {
        ...NEUTROS,
        grayscale: 100,
      }),
    ).not.toThrow();
    const dados = new Uint8ClampedArray([255, 0, 0, 255, 9, 9]);
    aplicarFiltrosDeCor(dados, { ...NEUTROS, grayscale: 100 });
    expect([...dados]).toEqual([54, 54, 54, 255, 9, 9]);
  });

  it("rodar neutro duas vezes não muda nada (idempotente); rodar o filtro de novo filtra de novo", () => {
    const dados = new Uint8ClampedArray([200, 100, 50, 255]);
    aplicarFiltrosDeCor(dados, NEUTROS);
    aplicarFiltrosDeCor(dados, NEUTROS);
    expect([...dados]).toEqual([200, 100, 50, 255]);
  });
});
