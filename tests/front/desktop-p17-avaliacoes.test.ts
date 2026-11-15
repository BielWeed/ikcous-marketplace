/* eslint-disable security/detect-non-literal-fs-filename -- Caminho fixo da tela local, relativo a este teste. */
import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const fonte = readFileSync(
  new URL("../../src/views/admin/AdminReviewsView.tsx", import.meta.url),
  "utf8",
);
const arvore = ts.createSourceFile(
  "AdminReviewsView.tsx",
  fonte,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX,
);

function classesDaTela() {
  const classes: string[] = [];
  function visitar(no: ts.Node) {
    if (ts.isJsxAttribute(no) && no.name.getText(arvore) === "className") {
      function literal(filho: ts.Node) {
        if (
          ts.isStringLiteral(filho) ||
          ts.isNoSubstitutionTemplateLiteral(filho)
        )
          classes.push(filho.text);
        ts.forEachChild(filho, literal);
      }
      literal(no);
    }
    ts.forEachChild(no, visitar);
  }
  visitar(arvore);
  return classes;
}

const CLASSES_DO_CELULAR_NA_BASE = [
  "inline-flex shrink-0 gap-0.5",
  "size-4",
  "fill-current",
  "text-zinc-100",
  "text-zinc-400",
  "inline-flex shrink-0 items-center gap-1.5 text-base font-bold tabular-nums text-white",
  "size-5 fill-current",
  "text-sm tabular-nums text-zinc-300",
  "shrink-0 text-sm",
  "space-y-3",
  "sr-only",
  "h-40 animate-pulse rounded-2xl border border-solid border-admin-border bg-admin-surface",
  "space-y-3",
  "space-y-2",
  "block text-sm font-medium text-zinc-300",
  "grid grid-cols-2 gap-2",
  "px-2",
  "h-32 w-full resize-none rounded-2xl border border-solid border-admin-border-strong bg-admin-bg p-3.5 text-base text-white placeholder:text-zinc-400 focus:outline-none focus-visible:outline focus-visible:outline-2 disabled:opacity-40",
  "text-right text-xs text-zinc-400",
  "text-red-400",
  "flex gap-2",
  "flex-1 bg-transparent",
  "flex-[2]",
  "size-4",
  "rounded-2xl border border-solid border-admin-border bg-admin-surface p-3.5",
  "flex items-start gap-3",
  "min-w-0 flex-1",
  "flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5",
  "flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5",
  "min-w-0 truncate text-base font-semibold text-white",
  "size-4",
  "shrink-0 text-sm",
  "mt-0.5 flex items-center justify-between gap-3",
  "flex min-w-0 items-center gap-1.5 text-sm text-zinc-300",
  "shrink-0 tabular-nums",
  "min-w-0 truncate",
  "mt-3 break-words text-base italic text-zinc-100",
  "whitespace-pre-wrap",
  "line-clamp-3",
  "mt-2 inline-flex items-center gap-1.5 text-sm text-zinc-300",
  "size-3.5",
  "tabular-nums",
  "sr-only",
  "mt-3 rounded-xl border border-l-[3px] border-solid border-admin-border border-l-admin-border-strong bg-admin-bg p-3",
  "inline-flex items-center gap-1.5 text-sm font-medium text-zinc-300",
  "size-4",
  "mt-1.5 break-words text-base text-zinc-100",
  "whitespace-pre-wrap",
  "line-clamp-2",
  "mt-3",
  "mt-3",
  "flex items-center gap-2",
  "min-w-0 flex-1",
  "min-w-0 flex-1",
  "size-4",
  "ml-auto",
  "size-5",
  "h-auto bg-admin-bg pb-admin text-zinc-100",
  "sr-only",
  "mx-auto flex w-full max-w-3xl flex-col gap-3 px-4 pt-3",
  "flex items-center gap-2",
  "min-w-0 flex-1",
  "group flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full active:scale-95",
  "flex size-11 items-center justify-center rounded-full border border-solid border-admin-border-strong bg-admin-surface text-zinc-200 transition-colors group-hover:bg-admin-raised",
  "size-5",
  "size-3.5 fill-current",
  "mt-0.5",
  "font-medium",
  "rounded-2xl border border-solid border-admin-border bg-admin-surface px-3.5 py-1.5",
  "flex items-center justify-between gap-3",
  "flex min-h-11 min-w-0 cursor-pointer items-center text-base font-semibold text-white",
  "flex shrink-0 items-center gap-1",
  "text-sm",
  "flex size-11 cursor-pointer items-center justify-center",
  "data-[state=checked]:bg-foreground data-[state=unchecked]:bg-admin-border-strong",
  "pb-2 text-sm text-zinc-300",
  "mx-auto mt-4 w-full max-w-3xl px-4",
  "mb-3",
  "mb-3",
  "self-start",
  "mb-3",
  "self-start",
  "space-y-3",
  "space-y-4",
  "text-sm leading-relaxed text-zinc-300",
  "space-y-3",
  "border-l-2 border-solid border-admin-border-strong pl-2 text-[11px] font-black uppercase tracking-wider text-zinc-300",
  "grid grid-cols-1 gap-3 sm:grid-cols-2",
  "space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4",
  "flex items-center gap-2 text-sm font-bold text-white",
  "size-4 fill-current",
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
  "space-y-1 rounded-2xl border border-solid border-admin-border bg-admin-surface p-4 sm:col-span-2",
  "flex items-center gap-2 text-sm font-bold text-white",
  "size-4",
  "text-sm text-zinc-300",
];

function classeQueComecaCom(inicio: string) {
  const classe = classesDaTela().find((valor) => valor.startsWith(inicio));
  expect(classe).toBeDefined();
  return classe?.split(/\s+/) ?? [];
}

describe("Avaliações no computador — P17", () => {
  it("preserva os literais de classes do celular, inclusive cortes do comentário e da resposta", () => {
    expect(classesDaTela().map(classesDoCelular)).toEqual(
      CLASSES_DO_CELULAR_NA_BASE,
    );
  });

  it("libera a largura dos controles e da lista a partir de 1024, sem limitar a altura das ações", () => {
    for (const inicio of [
      "mx-auto flex w-full max-w-3xl",
      "mx-auto mt-4 w-full max-w-3xl",
    ]) {
      const classes = classeQueComecaCom(inicio);
      expect(classes).toEqual(
        expect.arrayContaining(["lg:max-w-none", "lg:px-6"]),
      );
      expect(
        classes.some((classe) => /(?:max-h-|overflow-hidden)/.test(classe)),
      ).toBe(false);
    }
    expect(
      classeQueComecaCom(
        "rounded-2xl border border-solid border-admin-border bg-admin-surface p-3.5",
      ),
    ).toContain("lg:p-6");
  });

  it("pareia somente os dois filtros em 1280; todos os outros filhos ocupam a linha inteira", () => {
    const classes = classeQueComecaCom("mx-auto flex w-full max-w-3xl");
    expect(classes).toEqual(
      expect.arrayContaining([
        "xl:grid",
        "xl:grid-cols-2",
        "xl:gap-x-6",
        "xl:[&>*]:col-span-2",
        "xl:[&>:nth-child(3)]:col-span-1",
        "xl:[&>:nth-child(4)]:col-span-1",
      ]),
    );
    expect(classes).not.toContain("lg:grid-cols-2");
    // Enumera os filhos reais: não basta contar classes. O bloco condicional
    // final ocupa duas colunas tanto sozinho como com as métricas recolhidas.
    let grade: ts.JsxElement | undefined;
    function visitar(no: ts.Node) {
      if (
        ts.isJsxElement(no) &&
        no.openingElement
          .getText(arvore)
          .includes('className="mx-auto flex w-full max-w-3xl')
      )
        grade = no;
      ts.forEachChild(no, visitar);
    }
    visitar(arvore);
    const filhos = grade?.children.filter(
      (no) =>
        ts.isJsxElement(no) ||
        ts.isJsxSelfClosingElement(no) ||
        (ts.isJsxExpression(no) && no.expression !== undefined),
    );
    expect(
      filhos?.map((no) => {
        if (ts.isJsxElement(no))
          return no.openingElement.tagName.getText(arvore);
        if (ts.isJsxSelfClosingElement(no)) return no.tagName.getText(arvore);
        return (no as ts.JsxExpression).expression
          ?.getText(arvore)
          .split("&&")[0]
          .trim();
      }),
    ).toEqual([
      "div",
      "BuscaEModo",
      "FiltroEmSegmentos",
      "FiltroEmSegmentos",
      "ResumoRecolhivel",
      "configLoaded",
    ]);
    for (const configLoaded of [false, true]) {
      const spans = configLoaded ? [2, 2, 1, 1, 2, 2] : [2, 2, 1, 1, 2];
      let ocupadas = 0;
      for (const span of spans) {
        expect((ocupadas % 2) + span).toBeLessThanOrEqual(2);
        ocupadas += span;
      }
      expect(ocupadas % 2).toBe(0);
    }
    // Carregando, vazio, erro e lista ficam fora da grade de filtros.
    expect(
      classeQueComecaCom("mx-auto mt-4 w-full max-w-3xl").some((classe) =>
        classe.includes("grid"),
      ),
    ).toBe(false);
    // P47: a lista ganhou as duas colunas de 1280 (acrescentadas depois da
    // cópia do celular, `space-y-3`); ela continua fora da grade dos filtros.
    expect(fonte).toContain('<ul className="space-y-3 xl:grid ');
  });
});
