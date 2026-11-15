/* eslint-disable security/detect-non-literal-fs-filename -- URL fixa da tela local, sem entrada externa. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const fonte = readFileSync(
  new URL("../../src/views/admin/AdminCouponFormView.tsx", import.meta.url),
  "utf8",
);
const arvore = ts.createSourceFile(
  "AdminCouponFormView.tsx",
  fonte,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function atributo(elemento: ts.JsxElement, nome: string) {
  const prop = elemento.openingElement.attributes.properties.find(
    (no) => ts.isJsxAttribute(no) && no.name.getText(arvore) === nome,
  );
  if (!prop || !ts.isJsxAttribute(prop)) return "";
  return prop.initializer && ts.isStringLiteral(prop.initializer)
    ? prop.initializer.text
    : (prop.initializer?.getText(arvore) ?? "");
}

function localizar(predicado: (elemento: ts.JsxElement) => boolean) {
  let encontrado: ts.JsxElement | undefined;
  function visitar(no: ts.Node) {
    if (ts.isJsxElement(no) && predicado(no)) encontrado = no;
    ts.forEachChild(no, visitar);
  }
  visitar(arvore);
  if (!encontrado) throw new Error("Bloco do formulário não encontrado");
  return encontrado;
}

function filhosDiretos(elemento: ts.JsxElement) {
  const filhos: { elemento: ts.JsxElement; condicional: boolean }[] = [];
  function coletar(no: ts.Node, condicional: boolean) {
    if (ts.isJsxElement(no)) {
      filhos.push({ elemento: no, condicional });
      return; // Os descendentes da célula não são outras células da grade.
    }
    ts.forEachChild(no, (filho) => coletar(filho, condicional));
  }
  for (const filho of elemento.children) {
    if (ts.isJsxElement(filho)) coletar(filho, false);
    else if (ts.isJsxExpression(filho) && filho.expression) {
      coletar(filho.expression, true);
    }
  }
  return filhos;
}

const corpo = localizar((el) =>
  atributo(el, "className").startsWith("mx-auto max-w-xl "),
);
const grade = localizar((el) =>
  filhosDiretos(el).some(
    (filho) =>
      atributo(filho.elemento, "aria-labelledby") === "coupon-identification",
  ),
);

describe("formulário de cupom no computador — P15", () => {
  it("usa a largura disponível, mas só divide as seções a partir de 1280 px", () => {
    const cabecalho = localizar((el) =>
      atributo(el, "className").startsWith("mx-auto flex max-w-xl "),
    );
    for (const el of [corpo, cabecalho]) {
      expect(atributo(el, "className").split(" ")).toContain("lg:max-w-none");
    }
    const classes = atributo(grade, "className").split(" ");
    for (const token of [
      "xl:grid",
      "xl:grid-cols-2",
      "xl:items-start",
      "xl:gap-6",
      "xl:space-y-0",
    ]) {
      expect(classes).toContain(token);
    }
    expect(classes).not.toContain("lg:grid-cols-2");
    expect(fonte).not.toMatch(
      /(?:lg|xl|2xl):(?:order-|row-start-|grid-flow-dense|overflow-hidden)/,
    );
  });

  it("enumera todas as células e fecha cada linha, com ou sem os avisos e público", () => {
    const filhos = filhosDiretos(grade);
    expect(
      filhos.map(
        ({ elemento }) =>
          atributo(elemento, "aria-labelledby") ||
          atributo(elemento, "data-testid") ||
          atributo(elemento, "role") ||
          elemento.openingElement.tagName.getText(arvore),
      ),
    ).toEqual([
      "coupon-identification",
      "coupon-discount",
      "coupon-limits",
      "aviso-cupom-cobre-a-compra",
      "coupon-validity",
      "note",
      "div",
    ]);
    expect(filhos.map(({ condicional }) => condicional)).toEqual([
      false,
      false,
      false,
      true,
      false,
      true,
      true,
    ]);
    const celulas = filhos.map(({ elemento, condicional }) => ({
      span: atributo(elemento, "className").split(" ").includes("xl:col-span-2")
        ? 2
        : 1,
      condicional,
    }));
    expect(celulas.map(({ span }) => span)).toEqual([1, 1, 2, 2, 2, 2, 2]);
    // Também percorre combinações impossíveis: nenhum condicional pode
    // depender da presença de outro para completar uma linha.
    for (let mascara = 0; mascara < 8; mascara++) {
      let indice = 0;
      let coluna = 0;
      for (const celula of celulas) {
        if (celula.condicional && !(mascara & (1 << indice++))) continue;
        if (celula.span === 2) expect(coluna).toBe(0);
        coluna = (coluna + celula.span) % 2;
      }
      expect(coluna).toBe(0);
    }
  });

  it("mantém estados, prévia e o único salvar fora da grade, na largura inteira", () => {
    const filhos = filhosDiretos(corpo);
    expect(
      filhos.map(
        ({ elemento }) =>
          atributo(elemento, "role") ||
          elemento.openingElement.tagName.getText(arvore),
      ),
    ).toEqual(["status", "status", "status", "div", "AcaoDaBarra"]);
    const formulario = filhos.find(
      ({ elemento, condicional }) =>
        !condicional &&
        elemento.openingElement.tagName.getText(arvore) === "div",
    );
    if (!formulario) throw new Error("Formulário não encontrado");
    const blocos = filhosDiretos(formulario.elemento);
    expect(blocos).toHaveLength(2);
    expect(blocos[0].elemento.getText(arvore)).toContain('id="coupon-preview"');
    expect(blocos[1].elemento).toBe(grade);
    for (const el of [corpo, formulario.elemento]) {
      expect(atributo(el, "className")).not.toMatch(/(?:lg|xl|2xl):grid/);
    }
    let salvar = 0;
    function contar(no: ts.Node) {
      if (ts.isJsxElement(no) && atributo(no, "onClick") === "{handleSubmit}") {
        salvar++;
      }
      ts.forEachChild(no, contar);
    }
    contar(arvore);
    expect(salvar).toBe(1);
    expect(filhos[4].elemento.getText(arvore)).toContain("Salvar Cupom");
  });

  it("preserva as 78 classes móveis e condicionais da base, inclusive abaixo de 1024 px", () => {
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
    expect(classes).toHaveLength(78);
    // Só classes (não hash da fonte): medido ANTES da mudança em 84a35d769.
    expect(
      createHash("sha256").update(JSON.stringify(classes)).digest("hex"),
    ).toBe("61918e599b8aff760bdc9f3605bbaa2a645d3fa0000cf946df200cb0be7286eb");
  });
});
