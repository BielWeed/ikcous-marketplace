import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const caminho = "src/views/admin/AdminAboutStoreView.tsx";
const fonte = readFileSync("src/views/admin/AdminAboutStoreView.tsx", "utf8");
// Classes por ELEMENTO JSX (inclusive sem classe e com expressão não literal),
// na ordem da árvore da base 84a35d769. O CI raso não precisa do histórico git.
const CLASSES_DO_CELULAR_NA_BASE = [
  "admin-glass rounded-2xl border border-admin-border p-4 shadow-2xl sm:p-6",
  "flex items-center gap-3",
  "flex size-7 shrink-0 items-center justify-center rounded-lg border border-admin-gold/20 bg-admin-gold/10 text-[13px] font-black text-admin-gold",
  "scroll-mt-4 rounded text-[15px] font-black tracking-tight text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-admin-gold",
  "ml-auto shrink-0 rounded-full bg-white/5 px-2 py-1 text-[11px] font-bold text-zinc-300",
  "",
  "mt-1.5 text-[13px] leading-snug text-zinc-400",
  "mt-5",
  "mt-3 text-sm font-semibold text-red-400",
  "pb-admin relative min-h-screen bg-admin-bg font-sans text-zinc-400",
  "admin-topo-cabecalho mx-auto flex h-[76px] w-full max-w-4xl items-center justify-between gap-3 px-5",
  "min-w-0 [&_h1]:normal-case [&_h1]:tracking-tight [&_h1_span]:not-italic",
  "",
  "mx-auto max-w-4xl px-4 pt-4",
  "",
  "mx-auto min-w-0 max-w-4xl space-y-4 px-4 pt-4",
  "flex select-none items-center gap-3 rounded-2xl border border-red-500/20 bg-red-500/10 p-4 text-xs font-bold uppercase tracking-wider text-red-400 duration-300 animate-in fade-in slide-in-from-top-2",
  "size-5 shrink-0 animate-pulse text-red-500",
  "",
  "flex flex-wrap items-center gap-2 rounded-2xl border border-admin-gold/20 bg-admin-gold/5 p-3",
  "text-sm font-bold text-white",
  "flex min-h-11 items-center rounded-xl border border-admin-gold/30 bg-admin-bg px-4 text-sm font-bold text-admin-gold transition-colors hover:border-admin-gold/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "",
  "",
  "",
  "text-sm text-zinc-400",
  "",
  "",
  "",
  "mt-4 overflow-hidden rounded-2xl border border-admin-border",
  "relative h-40 w-full",
  "pointer-events-none absolute left-0 top-[-56px] block h-[calc(100%+56px)] w-full border-0",
  "absolute bottom-2 left-2 rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider text-zinc-500 shadow-sm",
  "",
  "",
  "",
  "text-sm text-zinc-300",
  "mt-2 w-full rounded-xl border border-admin-border bg-black/50 px-3.5 py-3 text-sm leading-relaxed text-white",
  "mt-1.5 text-[11px] text-zinc-500",
  "",
  "",
  "",
  "",
  "",
  "px-2 pb-2 text-[11px] leading-relaxed text-zinc-500",
  "",
  "w-full min-w-0",
  "mb-2 flex flex-wrap items-center justify-between gap-1 text-xs",
  "",
  "text-zinc-400",
  "admin-barra-principal flex min-h-11 w-full items-center justify-center gap-2 rounded-full bg-foreground px-5 text-sm font-bold text-background transition-colors hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  "size-4 animate-spin",
  "size-4",
];

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

describe("P19 — Minha loja no computador", () => {
  it("preserva as classes do celular por elemento sem depender do histórico git", () => {
    const conferir = (texto: string) =>
      expect(
        elementos(texto).map((no) => classesDoCelular(classes(no))),
      ).toEqual(CLASSES_DO_CELULAR_NA_BASE);
    conferir(fonte);
    expect(() =>
      conferir(fonte.replace('className="mt-5"', 'className="mt-6"')),
    ).toThrow();
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
