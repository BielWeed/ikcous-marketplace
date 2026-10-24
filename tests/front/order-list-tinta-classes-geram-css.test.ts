// Meus Pedidos no desenho "Tinta" (24/10/2026): toda classe nova do cartão do
// pedido, do estado vazio/falha e da busca de pedido precisa virar CSS de
// verdade. O jsdom não calcula CSS, então classe inventada passa nos testes de
// componente e não pinta nada no celular. Aqui o Tailwind REAL do projeto
// compila as classes. Molde: free-shipping-block-compacto-classes-geram-css.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

const CLASSES_DA_LISTA = [
  "rounded-[18px]",
  "rounded-[22px]",
  "rounded-[14px]",
  "border-border",
  "bg-background",
  "bg-muted",
  "bg-muted/40",
  "bg-foreground",
  "text-foreground",
  "text-background",
  "text-muted-foreground",
  "bg-muted-foreground/40",
  "border-muted-foreground",
  "hover:border-foreground/30",
  "border-background",
  "border-t",
  "font-mono",
  "uppercase",
  "tracking-[0.12em]",
  "text-[13px]",
  "leading-[18px]",
  "text-[15px]",
  "text-[22px]",
  "h-[52px]",
  "min-h-11",
  "min-h-[136px]",
  "line-clamp-2",
  "break-words",
  "bg-red-600",
  "dark:bg-red-400",
  "text-red-600",
  "dark:text-red-400",
  "bg-emerald-600",
  "dark:bg-emerald-400",
  "text-emerald-700",
  "dark:text-emerald-400",
  "text-amber-700",
  "dark:text-amber-400",
  "after:absolute",
  "after:inset-0",
  "after:rounded-[18px]",
  "after:content-['']",
  "aria-disabled:opacity-60",
  "border-solid",
  "size-20",
  "size-9",
];

const CLASSES_DA_BUSCA = [
  "bg-muted/40",
  "border-input",
  "placeholder:text-muted-foreground",
  "placeholder:text-sm",
  "placeholder:font-medium",
  "placeholder:tracking-normal",
  "focus:border-foreground",
  "focus:ring-foreground/20",
  "tracking-[0.3em]",
  "h-14",
  "h-12",
  "h-[52px]",
  "flex-[2]",
  "rounded-[14px]",
  "rounded-[18px]",
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

describe("Meus Pedidos Tinta: toda classe vira regra no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const g = await geradas(["bg-marca-inventada-900", "rounded-[18px]"]);
    expect(g.has("bg-marca-inventada-900")).toBe(false);
    expect(g.has("rounded-[18px]")).toBe(true);
  }, 60_000);

  it("cartão, estados e esqueleto da lista geram CSS", async () => {
    const g = await geradas(CLASSES_DA_LISTA);
    // `after:content-['']` sai escapado do seletor; compara pelo nome literal.
    const faltam = CLASSES_DA_LISTA.filter((c) => !g.has(c));
    expect(faltam).toEqual([]);
  }, 60_000);

  it("a busca de pedido gera CSS", async () => {
    const g = await geradas(CLASSES_DA_BUSCA);
    expect(CLASSES_DA_BUSCA.filter((c) => !g.has(c))).toEqual([]);
  }, 60_000);

  it("as classes de valor arbitrário listadas são as que os componentes usam", () => {
    const lista = readFileSync(
      "src/components/ui/custom/OrderList.tsx",
      "utf8",
    );
    const busca = readFileSync(
      "src/components/ui/custom/OrderSearch.tsx",
      "utf8",
    );
    for (const c of CLASSES_DA_LISTA.filter((x) => /\[/.test(x)))
      expect(lista, c).toContain(c);
    for (const c of CLASSES_DA_BUSCA.filter((x) => /\[|^h-1[24]$/.test(x)))
      expect(busca, c).toContain(c);
  });

  it("nenhum texto abaixo de 12 px e nenhum dourado de selecionado nos dois componentes", () => {
    for (const arq of [
      "src/components/ui/custom/OrderList.tsx",
      "src/components/ui/custom/OrderSearch.tsx",
    ]) {
      const fonte = readFileSync(arq, "utf8");
      expect(fonte, arq).not.toMatch(/text-\[(?:[0-9]|1[01])px\]/);
      expect(fonte, arq).not.toMatch(/tracking-(?:widest|\[0\.2em\])/);
      expect(fonte, arq).not.toMatch(/bg-primary/);
    }
  });
});
