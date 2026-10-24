// Sobre a Loja, linguagem Tinta (23/10/2026): toda classe do redesenho precisa
// virar CSS de verdade. O jsdom não calcula CSS, então classe inventada passa
// nos testes de componente e não pinta nada no celular. Aqui o Tailwind REAL do
// projeto compila as classes. Molde: free-shipping-block-compacto-classes-geram-css.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

const CLASSES = [
  "bg-background",
  "text-foreground",
  "text-background",
  "bg-foreground",
  "border-border",
  "text-muted-foreground",
  "bg-muted/40",
  "bg-muted/30",
  "bg-background/90",
  "rounded-[18px]",
  "rounded-[14px]",
  "rounded-2xl",
  "h-[52px]",
  "h-52",
  "min-h-11",
  "size-20",
  "sm:size-24",
  "font-mono",
  "text-[11px]",
  "uppercase",
  "tracking-[0.12em]",
  "text-[28px]",
  "leading-8",
  "tracking-tight",
  "break-words",
  "min-w-0",
  "w-[calc(100%-2rem)]",
  "-translate-x-1/2",
  "left-1/2",
  "pb-28",
  "focus-visible:ring-2",
  "focus-visible:ring-ring",
  "focus-visible:ring-offset-background",
  "[&_img]:max-w-full",
  "[&_img]:rounded-[14px]",
  "[&_a]:text-foreground",
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

describe("Sobre a Loja Tinta: toda classe vira regra no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const g = await geradas(["bg-marca-inventada-900", "rounded-[18px]"]);
    expect(g.has("bg-marca-inventada-900")).toBe(false);
    expect(g.has("rounded-[18px]")).toBe(true);
  }, 60_000);

  it("as classes do desenho aprovado geram CSS", async () => {
    const g = await geradas(CLASSES);
    expect(CLASSES.filter((c) => !g.has(c))).toEqual([]);
  }, 60_000);

  it("a tela usa as classes de tinta e não usa cor fixa", () => {
    const fonte = readFileSync("src/views/customer/AboutStoreView.tsx", "utf8");
    for (const c of [
      "bg-foreground",
      "text-background",
      "h-[52px]",
      "rounded-[18px]",
      "tracking-[0.12em]",
      "text-[28px]",
    ])
      expect(fonte, c).toContain(c);
    const cru = fonte.replace(/\/\/.*$/gm, "");
    expect(cru).not.toMatch(
      /bg-primary|bg-white|zinc-\d|bg-emerald|admin-gold/,
    );
  });
});
