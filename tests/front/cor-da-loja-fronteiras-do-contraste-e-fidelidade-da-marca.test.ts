// Buracos achados por mutação em `src/config/cor-da-loja.ts` (caça de provas
// fracas, 24/11/2026). Os testes vizinhos varrem faixas de cor e conferem o
// contraste, mas deixavam passar quatro trocas que mudam o que a lojista vê:
//
//   1. o limite de 4,5:1 do texto sobre a cor da loja só era provado pelo lado
//      de baixo (4,4 caía; 4,6 passava) — uma cinza a 4,54:1 já mudava de texto;
//   2. o limite de 4,7:1 da "cor da marca sobre branco" só era provado pelo lado
//      de cima — 4,8 passava e escurecia cor que já estava boa;
//   3. a cor escurecida tinha o contraste conferido, mas ninguém conferia que
//      ela continuava SENDO A MESMA COR: matiz do azul/lilás errado e saturação
//      errada passavam (a varredura só mede o contraste);
//   4. a forma com espaço em volta só era tratada na conta de contraste, não na
//      cor escurecida.
import {
  TEXTO_CLARO_SOBRE_A_COR_DA_LOJA,
  corDaMarcaSobreBranco,
  razaoDeContraste,
  textoSobreACorDaLoja,
} from "@/config/cor-da-loja";
import { describe, expect, it } from "vitest";

const BRANCO = "#ffffff";
const TEXTO_CLARO_DO_TEMA = "#fafafa";

// Lê o token "H S% L%" de volta em números (o mesmo formato que vai para o CSS).
function hsl(hex: string): { h: number; s: number; l: number } {
  const [h, s, l] = hexParaHsl(hex)
    .split(" ")
    .map((parte) => Number.parseFloat(parte.replace("%", "")));
  return { h, s, l };
}

// Conversão independente da do código de produção (fórmula padrão), só para
// comparar matiz e saturação antes e depois do escurecimento.
function hexParaHsl(hex: string): string {
  const r = Number.parseInt(hex.slice(1, 3), 16) / 255;
  const g = Number.parseInt(hex.slice(3, 5), 16) / 255;
  const b = Number.parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  const l = (max + min) / 2;
  const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
  let h = 0;
  if (d !== 0) {
    if (max === r) h = (((g - b) / d + 6) % 6) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  return `${h} ${s * 100}% ${l * 100}%`;
}

describe("textoSobreACorDaLoja — a fronteira exata de 4,5:1 com o texto claro", () => {
  it("#737373 (4,54:1) ainda leva o texto claro; #747474 (4,48:1) já não", () => {
    // Os dois cinzas são vizinhos de um passo e ficam um de cada lado do 4,5.
    expect(razaoDeContraste(TEXTO_CLARO_DO_TEMA, "#737373")).toBeGreaterThan(
      4.5,
    );
    expect(razaoDeContraste(TEXTO_CLARO_DO_TEMA, "#747474")).toBeLessThan(4.5);

    expect(textoSobreACorDaLoja("#737373")).toBe(
      TEXTO_CLARO_SOBRE_A_COR_DA_LOJA,
    );
    expect(textoSobreACorDaLoja("#747474")).not.toBe(
      TEXTO_CLARO_SOBRE_A_COR_DA_LOJA,
    );
  });

  it("a escolha não depende de maiúscula nem da forma curta na fronteira", () => {
    expect(textoSobreACorDaLoja("#737373")).toBe(
      textoSobreACorDaLoja("#737373".toUpperCase()),
    );
    // #777 = #777777, que já está do lado de fora do 4,5:1 com o texto claro.
    expect(textoSobreACorDaLoja("#777")).toBe(textoSobreACorDaLoja("#777777"));
    expect(textoSobreACorDaLoja("#777")).not.toBe(
      TEXTO_CLARO_SOBRE_A_COR_DA_LOJA,
    );
  });
});

describe("corDaMarcaSobreBranco — a fronteira exata de 4,7:1 (4,5 mais a folga do arredondamento)", () => {
  it("#737373 (4,74:1) fica idêntica; #747474 (4,67:1) é escurecida e passa de 4,7", () => {
    expect(razaoDeContraste("#737373", BRANCO)).toBeGreaterThanOrEqual(4.7);
    expect(razaoDeContraste("#747474", BRANCO)).toBeLessThan(4.7);
    // Mas já passa do 4,5 do WCAG: a folga é o que manda escurecer.
    expect(razaoDeContraste("#747474", BRANCO)).toBeGreaterThan(4.5);

    expect(corDaMarcaSobreBranco("#737373")).toBe("#737373");

    const escurecida = corDaMarcaSobreBranco("#747474");
    expect(escurecida).not.toBe("#747474");
    expect(razaoDeContraste(escurecida, BRANCO)).toBeGreaterThanOrEqual(4.7);
  });

  it("a cor com espaço em volta e em maiúsculas vira a mesma cor escurecida", () => {
    expect(corDaMarcaSobreBranco("  #FFD400 ")).toBe(
      corDaMarcaSobreBranco("#ffd400"),
    );
    expect(corDaMarcaSobreBranco("\t#737373\n")).toBe("#737373");
  });
});

describe("corDaMarcaSobreBranco — a cor escurecida continua sendo a mesma cor", () => {
  // Um de cada ramo do cálculo do matiz: vermelho com verde acima do azul
  // (laranja), vermelho com azul acima do verde (rosa), verde, azul e lilás.
  it.each([
    ["azul médio", "#3b82f6"],
    ["lilás", "#a855f7"],
    ["ciano", "#06b6d4"],
    ["verde médio", "#22c55e"],
    ["laranja", "#f97316"],
    ["rosa choque (verde abaixo do azul)", "#ff69b4"],
    ["rosa claro (verde abaixo do azul)", "#ffb6c1"],
  ])("%s (%s): mesmo matiz e mesma saturação, só mais escura", (_nome, cor) => {
    const original = hsl(cor);
    const legivel = corDaMarcaSobreBranco(cor);
    const depois = hsl(legivel);

    expect(legivel).not.toBe(cor);
    // O matiz é circular: 359 e 1 são vizinhos.
    const volta = Math.abs(original.h - depois.h);
    expect(Math.min(volta, 360 - volta)).toBeLessThanOrEqual(2);
    expect(Math.abs(original.s - depois.s)).toBeLessThanOrEqual(2);
    expect(depois.l).toBeLessThan(original.l);
  });
});
