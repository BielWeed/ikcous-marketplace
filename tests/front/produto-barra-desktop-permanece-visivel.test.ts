import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { expect, it } from "vitest";

const fonte = ts.createSourceFile(
  "AdminProductFormView.tsx",
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- fonte local fixa, sem caminho recebido de usuário
  readFileSync(
    resolve(__dirname, "../../src/views/admin/AdminProductFormView.tsx"),
    "utf8",
  ),
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

it("nenhum ancestral da ação de salvar cria rolagem própria que desliga o sticky", () => {
  const ancestrais: ts.JsxElement[] = [];
  let encontrouBarra = false;
  const visitar = (no: ts.Node) => {
    if (ts.isJsxElement(no)) {
      if (no.openingElement.tagName.getText(fonte) === "AcaoDaBarra") {
        encontrouBarra = true;
        expect(ancestrais.length).toBeGreaterThan(0);
        const classes = ancestrais.map((el) =>
          el.openingElement.attributes.properties
            .filter(
              (attr) =>
                ts.isJsxAttribute(attr) &&
                attr.name.getText(fonte) === "className",
            )
            .map((attr) => attr.getText(fonte))
            .join(" "),
        );
        expect(classes.join(" ")).toContain("overflow-x-clip");
        for (const classe of classes) {
          expect(classe).not.toMatch(
            /overflow-(?:x-hidden|y-auto|y-scroll|hidden|auto|scroll)\b/,
          );
        }
      }
      ancestrais.push(no);
      ts.forEachChild(no, visitar);
      ancestrais.pop();
      return;
    }
    ts.forEachChild(no, visitar);
  };
  visitar(fonte);
  expect(encontrouBarra).toBe(true);
});
