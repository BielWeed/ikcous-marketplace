// O rodapé da vitrine (Home) e os links do checkout, do produto e do cadastro
// só precisam do NOME de cada política. O texto jurídico inteiro
// (`textos-das-politicas.ts`, ~2,9 kB comprimido) tem de ficar no pedaço
// baixado sob demanda — senão toda abertura da Home paga por um texto que quase
// ninguém lê. Este teste anda pelos imports ESTÁTICOS de cada ponto de entrada
// e prova que o arquivo grande não está no caminho. (Import dinâmico e
// `import type` não contam: não entram no pedaço inicial.)
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = resolve(__dirname, "../..");
const GRANDE = "src/lib/textos-das-politicas.ts";

function caminhoDoImport(origem: string, alvo: string): string | null {
  if (!alvo.startsWith("@/") && !alvo.startsWith(".")) return null;
  const base = alvo.startsWith("@/")
    ? resolve(RAIZ, "src", alvo.slice(2))
    : resolve(dirname(resolve(RAIZ, origem)), alvo);
  for (const ext of [".ts", ".tsx"]) {
    const candidato = `${base}${ext}`;
    try {
      // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho dentro do proprio repositorio
      readFileSync(candidato, "utf8");
      return candidato.slice(RAIZ.length + 1).replace(/\\/g, "/");
    } catch {
      // tenta a próxima extensão
    }
  }
  return null;
}

/** `{ type A, type B }`: some na compilação, não traz nada para o pedaço. */
function soTipos(especificadores: string): boolean {
  const texto = especificadores.trim();
  if (!/^\{[^}]*\}$/.test(texto)) return false;
  const nomes = texto
    .replace(/[{}]/g, "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return nomes.length > 0 && nomes.every((s) => s.startsWith("type "));
}

/**
 * Imports ESTÁTICOS de valor de um fonte, em todas as formas que entram no
 * pedaço inicial:
 *   - `import x from "..."`, `import { a } from '...'`, `import * as x from "..."`
 *   - `import "..."` (efeito colateral, sem `from`)
 *   - `export { a } from "..."`, `export * from "..."`, `export * as x from "..."`
 * Aspas simples ou duplas, com ou sem `;` no fim.
 * Ficam de fora o que some na compilação (`import type`, `export type`,
 * `{ type A }`) e o `import("...")` dinâmico, que é carregado sob demanda e por
 * definição NÃO está no pedaço inicial.
 */
function importsDoFonte(fonte: string): string[] {
  const achados: string[] = [];
  // Os padrões abaixo são ancorados no começo da linha e limitados por aspas
  // ou chaves, sobre o fonte do próprio repositório: sem entrada hostil.
  // import "x";  (efeito colateral)
  // eslint-disable-next-line security/detect-unsafe-regex -- fonte do proprio repositorio
  const efeitoColateral = /^import\s*["']([^"']+)["']/gm;
  for (const m of fonte.matchAll(efeitoColateral)) achados.push(m[1]);
  // import x, { a } from "x";  /  import * as x from "x";
  // eslint-disable-next-line security/detect-unsafe-regex -- fonte do proprio repositorio
  const comBinding =
    /^import\s+(type\s+(?!from\b))?([^;"']*?)\s*from\s*["']([^"']+)["']/gms;
  for (const m of fonte.matchAll(comBinding)) {
    if (m[1]) continue; // import type
    if (soTipos(m[2])) continue;
    achados.push(m[3]);
  }
  // export { a } from "x";  /  export * from "x";  /  export * as x from "x";
  // eslint-disable-next-line security/detect-unsafe-regex -- fonte do proprio repositorio
  const reexporta =
    /^export\s+(type\s+(?=[{*]))?(\{[^}]*\}|\*(?:\s+as\s+[\w$]+)?)\s*from\s*["']([^"']+)["']/gms;
  for (const m of fonte.matchAll(reexporta)) {
    if (m[1]) continue; // export type
    if (soTipos(m[2])) continue;
    achados.push(m[3]);
  }
  return achados;
}

function importsEstaticos(arquivo: string): string[] {
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho dentro do proprio repositorio
  return importsDoFonte(readFileSync(resolve(RAIZ, arquivo), "utf8"));
}

function fechamentoEstatico(entrada: string): Set<string> {
  const visto = new Set<string>();
  const fila = [entrada];
  while (fila.length > 0) {
    const atual = fila.pop() as string;
    if (visto.has(atual)) continue;
    visto.add(atual);
    for (const alvo of importsEstaticos(atual)) {
      const caminho = caminhoDoImport(atual, alvo);
      // Só seguimos dentro de politicas/ e dos dois arquivos de lib: o resto
      // do app (hooks, contexto, ícones) não pode arrastar o texto grande.
      if (
        caminho &&
        (caminho.startsWith("src/components/politicas/") ||
          caminho.startsWith("src/lib/") ||
          caminho.startsWith("src/hooks/") ||
          caminho.startsWith("src/utils/"))
      ) {
        fila.push(caminho);
      }
    }
  }
  return visto;
}

describe("o detector de imports estáticos enxerga todas as formas", () => {
  it.each([
    ['import x from "@/a";', "@/a"],
    ["import x from '@/a'", "@/a"],
    ['import { a, b } from "@/a";', "@/a"],
    ['import x, { a } from "@/a";', "@/a"],
    ['import * as x from "@/a";', "@/a"],
    ['import { a as b } from "@/a";', "@/a"],
    ['import { type A, b } from "@/a";', "@/a"],
    ['import "@/a";', "@/a"],
    ["import '@/a'", "@/a"],
    ['import"@/a";', "@/a"],
    ['export { a } from "@/a";', "@/a"],
    ['export * from "@/a";', "@/a"],
    ['export * as ns from "@/a";', "@/a"],
    ['export { type A, b } from "@/a";', "@/a"],
    ['import type_ from "@/a";', "@/a"],
    ['import type from "@/a";', "@/a"],
    ['import {\n  a,\n  b,\n} from "@/a";', "@/a"],
  ])("conta: %s", (fonte, alvo) => {
    expect(importsDoFonte(fonte)).toEqual([alvo]);
  });

  it.each([
    'import type { A } from "@/a";',
    'import type X from "@/a";',
    'import type * as X from "@/a";',
    'import { type A, type B } from "@/a";',
    'export type { A } from "@/a";',
    'export type * from "@/a";',
    'export { type A } from "@/a";',
    'const m = () => import("@/a");',
    'const m = lazy(() => import("@/a"));',
    '// import "@/a";',
    "export const a = 1;",
  ])("não conta (some na compilação ou é sob demanda): %s", (fonte) => {
    expect(importsDoFonte(fonte)).toEqual([]);
  });

  it("acha cada import num arquivo com vários", () => {
    const fonte = [
      'import { useState } from "react";',
      'import type { T } from "@/t";',
      'import "@/lib/textos-das-politicas";',
      'export * from "./irmao";',
      'const Folha = lazy(() => import("@/lib/outro"));',
    ].join("\n");
    expect(importsDoFonte(fonte).sort()).toEqual(
      ["./irmao", "@/lib/textos-das-politicas", "react"].sort(),
    );
  });
});

describe("peso da Home: o texto jurídico não vem junto do rodapé", () => {
  it.each([
    "src/components/politicas/RodapeDasPoliticas.tsx",
    "src/components/politicas/LinksDasPoliticas.tsx",
    "src/components/politicas/PoliticaEmFolhaSobDemanda.tsx",
  ])("%s não importa o arquivo grande, nem de forma indireta", (entrada) => {
    const fecho = fechamentoEstatico(entrada);
    expect([...fecho]).not.toContain(GRANDE);
    expect([...fecho]).not.toContain(
      "src/components/politicas/PoliticaEmFolha.tsx",
    );
    expect([...fecho]).not.toContain(
      "src/components/politicas/ConteudoDaPolitica.tsx",
    );
  });

  it("controle: a folha de leitura, essa sim, traz o arquivo grande", () => {
    const fecho = fechamentoEstatico(
      "src/components/politicas/ConteudoDaPolitica.tsx",
    );
    expect([...fecho]).toContain(GRANDE);
  });
});
