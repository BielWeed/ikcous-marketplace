// Barra de frete compacta da Home (23/10/2026): toda classe do ramo "compacto"
// precisa virar CSS de verdade. O jsdom não calcula CSS, então classe
// inventada ou valor arbitrário mal escrito passa nos testes de componente e
// não pinta nada no celular. Aqui o Tailwind REAL do projeto compila as
// classes do cartão e do esqueleto da Home. Molde: perfil-classes-geram-css.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

// Classes do ramo compacto de FreeShippingBlock.tsx e do esqueleto da Home.
const CLASSES = [
  "flex",
  "w-full",
  "min-h-[66px]",
  "items-center",
  "gap-2.5",
  "rounded-[18px]",
  "border",
  "border-zinc-800",
  "bg-zinc-950",
  "px-3",
  "py-2",
  "text-white",
  "relative",
  "shrink-0",
  "absolute",
  "inset-0",
  "m-auto",
  "text-zinc-400",
  "text-emerald-400",
  "min-w-0",
  "flex-1",
  "text-[11px]",
  "font-semibold",
  "uppercase",
  "leading-[13px]",
  "tracking-[0.06em]",
  "text-base",
  "font-bold",
  "leading-5",
  "tabular-nums",
  "text-xs",
  "leading-[15px]",
  "h-[66px]",
  "animate-pulse",
  "bg-zinc-100",
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

describe("barra de frete compacta: toda classe vira regra no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const g = await geradas(["bg-marca-inventada-900", "rounded-[18px]"]);
    expect(g.has("bg-marca-inventada-900")).toBe(false);
    expect(g.has("rounded-[18px]")).toBe(true);
  }, 60_000);

  it("as classes do desenho aprovado geram CSS", async () => {
    const g = await geradas(CLASSES);
    expect(CLASSES.filter((c) => !g.has(c))).toEqual([]);
  }, 60_000);

  it("as classes listadas são as que o componente usa de fato", () => {
    const fonte = readFileSync(
      "src/components/ui/custom/FreeShippingBlock.tsx",
      "utf8",
    );
    const ramo = fonte.slice(
      fonte.indexOf('freeShippingCardStyle === "compacto"'),
      fonte.indexOf('Selo "Liberado"'),
    );
    for (const c of CLASSES.filter((x) => /\[|^text-(base|xs)$/.test(x)))
      if (!c.startsWith("h-[") && c !== "animate-pulse" && c !== "bg-zinc-100")
        expect(ramo, c).toContain(c);
  });
});
