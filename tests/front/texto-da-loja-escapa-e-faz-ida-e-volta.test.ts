// A descrição da loja ("Sobre a loja") vira HTML simples ao salvar e volta a
// texto ao reabrir a tela. Duas promessas que os testes de tela só tocam de
// leve e que ficam caras se quebrarem:
//   1. o que a lojista digita é TEXTO, nunca marcação: "<", ">" e "&" saem
//      escapados (senão "<img onerror=...>" vira HTML da página pública);
//   2. salvar e reabrir devolve EXATAMENTE o que ela digitou, inclusive quando
//      ela digitou "&lt;" de verdade — senão o botão Salvar fica habilitado
//      para sempre (a tela acha que mudou) ou o texto muda sozinho.
import { descricaoDaLojaParaHtml, textoDaLoja } from "@/lib/texto-da-loja";
import { describe, expect, it } from "vitest";

describe("descricaoDaLojaParaHtml — texto digitado vira parágrafos escapados", () => {
  it("cada bloco separado por linha em branco vira um parágrafo", () => {
    expect(descricaoDaLojaParaHtml("Primeira.\n\nSegunda.")).toBe(
      "<p>Primeira.</p><p>Segunda.</p>",
    );
  });

  it("linha em branco com espaços ou tabs no meio também separa parágrafos", () => {
    expect(descricaoDaLojaParaHtml("A\n   \nB")).toBe("<p>A</p><p>B</p>");
    expect(descricaoDaLojaParaHtml("A\n\t\nB")).toBe("<p>A</p><p>B</p>");
  });

  it("quebra de linha simples fica DENTRO do mesmo parágrafo", () => {
    expect(descricaoDaLojaParaHtml("Linha 1\nLinha 2")).toBe(
      "<p>Linha 1\nLinha 2</p>",
    );
  });

  it("várias linhas em branco seguidas não geram parágrafo vazio", () => {
    expect(descricaoDaLojaParaHtml("A\n\n\n\n\nB")).toBe("<p>A</p><p>B</p>");
  });

  it("aparar: espaço nas pontas de cada bloco não vai para o HTML", () => {
    expect(descricaoDaLojaParaHtml("  A  \n\n  B  ")).toBe("<p>A</p><p>B</p>");
  });

  it("texto vazio ou só espaços vira vazio (a tela grava null)", () => {
    expect(descricaoDaLojaParaHtml("")).toBe("");
    expect(descricaoDaLojaParaHtml("   \n\n  \n")).toBe("");
  });

  it("marcação digitada é escapada, nunca interpretada", () => {
    expect(descricaoDaLojaParaHtml("<script>alert(1)</script>")).toBe(
      "<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>",
    );
    expect(descricaoDaLojaParaHtml('<img src=x onerror="a()">')).toBe(
      '<p>&lt;img src=x onerror="a()"&gt;</p>',
    );
  });

  it("o '&' é escapado ANTES dos outros (senão '&lt;' sairia como '&amp;lt;' em dobro)", () => {
    expect(descricaoDaLojaParaHtml("Moda & Cia")).toBe("<p>Moda &amp; Cia</p>");
    expect(descricaoDaLojaParaHtml("&lt;")).toBe("<p>&amp;lt;</p>");
    expect(descricaoDaLojaParaHtml("a < b > c & d")).toBe(
      "<p>a &lt; b &gt; c &amp; d</p>",
    );
  });

  it("todas as ocorrências são escapadas, não só a primeira", () => {
    expect(descricaoDaLojaParaHtml("<<>> && <b>")).toBe(
      "<p>&lt;&lt;&gt;&gt; &amp;&amp; &lt;b&gt;</p>",
    );
  });
});

describe("textoDaLoja — o inverso, o que o editor mostra ao reabrir", () => {
  it("vazio, nulo e indefinido viram texto vazio", () => {
    expect(textoDaLoja("")).toBe("");
    expect(textoDaLoja(null)).toBe("");
    expect(textoDaLoja(undefined)).toBe("");
  });

  it("parágrafos voltam a ser blocos separados por uma linha em branco", () => {
    expect(textoDaLoja("<p>A</p><p>B</p>")).toBe("A\n\nB");
    expect(textoDaLoja("<p>A</p>\n  <p>B</p>")).toBe("A\n\nB");
  });

  it("espaço e quebra de linha fora dos parágrafos não vão para o editor", () => {
    expect(textoDaLoja("  <p>A</p>\n")).toBe("A");
    expect(textoDaLoja("\n<p>A</p>\n<p>B</p>  ")).toBe("A\n\nB");
  });

  it("desfaz o escape e o '&' por último (senão '&amp;lt;' viraria '<')", () => {
    expect(textoDaLoja("<p>&amp;lt;</p>")).toBe("&lt;");
    expect(textoDaLoja("<p>a &lt; b &gt; c &amp; d</p>")).toBe("a < b > c & d");
  });
});

describe("ida e volta: salvar e reabrir devolve o que a lojista digitou", () => {
  const casos = [
    "Uma frase só.",
    "Primeira.\n\nSegunda.\n\nTerceira.",
    "Linha 1\nLinha 2\n\nOutro parágrafo.",
    "Moda & Cia — 100% <artesanal>",
    "Escrevi &lt; de verdade e &amp; também",
    "<script>alert(1)</script>",
    "a < b > c",
  ];
  it.each(casos)("%j", (texto) => {
    expect(textoDaLoja(descricaoDaLojaParaHtml(texto))).toBe(texto);
  });

  it("depois da primeira ida e volta o texto é estável (Salvar não reabilita sozinho)", () => {
    const sujo = "  A  \n\n\n\n  B & C  ";
    const uma = textoDaLoja(descricaoDaLojaParaHtml(sujo));
    expect(uma).toBe("A\n\nB & C");
    expect(textoDaLoja(descricaoDaLojaParaHtml(uma))).toBe(uma);
  });
});
