import {
  OBJETIVOS,
  PASSOS_DA_IA,
  gerarPromptDeBanner,
} from "@/lib/prompt-de-banner";
import { describe, expect, it } from "vitest";

// Conector invisivel que cola um emoji no outro (U+200D).
const ZWJ = String.fromCodePoint(0x200d);

describe("texto para criar a imagem do banner", () => {
  it.each([
    ["promocao", "energia"],
    ["lancamento", "novo"],
    ["frete_gratis", "entrega rápida"],
    ["colecao", "harmonizados"],
  ] as const)(
    "orienta a cena de %s sem perder o formato e o espaço dos textos",
    (objetivo, cena) => {
      const texto = gerarPromptDeBanner({ objetivo });
      expect(texto).toContain(cena);
      expect(texto).toContain("1200");
      expect(texto).toContain("600");
      expect(texto).toContain("2:1");
      expect(texto).toContain("esquerdo livre");
      expect(texto).toContain("foto anexada");
      expect(texto).toMatch(/Não escreva.*texto/);
      expect(texto).toContain("estúdio");
      expect(texto).toContain("minimalista e profissional");
      expect(texto).not.toMatch(/undefined|null/);
      expect(texto).not.toMatch(/\p{Cc}/u);
      expect(texto.length).toBeLessThan(900);
    },
  );

  it("produz quatro cenas diferentes e repete exatamente o mesmo pedido", () => {
    const textos = OBJETIVOS.map((objetivo) =>
      gerarPromptDeBanner({ objetivo }),
    );
    expect(new Set(textos).size).toBe(4);
    expect(gerarPromptDeBanner({ objetivo: "promocao" })).toBe(textos[0]);
  });

  it("inclui somente os nomes informados e distingue os dois fundos", () => {
    const entrada = {
      objetivo: "lancamento" as const,
      nomeDoProduto: "Camiseta Azul",
      nomeDaLoja: "Loja Exemplo",
    };
    const escuro = gerarPromptDeBanner(entrada);
    const claro = gerarPromptDeBanner({ ...entrada, estilo: "claro" });
    expect(escuro).toContain("Camiseta Azul");
    expect(escuro).toContain("Loja Exemplo");
    expect(escuro).toContain("escuro elegante");
    expect(claro).toContain("fundo claro");
    expect(claro).not.toBe(escuro);
    expect(
      gerarPromptDeBanner({
        objetivo: "promocao",
        nomeDoProduto: " ",
        nomeDaLoja: " ",
      }),
    ).not.toMatch(/Produto:|Loja:/);
  });

  it("normaliza controles dos nomes e mantém o pedido curto mesmo com nomes extensos", () => {
    const texto = gerarPromptDeBanner({
      objetivo: "colecao",
      nomeDoProduto: "Azul\n\t\u0000".repeat(200),
      nomeDaLoja: "Loja".repeat(200),
    });
    expect(texto).not.toMatch(/\p{Cc}/u);
    expect(texto.length).toBeLessThan(900);
  });

  it("nao parte um emoji ao meio quando o nome passa do limite", () => {
    const texto = gerarPromptDeBanner({
      objetivo: "promocao",
      nomeDaLoja: `${"a".repeat(99)}😀 resto`,
    });
    expect(texto).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(texto).not.toMatch(/(?<![\ud800-\udbff])[\udc00-\udfff]/);
    expect(texto).toContain(`Loja: ${"a".repeat(99)}.`);
  });

  it("mantem a familia de emojis inteira, com o conector invisivel", () => {
    const familia = ["👩", "👩", "👧", "👦"].join(ZWJ);
    const texto = gerarPromptDeBanner({
      objetivo: "promocao",
      nomeDaLoja: `Loja ${familia}`,
    });
    expect(texto).toContain(`Loja: Loja ${familia}.`);
  });

  it("nao parte a familia de emojis no corte dos 100", () => {
    const familia = ["👩", "👩", "👧", "👦"].join(ZWJ);
    const texto = gerarPromptDeBanner({
      objetivo: "promocao",
      nomeDaLoja: `${"a".repeat(95)}${familia}`,
    });
    expect(texto).toContain(`Loja: ${"a".repeat(95)}.`);
    expect(texto).not.toContain(ZWJ);
  });

  it("ainda troca o conector invisivel solto por espaco", () => {
    const texto = gerarPromptDeBanner({
      objetivo: "promocao",
      nomeDoProduto: `Azul${ZWJ}Claro ${ZWJ}`,
    });
    expect(texto).toContain("Produto: Azul Claro.");
  });

  it("explica o caminho completo sem prometer gerar a imagem no app", () => {
    expect(PASSOS_DA_IA).toHaveLength(3);
    expect(PASSOS_DA_IA[0]).toMatch(/ChatGPT.*Gemini/);
    expect(PASSOS_DA_IA[1]).toMatch(/foto/);
    expect(PASSOS_DA_IA[2]).toMatch(/envie aqui/);
  });
});
