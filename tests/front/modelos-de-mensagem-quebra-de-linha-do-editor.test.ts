// @vitest-environment jsdom
// Achado 4 (autônomo r8): o editor de "Compartilhar" em Minha loja > Contato é
// uma div contentEditable. Nos navegadores atuais o Enter cria blocos
// `<div>linha</div>` (linha em branco = `<div><br></div>`), não um `<br>`. A
// volta HTML → texto só olhava o `<br>`: "Oi!<div>Veja [nome]</div>" virava
// "Oi!Veja [nome]" e a lojista via a mensagem toda colada na prévia e na loja.
import {
  htmlDoMarcador,
  htmlParaTexto,
  textoParaHtml,
} from "@/components/admin/minha-loja/modelos-de-mensagem";
import { describe, expect, it } from "vitest";

/** Como o Chrome grava o que a lojista digitou com Enter: a 1ª linha solta e
 * cada linha seguinte num `<div>` (linha em branco = `<div><br></div>`). */
function htmlComoOChromeGrava(linhasEmHtml: readonly string[]): string {
  const [primeira = "", ...resto] = linhasEmHtml;
  return (
    primeira + resto.map((l) => `<div>${l === "" ? "<br>" : l}</div>`).join("")
  );
}

describe("htmlParaTexto — blocos do Enter viram quebra de linha", () => {
  it("1 linha: sem bloco, nada muda", () => {
    expect(htmlParaTexto("Oi!")).toBe("Oi!");
    expect(htmlParaTexto("<div>Oi!</div>")).toBe("Oi!");
  });

  it("2 linhas: 'Oi!<div>Veja [nome]</div>' mantém a quebra", () => {
    const html = `Oi!<div>Veja ${htmlDoMarcador("nome")}</div>`;
    expect(htmlParaTexto(html)).toBe("Oi!\nVeja [nome]");
  });

  it("3 linhas: uma quebra entre cada uma, nem mais nem menos", () => {
    expect(htmlParaTexto("A<div>B</div><div>C</div>")).toBe("A\nB\nC");
    expect(htmlParaTexto("<div>A</div><div>B</div><div>C</div>")).toBe(
      "A\nB\nC",
    );
  });

  it("linha em branco: 'A<div><br></div><div>B</div>' vira A, vazio, B", () => {
    expect(htmlParaTexto("A<div><br></div><div>B</div>")).toBe("A\n\nB");
  });

  it("o <br> sozinho dentro do bloco não duplica a quebra", () => {
    expect(htmlParaTexto("<div><br></div>")).toBe("");
    expect(htmlParaTexto("<div>A</div><div><br></div><div>B</div>")).toBe(
      "A\n\nB",
    );
    expect(htmlParaTexto("A<div><br></div><div><br></div><div>B</div>")).toBe(
      "A\n\n\nB",
    );
  });

  it("primeira linha em branco não some", () => {
    expect(htmlParaTexto("<div><br></div><div>B</div>")).toBe("\nB");
  });

  it("<p> se comporta como <div>", () => {
    expect(htmlParaTexto("<p>A</p><p>B</p>")).toBe("A\nB");
  });

  it("Shift+Enter (<br>) continua valendo, solto ou dentro do bloco", () => {
    expect(htmlParaTexto("A<br>B")).toBe("A\nB");
    expect(htmlParaTexto("A<div>B<br>C</div>")).toBe("A\nB\nC");
    expect(htmlParaTexto("A<br><br>B")).toBe("A\n\nB");
  });

  it("texto solto depois de um bloco começa linha nova", () => {
    expect(htmlParaTexto("<div>A</div>B")).toBe("A\nB");
  });

  it("bloco dentro de bloco não abre linha em branco à toa", () => {
    expect(htmlParaTexto("<div><div>A</div></div><div>B</div>")).toBe("A\nB");
  });

  it("espaço de formatação entre blocos não vira linha", () => {
    expect(htmlParaTexto("<div>A</div>\n<div>B</div>")).toBe("A\nB");
  });

  it("os marcadores continuam virando [nome], [preco] e [link]", () => {
    const html = `Olá<div>${htmlDoMarcador("nome")} por ${htmlDoMarcador("preco")}</div><div>${htmlDoMarcador("link")}</div>`;
    expect(htmlParaTexto(html)).toBe("Olá\n[nome] por [preco]\n[link]");
  });
});

describe("ida e volta: texto → HTML do editor → texto", () => {
  const casos: ReadonlyArray<readonly [string, string]> = [
    ["1 linha", "Confira [nome] por [preco]: [link]"],
    ["2 linhas", "Oi!\nVeja [nome] por [preco]"],
    ["3 linhas", "Oi!\nVeja [nome] por [preco]\n[link]"],
    ["linha em branco", "Oi!\n\nVeja [nome]"],
    ["duas linhas em branco", "Oi!\n\n\n[link]"],
  ];

  it.each(casos)("%s: o <br> do textoParaHtml volta igual", (_nome, texto) => {
    expect(htmlParaTexto(textoParaHtml(texto))).toBe(texto);
  });

  it.each(casos)(
    "%s: o que o Chrome grava com Enter volta igual",
    (_nome, texto) => {
      const linhasEmHtml = texto.split("\n").map((l) => textoParaHtml(l));
      expect(htmlParaTexto(htmlComoOChromeGrava(linhasEmHtml))).toBe(texto);
    },
  );

  it.each(casos)("%s: tudo em <div> (Firefox) volta igual", (_nome, texto) => {
    const html = texto
      .split("\n")
      .map((l) => `<div>${l === "" ? "<br>" : textoParaHtml(l)}</div>`)
      .join("");
    expect(htmlParaTexto(html)).toBe(texto);
  });
});
