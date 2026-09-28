// Onda 0 do plano app-cliente-desktop (F1.5, contrato C3): variáveis da
// casca do computador (≥1024px) vivem TODAS dentro de um único bloco
// `@media (min-width: 1024px)` em `src/index.css` -- R10 (spec §4.1): "CSS
// global só dentro de media query". Os valores de BASE (52px e o resto)
// seguem byte a byte idênticos fora do media: nada muda para quem está
// abaixo de 1024px.
//
// Padrão de teste C (spec §4.4): leitura do CSS-fonte. `import.meta.glob`
// com `?raw` não serve para `.css` neste projeto -- o plugin de CSS do Vite
// intercepta a extensão antes da query "raw" (o transform em ambiente
// node/SSR devolve módulo com export default vazio); mesmo caminho de
// `admin-ficha-barra-de-acoes-nao-rola-junto.test.ts`: `readFileSync` direto.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório, montado de import.meta.url
const CSS = readFileSync(
  new URL("../../src/index.css", import.meta.url),
  "utf8",
);

/** Extrai o conteúdo entre as chaves de `@media (<consulta>) { ... }`, com contagem de chaves aninhadas. */
function extrairBlocoDeMedia(css: string, consulta: string): string {
  const marcador = `@media (${consulta})`;
  const inicioMarcador = css.indexOf(marcador);
  if (inicioMarcador === -1) return "";

  const aberturaChave = css.indexOf("{", inicioMarcador);
  if (aberturaChave === -1) return "";

  let profundidade = 0;
  for (let i = aberturaChave; i < css.length; i++) {
    const caractere = css.charAt(i);
    if (caractere === "{") profundidade++;
    else if (caractere === "}") {
      profundidade--;
      if (profundidade === 0) {
        return css.slice(aberturaChave + 1, i);
      }
    }
  }
  return css.slice(aberturaChave + 1);
}

// Literais de BASE de hoje, byte a byte (copiados do arquivo antes desta
// tarefa) -- se sumirem ou mudarem, o celular mudou, o que é proibido.
const HEADER_HEIGHT_DE_BASE = "--header-height: 52px;";
const CUSTOMER_PB_DE_BASE = `--customer-pb: calc(
      64px +
      var(--safe-area-bottom, 0px) +
      var(--visual-bottom-offset, 0px) +
      24px
    );`;
const CUSTOMER_PB_SUMMARY_DE_BASE = `--customer-pb-summary: calc(
      130px +
      var(--safe-area-bottom, 0px) +
      var(--visual-bottom-offset, 0px) +
      15px
    );`;
const TOAST_TOP_DE_BASE =
  "top: calc(var(--safe-area-top, 0px) + 64px) !important;";

describe("variáveis da casca do computador — contrato C3", () => {
  it("o arquivo foi lido (a varredura não é vazia)", () => {
    expect(CSS).toBeTruthy();
    expect(CSS.length).toBeGreaterThan(1000);
  });

  it("existe um bloco @media (min-width: 1024px) com os três valores de C3", () => {
    const bloco = extrairBlocoDeMedia(CSS, "min-width: 1024px");
    expect(
      bloco,
      "esperava um bloco @media (min-width: 1024px) em index.css",
    ).not.toBe("");

    expect(bloco).toMatch(/--header-height:\s*72px\s*;/);
    expect(bloco).toMatch(/--customer-pb:\s*64px\s*;/);
    expect(bloco).toMatch(/--customer-pb-summary:\s*64px\s*;/);
  });

  it("a regra do toast, dentro do media de computador, usa var(--header-height)", () => {
    const bloco = extrairBlocoDeMedia(CSS, "min-width: 1024px");
    expect(bloco).toMatch(/data-sonner-toaster/);
    expect(bloco).toMatch(/var\(--header-height\)/);
    // safe-area continua fazendo parte da conta, só que agora somada ao
    // header de 72px, não ao valor fixo de 64px do celular.
    expect(bloco).toMatch(/var\(--safe-area-top,\s*0px\)/);
  });

  it("os valores de BASE (52px e o resto) seguem idênticos fora do media, byte a byte", () => {
    expect(CSS).toContain(HEADER_HEIGHT_DE_BASE);
    expect(CSS).toContain(CUSTOMER_PB_DE_BASE);
    expect(CSS).toContain(CUSTOMER_PB_SUMMARY_DE_BASE);
    expect(CSS).toContain(TOAST_TOP_DE_BASE);
  });
});
