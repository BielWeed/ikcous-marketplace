import { describe, expect, it } from "vitest";
import { resumoParaPrevia } from "../../src/lib/resumo-para-previa";

const DESCRICAO_DO_ACHADO = [
  "**Caderno Inteligente**",
  "* 📖 50 Páginas reposicionáveis",
  "* ✏️ Acompanha caneta",
  "",
  "---",
  "## Detalhes",
  "- Capa dura",
].join("\n");

describe("resumoParaPrevia (previa do link: texto sem Markdown e com teto)", () => {
  it("tira asteriscos, cerquilhas, marcadores de lista e linhas de traços", () => {
    const resumo = resumoParaPrevia(DESCRICAO_DO_ACHADO);
    expect(resumo).toBe(
      "Caderno Inteligente 📖 50 Páginas reposicionáveis ✏️ Acompanha caneta Detalhes Capa dura",
    );
    expect(resumo).not.toMatch(/[*#]/);
    expect(resumo).not.toContain("\n");
  });

  it("junta quebras de linha (inclusive CRLF) e comprime espaços repetidos", () => {
    expect(resumoParaPrevia("Leve   e\r\n\r\n  rápido\t\tmesmo")).toBe(
      "Leve e rápido mesmo",
    );
  });

  it("texto simples e curto passa intacto, '100%' e '#hashtag' no meio não são Markdown", () => {
    expect(resumoParaPrevia("100% algodão")).toBe("100% algodão");
    expect(resumoParaPrevia("Use a #hashtag da loja")).toBe(
      "Use a #hashtag da loja",
    );
  });

  it("texto vazio, só espaços ou só Markdown vira vazio (quem chama usa o texto padrão)", () => {
    expect(resumoParaPrevia("")).toBe("");
    expect(resumoParaPrevia("   \n  ")).toBe("");
    expect(resumoParaPrevia("---\n**\n***")).toBe("");
  });

  it("respeita o teto, corta em fronteira de palavra e põe reticências", () => {
    const longo = "palavra ".repeat(100);
    const resumo = resumoParaPrevia(longo, 200);
    expect(Array.from(resumo).length).toBeLessThanOrEqual(200);
    expect(resumo.endsWith("…")).toBe(true);
    expect(resumo).toBe(`${"palavra ".repeat(23)}palavra…`);
  });

  it("texto que cabe exatamente no teto não ganha reticências", () => {
    const exato = "a".repeat(200);
    expect(resumoParaPrevia(exato, 200)).toBe(exato);
    expect(resumoParaPrevia(`${exato}b`, 200)).toBe(`${"a".repeat(199)}…`);
  });

  it("palavra gigante sem espaço é cortada seca no teto, sem passar dele", () => {
    const resumo = resumoParaPrevia("x".repeat(500), 200);
    expect(Array.from(resumo).length).toBe(200);
    expect(resumo.endsWith("…")).toBe(true);
  });

  it("nunca parte um emoji ao meio (corta por pontos de código)", () => {
    const resumo = resumoParaPrevia("😀".repeat(300), 200);
    expect(Array.from(resumo).length).toBe(200);
    // Se o corte tivesse partido um par substituto, sobraria metade de emoji.
    expect(resumo).toBe(`${"😀".repeat(199)}…`);
    expect(resumo).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
  });

  it("não deixa o conector de emoji composto pendurado antes das reticências", () => {
    const familia = "👨‍👩‍👧";
    // a a a a 👨 ZWJ 👩 ZWJ 👧: com teto 7 o corte cairia logo depois do ZWJ.
    const resumo = resumoParaPrevia(`aaaa${familia}${familia}`, 7);
    expect(resumo).toBe("aaaa👨…");
  });

  it("teto menor que 2 não quebra: devolve no máximo o que cabe", () => {
    expect(
      Array.from(resumoParaPrevia("abcdef", 1)).length,
    ).toBeLessThanOrEqual(1);
    expect(resumoParaPrevia("abcdef", 0)).toBe("");
  });
});
