import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
// Seletor de variantes no estilo "Tinta" (23/10/2026): toda classe de
// FileirasDeVariacao precisa virar CSS de verdade. O jsdom não calcula CSS,
// então classe inventada ou valor arbitrário mal escrito passa nos testes de
// componente e não pinta nada no celular. Aqui o Tailwind REAL do projeto
// compila as classes do chip, da amostra de cor e do rótulo. Molde:
// free-shipping-block-compacto-classes-geram-css.
import { FileirasDeVariacao } from "@/components/ui/custom/FileirasDeVariacao";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

const CLASSES = [
  // rótulo acima dos chips
  "mb-2",
  "flex",
  "items-baseline",
  "justify-between",
  "gap-3",
  "break-words",
  "font-mono",
  "text-[11px]",
  "uppercase",
  "tracking-[0.12em]",
  "text-muted-foreground",
  "text-foreground",
  "min-w-0",
  "text-right",
  "text-[13px]",
  "font-semibold",
  "space-y-5",
  // chip
  "flex-wrap",
  "gap-2",
  "min-h-11",
  "py-2",
  "min-w-11",
  "max-w-full",
  "items-center",
  "justify-center",
  "rounded-[14px]",
  "border",
  "px-3.5",
  "text-sm",
  "border-border",
  "bg-background",
  "text-foreground",
  "border-foreground",
  "bg-foreground",
  "text-background",
  "line-through",
  "disabled:cursor-not-allowed",
  "disabled:border-border/60",
  "disabled:bg-muted/30",
  "disabled:text-muted-foreground",
  "text-left",
  "sr-only",
  // amostra de cor
  "size-[18px]",
  "shrink-0",
  "rounded-full",
  "border-transparent",
  "ring-1",
  "ring-background",
  "border-foreground/50",
];

async function geradas(candidatas: string[]): Promise<Set<string>> {
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
  return achadas;
}

describe("variantes Tinta: toda classe vira regra no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const g = await geradas(["bg-marca-inventada-900", "rounded-[14px]"]);
    expect(g.has("bg-marca-inventada-900")).toBe(false);
    expect(g.has("rounded-[14px]")).toBe(true);
  }, 60_000);

  it("as classes do desenho aprovado geram CSS", async () => {
    const g = await geradas(CLASSES);
    expect(CLASSES.filter((c) => !g.has(c))).toEqual([]);
  }, 60_000);

  it("as classes listadas são as que o componente usa de fato", () => {
    const fonte = readFileSync(
      "src/components/ui/custom/FileirasDeVariacao.tsx",
      "utf8",
    );
    const ausentes = CLASSES.filter((c) => !fonte.includes(c));
    expect(ausentes).toEqual([]);
  });

  it("toda classe que o componente RENDERIZA (cor, tamanho, escolhido, esgotado) gera CSS", async () => {
    const valores = [
      { valor: "Preto", disponivel: true, estoque: 1 },
      { valor: "Xadrez Preto, Cinza e Branco", disponivel: true, estoque: 1 },
      { valor: "Estampado", disponivel: false, estoque: 0 },
    ];
    const html = renderToStaticMarkup(
      createElement(FileirasDeVariacao, {
        fileiras: [
          { nome: "Cor", valores },
          { nome: "Tamanho", valores },
        ],
        escolha: { Cor: "Preto", Tamanho: "Estampado" },
        onEscolher: () => {},
      }),
    );
    const usadas = new Set<string>();
    for (const [, lista] of html.matchAll(/class="([^"]*)"/g))
      for (const c of lista.split(/\s+/).filter(Boolean)) usadas.add(c);
    expect(usadas.size).toBeGreaterThan(30);
    const g = await geradas([...usadas]);
    expect([...usadas].filter((c) => !g.has(c))).toEqual([]);
  }, 60_000);
});
