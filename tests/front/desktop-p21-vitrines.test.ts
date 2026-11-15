/* eslint-disable security/detect-non-literal-fs-filename -- Caminhos fixos das duas fontes da peça P21. */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const tela = "src/views/admin/AdminCarouselsView.tsx";
const cartao = "src/components/admin/vitrines/CartaoDaVitrine.tsx";

function analisar(caminho: string) {
  const fonte = readFileSync(caminho, "utf8");
  const arvore = ts.createSourceFile(
    caminho,
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const classes: string[] = [];
  const elementos: (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxAttribute(no) && no.name.getText(arvore) === "className") {
      classes.push(no.initializer?.getText(arvore) ?? "");
    }
    if (ts.isJsxOpeningElement(no) || ts.isJsxSelfClosingElement(no))
      elementos.push(no);
    ts.forEachChild(no, visitar);
  }
  visitar(arvore);
  const classe = (no: ts.JsxOpeningElement | ts.JsxSelfClosingElement) =>
    no.attributes.properties
      .find(
        (p) => ts.isJsxAttribute(p) && p.name.getText(arvore) === "className",
      )
      ?.getText(arvore) ?? "";
  return { arvore, classes, elementos, classe };
}

const pagina = analisar(tela);
const vitrine = analisar(cartao);
const conteudo = pagina.classes.find((c) => c.includes("max-w-5xl")) ?? "";
const corpo = vitrine.elementos.find((e) =>
  e.attributes.getText(vitrine.arvore).includes('data-testid="cartao-vitrine"'),
);

function filhosDaGrade(
  no: ts.Node,
): (ts.JsxOpeningElement | ts.JsxSelfClosingElement)[] {
  if (ts.isJsxElement(no)) return [no.openingElement];
  if (ts.isJsxSelfClosingElement(no)) return [no];
  return no.getChildren(vitrine.arvore).flatMap(filhosDaGrade);
}

// Quebras capturadas: perda de classes móveis, lista em grade, colunas estreitas,
// e aviso condicional deixando um buraco no cartão. Não há hash da fonte inteira.
describe("P21 — Vitrines no computador", () => {
  it.each([
    [
      pagina,
      54,
      "8b399e2f7dfab2b78349535996b5e622c78eb6bbdde664612e8d78145f83a7ae",
    ],
    [
      vitrine,
      36,
      "c716b3069fa3c198a1e2cddcac4ca1da66538313c61443bdf9e375f83e7b1697",
    ],
  ] as const)(
    "preserva todas as classes de celular e tablet (%#)",
    (analise, quantidade, assinatura) => {
      // P43 acrescentou ao interruptor da vitrine só a área de toque invisível
      // do tablet (`md:relative` + `md:after:*`); quem trava essas classes
      // uma a uma é tests/front/alvo-de-toque-p43-*.test.tsx.
      const classesMoveis = analise.classes.map((c) =>
        c
          .replace(/\s+(?:lg|xl|2xl):[^\s"'`]+/g, "")
          .replace(/\s+md:(?:relative|after:[^\s"`]+)/g, "")
          .replace(/\s+/g, " "),
      );
      expect(classesMoveis).toHaveLength(quantidade);
      expect(
        createHash("sha256")
          .update(JSON.stringify(classesMoveis))
          .digest("hex"),
      ).toBe(assinatura);
    },
  );

  it("alarga o mesmo contêiner do título e da lista sem fixar sua altura", () => {
    expect(conteudo).toContain("lg:max-w-7xl");
    expect(conteudo).toContain("lg:p-6");
    expect(conteudo).toContain("lg:space-y-6");
    expect(conteudo).not.toMatch(
      /(?:lg|xl|2xl):(?:h-|max-h-|overflow-hidden|sticky)/,
    );
  });

  it("mantém o arrasto vertical em uma coluna, sem corte ou transformação nova", () => {
    const grupo = pagina.elementos.find(
      (e) => e.tagName.getText(pagina.arvore) === "Reorder.Group",
    );
    expect(grupo?.attributes.getText(pagina.arvore)).toContain('axis="y"');
    const classes = grupo ? pagina.classe(grupo) : "";
    expect(classes).toContain("flex flex-col");
    expect(classes).toContain("lg:gap-4");
    expect(classes).not.toMatch(
      /grid|flex-row|overflow-hidden|transform|translate|scale/,
    );
    const item = vitrine.elementos.find(
      (e) => e.tagName.getText(vitrine.arvore) === "Reorder.Item",
    );
    expect(item ? vitrine.classe(item) : "").toBe(
      'className="relative list-none"',
    );
  });

  it.each([
    [1024, 720, 1],
    [1280, 976, 2],
    [1536, 1232, 2],
    [1920, 1232, 2],
  ])(
    "em %i px usa %i px de painel e %i coluna(s) apenas dentro do cartão",
    (janela, largura, colunas) => {
      const classe = corpo ? vitrine.classe(corpo) : "";
      expect(classe).toContain("lg:p-5");
      expect(classe).toContain("lg:pl-4");
      expect(classe).toContain("xl:grid xl:grid-cols-2 xl:gap-x-6");
      expect(classe).not.toMatch(/lg:grid|(?:lg|xl|2xl):overflow-hidden/);
      expect(Math.min(janela - 256, 1280) - 48).toBe(largura);
      // Bordas 2, padding esquerdo 16 e direito 20; gap 24.
      // A miniatura ainda tem margem esquerda de 28 px (ml-7).
      const larguraInterna = (largura - 38 - (colunas - 1) * 24) / colunas - 28;
      expect(larguraInterna).toBeGreaterThanOrEqual(420);
      expect(janela >= 1280 ? 2 : 1).toBe(colunas);
    },
  );

  it("enumera TODOS os filhos da grade e mantém pares ou largura inteira com/sem aviso", () => {
    expect(corpo && ts.isJsxElement(corpo.parent)).toBe(true);
    if (!corpo || !ts.isJsxElement(corpo.parent))
      throw new Error("Cartão ausente");
    const filhos = corpo.parent.children.flatMap(filhosDaGrade);
    expect(filhos).toHaveLength(6);
    const [editar, titulo, miniaturas, aviso, controles, layout] = filhos.map(
      vitrine.classe,
    );
    expect(editar).toContain("absolute inset-0"); // Fora do fluxo da grade.
    for (const classe of [titulo, aviso, layout])
      expect(classe).toContain("xl:col-span-2");
    expect(miniaturas).toContain("xl:col-start-1 xl:row-start-2");
    expect(controles).toContain("xl:col-start-2 xl:row-start-2");
    expect(controles).toContain("xl:ml-0");
    expect(aviso).toContain("xl:row-start-3");
    expect(layout).toContain("xl:row-start-4");
    for (const comAviso of [false, true]) {
      const linhas = [
        [titulo],
        [miniaturas, controles],
        ...(comAviso ? [[aviso]] : []),
        [layout],
      ];
      for (const linha of linhas) {
        expect(linha.length === 2 || linha[0].includes("xl:col-span-2")).toBe(
          true,
        );
      }
    }
  });
});
