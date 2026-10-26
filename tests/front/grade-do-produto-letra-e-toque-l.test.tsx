// Onda L · frente "grade-do-produto" — prova ESTÁTICA (lê o fonte; o jsdom não
// aplica CSS, então a medida de 44px de verdade é a do render).
//
//  (a) O modal de variação, o seletor de atributo e as linhas da grade não têm
//      texto abaixo de 11px (a régua do painel: `text-[6px]` … `text-[10.5px]`),
//      fora de comentário.
//  (b) Os alvos de toque listados têm `min-h-11`: as peças e os chips do
//      seletor de atributo (que trocou as sugestões digitáveis por toque), o
//      "+ Atributo" e o "Aplicar para todas".
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex --
   lê arquivos-fonte do próprio repositório (caminhos constantes deste teste, não entrada de usuário); regex constantes, sem backtracking sobre entrada externa */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

const MODAL = "src/components/admin/products/ModalVarianteGrade.tsx";
const LINHAS = "src/components/admin/products/LinhasDaGrade.tsx";
const SELETOR = "src/components/admin/products/SeletorDeAtributo.tsx";

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
  it.each([MODAL, LINHAS, SELETOR])(
    "%s não tem texto abaixo de 11px",
    (caminho) => {
      const fonte = semComentarios(ler(caminho));
      expect(fonte.match(/text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g) ?? []).toEqual(
        [],
      );
    },
  );

  it("toda peça, chip e bolinha do seletor de atributo tem 44px de altura", () => {
    const fonte = semComentarios(ler(SELETOR));
    // Os alvos de toque do seletor: a peça de tipo (card), o tamanho/voltagem,
    // o chip arredondado e a bolinha de cor (que mora num botão com min-h-11).
    for (const marcas of [
      ["flex-col items-center justify-center", "py-2.5"],
      ["relative flex min-h-11", "rounded-xl"],
      ["rounded-full", "px-3"],
      ["flex-col items-center gap-1", "py-0.5"],
    ]) {
      const alvos = literais(fonte).filter((l) =>
        marcas.every((marca) => l.includes(marca)),
      );
      expect(alvos.length, marcas.join(" + ")).toBeGreaterThan(0);
      for (const alvo of alvos) expect(alvo).toContain("min-h-11");
    }
  });

  it('o botão "+ Adicionar outro atributo" tem 44px de altura', () => {
    const botao = literalComMarcas(semComentarios(ler(MODAL)), [
      "border-dashed",
      "px-5 py-3",
    ]);
    expect(botao).toContain("min-h-11");
    // Letra de 14px ou, no mínimo, os 11px da régua.
    expect(botao).toMatch(/text-(?:sm|\[11px\])/);
  });

  it('o botão "Aplicar para todas" tem 44px de altura', () => {
    const fonte = semComentarios(ler(LINHAS));
    // A cor mudou com o desenho; identificamos a ação pelo botão e seu texto.
    const botoes = [...fonte.matchAll(/<button\b[\s\S]*?<\/button>/g)]
      .map((m) => m[0])
      .filter((b) => />\s*Aplicar para todas\s*<\/button>/.test(b));
    expect(botoes).toHaveLength(1);
    expect(botoes[0]).toContain("onClick={onAplicarParaTodas}");
    const botao = literalComMarcas(botoes[0] ?? "", ["px-5 py-3"]);
    expect(botao).toContain("min-h-11");
    expect(botao).toContain("text-[11px]");
  });
});
