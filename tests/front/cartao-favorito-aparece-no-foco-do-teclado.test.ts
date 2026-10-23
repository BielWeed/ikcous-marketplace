// O coração de favoritar do cartão em grade, no computador (com mouse), fica
// escondido e só aparece com o mouse em cima. Quem navega por Tab chegava no
// botão, mas ele continuava invisível e deslocado (sem anel de foco visível).
//
// jsdom não calcula CSS: este teste compila o Tailwind REAL do projeto e prova
// que as classes do container do coração geram a regra "foco dentro do cartão
// traz o coração de volta", só em aparelho com mouse (@media (hover: hover)).
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

async function compilar(candidatas: string[]): Promise<string> {
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

const FONTE = readFileSync("src/components/ui/custom/ProductCard.tsx", "utf8");
const CLASSES_DE_FOCO = [
  "hover-hover:group-focus-within:translate-x-0",
  "hover-hover:group-focus-within:opacity-100",
];

describe("cartão em grade: o coração aparece quando o foco do teclado chega", () => {
  it("o container do coração declara as duas classes de foco dentro do grupo", () => {
    for (const classe of CLASSES_DE_FOCO) expect(FONTE).toContain(classe);
  });

  it("o Tailwind gera a regra (foco dentro do grupo, só com mouse)", async () => {
    const css = await compilar(CLASSES_DE_FOCO);
    for (const classe of CLASSES_DE_FOCO) {
      const escapada = classe.replace(/[:]/g, "\\:");
      expect(css).toContain(escapada);
    }
    expect(css).toContain(":focus-within");
    expect(css).toContain("(hover: hover)");
  }, 60_000);

  it("controle: classe inventada de foco NÃO gera regra", async () => {
    const css = await compilar([
      "hover-hover:group-foco-inventado:opacity-100",
    ]);
    expect(css).not.toContain("group-foco-inventado");
  }, 60_000);
});
