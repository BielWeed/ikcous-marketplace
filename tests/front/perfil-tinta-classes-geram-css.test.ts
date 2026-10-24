// Perfil em Tinta (24/10/2026): toda classe NOVA do desenho aprovado precisa
// virar CSS de verdade, com o VALOR certo.
//
// POR QUE ESTE TESTE EXISTE: o jsdom não calcula CSS. Classe inventada, ou
// valor arbitrário mal escrito (`size-[88]` sem unidade), passa nos testes de
// componente e não pinta nada no celular. Aqui o Tailwind REAL do projeto
// compila as classes e o teste confere a declaração CSS de cada uma e se a
// tela de fato as usa. Molde: free-shipping-block-compacto-classes-geram-css.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

// classe -> trecho que a regra gerada precisa ter.
const CLASSES: Record<string, string> = {
  "h-[120px]": "height: 120px",
  "size-[88px]": "width: 88px",
  "h-[52px]": "height: 52px",
  "rounded-[28px]": "border-radius: 28px",
  "rounded-[20px]": "border-radius: 20px",
  "rounded-[18px]": "border-radius: 18px",
  "rounded-[14px]": "border-radius: 14px",
  "text-[26px]": "font-size: 26px",
  "text-[15px]": "font-size: 15px",
  "text-[11px]": "font-size: 11px",
  "tracking-[0.12em]": "letter-spacing: 0.12em",
  "font-mono": "font-family",
  "bg-foreground": "background-color",
  "text-background": "color",
  "bg-background/90": "background-color",
  "bg-background/10": "background-color",
  "text-background/70": "color",
  "bg-muted/30": "background-color",
  "bg-border": "background-color",
  "divide-border": "border-color",
  "border-border": "border-color",
  "border-red-300": "border-color",
  "text-red-600": "color",
  "dark:text-red-400": "color",
  "dark:text-emerald-400": "color",
  "hover:bg-foreground/90": "background-color",
  "hover:border-foreground/40": "border-color",
  "hover:bg-muted/50": "background-color",
  "-mt-11": "margin-top: -2.75rem",
  "space-y-7": "margin-top",
  "border-solid": "border-style: solid",
};

async function cssGerado(candidatas: string[]): Promise<string> {
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
  return resultado.css;
}

/** Corpo da(s) regra(s) cujo seletor contém a classe (com escapes do CSS). */
function corpoDaRegra(css: string, classe: string): string {
  const escapada = classe.replace(/([:[\]/.%])/g, "\\$1");
  const partes: string[] = [];
  const raiz = postcss.parse(css);
  raiz.walkRules((regra) => {
    if (regra.selector.includes(`.${escapada}`))
      partes.push(regra.nodes.map((n) => n.toString()).join(";"));
  });
  return partes.join("\n");
}

describe("Perfil Tinta — classes novas viram CSS com o valor certo", () => {
  it("controle: classe inventada não gera regra e valor sem unidade não vira o tamanho", async () => {
    const css = await cssGerado(["bg-marca-inventada-900", "size-[88]"]);
    expect(corpoDaRegra(css, "bg-marca-inventada-900")).toBe("");
    expect(corpoDaRegra(css, "size-[88]")).not.toContain("88px");
  }, 60_000);

  it("cada classe do desenho gera uma regra com a declaração esperada", async () => {
    const nomes = Object.keys(CLASSES);
    const css = await cssGerado(nomes);
    const falhas = nomes.filter((classe) => {
      const corpo = corpoDaRegra(css, classe);
      // eslint-disable-next-line security/detect-object-injection -- `classe` sai de Object.keys(CLASSES), chave conhecida
      return !corpo.includes(CLASSES[classe] as string);
    });
    expect(falhas).toEqual([]);
  }, 60_000);

  it("a tela usa de fato as classes-chave do desenho", () => {
    const fonte = readFileSync("src/views/customer/ProfileView.tsx", "utf8");
    for (const c of [
      "h-[120px]",
      "size-[88px]",
      "rounded-[28px]",
      "text-[26px]",
      "h-[52px]",
      "tracking-[0.12em]",
      "bg-foreground",
      "border-red-300",
    ])
      expect(fonte, c).toContain(c);
  });

  it("Tinta: a tela não usa mais cor fixa de tema nem a cor da marca", () => {
    const fonte = readFileSync("src/views/customer/ProfileView.tsx", "utf8");
    expect(fonte).not.toMatch(/\b(?:bg|text|border)-(?:zinc|slate|gray)-\d/);
    expect(fonte).not.toMatch(/\bbg-primary\b|\btext-primary\b/);
    expect(fonte).not.toMatch(/tracking-\[0\.[23]em\]|tracking-widest/);
  });
});
