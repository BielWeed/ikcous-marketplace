// Folha do Financeiro (24/10/2026): toda classe nova do casco precisa virar CSS
// de verdade — o jsdom não calcula CSS, e classe inventada passa em teste de
// componente sem pintar nada. Aqui o Tailwind REAL do projeto compila as
// classes. Também prova a CAUSA do "véu cinza chapado": nos temas Claro e
// Confortável o painel troca `bg-black/50` pelo fundo opaco do painel.
// Molde: free-shipping-block-compacto-classes-geram-css.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

const CLASSES = [
  "max-h-[84dvh]",
  "rounded-t-[28px]",
  "bg-[rgb(0_0_0/0.5)]",
  "touch-none",
  "h-[5px]",
  "w-14",
  "h-11",
  "bg-muted-foreground/40",
  "bg-muted",
  "bg-background",
  "text-foreground",
  "text-muted-foreground",
  "border-border",
  "text-[22px]",
  "text-[13px]",
  "leading-7",
  "leading-5",
  "tracking-tight",
  "after:absolute",
  "after:-inset-1",
  "after:content-['']",
  "focus-visible:ring-ring",
  "disabled:opacity-40",
  "pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]",
];

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

describe("folha do Financeiro: classes do casco geram CSS", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const { achadas } = await compilar(["bg-marca-inventada-900", "h-11"]);
    expect(achadas.has("bg-marca-inventada-900")).toBe(false);
    expect(achadas.has("h-11")).toBe(true);
  }, 60_000);

  it("as classes do desenho aprovado geram CSS", async () => {
    const { achadas } = await compilar(CLASSES);
    // `after:content-['']` e `after:-inset-1` saem escapados no seletor.
    const faltam = CLASSES.filter(
      (c) =>
        !achadas.has(c) &&
        !achadas.has(c.replace(/:/g, "\\:")) &&
        ![...achadas].some((a) => a.replace(/\\/g, "") === c),
    );
    expect(faltam).toEqual([]);
  }, 60_000);

  it("o véu arbitrário compila para preto a 50% (e usa a cor, não imagem)", async () => {
    const { css } = await compilar(["bg-[rgb(0_0_0/0.5)]"]);
    expect(css).toMatch(/background-color:\s*rgb\(0 0 0\s*\/\s*0?\.5\)/);
  }, 60_000);
});

describe("o tema do painel e o véu", () => {
  const cores = readFileSync(
    "src/components/layouts/temas-do-painel-cores.css",
    "utf8",
  );

  it("causa: bg-black/50 vira o fundo opaco do painel nos temas claros", () => {
    expect(cores).toMatch(
      /\.bg-black\\\/50[^{]*\{background-color:hsl\(var\(--admin-bg\)\)\}/,
    );
  });

  it("o véu novo escapa dessa troca (não há regra de tema para ele)", () => {
    expect(cores).not.toContain("rgb(0_0_0");
    expect(cores).not.toContain("rgb\\(0_0_0");
  });

  it("a folha usa o véu novo e nenhuma cor fixa de tema no casco", () => {
    const fonte = readFileSync(
      "src/components/admin/financeiro/FolhaFinanceira.tsx",
      "utf8",
    );
    expect(fonte).toContain("bg-[rgb(0_0_0/0.5)]");
    expect(fonte).not.toMatch(/text-white|bg-admin-|zinc-\d/);
    for (const c of ["max-h-[84dvh]", "rounded-t-[28px]", "touch-none"]) {
      expect(fonte, c).toContain(c);
    }
  });
});
