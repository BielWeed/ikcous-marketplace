// Notificações da cliente no desenho Tinta (23/10/2026): toda classe nova
// precisa virar CSS de verdade. O jsdom não calcula CSS, então classe
// inventada passa nos testes de componente e não pinta nada no celular. Aqui o
// Tailwind REAL do projeto compila as classes. Molde:
// free-shipping-block-compacto-classes-geram-css.
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
  "border-border",
  "bg-background/90",
  "bg-foreground",
  "text-background",
  "text-background/70",
  "text-foreground",
  "text-muted-foreground",
  "bg-muted",
  "bg-muted/30",
  "bg-muted/40",
  "bg-muted/60",
  "hover:bg-muted/30",
  "hover:bg-muted/40",
  "hover:bg-foreground/90",
  "hover:text-foreground",
  "ring-ring",
  "focus-visible:ring-2",
  "focus-visible:ring-ring",
  "focus-visible:outline-none",
  "text-[28px]",
  "leading-8",
  "tracking-tight",
  "text-[11px]",
  "tracking-[0.12em]",
  "text-[13px]",
  "text-[14px]",
  "text-[15px]",
  "text-[16px]",
  "text-[20px]",
  "font-mono",
  "tabular-nums",
  "uppercase",
  "rounded-xl",
  "rounded-2xl",
  "rounded-[14px]",
  "rounded-[18px]",
  "h-11",
  "size-11",
  "size-2",
  "h-[52px]",
  "min-h-[72px]",
  "text-blue-600",
  "dark:text-blue-400",
  "text-amber-700",
  "dark:text-amber-400",
  "text-emerald-700",
  "dark:text-emerald-400",
  "text-red-600",
  "dark:text-red-400",
  "break-words",
  "sr-only",
  "xs:inline",
  "xs:hidden",
  "after:-inset-2",
  "hover-hover:opacity-0",
  "hover-hover:group-hover:opacity-100",
  "hover-hover:focus-visible:opacity-100",
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

describe("Notificações (Tinta): toda classe vira regra no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const g = await geradas(["bg-marca-inventada-900", "rounded-[18px]"]);
    expect(g.has("bg-marca-inventada-900")).toBe(false);
    expect(g.has("rounded-[18px]")).toBe(true);
  }, 60_000);

  it("as classes do desenho aprovado geram CSS", async () => {
    const g = await geradas(CLASSES);
    expect(CLASSES.filter((c) => !g.has(c))).toEqual([]);
  }, 60_000);

  it("a tela não usa mais cor fixa de zinco/branco nem bg-primary", () => {
    const fonte = readFileSync(
      "src/views/customer/NotificationsView.tsx",
      "utf8",
    );
    expect(fonte).not.toMatch(/zinc-|bg-white|bg-primary|#[0-9a-fA-F]{3,6}/);
  });
});
