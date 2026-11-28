// Banner com preço velho (lote-581). O subtítulo e as sugestões do painel
// congelam o preço do momento em que a lojista escolheu o produto ("Por apenas
// R$ 70,00", "30% OFF em Vestido"). A promoção acaba, o preço volta a R$ 100 e
// o banner segue anunciando R$ 70 -- oferta anunciada (CDC art. 30). O painel
// passa a AVISAR; o texto continua sendo da lojista.
import { describe, expect, it } from "vitest";

import {
  precoAnunciadoVelho,
  valoresCitados,
} from "@/lib/preco-anunciado-no-banner";

describe("valoresCitados — o que o texto do banner promete", () => {
  it.each([
    ["Por apenas R$ 70,00", [7000]],
    ["Por apenas R$70,00", [7000]],
    ["De R$ 1.234,56 por R$ 999,90", [123456, 99990]],
    ["Só R$1.234,56!", [123456]],
    ["A partir de R$ 1234,56", [123456]],
    ["Leve por R$ 70", [7000]],
    ["Leve por R$ 70,5", [7050]],
    // O Intl põe espaço inquebrável depois do "R$".
    ["Por apenas R$ 70,00", [7000]],
    ["R$ 2.000.000,00 em prêmios", [200000000]],
    // Pontuação do fim da frase não é milhar nem centavo.
    ["Por apenas R$ 70,00.", [7000]],
    ["Agora R$ 1.234.", [123400]],
    ["Só R$ 70, corra!", [7000]],
    // Ponto sem três dígitos depois não é milhar: "70.00" é 70.
    ["Por R$ 70.00", [7000]],
  ])("acha os reais em %j", (texto, centavos) => {
    expect(valoresCitados(texto).centavos).toEqual(centavos);
  });

  it.each([
    ["30% OFF em Vestido", [30]],
    ["30 % OFF em Vestido", [30]],
    ["Vestido 30%OFF", [30]],
    ["30% off hoje", [30]],
    ["Até 12,5% OFF", [12.5]],
  ])("acha o percentual em %j", (texto, percentuais) => {
    expect(valoresCitados(texto).percentuais).toEqual(percentuais);
  });

  it.each([
    "Confira essa oferta especial na nossa loja!",
    "Coleção 2026",
    "Leve 3 peças",
    "30% de algodão",
    "",
  ])("texto sem preço nem '% OFF' não cita nada: %j", (texto) => {
    expect(valoresCitados(texto)).toEqual({ centavos: [], percentuais: [] });
  });

  it("título vazio ou ausente não cita nada", () => {
    expect(valoresCitados(null)).toEqual({ centavos: [], percentuais: [] });
    expect(valoresCitados(undefined)).toEqual({
      centavos: [],
      percentuais: [],
    });
  });
});

const vestido = (price: number, originalPrice: number | null = null) => ({
  price,
  originalPrice,
});

describe("precoAnunciadoVelho — o texto bate com o preço de agora?", () => {
  it("a promoção acabou: R$ 70 anunciado, R$ 100 cobrado, avisa com os dois valores", () => {
    expect(
      precoAnunciadoVelho(["Vestido", "Por apenas R$ 70,00"], vestido(100)),
    ).toEqual({ tipo: "preco", citado: 70, atual: 100, aPartirDe: false });
  });

  it("o '30% OFF' do título sobra depois que o desconto acabou", () => {
    expect(
      precoAnunciadoVelho(["30% OFF em Vestido", ""], vestido(100)),
    ).toEqual({ tipo: "percentual", citado: 30, atual: 0 });
  });

  it("o percentual mudou: anuncia 30%, a vitrine dá 20%", () => {
    expect(
      precoAnunciadoVelho(["30% OFF em Vestido"], vestido(80, 100)),
    ).toEqual({ tipo: "percentual", citado: 30, atual: 20 });
  });

  it("texto sem valor nenhum não avisa", () => {
    expect(
      precoAnunciadoVelho(
        ["Vestido", "Confira essa oferta especial na nossa loja!"],
        vestido(100),
      ),
    ).toBeNull();
  });

  it("'De' riscado, preço de venda e percentual que batem não avisam", () => {
    expect(
      precoAnunciadoVelho(
        ["30% OFF em Vestido", "De R$ 100,00 por R$ 70,00"],
        vestido(70, 100),
      ),
    ).toBeNull();
  });

  it("'De' que não existe mais (preço igual ao original) avisa", () => {
    expect(
      precoAnunciadoVelho(["De R$ 120,00 por R$ 100,00"], vestido(100, 100)),
    ).toEqual({ tipo: "preco", citado: 120, atual: 100, aPartirDe: false });
  });

  it("a economia que a vitrine mostra ('Economize R$ 30,00') não avisa", () => {
    expect(
      precoAnunciadoVelho(["Economize R$ 30,00"], vestido(70, 100)),
    ).toBeNull();
  });

  it("tolerância é o centavo exato: R$ 69,99 contra R$ 70,00 avisa", () => {
    expect(precoAnunciadoVelho(["Por R$ 69,99"], vestido(70))).toEqual({
      tipo: "preco",
      citado: 69.99,
      atual: 70,
      aPartirDe: false,
    });
  });

  it("ruído de ponto flutuante do preço não vira aviso (89,90 gravado como 89.9)", () => {
    expect(
      precoAnunciadoVelho(["Por apenas R$ 89,90"], vestido(89.9)),
    ).toBeNull();
  });

  it("preço com milhar bate: R$ 1.234,56", () => {
    expect(
      precoAnunciadoVelho(["Por apenas R$ 1.234,56"], vestido(1234.56)),
    ).toBeNull();
  });

  describe("produto com variações de preço diferente", () => {
    const variacao = (
      value: string,
      priceOverride: number | undefined,
      stockIncrement: number,
      extra: { active?: boolean; name?: string } = {},
    ) => ({
      name: extra.name ?? "Tamanho",
      value,
      active: extra.active ?? true,
      stockIncrement,
      priceOverride,
    });
    // Base 50 sem opção própria; M a 90 e G a 120 à venda; "De" 150.
    const comFaixa = {
      price: 50,
      originalPrice: 150,
      variants: [variacao("M", 90, 3), variacao("G", 120, 3)],
    };

    it("o preço de qualquer opção ligada não avisa ('Por R$ 120,00' é o G)", () => {
      expect(precoAnunciadoVelho(["Por R$ 120,00"], comFaixa)).toBeNull();
      expect(
        precoAnunciadoVelho(["A partir de R$ 90,00"], comFaixa),
      ).toBeNull();
    });

    it("o preço de uma opção ligada SEM estoque também é praticado: não avisa", () => {
      const comEsgotada = {
        ...comFaixa,
        variants: [variacao("M", 90, 3), variacao("GG", 140, 0)],
      };
      expect(precoAnunciadoVelho(["Por R$ 140,00"], comEsgotada)).toBeNull();
    });

    it("o percentual de qualquer opção ligada não avisa (150 -> 120 = 20%)", () => {
      expect(precoAnunciadoVelho(["20% OFF"], comFaixa)).toBeNull();
      expect(precoAnunciadoVelho(["40% OFF"], comFaixa)).toBeNull();
    });

    it("o preço-base que nenhuma opção cobra avisa, com o 'a partir de' da vitrine", () => {
      expect(precoAnunciadoVelho(["Por R$ 50,00"], comFaixa)).toEqual({
        tipo: "preco",
        citado: 50,
        atual: 90,
        aPartirDe: true,
      });
    });

    it("opção DESLIGADA não conta como preço praticado", () => {
      const comDesligada = {
        ...comFaixa,
        variants: [
          variacao("M", 90, 3),
          variacao("G", 120, 3),
          variacao("P", 70, 3, { active: false }),
        ],
      };
      expect(precoAnunciadoVelho(["Por R$ 70,00"], comDesligada)).toEqual({
        tipo: "preco",
        citado: 70,
        atual: 90,
        aPartirDe: true,
      });
    });
  });

  it("o primeiro valor errado é o do aviso; reais vêm antes do percentual", () => {
    expect(
      precoAnunciadoVelho(
        ["30% OFF em Vestido", "De R$ 100,00 por R$ 70,00"],
        vestido(100),
      ),
    ).toEqual({ tipo: "preco", citado: 70, atual: 100, aPartirDe: false });
  });
});
