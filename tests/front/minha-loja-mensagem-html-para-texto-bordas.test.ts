// @vitest-environment jsdom
//
// O editor da mensagem de compartilhar (`htmlParaTexto` em
// `src/components/admin/minha-loja/modelos-de-mensagem.ts`) lê o HTML do
// contentEditable linha por linha. Bordas que os testes da prévia não tocam:
// espaço solto antes do primeiro texto, texto depois de um bloco fechado, e o
// `<br>` solto logo depois de um bloco (que deixa uma linha em branco).
import { describe, expect, it } from "vitest";

import { htmlParaTexto } from "@/components/admin/minha-loja/modelos-de-mensagem";

describe("htmlParaTexto — bordas da leitura por linhas", () => {
  it("espaço dentro de um elemento, ANTES de qualquer texto, é texto: não some", () => {
    expect(htmlParaTexto("<span> </span>x")).toBe(" x");
  });

  it("espaço de formatação ENTRE dois blocos não vira linha", () => {
    expect(htmlParaTexto("<div>A</div> <div>B</div>")).toBe("A\nB");
    expect(htmlParaTexto("<div>A</div>\n  <div>B</div>")).toBe("A\nB");
  });

  it("texto solto depois de um bloco fechado começa linha nova", () => {
    expect(htmlParaTexto("<div>A</div>B")).toBe("A\nB");
    expect(htmlParaTexto("<div>A</div><div>B</div>C")).toBe("A\nB\nC");
  });

  it("<br> solto depois de um bloco deixa uma linha em branco antes do que vem", () => {
    expect(htmlParaTexto("<div>A</div><br>B")).toBe("A\n\nB");
  });

  it("<br> solto no meio de um texto quebra a linha uma vez", () => {
    expect(htmlParaTexto("A<br>B")).toBe("A\nB");
    expect(htmlParaTexto("A<br><br>B")).toBe("A\n\nB");
  });

  it("<br> que é o único filho do bloco é só o marcador de linha vazia (não duplica a quebra)", () => {
    expect(htmlParaTexto("<div>A</div><div><br></div><div>B</div>")).toBe(
      "A\n\nB",
    );
    expect(htmlParaTexto("A<div><br></div>B")).toBe("A\n\nB");
  });

  it("entrada vazia devolve vazio", () => {
    expect(htmlParaTexto("")).toBe("");
  });
});
