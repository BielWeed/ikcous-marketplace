//
// A tela do cliente nao pode ter rolagem para o lado.
//
// Defeito (21/10/2026, app instalado no Android): ao arrastar o dedo para o
// LADO na home, a aba inteira deslizava ~4 px e aparecia uma faixa branca a
// direita. Causa medida em Chromium real (script em
// equipe/.../rolagem-lateral/medir.mjs):
//   1. A barra de filtros da home e a das abas do produto (`sticky`) usavam
//      margem negativa MAIOR que o respiro do pai (-mx-4 num pai com p-3;
//      -mx-6 num pai com px-5): 4 px a mais de cada lado -> a aba ficava 4 px
//      mais larga que a tela.
//   2. O painel de cada aba (`TabWrapper`) e `overflow-y-auto` sem eixo X
//      declarado, e o CSS manda `overflow-x: visible` virar `auto` quando o
//      outro eixo nao e `visible` -> qualquer sobra de 1 px virava rolagem
//      lateral pelo toque.
//
// jsdom nao ve layout, entao este contrato le o FONTE e confere a marcacao e
// o CSS; a prova de layout (scrollWidth <= clientWidth e o arrasto de toque nao
// mover a aba) e do script de Chromium real, nao deste arquivo.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const FONTES = import.meta.glob<string>(
  [
    "/src/App.tsx",
    "/src/views/customer/HomeView.tsx",
    "/src/views/customer/ProductView.tsx",
  ],
  { query: "?raw", import: "default", eager: true },
);

function fonte(caminho: string): string {
  const texto = new Map(Object.entries(FONTES)).get(caminho);
  expect(texto, `falta o fonte de ${caminho}`).toBeDefined();
  return (texto as string).replace(/\r\n/g, "\n");
}

const APP = fonte("/src/App.tsx");
const HOME = fonte("/src/views/customer/HomeView.tsx");
const PRODUTO = fonte("/src/views/customer/ProductView.tsx");
// eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do proprio repositorio
const CSS = readFileSync(
  new URL("../../src/index.css", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

/** "px-3 sm:px-4" -> { base: 3, sm: 4 } para o prefixo dado (px-, p-, -mx-). */
function porPonto(classes: string, prefixo: string): Map<string, number> {
  const mapa = new Map<string, number>();
  for (const classe of classes.split(/\s+/)) {
    const m = /^(?:(sm|md|lg):)?([-\w]+?)-(\d+)$/.exec(classe);
    if (m && `${m[2]}-` === prefixo) mapa.set(m[1] ?? "base", Number(m[3]));
  }
  return mapa;
}

/** O className (string literal) que contem `ancora`, sem o resto do arquivo. */
function classesComTrecho(codigo: string, ancora: string): string {
  const i = codigo.indexOf(ancora);
  expect(i, `trecho "${ancora}" sumiu do fonte`).toBeGreaterThan(-1);
  const ini = codigo.lastIndexOf('"', i) + 1;
  const fim = codigo.indexOf('"', i);
  return codigo.slice(ini, fim);
}

/**
 * Sangria (margem negativa) de uma barra que vai de ponta a ponta dentro de
 * um pai com respiro: nunca pode passar do respiro do pai, em nenhum ponto de
 * quebra, ou a aba fica mais larga que a tela.
 */
function sangriaCabeNoRespiro(sangria: string, respiroDoPai: string): void {
  const margens = porPonto(sangria, "-mx-");
  expect(margens.size).toBeGreaterThan(0);
  const respiro = porPonto(respiroDoPai, "px-");
  const respiroP = porPonto(respiroDoPai, "p-");
  const doPai = (ponto: string): number | undefined =>
    respiro.get(ponto) ?? respiroP.get(ponto);
  // O valor "em vigor" num ponto cai para o ponto anterior (mobile-first).
  const emVigor = (mapa: Map<string, number | undefined>, ponto: string) => {
    const ordem = ["base", "sm", "md", "lg"];
    let v: number | undefined;
    for (const p of ordem) {
      if (mapa.get(p) !== undefined) v = mapa.get(p);
      if (p === ponto) break;
    }
    return v ?? 0;
  };
  const margensMapa = new Map<string, number | undefined>(margens);
  const paiMapa = new Map<string, number | undefined>(
    ["base", "sm", "md", "lg"].map((p) => [p, doPai(p)]),
  );
  for (const ponto of ["base", "sm", "md"]) {
    expect(
      emVigor(margensMapa, ponto),
      `em "${ponto}" a sangria (${emVigor(margensMapa, ponto)}) passa do respiro do pai (${emVigor(paiMapa, ponto)})`,
    ).toBeLessThanOrEqual(emVigor(paiMapa, ponto));
  }
}

describe("a barra de filtros da home nao passa da tela", () => {
  it("a sangria (-mx) cabe no respiro do pai (p-3 sm:p-4) em todo ponto de quebra", () => {
    const pai = classesComTrecho(HOME, "p-3 sm:p-4");
    const barra = classesComTrecho(HOME, "sticky top-[-2px] z-40");
    sangriaCabeNoRespiro(barra, pai);
  });

  it("a barra volta a encostar na borda: o respiro interno (px) iguala a sangria", () => {
    const barra = classesComTrecho(HOME, "sticky top-[-2px] z-40");
    expect(porPonto(barra, "px-")).toEqual(porPonto(barra, "-mx-"));
  });
});

describe("a barra de abas do produto nao passa da tela", () => {
  it("a sangria (-mx) cabe no respiro do pai (px-5) abaixo do desktop", () => {
    const pai = classesComTrecho(PRODUTO, "px-5 py-4");
    const barra = classesComTrecho(PRODUTO, "sticky top-0 z-40 transition-all");
    sangriaCabeNoRespiro(barra, pai);
  });
});

describe("cinto de seguranca: nenhuma aba rola de lado", () => {
  it("o painel de cada aba (.admin-tab-pane) fecha o eixo X no CSS", () => {
    // O painel e `overflow-y-auto` no App.tsx; sem o eixo X declarado ele vira
    // `auto` e rola de lado pelo toque. A regra mora no CSS (0 byte de JS).
    expect(classesComTrecho(APP, "admin-tab-pane")).toContain(
      "overflow-y-auto",
    );
    const regra = /\n\.admin-tab-pane \{([^}]*)\}/.exec(CSS);
    expect(regra, "regra `.admin-tab-pane {` sumiu").not.toBeNull();
    expect(regra?.[1]).toMatch(/overflow-x:\s*hidden/);
  });

  it("html, body e #root seguem com overflow oculto e o overscroll lateral e cortado", () => {
    expect(CSS).toMatch(
      /html,\s*body,\s*#root\s*\{[^}]*overflow:\s*hidden;[^}]*\}/,
    );
    const html = /\n {2}html \{([^}]*)\}/.exec(CSS);
    expect(html, "bloco `html {` do @layer base sumiu").not.toBeNull();
    // O atalho `overscroll-behavior: none` cobre os dois eixos: o vertical que
    // ja existia (puxar para atualizar) fica como estava e o lateral entra.
    // (O stylelint do repo exige o atalho quando x e y valem o mesmo.)
    expect(html?.[1]).toMatch(/overscroll-behavior:\s*none/);
  });
});
