// Caça 03/11/2026 (b8 e b9): classe de cor que o Tailwind do projeto não conhece
// (emerald-450/455, zinc-450, red-650, green-650) não gera CSS e some em silêncio:
// o preset escolhido do editor de imagem perdia a borda verde, o aviso de estoque
// da prévia perdia a cor e "Remover Avatar Atual" aparecia sem vermelho. O
// jsdom não calcula CSS, então o teste lê a fonte; um segundo teste compila as
// classes novas no Tailwind REAL (molde: conta-tinta-classes-geram-css).
// Os modais de foto e capa também ficaram com alvos de toque abaixo de 44 px.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import selectorParser from "postcss-selector-parser";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

const FONTES: Record<string, string> = {
  "src/components/ui/custom/ImageAdjuster.tsx": readFileSync(
    "src/components/ui/custom/ImageAdjuster.tsx",
    "utf8",
  ),
  "src/components/admin/PhoneSimulator.tsx": readFileSync(
    "src/components/admin/PhoneSimulator.tsx",
    "utf8",
  ),
  "src/views/customer/AccountSettingsView.tsx": readFileSync(
    "src/views/customer/AccountSettingsView.tsx",
    "utf8",
  ),
};

// Tons que o config NÃO define (zinc 550/650/750/850 existem; estes não).
const TONS_INEXISTENTES = [
  "emerald-450",
  "emerald-455",
  "zinc-450",
  "red-650",
  "green-650",
];

// Fichas de classe da fonte (separadas por espaço, aspas e crase) que usam um deles.
function usosInexistentes(fonte: string): string[] {
  return fonte
    .split(/[\s"'`]+/)
    .filter((ficha) =>
      TONS_INEXISTENTES.some((tom) => ficha.endsWith(`-${tom}`)),
    );
}

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

describe("tokens de cor que o Tailwind do projeto não conhece", () => {
  it("controle: o Tailwind real não gera as cores inexistentes e gera as vivas", async () => {
    const g = await geradas([
      "text-red-650",
      "border-emerald-450",
      "text-red-600",
      "text-zinc-550",
    ]);
    expect(g.has("text-red-650")).toBe(false);
    expect(g.has("border-emerald-450")).toBe(false);
    expect(g.has("text-red-600")).toBe(true);
    expect(g.has("text-zinc-550")).toBe(true);
  }, 60_000);

  for (const [arquivo, fonte] of Object.entries(FONTES)) {
    it(`${arquivo} não usa emerald-450/455, zinc-450, red-650 nem green-650`, () => {
      expect(usosInexistentes(fonte)).toEqual([]);
    });
  }

  it("as cores que entram no lugar geram CSS", async () => {
    const trocas = [
      "border-emerald-400",
      "text-emerald-400",
      "text-zinc-500",
      "text-red-600",
      "text-green-600",
      "dark:text-red-400",
    ];
    const g = await geradas(trocas);
    expect(trocas.filter((c) => !g.has(c))).toEqual([]);
  }, 60_000);
});

describe("modais de foto e capa (Configurações da conta)", () => {
  const fonte = FONTES["src/views/customer/AccountSettingsView.tsx"];
  const modais = fonte.slice(fonte.indexOf("<Dialog open={isAvatarModalOpen}"));
  const classes = [
    ...modais.matchAll(/className=(?:"([^"]*)"|\{`([^`]*)`\})/g),
  ].map((m) => m[1] ?? m[2]);

  it("'Remover Avatar Atual' é vermelho de verdade", () => {
    const ponto = modais.indexOf("Remover Avatar Atual");
    const botao = modais.slice(modais.lastIndexOf("<Button", ponto), ponto);
    expect(botao).toContain("text-red-600");
  });

  it("abas e botões não ficam abaixo de 44 px (nada de h-10 nem py-1.5)", () => {
    expect(classes.filter((c) => /\b(?:h-10|py-1\.5)\b/.test(c))).toEqual([]);
    // 2 abas do avatar, 2 abas da capa, 3 botões do avatar, 2 botões da capa.
    expect(
      classes.filter((c) => /\bmin-h-11\b/.test(c)).length,
    ).toBeGreaterThanOrEqual(9);
  });

  it("os controles com alvo de toque não usam letra de 9 ou 10 px", () => {
    const miudas = classes
      .filter((c) => /\bmin-h-11\b/.test(c))
      .filter((c) => /\btext-\[(?:8|9|10)px\]/.test(c));
    expect(miudas).toEqual([]);
  });
});
