import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const caminho = "src/views/admin/AdminAboutStoreView.tsx";
const fonte = readFileSync("src/views/admin/AdminAboutStoreView.tsx", "utf8");
const base = execFileSync("git", ["show", `84a35d769:${caminho}`], {
  encoding: "utf8",
});

function elementos(texto: string) {
  const arquivo = ts.createSourceFile(
    caminho,
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const encontrados: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxOpeningElement(no) || ts.isJsxSelfClosingElement(no))
      encontrados.push(no);
    ts.forEachChild(no, visitar);
  }
  visitar(arquivo);
  return encontrados;
}

function classes(no: ts.JsxOpeningElement | ts.JsxSelfClosingElement) {
  const atributo = no.attributes.properties.find(
    (item) => ts.isJsxAttribute(item) && item.name.getText() === "className",
  );
  return atributo &&
    ts.isJsxAttribute(atributo) &&
    atributo.initializer &&
    ts.isStringLiteral(atributo.initializer)
    ? atributo.initializer.text
    : "";
}

function semComputador(texto: string) {
  return texto
    .replace(/\s+(?:lg|xl|2xl):[^\s"']+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

describe("P19 — Minha loja no computador", () => {
  it("só acrescenta classes de computador: celular, DOM e lógica iguais à base", () => {
    expect(elementos(fonte).map((no) => classesDoCelular(classes(no)))).toEqual(
      elementos(base).map((no) => classesDoCelular(classes(no))),
    );
    expect(semComputador(fonte)).toBe(semComputador(base));
  });

  it("alinha título, aviso e corpo na largura do painel e só divide em xl", () => {
    const nos = elementos(fonte);
    const cabecalho = nos.find((no) => no.tagName.getText() === "header");
    const formulario = nos.find((no) => no.tagName.getText() === "fieldset");
    expect(cabecalho).toBeDefined();
    expect(formulario).toBeDefined();
    for (const no of [cabecalho, formulario]) {
      expect(classes(no!)).toContain("lg:max-w-none");
      expect(classes(no!)).toContain("lg:px-6");
    }
    const aviso = nos.find(
      (no) => classes(no).includes("pt-4") && no.tagName.getText() === "div",
    );
    expect(classes(aviso!)).toContain("lg:max-w-none");
    expect(classes(aviso!)).toContain("lg:px-6");
    const grade = classes(formulario!);
    for (const token of [
      "xl:grid",
      "xl:grid-cols-2",
      "xl:gap-6",
      "xl:space-y-0",
    ]) {
      expect(grade.split(/\s+/)).toContain(token);
    }
    expect(grade).not.toMatch(/lg:grid/);
    // 1024: 720 px, uma coluna. 1280: (976 - 24) / 2 = 476.
    expect((1280 - 256 - 48 - 24) / 2).toBeGreaterThanOrEqual(420);
    expect(fonte).not.toMatch(
      /lg:overflow-hidden|xl:overflow-hidden|lg:h-screen|xl:h-screen/,
    );
  });

  it("enumera todos os filhos da grade e não deixa buracos com avisos presentes ou ausentes", () => {
    const formulario = elementos(fonte).find(
      (no) => no.tagName.getText() === "fieldset",
    );
    expect(formulario).toBeDefined();
    const filhos: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
    function coletar(no: ts.Node) {
      if (ts.isJsxElement(no)) filhos.push(no.openingElement);
      else if (ts.isJsxSelfClosingElement(no)) filhos.push(no);
      else ts.forEachChild(no, coletar);
    }
    const pai = formulario!.parent;
    expect(ts.isJsxElement(pai)).toBe(true);
    if (!ts.isJsxElement(pai)) throw new Error("fieldset sem corpo");
    for (const filho of pai.children) coletar(filho);
    expect(filhos.map((no) => no.tagName.getText())).toEqual([
      "div",
      "div",
      ...Array(6).fill("BlocoNumerado"),
      "p",
    ]);
    for (const no of filhos.filter(
      (filho) => filho.tagName.getText() !== "BlocoNumerado",
    )) {
      expect(classes(no).split(/\s+/)).toContain("xl:col-span-2");
    }
    for (const offline of [false, true]) {
      for (const pendencias of [false, true]) {
        const visiveis = filhos.filter(
          (_, indice) => indice > 1 || (indice === 0 ? offline : pendencias),
        );
        let coluna = 0;
        for (const no of visiveis) {
          const largura = classes(no).includes("xl:col-span-2") ? 2 : 1;
          if (largura === 2) expect(coluna).toBe(0);
          coluna = (coluna + largura) % 2;
        }
        expect(coluna).toBe(0);
      }
    }
  });
});
