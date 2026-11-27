// A variante `hover-hover` esconde botões até o mouse passar em cima. Ela
// olhava só `@media (hover: hover)`, que pergunta pelo aparelho PRINCIPAL de
// apontar: num notebook com tela de toque, num Surface ou num iPad com
// trackpad a resposta é "tem mouse", e quem usa o dedo nunca via o botão.
//
// A regra certa é "tem hover E nenhum apontador grosso (dedo)":
// `(hover: hover) and (not (any-pointer: coarse))`. `(any-pointer: fine)` NÃO
// serve: no notebook de toque o touchpad já é fino e ela continuaria
// verdadeira. Navegador que não entende `not (...)` descarta a consulta
// inteira — o botão fica visível, o lado seguro.
//
// jsdom não calcula CSS: este teste compila o Tailwind REAL do projeto
// (mesmo padrão de cartao-favorito-aparece-no-foco-do-teclado.test.ts).
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

/**
 * Os blocos `@media` que envolvem a regra da classe pedida, de fora para
 * dentro. `group-hover` tem o próprio `@media` (o `hoverOnlyWhenSupported` da
 * config), aninhado dentro do da variante.
 */
function consultasDa(css: string, classe: string): string[] {
  const escapada = classe.replace(/[:]/g, "\\:");
  const raiz = postcss.parse(css);
  const achadas: string[] = [];
  raiz.walkRules((regra) => {
    if (!regra.selector.includes(escapada)) return;
    for (let pai = regra.parent; pai; pai = pai.parent) {
      if (pai.type === "atrule") {
        achadas.unshift((pai as postcss.AtRule).params);
      }
    }
  });
  return achadas;
}

const SEM_DEDO = "(hover: hover) and (not (any-pointer: coarse))";

describe("variante hover-hover: só esconde em aparelho sem dedo nenhum", () => {
  it("a regra exige hover E nenhum apontador grosso", async () => {
    const css = await compilar(["hover-hover:opacity-0"]);
    expect(consultasDa(css, "hover-hover:opacity-0")).toEqual([SEM_DEDO]);
  }, 60_000);

  it("o esconder do X de excluir aviso tira o toque junto (pointer-events-none)", async () => {
    const classes = [
      "hover-hover:pointer-events-none",
      "hover-hover:group-hover:pointer-events-auto",
      "hover-hover:focus-visible:pointer-events-auto",
    ];
    const css = await compilar(classes);
    for (const classe of classes) {
      // A camada de fora é sempre a da variante (o resto vem por dentro).
      expect(consultasDa(css, classe)[0]).toBe(SEM_DEDO);
    }
    expect(css).toContain("pointer-events: none");
    expect(css).toContain("pointer-events: auto");
  }, 60_000);

  it("controle: classe sem a variante não cai em @media nenhum", async () => {
    const css = await compilar(["opacity-0"]);
    expect(consultasDa(css, "opacity-0")).toEqual([]);
  }, 60_000);
});
