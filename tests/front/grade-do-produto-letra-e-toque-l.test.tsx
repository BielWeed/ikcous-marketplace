// Onda L · frente "grade-do-produto" — prova ESTÁTICA (lê o fonte; o jsdom não
// aplica CSS, então a medida de 44px de verdade é a do render).
//
//  (a) O modal de variação e as linhas da grade não têm texto abaixo de 11px
//      (a régua do painel: `text-[6px]` … `text-[10.5px]`), fora de comentário.
//  (b) Os alvos de toque listados têm `min-h-11`: o chip de sugestão de
//      atributo, o "+ Atributo" e o "Aplicar para todas".
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex --
   lê arquivos-fonte do próprio repositório (caminhos constantes deste teste, não entrada de usuário); regex constantes, sem backtracking sobre entrada externa */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

const MODAL = "src/components/admin/products/ModalVarianteGrade.tsx";
const LINHAS = "src/components/admin/products/LinhasDaGrade.tsx";

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), "utf8");
}

/** Remove comentários de linha e de bloco para não contar texto que só está escrito. */
function semComentarios(fonte: string): string {
  return fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/** Os literais de string `"…"` do fonte (onde moram as `className`). */
function literais(fonte: string): string[] {
  return [...fonte.matchAll(/"([^"\n]*)"/g)].map((m) => m[1] ?? "");
}

/** O único literal que traz todas as marcas; falha se achar zero ou mais de um. */
function literalComMarcas(fonte: string, marcas: string[]): string {
  const achados = literais(fonte).filter((l) =>
    marcas.every((marca) => l.includes(marca)),
  );
  expect(achados, `esperava 1 literal com ${marcas.join(" + ")}`).toHaveLength(
    1,
  );
  return achados[0] ?? "";
}

describe("Grade do produto — letra e toque (onda L)", () => {
  it.each([MODAL, LINHAS])("%s não tem texto abaixo de 11px", (caminho) => {
    const fonte = semComentarios(ler(caminho));
    expect(fonte.match(/text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g) ?? []).toEqual([]);
  });

  it("o chip de sugestão de atributo tem 44px de altura", () => {
    const chip = literalComMarcas(semComentarios(ler(MODAL)), [
      "rounded-full",
      "font-black uppercase",
      "px-2.5",
    ]);
    expect(chip).toContain("min-h-11");
    expect(chip).toContain("text-[11px]");
  });

  it('o botão "+ Atributo" tem 44px de altura', () => {
    const botao = literalComMarcas(semComentarios(ler(MODAL)), [
      "border-dashed",
      "px-5 py-3",
    ]);
    expect(botao).toContain("min-h-11");
    expect(botao).toContain("text-[11px]");
  });

  it('o botão "Aplicar para todas" tem 44px de altura', () => {
    const botao = literalComMarcas(semComentarios(ler(LINHAS)), [
      "text-emerald-500",
      "px-5 py-3",
    ]);
    expect(botao).toContain("min-h-11");
    expect(botao).toContain("text-[11px]");
  });
});
