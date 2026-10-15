// @vitest-environment jsdom
//
// O texto que fica SOBRE a cor da loja (botão "Adicionar ao Carrinho", chips
// escolhidos, cards) era sempre branco. Com uma cor clara escolhida pela
// lojista (amarelo, rosa claro, dourado) o botão principal da compra ficava
// quase sem texto legível. Agora a cor do texto (--primary-foreground) sai do
// contraste WCAG: branco quando o branco sobre a cor chega a 4,5:1, senão um
// escuro legível. As lojas de cor escura ficam IDÊNTICAS nas variáveis que já
// existiam (--primary), e ganham só o --primary-foreground branco.
import { afterEach, describe, expect, it } from "vitest";

import { aplicarCorDaLoja, hexToTailwindHsl } from "@/config/branding";
import {
  TEXTO_CLARO_SOBRE_A_COR_DA_LOJA,
  TEXTO_ESCURO_SOBRE_A_COR_DA_LOJA,
  razaoDeContraste,
  textoSobreACorDaLoja,
} from "@/config/cor-da-loja";

// A cor de fábrica do tema (index.css: --primary: 240 5.9% 10%) em hexadecimal.
const COR_PADRAO_DA_LOJA = "#18181b";

describe("razaoDeContraste — a conta do WCAG", () => {
  it("preto sobre branco é 21:1 e a mesma cor sobre ela mesma é 1:1", () => {
    expect(razaoDeContraste("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(razaoDeContraste("#ffffff", "#000000")).toBeCloseTo(21, 5);
    expect(razaoDeContraste("#ffd400", "#ffd400")).toBeCloseTo(1, 5);
  });

  it("aceita a forma curta #rgb e ignora maiúsculas", () => {
    expect(razaoDeContraste("#FFF", "#000")).toBeCloseTo(21, 5);
  });
});

describe("textoSobreACorDaLoja — branco ou escuro pelo contraste", () => {
  it("cor escura (preto, azul escuro, a cor padrão): texto branco", () => {
    expect(textoSobreACorDaLoja("#000000")).toBe(
      TEXTO_CLARO_SOBRE_A_COR_DA_LOJA,
    );
    expect(textoSobreACorDaLoja("#1e3a8a")).toBe(
      TEXTO_CLARO_SOBRE_A_COR_DA_LOJA,
    );
    expect(textoSobreACorDaLoja(COR_PADRAO_DA_LOJA)).toBe(
      TEXTO_CLARO_SOBRE_A_COR_DA_LOJA,
    );
  });

  it("cor clara (branco, amarelo, rosa claro, dourado): texto escuro", () => {
    expect(textoSobreACorDaLoja("#ffffff")).toBe(
      TEXTO_ESCURO_SOBRE_A_COR_DA_LOJA,
    );
    expect(textoSobreACorDaLoja("#ffd400")).toBe(
      TEXTO_ESCURO_SOBRE_A_COR_DA_LOJA,
    );
    expect(textoSobreACorDaLoja("#ffb6c1")).toBe(
      TEXTO_ESCURO_SOBRE_A_COR_DA_LOJA,
    );
    expect(textoSobreACorDaLoja("#d4af37")).toBe(
      TEXTO_ESCURO_SOBRE_A_COR_DA_LOJA,
    );
  });

  it("o branco do tema é o MESMO branco que o index.css já usa", () => {
    expect(TEXTO_CLARO_SOBRE_A_COR_DA_LOJA).toBe("0 0% 98%");
  });

  it("onde o branco não chega a 4,5:1, o texto escolhido nunca é o de menor contraste", () => {
    const amostras = ["#ff6600", "#00a86b", "#e91e63", "#767676", "#ffd400"];
    for (const cor of amostras) {
      const escolhido = textoSobreACorDaLoja(cor);
      const claro = razaoDeContraste("#fafafa", cor);
      const escuro = razaoDeContraste("#18181b", cor);
      if (claro >= 4.5) {
        expect(escolhido).toBe(TEXTO_CLARO_SOBRE_A_COR_DA_LOJA);
      } else {
        const contrasteEscolhido =
          escolhido === TEXTO_CLARO_SOBRE_A_COR_DA_LOJA ? claro : escuro;
        expect(contrasteEscolhido).toBeGreaterThanOrEqual(
          Math.max(claro, escuro) - 1e-9,
        );
      }
    }
  });

  it("valor que não é cor: cai no branco, como o hexToTailwindHsl já tratava (preto)", () => {
    expect(textoSobreACorDaLoja("isto-nao-e-cor")).toBe(
      TEXTO_CLARO_SOBRE_A_COR_DA_LOJA,
    );
  });
});

describe("aplicarCorDaLoja — as variáveis do tema", () => {
  afterEach(() => {
    document.documentElement.style.removeProperty("--primary");
    document.documentElement.style.removeProperty("--primary-foreground");
  });

  it("cor escura: --primary é exatamente o de antes e o texto é branco", () => {
    aplicarCorDaLoja(COR_PADRAO_DA_LOJA);

    const estilo = document.documentElement.style;
    expect(estilo.getPropertyValue("--primary")).toBe(
      hexToTailwindHsl(COR_PADRAO_DA_LOJA),
    );
    expect(estilo.getPropertyValue("--primary-foreground")).toBe("0 0% 98%");
  });

  it("amarelo: --primary é o amarelo e o texto vira escuro", () => {
    aplicarCorDaLoja("#ffd400");

    const estilo = document.documentElement.style;
    expect(estilo.getPropertyValue("--primary")).toBe(
      hexToTailwindHsl("#ffd400"),
    );
    expect(estilo.getPropertyValue("--primary-foreground")).toBe(
      TEXTO_ESCURO_SOBRE_A_COR_DA_LOJA,
    );
  });

  it("trocar de cor clara para escura devolve o texto branco", () => {
    aplicarCorDaLoja("#ffd400");
    aplicarCorDaLoja("#1e3a8a");

    expect(
      document.documentElement.style.getPropertyValue("--primary-foreground"),
    ).toBe("0 0% 98%");
  });

  it("não mexe em nenhuma outra variável do tema", () => {
    aplicarCorDaLoja("#ffd400");

    const nomes = Array.from(document.documentElement.style).sort();
    expect(nomes).toEqual(["--primary", "--primary-foreground"]);
  });
});
