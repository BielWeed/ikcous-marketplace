import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const fonte = readFileSync("src/views/admin/AdminQAView.tsx", "utf8");
const arvore = ts.createSourceFile(
  "AdminQAView.tsx",
  fonte,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

const atributos: ts.JsxAttribute[] = [];
const elementos: ts.JsxElement[] = [];
function visitar(no: ts.Node) {
  if (ts.isJsxAttribute(no) && no.name.getText(arvore) === "className")
    atributos.push(no);
  if (ts.isJsxElement(no)) elementos.push(no);
  ts.forEachChild(no, visitar);
}
visitar(arvore);

function literais(no: ts.Node): string[] {
  if (ts.isStringLiteral(no) || ts.isNoSubstitutionTemplateLiteral(no))
    return [no.text];
  if (ts.isTemplateExpression(no))
    return [no.head.text, ...no.templateSpans.map((s) => s.literal.text)];
  const encontrados: string[] = [];
  ts.forEachChild(no, (filho) => {
    encontrados.push(...literais(filho));
  });
  return encontrados;
}

const classes = atributos.flatMap((a) =>
  a.initializer ? literais(a.initializer) : [],
);
function classeCom(inicio: string) {
  const classe = classes.find((c) => c.startsWith(inicio));
  expect(classe, inicio).toBeDefined();
  return classe?.split(/\s+/) ?? [];
}

describe("P16 — perguntas no computador, só classes", () => {
  it("preserva todos os literais de celular, inclusive os ramos de compacto/detalhado", () => {
    expect(classes.map(classesDoCelular)).toEqual([
      "shrink-0 text-base font-bold text-white",
      "min-w-0 text-sm text-red-300",
      "min-w-0 text-base font-bold text-white",
      "shrink-0 text-base font-bold tabular-nums text-white",
      "shrink-0 text-sm tabular-nums text-zinc-300",
      "space-y-3",
      "sr-only",
      "h-36 animate-pulse rounded-2xl border border-solid border-admin-border bg-admin-surface",
      "rounded-2xl border border-solid border-admin-border bg-admin-surface p-3.5",
      "flex items-start gap-3",
      "min-w-0 flex-1",
      "flex items-start justify-between gap-3",
      "min-w-0 truncate text-base font-semibold text-white",
      "inline-flex shrink-0 items-center gap-1 text-sm font-semibold",
      "",
      "size-4",
      "shrink-0 text-sm",
      "mt-0.5 flex min-w-0 items-center gap-1.5 text-sm text-zinc-300",
      "shrink-0 tabular-nums",
      "min-w-0 truncate",
      "mt-3 break-words text-base italic text-zinc-100",
      "whitespace-pre-wrap",
      "line-clamp-2",
      "mt-3 space-y-2",
      "rounded-xl border border-l-[3px] border-solid border-admin-border border-l-admin-border-strong bg-admin-bg p-3",
      "flex items-center justify-between gap-3",
      "inline-flex items-center gap-1.5 text-sm font-medium text-zinc-300",
      "size-4",
      "text-sm tabular-nums text-zinc-400",
      "mt-1.5 whitespace-pre-wrap break-words text-base text-zinc-100",
      "mt-3",
      "flex items-center gap-2",
      "min-w-0 flex-1",
      "size-4",
      "size-5",
      "size-5",
      "size-5",
      "space-y-3 transition-opacity duration-300",
      "pointer-events-none opacity-50",
      "h-auto bg-admin-bg pb-admin text-zinc-100",
      "sr-only",
      "mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-3",
      "flex items-center gap-2",
      "min-w-0 flex-1",
      "group flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full active:scale-95",
      "flex size-11 items-center justify-center rounded-full border border-solid border-admin-border-strong bg-admin-surface text-zinc-200 transition-colors group-hover:bg-admin-raised",
      "size-5",
      "font-medium",
      "mx-auto mt-4 w-full max-w-3xl px-4",
      "mb-3",
      "mb-3",
      "self-start",
      "space-y-4",
      "text-sm leading-relaxed text-zinc-300",
      "space-y-3",
      "border-l-2 border-solid border-admin-border-strong pl-2 text-[11px] font-black uppercase tracking-wider text-zinc-300",
      "grid grid-cols-1 gap-3 sm:grid-cols-2",
      "space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4",
      "flex items-center gap-2 text-sm font-bold text-white",
      "size-4",
      "text-sm text-zinc-300",
      "space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4",
      "flex items-center gap-2 text-sm font-bold text-white",
      "size-4",
      "text-sm text-zinc-300",
      "space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4",
      "flex items-center gap-2 text-sm font-bold text-white",
      "size-4",
      "text-sm text-zinc-300",
      "space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4",
      "flex items-center gap-2 text-sm font-bold text-white",
      "size-4",
      "text-sm text-zinc-300",
    ]);
  });

  it("libera a largura do painel em 1024, mas só divide busca/filtro em 1280", () => {
    const topo = classeCom("mx-auto flex w-full max-w-3xl");
    const lista = classeCom("mx-auto mt-4 w-full max-w-3xl");
    for (const c of [topo, lista])
      expect(c).toEqual(expect.arrayContaining(["lg:max-w-none", "lg:px-6"]));
    expect(topo).toEqual(
      expect.arrayContaining(["xl:grid", "xl:grid-cols-2", "xl:gap-6"]),
    );
    expect(topo).not.toContain("lg:grid-cols-2");
  });

  it("enumera todos os filhos da grade: navegação e resumo ocupam a linha inteira, sem buraco em qualquer estado", () => {
    const topo = elementos.find((el) =>
      el.openingElement.attributes.properties.some(
        (a) =>
          ts.isJsxAttribute(a) &&
          a.initializer
            ?.getText(arvore)
            .includes("mx-auto flex w-full max-w-3xl"),
      ),
    );
    expect(topo).toBeDefined();
    if (!topo) throw new Error("Topo não encontrado");
    // Apenas quatro filhos incondicionais: os estados mudam DENTRO dos
    // controles, nunca a ocupação da grade (resumo fechado/aberto, erro, vazio).
    const filhos = topo.children.filter(
      (no) => !ts.isJsxText(no) && !(ts.isJsxExpression(no) && !no.expression),
    );
    expect(
      filhos.map((no) =>
        ts.isJsxElement(no)
          ? no.openingElement.tagName.getText(arvore)
          : ts.isJsxSelfClosingElement(no)
            ? no.tagName.getText(arvore)
            : "condicional",
      ),
    ).toEqual(["div", "BuscaEModo", "FiltroEmSegmentos", "ResumoRecolhivel"]);
    const topoClasses = classeCom("mx-auto flex w-full max-w-3xl");
    expect(topoClasses).toContain("xl:[&>div:first-child]:col-span-2");
    expect(topoClasses).toContain("xl:[&>section]:col-span-2");
    // As duas metades são a busca e o filtro; nenhum filho é condicional.
    // O resumo continua sendo uma única section mesmo ao expandir seus cartões.
  });

  it("mantém as perguntas em uma coluna até 1279 (duas só em 1280, P47) e ações sem corte no PC", () => {
    const lista = classeCom("space-y-3 transition-opacity");
    expect(lista).toContain("lg:space-y-4");
    // Em 1024 o painel tem ~720 px: duas colunas dariam ~358 px. A divisão é
    // do `xl:` (P47, `items-start` para a altura variável não esticar o
    // cartão); nenhuma classe de grade ou colunas vale a partir de `lg:`.
    expect(lista.some((c) => /^lg:.*(grid|columns-)/.test(c))).toBe(false);
    expect(lista).toContain("xl:grid-cols-2");
    expect(lista).toContain("xl:items-start");
    const cartao = classeCom(
      "rounded-2xl border border-solid border-admin-border bg-admin-surface p-3.5",
    );
    expect(cartao).toEqual(
      expect.arrayContaining(["lg:rounded-3xl", "lg:p-6"]),
    );
    const responder = atributos.find(
      (a) =>
        a.getText(arvore).includes("BOTAO_NEUTRO") &&
        a.getText(arvore).includes("min-w-0 flex-1"),
    );
    expect(responder?.getText(arvore)).toContain("lg:flex-none");
    expect(responder?.getText(arvore)).toContain("lg:min-w-48");
    expect(
      classes.some((c) =>
        /(?:^|\s)(?:lg|xl|2xl):(?:overflow-hidden|h-screen|max-h-)/.test(c),
      ),
    ).toBe(false);
  });
});
