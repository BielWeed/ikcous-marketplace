// Barra de cima do painel, redesenho "Tinta" (24/10/2026): toda classe nova
// precisa virar CSS de verdade. O jsdom não calcula CSS, então classe
// inventada passa nos testes de componente e não pinta nada. Aqui o Tailwind
// REAL do projeto compila as classes. Molde: admin-notifications-tinta.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

const CLASSES = [
  "rounded-2xl",
  "rounded-full",
  "border-solid",
  "border-admin-border-strong",
  "bg-admin-raised",
  "hover:bg-admin-hover",
  "bg-muted/40",
  "text-foreground",
  "text-muted-foreground",
  "text-[17px]",
  "text-[14px]",
  "text-[13px]",
  "text-base",
  "leading-5",
  "min-h-11",
  "min-w-11",
  "size-11",
  "size-2",
  "size-2.5",
  "size-5",
  "size-4",
  "right-0.5",
  "bg-current",
  "bg-red-500",
  "ring-2",
  "ring-admin-nav",
  "border-red-300",
  "text-red-400",
  "text-emerald-400",
  "text-orange-300",
  "text-sky-300",
  "fill-current",
  "break-words",
  "focus-visible:ring-ring",
  "py-2.5",
  "rotate-180",
  "px-4",
  "px-3",
  "gap-1.5",
  "text-[15px]",
  "min-[360px]:px-5",
  "min-[360px]:gap-3",
  "min-[360px]:gap-2",
  "min-[360px]:px-3.5",
  "min-[360px]:text-base",
  "min-[360px]:text-[17px]",
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

describe("Barra do painel (Tinta): toda classe vira regra no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const g = await geradas(["bg-marca-inventada-900", "rounded-2xl"]);
    expect(g.has("bg-marca-inventada-900")).toBe(false);
    expect(g.has("rounded-2xl")).toBe(true);
  }, 60_000);

  it("as classes do desenho aprovado geram CSS", async () => {
    const g = await geradas(CLASSES);
    const faltam = CLASSES.filter((c) => !g.has(c));
    expect(faltam).toEqual([]);
  }, 60_000);

  it("as classes de forma e cor listadas são as que a barra usa de fato", () => {
    const layout = readFileSync(
      "src/components/layouts/AdminLayout.tsx",
      "utf8",
    );
    const conexao = readFileSync(
      "src/components/layouts/ConexaoDoPainel.tsx",
      "utf8",
    );
    for (const c of [
      "rounded-2xl",
      "border-solid",
      "size-11",
      "fill-current",
      "border-red-300",
      "text-red-400",
      "ring-admin-nav",
      "min-[360px]:px-5",
      "min-[360px]:gap-3",
      "min-[360px]:text-base",
    ])
      expect(layout, c).toContain(c);
    for (const c of [
      "bg-current",
      "size-2",
      "text-muted-foreground",
      "text-foreground",
      "text-[17px]",
      "text-[14px]",
      "text-[13px]",
      "min-[360px]:text-[17px]",
      "text-orange-300",
      "text-emerald-400",
      "text-red-400",
      "rotate-180",
    ])
      expect(conexao, c).toContain(c);
  });
});
