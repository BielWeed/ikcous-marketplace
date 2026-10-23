// Notificações do painel, redesenho "Tinta" (23/10/2026): toda classe nova
// precisa virar CSS de verdade. O jsdom não calcula CSS, então classe
// inventada passa nos testes de componente e não pinta nada. Aqui o Tailwind
// REAL do projeto compila as classes. Molde: free-shipping-block-compacto.
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
  "bg-background/95",
  "text-foreground",
  "bg-foreground",
  "text-background",
  "border-border",
  "bg-muted/30",
  "bg-muted/40",
  "bg-muted/50",
  "hover:bg-muted/40",
  "hover:bg-muted/50",
  "hover:bg-muted/70",
  "text-muted-foreground",
  "focus-visible:ring-ring",
  "rounded-[18px]",
  "rounded-2xl",
  "rounded-xl",
  "rounded-full",
  "min-h-11",
  "min-h-14",
  "size-11",
  "size-2",
  "font-mono",
  "text-[11px]",
  "text-[18px]",
  "text-[22px]",
  "text-[28px]",
  "tracking-[0.12em]",
  "text-emerald-400",
  "text-red-400",
  "text-amber-400",
  "text-sky-300",
  "bg-current",
  "[&_h1]:text-[28px]",
  "[&_h1]:leading-8",
  "[&_h1]:tracking-tight",
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

describe("Notificações do painel (Tinta): toda classe vira regra no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const g = await geradas(["bg-marca-inventada-900", "rounded-[18px]"]);
    expect(g.has("bg-marca-inventada-900")).toBe(false);
    expect(g.has("rounded-[18px]")).toBe(true);
  }, 60_000);

  it("as classes do desenho aprovado geram CSS", async () => {
    const g = await geradas(CLASSES);
    // O seletor sai escapado pelo parser: comparamos pelo valor desescapado.
    const faltam = CLASSES.filter((c) => !g.has(c));
    expect(faltam).toEqual([]);
  }, 60_000);

  it("as classes de cor e forma listadas são as que a tela usa de fato", () => {
    const fonte = readFileSync(
      "src/views/admin/AdminNotificationsView.tsx",
      "utf8",
    );
    for (const c of [
      "bg-foreground",
      "text-background",
      "border-border",
      "bg-muted/30",
      "rounded-[18px]",
      "text-[18px]",
      "text-[22px]",
      "[&_h1]:text-[28px]",
      "tracking-[0.12em]",
      "size-11",
      "min-h-11",
      "text-emerald-400",
      "text-sky-300",
    ])
      expect(fonte, c).toContain(c);
  });
});
