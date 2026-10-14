// iPhone: o Safari amplia a página quando o cliente toca num campo de texto
// com letra menor que 16px. `html` e `body` têm `overflow: hidden`, então a
// página ampliada não volta sozinha.
//
// O conserto é UMA regra em `src/index.css`, só para iOS/iPadOS
// (`@supports (-webkit-touch-callout: none)`), que fixa 16px nos campos de
// texto. jsdom não mede CSS, então o teste lê o texto do arquivo e afirma a
// regra. Se alguém apagar a regra, tirar o `@supports` (o que mudaria o visual
// no Android e no computador) ou deixar de fora um tipo de campo de texto, cai.
/* eslint-disable security/detect-non-literal-fs-filename --
   lê um arquivo fixo da própria árvore do repositório */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(
  join(__dirname, "..", "..", "src", "index.css"),
  "utf8",
);

/** O corpo (entre as chaves externas) do bloco `@supports` do iOS, ou null. */
function blocoDoIos(css: string): string | null {
  const inicio = css.indexOf("@supports (-webkit-touch-callout: none)");
  if (inicio === -1) return null;
  const abre = css.indexOf("{", inicio);
  let nivel = 0;
  for (let i = abre; i < css.length; i++) {
    if (css[i] === "{") nivel++;
    if (css[i] === "}") {
      nivel--;
      if (nivel === 0) return css.slice(abre + 1, i);
    }
  }
  return null;
}

describe("campo de texto no iPhone não amplia a página", () => {
  const bloco = blocoDoIos(CSS);

  it("existe uma regra só para iOS que fixa 16px", () => {
    expect(bloco).not.toBeNull();
    expect(bloco).toMatch(/font-size:\s*16px\s*!important/);
  });

  it("cobre campo de texto, área de texto e lista de escolha", () => {
    expect(bloco).toMatch(/(^|\s|,)input:not\(/);
    expect(bloco).toMatch(/(^|\s|,)textarea\s*,|,\s*textarea(\s|,|\{)/);
    expect(bloco).toMatch(/(^|\s|,)select\s*\{/);
  });

  it("não mexe em caixa de marcar, botão de escolha, intervalo, arquivo nem campo oculto", () => {
    for (const tipo of ["checkbox", "radio", "range", "file", "hidden"]) {
      expect(bloco).toContain(`[type="${tipo}"]`);
    }
  });

  it("a regra de 16px não vale fora do @supports (Android e computador não mudam)", () => {
    const fora = bloco === null ? CSS : CSS.replace(bloco, "");
    expect(fora).not.toMatch(
      /textarea[^{}]*\{[^}]*font-size:\s*16px\s*!important/,
    );
  });
});
