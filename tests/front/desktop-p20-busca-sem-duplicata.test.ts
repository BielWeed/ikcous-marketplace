import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const arquivo = "src/views/customer/SearchView.tsx";

function lerFonte() {
  return ts.createSourceFile(
    arquivo,
    readFileSync("src/views/customer/SearchView.tsx", "utf8"),
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function literaisDeClasse(no: ts.Node, fonte: ts.SourceFile): string[] {
  const valores: string[] = [];
  function visitar(filho: ts.Node) {
    if (ts.isJsxAttribute(filho) && filho.name.getText(fonte) === "className") {
      function coletar(valor: ts.Node) {
        if (ts.isStringLiteral(valor)) valores.push(valor.text);
        else ts.forEachChild(valor, coletar);
      }
      if (filho.initializer) coletar(filho.initializer);
    } else ts.forEachChild(filho, visitar);
  }
  visitar(no);
  return valores;
}

describe("P20 — busca sem controles duplicados no computador", () => {
  it("esconde apenas em lg a linha própria de campo e Voltar, preservando os filtros", () => {
    const fonte = lerFonte();
    const linhas: ts.JsxElement[] = [];
    function visitar(no: ts.Node) {
      if (
        ts.isJsxElement(no) &&
        no.children.some(
          (filho) =>
            ts.isJsxSelfClosingElement(filho) &&
            filho.tagName.getText(fonte) === "SearchInput",
        )
      ) {
        linhas.push(no);
      }
      ts.forEachChild(no, visitar);
    }
    visitar(fonte);
    expect(linhas).toHaveLength(1);
    // Só a linha que reúne ambos os controles: os filtros são seus irmãos.
    const classes = literaisDeClasse(linhas[0].openingElement, fonte);
    expect(classes).toEqual(["flex items-center gap-3 lg:hidden"]);
    expect(classesDoCelular(classes[0])).toBe("flex items-center gap-3");
  });

  it("mantém todos os literais de classe abaixo de lg iguais à base integrada", () => {
    const fonte = lerFonte();
    const celular = literaisDeClasse(fonte, fonte)
      .map(classesDoCelular)
      .filter(Boolean);
    // Mesma assinatura da base P13/P8: só literais de className, em ordem de DOM.
    expect(
      createHash("sha256").update(JSON.stringify(celular)).digest("hex"),
    ).toBe("2d4a0f2418a56c4965b213a645693a3225ab4ec3fbcc5a222392149774b9d90a");
  });
});
