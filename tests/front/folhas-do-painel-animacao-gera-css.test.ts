// As folhas do painel que sobem de baixo (Gestão de Cliente, Ações do pedido)
// ganharam animação de entrada/saída. O jsdom não calcula CSS e classe
// inventada passa em teste de componente sem pintar nada — aqui o Tailwind REAL
// do projeto compila as classes. Prova duas coisas que o Chromium mostrou:
//   1. o keyframe do tailwindcss-animate parte de translate3d(var(--x),var(--y))
//      e DESCARTA o -translate-x-1/2 da folha (`left-1/2`): sem a compensação
//      `slide-in-from-left-1/2` ela entrava escorregando ~197px de lado;
//   2. `[--tw-enter-scale:1]` (propriedade arbitrária, emitida por último)
//      precisa vir DEPOIS de `zoom-in-95` (o da base do Dialog), senão no
//      celular a folha continuaria entrando encolhida.
// Molde: folha-financeira-classes-geram-css.test.ts.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import postcss from "postcss";
import tailwindcss from "tailwindcss";
import { describe, expect, it } from "vitest";

const requisitar = createRequire(import.meta.url);

async function compilar(candidatas: string[]) {
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

// Corpo da regra cujo seletor contém `trecho` (as classes saem escapadas).
function corpoDaRegra(css: string, trecho: string): string {
  const i = css.indexOf(trecho);
  expect(i, `regra de ${trecho} não foi gerada`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("}", i));
}

describe("folhas do painel: a animação gera CSS de verdade", () => {
  const classes = [
    "data-[state=open]:slide-in-from-left-1/2",
    "data-[state=closed]:slide-out-to-left-1/2",
    "data-[state=open]:slide-in-from-bottom",
    "data-[state=closed]:slide-out-to-bottom",
    "sm:data-[state=open]:slide-in-from-top-1/2",
    "sm:data-[state=closed]:slide-out-to-top-1/2",
    "data-[state=open]:zoom-in-95",
    "data-[state=open]:[--tw-enter-scale:1]",
    "data-[state=open]:[animation-duration:250ms]",
  ];

  it("controle: classe inventada não gera nada", async () => {
    const css = await compilar(["data-[state=open]:slide-in-from-nada-9"]);
    expect(css).not.toContain("slide-in-from-nada-9");
  }, 60_000);

  it("compensa o -translate-x-1/2 e vem de baixo; a duração de 250ms é CSS de verdade", async () => {
    const css = await compilar(classes);
    expect(corpoDaRegra(css, "slide-in-from-left-1\\/2")).toContain(
      "--tw-enter-translate-x: -50%",
    );
    expect(corpoDaRegra(css, "slide-out-to-left-1\\/2")).toContain(
      "--tw-exit-translate-x: -50%",
    );
    expect(corpoDaRegra(css, "slide-in-from-bottom")).toContain(
      "--tw-enter-translate-y: 100%",
    );
    expect(corpoDaRegra(css, "slide-out-to-bottom")).toContain(
      "--tw-exit-translate-y: 100%",
    );
    expect(corpoDaRegra(css, "slide-in-from-top-1\\/2")).toContain(
      "--tw-enter-translate-y: -50%",
    );
    expect(corpoDaRegra(css, "animation-duration\\:250ms")).toContain(
      "animation-duration: 250ms",
    );
  }, 60_000);

  it("zerar a escala da entrada vem DEPOIS de zoom-in-95 (o da base do Dialog): propriedade arbitrária é emitida por último", async () => {
    const css = await compilar(classes);
    const de95 = css.indexOf("zoom-in-95");
    const zera = css.indexOf("enter-scale\\:1");
    expect(de95).toBeGreaterThan(-1);
    expect(zera).toBeGreaterThan(de95);
    expect(corpoDaRegra(css, "enter-scale\\:1")).toContain(
      "--tw-enter-scale: 1",
    );
  }, 60_000);
});
