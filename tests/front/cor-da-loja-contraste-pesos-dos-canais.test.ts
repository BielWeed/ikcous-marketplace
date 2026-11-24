// A conta de contraste (WCAG 2.x) decide se o botão de comprar fica legível na
// cor que a lojista escolheu. Os testes de `cor-do-texto-sobre-a-cor-da-loja`
// varrem faixas de cor, mas não pegam um defeito que troca o PESO dos canais
// (vermelho x azul) nem a curva dos tons quase pretos: o resultado muda pouco
// em cinza e muito em vermelho e azul puros. Aqui os valores são os de
// referência da própria fórmula do WCAG, fixados com duas casas.
import {
  corDaMarcaSobreBranco,
  razaoDeContraste,
  textoSobreACorDaLoja,
} from "@/config/cor-da-loja";
import { describe, expect, it } from "vitest";

const BRANCO = "#ffffff";
const TEXTO_CLARO = "0 0% 98%";
const TEXTO_ESCURO = "240 5.9% 10%";

describe("razaoDeContraste — valores de referência do WCAG", () => {
  it("preto sobre branco é 21:1 e a razão não depende da ordem", () => {
    expect(razaoDeContraste("#000000", BRANCO)).toBeCloseTo(21, 5);
    expect(razaoDeContraste(BRANCO, "#000000")).toBeCloseTo(21, 5);
    expect(razaoDeContraste("#336699", "#336699")).toBeCloseTo(1, 5);
  });

  it("cada canal pesa o que a fórmula manda: verde pesa mais, azul pesa menos", () => {
    // Vermelho puro contra branco ~4,00; azul puro ~8,59; verde puro ~1,37.
    // Trocar o peso do vermelho com o do azul inverte os dois primeiros.
    expect(razaoDeContraste("#ff0000", BRANCO)).toBeCloseTo(4.0, 2);
    expect(razaoDeContraste("#0000ff", BRANCO)).toBeCloseTo(8.59, 2);
    expect(razaoDeContraste("#00ff00", BRANCO)).toBeCloseTo(1.37, 2);
  });

  it("tons quase pretos usam a parte linear da curva (canal baixo dividido por 12,92)", () => {
    expect(razaoDeContraste("#0a0a0a", BRANCO)).toBeCloseTo(19.8, 2);
  });

  it("a fronteira clássica do AA: #767676 passa de 4,5 e #777777 não", () => {
    expect(razaoDeContraste("#767676", BRANCO)).toBeCloseTo(4.54, 2);
    expect(razaoDeContraste("#777777", BRANCO)).toBeCloseTo(4.48, 2);
  });

  it("cor curta #abc vale o mesmo que #aabbcc", () => {
    expect(razaoDeContraste("#abc", BRANCO)).toBeCloseTo(
      razaoDeContraste("#aabbcc", BRANCO),
      10,
    );
    expect(razaoDeContraste("#abc", BRANCO)).toBeCloseTo(1.96, 2);
  });

  it("aceita maiúscula e espaço em volta", () => {
    expect(razaoDeContraste(" #FF0000 ", BRANCO)).toBeCloseTo(
      razaoDeContraste("#ff0000", BRANCO),
      10,
    );
  });
});

describe("textoSobreACorDaLoja — o texto escolhido em cores de canal puro", () => {
  it("vermelho puro está na faixa do meio (nenhum dos dois tons chega a 4,5): vai o preto", () => {
    // O branco da loja dá 3,99 e o escuro dá 4,44 — nenhum chega a 4,5.
    expect(textoSobreACorDaLoja("#ff0000")).toBe("0 0% 0%");
  });

  it("azul puro é escuro o bastante: o texto claro de sempre", () => {
    expect(textoSobreACorDaLoja("#0000ff")).toBe(TEXTO_CLARO);
  });

  it("verde puro e amarelo são claros: texto escuro", () => {
    expect(textoSobreACorDaLoja("#00ff00")).toBe(TEXTO_ESCURO);
    expect(textoSobreACorDaLoja("#ffff00")).toBe(TEXTO_ESCURO);
  });

  it("cor curta é lida como a cor cheia", () => {
    expect(textoSobreACorDaLoja("#123")).toBe(textoSobreACorDaLoja("#112233"));
    expect(textoSobreACorDaLoja("#abc")).toBe(textoSobreACorDaLoja("#aabbcc"));
    expect(textoSobreACorDaLoja("#123")).toBe(TEXTO_CLARO);
    expect(textoSobreACorDaLoja("#abc")).toBe(TEXTO_ESCURO);
  });
});

describe("corDaMarcaSobreBranco — cor curta e valor inválido", () => {
  it("cor curta é expandida e escurecida como a cheia", () => {
    expect(corDaMarcaSobreBranco("#FFF")).toBe(
      corDaMarcaSobreBranco("#ffffff"),
    );
    expect(
      razaoDeContraste(corDaMarcaSobreBranco("#fff"), BRANCO),
    ).toBeGreaterThanOrEqual(4.7);
  });

  it("valor que não é cor volta exatamente como veio, sem inventar cor", () => {
    expect(corDaMarcaSobreBranco("azul")).toBe("azul");
    expect(corDaMarcaSobreBranco("")).toBe("");
    expect(corDaMarcaSobreBranco("#12")).toBe("#12");
  });

  it("cor que já tem contraste sai em forma canônica de 6 dígitos e minúsculas", () => {
    expect(corDaMarcaSobreBranco("#123")).toBe("#112233");
    expect(corDaMarcaSobreBranco("#1A2B3C")).toBe("#1a2b3c");
  });
});
