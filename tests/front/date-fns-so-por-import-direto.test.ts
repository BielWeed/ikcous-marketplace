// date-fns só entra por import DIRETO (`date-fns/format`, `date-fns/locale/pt-BR`).
//
// Defeito medido (06/11): `import { format } from "date-fns"` e
// `import { ptBR } from "date-fns/locale"` carregam os "barris" -- o pacote
// inteiro e os 98 idiomas. No Node puro o barril de idiomas custa ~1,1 s, o
// do pacote ~0,9 s e só o `pt-BR` 19 ms. No runner de teste isso virava ~3 s a
// frio no 1º caso de ~33 arquivos (banner, perfil, perguntas do produto) e o
// prazo de 5 s do CI estourava de forma intermitente. No navegador o
// tree-shaking esconde o custo, por isso o código "parecia" certo.
//
// Esta régua lê os fontes de `src/` e reprova qualquer import de barril. Pega
// import estático (`from "date-fns"`), dinâmico (`import("date-fns")`) e
// reexport (`export ... from "date-fns/locale"`), com aspas simples ou duplas.
/* eslint-disable security/detect-non-literal-fs-filename -- varredura apenas de fontes locais do repositório */
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const RAIZ = fileURLToPath(new URL("../..", import.meta.url));
const SRC = join(RAIZ, "src");

// "date-fns" e "date-fns/locale" exatos; `date-fns/format` e
// `date-fns/locale/pt-BR` ficam de fora de propósito.
const BARRIL = /(?:from\s*|import\s*\(\s*)(["'])date-fns(?:\/locale)?\1/;

function fontes(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const caminho = join(dir, e.name);
    if (e.isDirectory()) return fontes(caminho);
    return /\.(?:ts|tsx|js|jsx|mjs)$/.test(e.name) ? [caminho] : [];
  });
}

describe("date-fns só por import direto", () => {
  it("a régua reconhece os imports de barril (e só eles)", () => {
    expect(BARRIL.test('import { format } from "date-fns";')).toBe(true);
    expect(BARRIL.test("import { format } from 'date-fns';")).toBe(true);
    expect(BARRIL.test('import { ptBR } from "date-fns/locale";')).toBe(true);
    expect(BARRIL.test("import { ptBR } from 'date-fns/locale'")).toBe(true);
    expect(BARRIL.test('const m = await import("date-fns");')).toBe(true);
    expect(BARRIL.test('export { ptBR } from "date-fns/locale";')).toBe(true);
    expect(BARRIL.test('import { format } from "date-fns/format";')).toBe(
      false,
    );
    expect(BARRIL.test('import { ptBR } from "date-fns/locale/pt-BR";')).toBe(
      false,
    );
  });

  it("nenhum arquivo de src/ importa o barril do pacote nem o de idiomas", () => {
    const arquivos = fontes(SRC);
    // Sem arquivos lidos a régua passaria no vazio.
    expect(arquivos.length).toBeGreaterThan(100);

    const infratores = arquivos
      .filter((f) =>
        readFileSync(f, "utf8")
          .split(/\r?\n/)
          .some((linha) => BARRIL.test(linha)),
      )
      .map((f) => relative(RAIZ, f).replaceAll("\\", "/"));

    expect(
      infratores,
      "troque por `date-fns/<função>` e `date-fns/locale/pt-BR`",
    ).toEqual([]);
  });
});
