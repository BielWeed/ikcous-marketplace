import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { GRADE_DE_PRODUTOS_NO_COMPUTADOR } from "@/components/desktop/medidas";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelularSemGradeDeTablet } from "./classes-do-celular";

const arquivo = "src/views/customer/SearchView.tsx";
const ler = () => readFileSync(arquivo, "utf8");

function assinaturaDoCelular() {
  const fonte = ts.createSourceFile(
    arquivo,
    ler(),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const valores: string[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxAttribute(no) && no.name.getText(fonte) === "className") {
      function coletar(filho: ts.Node) {
        if (ts.isStringLiteral(filho)) {
          const celular = classesDoCelularSemGradeDeTablet(filho.text);
          if (celular) valores.push(celular);
        } else ts.forEachChild(filho, coletar);
      }
      if (no.initializer) coletar(no.initializer);
    } else ts.forEachChild(no, visitar);
  }
  visitar(fonte);
  return createHash("sha256").update(JSON.stringify(valores)).digest("hex");
}

describe("Busca — grade no computador", () => {
  it("preserva todas as classes do celular e tablet, inclusive a gaveta P8", () => {
    // Assinatura anterior à P13: literais na ordem da árvore, sem lg:/xl:/2xl:.
    expect(assinaturaDoCelular()).toBe(
      "2d4a0f2418a56c4965b213a645693a3225ab4ec3fbcc5a222392149774b9d90a",
    );
  });

  it("aplica a grade compartilhada e o respiro nas duas listas de produtos", () => {
    const fonte = ler();
    expect(fonte).toContain(
      'import { GRADE_DE_PRODUTOS_NO_COMPUTADOR } from "@/components/desktop/medidas"',
    );
    const grades = fonte.matchAll(
      /className={cn\(\s*"grid grid-cols-2 gap-6 md:grid-cols-3",\s*GRADE_DE_PRODUTOS_NO_COMPUTADOR,\s*"lg:gap-x-6 lg:gap-y-10",([^}]*?)\)}\s*>\s*\{(filteredProducts|trendingProducts)\./g,
    );
    const colunasEmXlPorLista = Object.fromEntries(
      Array.from(grades, ([, extras, lista]) => {
        const classesExtras = extras.replace(/\/\/[^\n]*/g, "");
        const sobrescrita = Array.from(
          classesExtras.matchAll(/"(xl:grid-cols-\d+)"/g),
          ([, classe]) => classe,
        ).at(-1);
        return [
          lista,
          sobrescrita ??
            GRADE_DE_PRODUTOS_NO_COMPUTADOR.match(/\bxl:grid-cols-\d+\b/)?.[0],
        ];
      }),
    );
    expect(colunasEmXlPorLista).toEqual({
      filteredProducts: "xl:grid-cols-5",
      trendingProducts: "xl:grid-cols-4",
    });
  });

  it("preserva o contêiner próprio da Busca com largura limitada e margens no PC", () => {
    const fonte = ler();
    expect(fonte).toMatch(
      /ref={resultadosRef}\s+className="mx-auto max-w-7xl px-4 py-8[^"]*lg:py-10[^"]*"/,
    );
    expect(fonte).not.toContain("CONTAINER_DO_COMPUTADOR");
    expect(fonte).not.toContain("PaginaDoComputador");
  });
});
