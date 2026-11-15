import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const fonte = readFileSync("src/views/customer/OrderDetailsView.tsx", "utf8");

function classeDepoisDoMarcador(marcador: string) {
  const inicio = fonte.indexOf(marcador);
  expect(inicio).toBeGreaterThanOrEqual(0);
  return (
    fonte.slice(inicio).match(/className=(?:\{cn\(\s*)?"([^"]+)"/)?.[1] ?? ""
  );
}

describe("detalhe do pedido no computador — P10", () => {
  it("abre duas colunas internas sem duplicar o contêiner da casca", () => {
    const classe = classeDepoisDoMarcador('<div className="mx-auto max-w-2xl');
    for (const token of [
      "lg:grid",
      "lg:grid-cols-2",
      "lg:items-start",
      "lg:gap-6",
      "lg:space-y-0",
      "lg:max-w-none",
    ]) {
      expect(classe.split(" ")).toContain(token);
    }
    expect(fonte).not.toMatch(
      /(?:lg|xl|2xl):(?:sticky|fixed|order-|row-start-)/,
    );
  });

  it("mantém etapas, avisos e ações largos, com itens e resumo lado a lado", () => {
    for (const marcador of [
      'data-testid="aviso-retrato-do-convidado"',
      'role="status"\n            className="flex items-center justify-between gap-3',
      'data-testid="cartao-status"',
      'data-testid="cartao-avaliacao"',
      "transition={{ delay: 0.08 }}",
      "{/* Lista de ações */}",
      "{/* Cartão de informações: endereço e pagamento */}",
    ]) {
      expect(classeDepoisDoMarcador(marcador).split(" ")).toContain(
        "lg:col-span-2",
      );
    }
    for (const marcador of [
      '{/* Cartão "Itens do pedido" */}',
      '{/* Cartão "Resumo" */}',
    ]) {
      expect(classeDepoisDoMarcador(marcador)).not.toContain("lg:col-span-2");
    }
  });

  it("fecha as linhas de todos os filhos diretos, com ou sem blocos condicionais", () => {
    const arvore = ts.createSourceFile(
      "OrderDetailsView.tsx",
      fonte,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let grade: ts.JsxElement | undefined;
    function localizar(no: ts.Node) {
      if (
        ts.isJsxElement(no) &&
        no.openingElement.attributes.properties.some(
          (atributo) =>
            ts.isJsxAttribute(atributo) &&
            atributo.name.getText(arvore) === "className" &&
            atributo.initializer &&
            ts.isStringLiteral(atributo.initializer) &&
            atributo.initializer.text.startsWith("mx-auto max-w-2xl "),
        )
      ) {
        grade = no;
      }
      ts.forEachChild(no, localizar);
    }
    localizar(arvore);
    expect(grade).toBeDefined();
    if (!grade) throw new Error("Grade do detalhe não encontrada");

    const filhos: { span: number; condicional: boolean }[] = [];
    function registrar(no: ts.Node, condicional: boolean) {
      if (ts.isJsxElement(no)) {
        const classe = no.openingElement.attributes.properties.find(
          (atributo) =>
            ts.isJsxAttribute(atributo) &&
            atributo.name.getText(arvore) === "className",
        );
        filhos.push({
          span: classe?.getText(arvore).includes("lg:col-span-2") ? 2 : 1,
          condicional,
        });
        return; // Não conta os descendentes de cada cartão como células.
      }
      ts.forEachChild(no, (filho) => registrar(filho, condicional));
    }
    for (const filho of grade.children) {
      if (ts.isJsxElement(filho)) registrar(filho, false);
      else if (ts.isJsxExpression(filho) && filho.expression) {
        registrar(filho.expression, true);
      }
    }

    // Retrato, erro, etapas, avaliação, devolução, itens, resumo, endereço, ações.
    expect(filhos.map(({ span }) => span)).toEqual([2, 2, 2, 2, 2, 1, 1, 2, 2]);
    expect(filhos.map(({ condicional }) => condicional)).toEqual([
      true,
      true,
      false,
      true,
      true,
      false,
      false,
      false,
      false,
    ]);
    const totalCondicionais = filhos.filter(
      (filho) => filho.condicional,
    ).length;
    for (let mascara = 0; mascara < 2 ** totalCondicionais; mascara++) {
      let condicional = 0;
      let coluna = 0;
      for (const filho of filhos) {
        if (filho.condicional && !(mascara & (1 << condicional++))) continue;
        // Um bloco largo com meia linha ocupada deixaria um buraco à direita.
        if (filho.span === 2) expect(coluna).toBe(0);
        coluna = (coluna + filho.span) % 2;
      }
      expect(coluna).toBe(0);
    }
  });

  it("preserva a assinatura das 160 classes de celular, incluindo classes condicionais", () => {
    const arvore = ts.createSourceFile(
      "OrderDetailsView.tsx",
      fonte,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const classes: string[][] = [];
    function visitar(no: ts.Node) {
      if (ts.isJsxAttribute(no) && no.name.getText(arvore) === "className") {
        const literais: string[] = [];
        function coletar(filho: ts.Node) {
          if (ts.isStringLiteral(filho)) {
            const celular = classesDoCelular(filho.text);
            if (celular) literais.push(celular);
          }
          ts.forEachChild(filho, coletar);
        }
        if (no.initializer) coletar(no.initializer);
        if (literais.length) classes.push(literais);
      }
      ts.forEachChild(no, visitar);
    }
    visitar(arvore);
    expect(classes).toHaveLength(160);
    // Medida na base f04669a6a, antes da implementação; não depende do HEAD.
    expect(
      createHash("sha256").update(JSON.stringify(classes)).digest("hex"),
    ).toBe("85cc285a16756b4cce95c1da18af7416062812b59c858cfee3b8ea0416504f59");
  });
});
