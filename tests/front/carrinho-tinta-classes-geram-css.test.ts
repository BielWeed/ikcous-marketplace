// Carrinho no estilo "Tinta" (24/10/2026): toda classe usada nas telas do
// carrinho precisa virar CSS de verdade. O jsdom não calcula CSS, então uma
// classe inventada (ou um valor arbitrário mal escrito) passa em todos os
// testes de componente e não pinta nada no celular. Aqui o Tailwind REAL do
// projeto compila TODAS as classes que o código dos cinco arquivos usa — a
// lista não é escrita à mão: sai do próprio fonte (AST do TypeScript), então
// classe nova entra no teste sem ninguém lembrar de acrescentá-la.
// Molde: free-shipping-block-compacto-classes-geram-css.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

const ARQUIVOS = [
  "src/views/customer/CartView.tsx",
  "src/components/ui/custom/CartItemsList.tsx",
  "src/components/ui/custom/EmptyCart.tsx",
  "src/components/ui/custom/CartFooterSummary.tsx",
  "src/components/ui/custom/ShippingProgress.tsx",
];

// Marcadores que o código usa e que NÃO são utilitários do Tailwind: `group`
// é só gancho de variante e as outras três vêm de src/index.css.
const NAO_TAILWIND = new Set([
  "group",
  "no-scrollbar",
  "bottom-docked-navigation",
  "pb-customer-summary",
]);

type Uso = { arquivo: string; tag: string; classes: string[] };

function usosDeClasse(arquivo: string): Uso[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho vem da lista fixa ARQUIVOS deste teste.
  const fonte = readFileSync(arquivo, "utf8");
  const sf = ts.createSourceFile(
    arquivo,
    fonte,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const textoDe = (n: ts.Node): string => {
    // `aba === "cart"` compara estado, não escolhe classe: fora.
    if (
      ts.isBinaryExpression(n) &&
      (
        [
          ts.SyntaxKind.EqualsEqualsEqualsToken,
          ts.SyntaxKind.ExclamationEqualsEqualsToken,
        ] as ts.SyntaxKind[]
      ).includes(n.operatorToken.kind)
    ) {
      return "";
    }
    if (ts.isStringLiteralLike(n)) return `${n.text} `;
    if (ts.isTemplateExpression(n)) {
      return `${n.head.text} ${n.templateSpans
        .map((s) => `${textoDe(s.expression)}${s.literal.text} `)
        .join("")}`;
    }
    let acc = "";
    ts.forEachChild(n, (c) => {
      acc += textoDe(c);
    });
    return acc;
  };
  const usos: Uso[] = [];
  const visitar = (n: ts.Node) => {
    const abertura = ts.isJsxElement(n)
      ? n.openingElement
      : ts.isJsxSelfClosingElement(n)
        ? n
        : null;
    if (abertura) {
      for (const p of abertura.attributes.properties) {
        if (
          ts.isJsxAttribute(p) &&
          p.name.getText() === "className" &&
          p.initializer
        ) {
          usos.push({
            arquivo,
            tag: abertura.tagName.getText(),
            classes: textoDe(p.initializer).split(/\s+/).filter(Boolean),
          });
        }
      }
    }
    ts.forEachChild(n, visitar);
  };
  visitar(sf);
  return usos;
}

const USOS = ARQUIVOS.flatMap(usosDeClasse);
const semVariante = (t: string) => t.slice(t.lastIndexOf(":") + 1);

async function compilar(candidatas: string[]) {
  const carregar = requisitar("tailwindcss/loadConfig") as (
    caminho: string,
  ) => Record<string, unknown>;
  const config = carregar(resolve("tailwind.config.js"));
  const css = readFileSync("src/index.css", "utf8");
  const resultado = await postcss([
    tailwindcss({
      ...config,
      content: [{ raw: candidatas.join(" "), extension: "html" }],
    }),
  ]).process(css, { from: "src/index.css" });
  const achadas = new Set<string>();
  resultado.root.walkRules((regra) => {
    selectorParser((seletores) => {
      seletores.walkClasses((c) => {
        achadas.add(c.value);
      });
    }).processSync(regra.selector);
  });
  return { achadas, css: resultado.css };
}

describe("carrinho Tinta: toda classe vira regra no Tailwind do projeto", () => {
  it("o extrator acha as classes (controle: não é uma lista vazia)", () => {
    const todas = new Set(USOS.flatMap((u) => u.classes));
    expect(todas.size).toBeGreaterThan(150);
    for (const esperada of [
      "bg-foreground",
      "text-background",
      "rounded-[18px]",
      "h-[52px]",
      "basis-[184px]",
      "dark:text-emerald-400",
    ]) {
      expect(todas.has(esperada), esperada).toBe(true);
    }
  });

  it("controle: classe inventada não gera CSS", async () => {
    const { achadas } = await compilar([
      "bg-tinta-inventada-900",
      "rounded-[18px]",
    ]);
    expect(achadas.has("bg-tinta-inventada-900")).toBe(false);
    expect(achadas.has("rounded-[18px]")).toBe(true);
  }, 60_000);

  it("todas as classes dos cinco arquivos geram CSS", async () => {
    const todas = [...new Set(USOS.flatMap((u) => u.classes))].filter(
      (c) => !NAO_TAILWIND.has(c),
    );
    const { achadas } = await compilar(todas);
    expect(todas.filter((c) => !achadas.has(c))).toEqual([]);
  }, 60_000);

  it("os marcadores fora do Tailwind existem em src/index.css (não são typo)", () => {
    const css = readFileSync("src/index.css", "utf8");
    for (const marcador of NAO_TAILWIND) {
      if (marcador === "group") continue;
      expect(css, marcador).toContain(`.${marcador}`);
    }
  });

  it("tinta é a cor do TEMA (foreground/background), não a cor da loja", async () => {
    const { css } = await compilar(["bg-foreground", "text-background"]);
    expect(css).toMatch(/\.bg-foreground\s*\{[^}]*var\(--foreground\)/);
    expect(css).toMatch(/\.text-background\s*\{[^}]*var\(--background\)/);
  }, 60_000);
});

describe("carrinho Tinta: regras do estilo valem em todo o fonte", () => {
  const todasAsClasses = USOS.flatMap((u) =>
    u.classes.map((c) => ({ ...u, c })),
  );

  it("nunca a cor da loja (primary) nem cinza/branco fixo de fundo: tudo vem dos tokens do tema (text-white só no glifo sobre verde)", () => {
    const ruins = todasAsClasses.filter(({ c }) =>
      /(^|:)(bg|text|border|ring|from|to|via|shadow)-(primary|secondary|zinc|slate|gray|neutral|stone)\b|(^|:)(bg|border|ring)-(white|black)\b/.test(
        c,
      ),
    );
    expect(ruins.map((r) => `${r.arquivo}: ${r.c}`)).toEqual([]);
  });

  it("sem letra miúda: texto abaixo de 11px nunca, e 11px só no rótulo mono em caixa alta", () => {
    const pequenas = USOS.flatMap((u) =>
      u.classes
        .map((c) => ({
          u,
          c,
          // eslint-disable-next-line security/detect-unsafe-regex -- regex curta aplicada a classes Tailwind do proprio repositorio.
          n: /^(?:[a-z-]+:)*text-\[(\d+(?:\.\d+)?)px\]$/.exec(c),
        }))
        .filter((x) => x.n !== null),
    );
    const abaixo = pequenas.filter((x) => Number(x.n?.[1]) < 11);
    expect(abaixo.map((x) => `${x.u.arquivo}: ${x.c}`)).toEqual([]);
    const onze = pequenas.filter((x) => Number(x.n?.[1]) === 11);
    expect(onze.length).toBeGreaterThan(0);
    for (const { u, c } of onze) {
      expect(u.classes, `${u.arquivo}: ${c}`).toEqual(
        expect.arrayContaining(["font-mono", "uppercase"]),
      );
    }
  });

  it("sem espaçamento largo de letra (tracking-widest/wider/wide, [0.2em], [0.25em])", () => {
    const ruins = todasAsClasses.filter(({ c }) =>
      /tracking-(widest|wider|wide|\[0\.2\d*em\])/.test(c),
    );
    expect(ruins.map((r) => `${r.arquivo}: ${r.c}`)).toEqual([]);
  });

  it("botão com `border` tem `border-solid`/`border-dashed` (o reset global tira o estilo do <button>)", () => {
    // eslint-disable-next-line security/detect-unsafe-regex -- regex curta aplicada a classes Tailwind do proprio repositorio.
    const espessura = /^!?border(?:-[xytblrse])?(?:-\d+|-\[\d[\d.]*[a-z]*\])?$/;
    const estilo = /^!?border-(?:solid|dashed|dotted|double)$/;
    const ruins = USOS.filter(
      (u) =>
        ["button", "Button"].includes(u.tag) &&
        u.classes.some((t) => espessura.test(semVariante(t))) &&
        !u.classes.some((t) => estilo.test(semVariante(t))),
    );
    expect(ruins.map((u) => `${u.arquivo}: ${u.classes.join(" ")}`)).toEqual(
      [],
    );
  });

  it("selecionado nunca é amarelo: âmbar só como ponto/texto de atenção, nunca fundo de aba", () => {
    const ambar = todasAsClasses.filter(({ c }) => /amber|yellow/.test(c));
    for (const { c } of ambar) {
      expect(c).toMatch(/^(dark:)?(text-amber-(700|400)|bg-amber-500)$/);
    }
  });
});
