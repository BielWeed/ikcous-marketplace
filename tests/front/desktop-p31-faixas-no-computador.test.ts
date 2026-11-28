import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  classesDoCelular,
  classesDoCelularSemGradeDeTablet,
} from "./classes-do-celular";

const home = readFileSync("src/views/customer/HomeView.tsx", "utf8");
const busca = readFileSync("src/views/customer/SearchView.tsx", "utf8");

// Congelados em 8dccb46f7. Não consulta git: o CI pode clonar só o topo.
const base = {
  home: "sticky top-[-2px] z-40 -mx-3 px-3 sm:-mx-4 sm:px-4 pb-1.5 pt-0 bg-background/95 backdrop-blur flex flex-col transition-all duration-200 mb-1.5 gpu-accelerated",
  busca:
    "sticky top-[-2px] z-50 border-b border-zinc-100 bg-white/90 backdrop-blur-2xl",
  filtros: "mx-auto max-w-7xl space-y-4 p-4",
  resultados: "mx-auto max-w-7xl px-4 py-8",
};

function analisar(texto: string) {
  return ts.createSourceFile(
    "view.tsx",
    texto,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
}

function literais(no: ts.Node, fonte: ts.SourceFile): string[] {
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

function elemento(texto: string, atributo: string, valor: string) {
  const fonte = analisar(texto);
  const encontrados: ts.JsxElement[] = [];
  function visitar(no: ts.Node) {
    if (
      ts.isJsxElement(no) &&
      no.openingElement.attributes.properties.some(
        (prop) =>
          ts.isJsxAttribute(prop) &&
          prop.name.getText(fonte) === atributo &&
          prop.initializer?.getText(fonte) === valor,
      )
    )
      encontrados.push(no);
    ts.forEachChild(no, visitar);
  }
  visitar(fonte);
  expect(
    encontrados,
    `Elemento ${atributo}=${valor} deve ser único`,
  ).toHaveLength(1);
  return { no: encontrados[0], fonte };
}

function classes(texto: string, atributo: string, valor: string) {
  const { no, fonte } = elemento(texto, atributo, valor);
  return literais(no.openingElement, fonte).join(" ");
}

function classeDaFaixaDaHome() {
  const { no, fonte } = elemento(
    home,
    "data-testid",
    '"faixa-categorias-filtros"',
  );
  expect(ts.isJsxElement(no.parent)).toBe(true);
  return literais((no.parent as ts.JsxElement).openingElement, fonte).join(" ");
}

function containerDosFiltros() {
  const { no, fonte } = elemento(busca, "ref", "{cabecalhoRef}");
  const filhos = no.children.filter(ts.isJsxElement);
  expect(filhos).toHaveLength(1);
  return literais(filhos[0].openingElement, fonte).join(" ");
}

describe("P31 — faixas no fluxo e busca alinhada no computador", () => {
  it("tira somente no PC a fixação da faixa da Home", () => {
    const atual = classeDaFaixaDaHome();
    expect(atual.split(/\s+/)).toContain("lg:static");
    expect(classesDoCelular(atual).startsWith(base.home)).toBe(true);
  });

  it("tira somente no PC a fixação do cabeçalho da busca", () => {
    const atual = classes(busca, "ref", "{cabecalhoRef}");
    expect(atual.split(/\s+/)).toContain("lg:static");
    expect(classesDoCelular(atual)).toBe(base.busca);
  });

  it.each(["filtros", "resultados"] as const)(
    "alinha %s com o cabeçalho em 1280 e 1920 sem alterar o celular",
    (tipo) => {
      const atual =
        tipo === "filtros"
          ? containerDosFiltros()
          : classes(busca, "ref", "{resultadosRef}");
      const tokens = atual.split(/\s+/);
      for (const token of [
        "lg:mx-auto",
        "lg:w-full",
        "lg:max-w-screen-xl",
        "lg:px-8",
        "2xl:max-w-[1440px]",
      ]) {
        expect(tokens).toContain(token);
      }
      expect(classesDoCelular(atual)).toBe(
        tipo === "filtros" ? base.filtros : base.resultados,
      );
      // screen-xl = 1280px na configuração deste projeto.
      const configuracao = readFileSync("tailwind.config.js", "utf8");
      const limiteLg = Number(configuracao.match(/xl: "(\d+)px"/)?.[1]);
      const limite2xl = Number(atual.match(/2xl:max-w-\[(\d+)px\]/)?.[1]);
      expect((1280 - Math.min(1280, limiteLg)) / 2 + 32).toBe(32);
      expect((1920 - Math.min(1920, limite2xl)) / 2 + 32).toBe(272);
    },
  );

  it("anula no PC a margem inline da antiga faixa fixa ao voltar aos resultados", () => {
    const atual = classes(busca, "ref", "{resultadosRef}");
    // ! é necessário: o efeito preservado escreve style.scrollMarginTop.
    expect(atual.split(/\s+/)).toContain("lg:!scroll-mt-0");
  });

  it.each([
    [
      "HomeView",
      home,
      // 27/11/2026: o Início ganha o aviso do pedido aguardando pagamento
      // ("mx-3 mb-2 mt-3 sm:mx-4", mais "lg:mx-0" só no PC); nenhuma classe
      // existente mudou.
      "637ba4817b7652fde438eb5c39ce4cb2487b909e1cfb7934ade472ce661968c0",
    ],
    [
      "SearchView",
      busca,
      "01e1f5d484ea7f385d52faf402087b19a749350f1f176f5109bf18a6de09f6ea",
    ],
  ])(
    "preserva a lista inteira de classes do celular de %s",
    (nome, texto, assinatura) => {
      const fonte = analisar(texto);
      const celular = literais(fonte, fonte)
        .map(classesDoCelularSemGradeDeTablet)
        .filter(Boolean);
      expect(
        createHash("sha256").update(JSON.stringify(celular)).digest("hex"),
        `${nome}: alguma classe abaixo de 1024px mudou; compare os literais de className com a base 8dccb46f7`,
      ).toBe(assinatura);
    },
  );
});
