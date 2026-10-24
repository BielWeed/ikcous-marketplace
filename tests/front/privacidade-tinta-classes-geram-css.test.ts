// "Privacidade e meus dados" no estilo Tinta (23/10/2026): toda classe do componente precisa virar CSS de
// verdade. O jsdom não calcula CSS, então classe inventada ou valor arbitrário mal escrito passa nos testes
// de componente e não pinta nada no celular. Aqui o Tailwind REAL do projeto compila as classes. Molde:
// free-shipping-block-compacto-classes-geram-css. Também prova que o atributo `hidden` esconde de fato o
// painel da sanfona (a regra do preflight não pode ser vencida por uma classe de display no mesmo elemento).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

// Classes de PrivacidadeEMeusDados.tsx (cabeçalho, prazo, sanfona, cartão com ponto e botões de ação).
const CLASSES = [
  "space-y-5",
  "space-y-1.5",
  "space-y-1",
  "space-y-2.5",
  "space-y-3",
  "font-mono",
  "text-[11px]",
  "uppercase",
  "tracking-[0.12em]",
  "text-muted-foreground",
  "text-[28px]",
  "font-bold",
  "leading-8",
  "tracking-tight",
  "text-foreground",
  "text-sm",
  "flex",
  "min-h-[52px]",
  "items-center",
  "gap-3",
  "rounded-2xl",
  "border",
  "border-border",
  "bg-muted/30",
  "px-4",
  "text-[15px]",
  "font-semibold",
  "overflow-hidden",
  "rounded-[18px]",
  "border-input",
  "border-t",
  "items-start",
  "gap-2",
  "gap-2.5",
  "w-full",
  "min-h-11",
  "min-w-0",
  "flex-1",
  "block",
  "py-3.5",
  "text-left",
  "leading-5",
  "mt-0.5",
  "mt-1.5",
  "mt-2",
  "text-xs",
  "leading-4",
  "line-clamp-2",
  "size-4",
  "size-2",
  "shrink-0",
  "rounded-full",
  "p-3.5",
  "pb-4",
  "pt-1",
  "text-[13px]",
  "leading-[18px]",
  "focus-visible:outline-none",
  "focus-visible:ring-2",
  "focus-visible:ring-inset",
  "focus-visible:ring-ring",
  "bg-emerald-500",
  "bg-amber-500",
  "bg-red-500",
  "h-[52px]",
  "border-[1.5px]",
  "border-foreground",
  "bg-background",
  "shadow-none",
  "hover:bg-muted/40",
  "hover:text-foreground",
  "dark:border-foreground",
  "dark:bg-background",
  "dark:hover:bg-muted/40",
  "border-red-300",
  "text-red-600",
  "hover:text-red-600",
  "dark:border-red-300",
  "dark:text-red-400",
  "dark:hover:text-red-400",
];

async function compilar(candidatas: string[]) {
  const carregar = requisitar("tailwindcss/loadConfig") as (
    caminho: string,
  ) => Record<string, unknown>;
  const config = carregar(resolve("tailwind.config.js"));
  const css = readFileSync("src/index.css", "utf8");
  return postcss([
    tailwindcss({
      ...config,
      content: [{ raw: candidatas.join(" "), extension: "html" }],
    }),
  ]).process(css, { from: "src/index.css" });
}

async function geradas(candidatas: string[]): Promise<Set<string>> {
  const resultado = await compilar(candidatas);
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

describe("Privacidade no estilo Tinta: toda classe vira regra no Tailwind do projeto", () => {
  it("controle: classe inventada não gera CSS", async () => {
    const g = await geradas(["bg-marca-inventada-900", "rounded-[18px]"]);
    expect(g.has("bg-marca-inventada-900")).toBe(false);
    expect(g.has("rounded-[18px]")).toBe(true);
  }, 60_000);

  it("as classes do desenho aprovado geram CSS", async () => {
    const g = await geradas(CLASSES);
    expect(CLASSES.filter((c) => !g.has(c))).toEqual([]);
  }, 60_000);

  it("o recorte de 2 linhas e o atributo hidden têm regra: o painel fechado some de verdade", async () => {
    const resultado = await compilar(["line-clamp-2"]);
    const regras: string[] = [];
    resultado.root.walkRules((r) => {
      regras.push(
        `${r.selector} { ${r.nodes?.map((n) => n.toString()).join("; ")} }`,
      );
    });
    const todas = regras.join("\n");
    expect(todas).toMatch(/\.line-clamp-2[^}]*-webkit-line-clamp: 2/);
    expect(todas).toMatch(/\[hidden\][^}]*display: none/);
  }, 60_000);

  it("as classes listadas são as que o componente usa de fato (as de tamanho arbitrário e de cor Tinta)", () => {
    const fonte = readFileSync(
      "src/components/account/PrivacidadeEMeusDados.tsx",
      "utf8",
    );
    const arbitrarias = CLASSES.filter((c) => /\[|^border-foreground$/.test(c));
    for (const c of arbitrarias) expect(fonte, c).toContain(c);
    // Nunca a cor da marca da loja (às vezes amarela) nos botões ou no resto da tela.
    expect(fonte).not.toContain("bg-primary");
  });
});
