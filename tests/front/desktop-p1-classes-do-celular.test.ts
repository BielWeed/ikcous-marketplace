import app from "@/App?raw";
import bottom from "@/components/ui/custom/BottomNav?raw";
import lembrete from "@/components/ui/custom/CartReminder?raw";
import header from "@/components/ui/custom/Header?raw";
import sobre from "@/views/customer/AboutStoreView?raw";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

// Snapshot criado na base 1.5.187, ANTES da implementação. Captura TODOS os
// literais de className, inclusive cn(), ternários e partes de templates.
// Só tokens que COMEÇAM por lg/xl/2xl podem ser acrescentados.
function classes(fonte: string) {
  const arquivo = ts.createSourceFile(
    "peca.tsx",
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const partes: string[] = [];
  const extrair = (node: ts.Node) => {
    if (
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateHead(node) ||
      ts.isTemplateMiddle(node) ||
      ts.isTemplateTail(node)
    ) {
      const celular = classesDoCelular(node.text);
      if (celular) partes.push(celular);
    } else ts.forEachChild(node, extrair);
  };
  const visitar = (node: ts.Node) => {
    if (
      ts.isJsxAttribute(node) &&
      node.name.getText(arquivo) === "className" &&
      node.initializer
    ) {
      extrair(node.initializer);
    } else ts.forEachChild(node, visitar);
  };
  visitar(arquivo);
  return partes;
}

describe("P1 preserva cada classe de celular da base", () => {
  for (const [nome, fonte] of Object.entries({
    header,
    bottom,
    app,
    lembrete,
    sobre,
  })) {
    it(nome, () => {
      expect(classes(fonte)).toMatchSnapshot();
    });
  }
});
