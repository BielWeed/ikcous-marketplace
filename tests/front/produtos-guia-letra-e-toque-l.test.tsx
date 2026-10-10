// Painel simples, onda L, frente L4 (produtos-guia) — o guia de Produtos no celular.
//
// O render da onda K mediu as abas "Dicionário" e "Simulador" do guia com 40px
// de altura, e a aba "Conceitos" ainda tinha 27 textos de 8 a 10px. O jsdom não
// aplica CSS, então a prova é sobre a classe escrita no arquivo (a medida real é
// do render do integrador):
//   a. as duas abas do guia têm `min-h-11` (44px) e mantêm os textos
//      "Dicionário" e "Simulador";
//   b. o arquivo todo não tem texto abaixo de 11px;
//   c. as linhas rótulo/fórmula da aba Conceitos não colam a 360px: com a letra
//      maior, rótulo e fórmula ganham `gap-2` e a fórmula quebra linha na caixa.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-unsafe-regex --
   lê o próprio arquivo-fonte da tela (caminho fixo no repositório, não entrada de usuário) */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const FONTE = readFileSync(
  join(__dirname, "..", "..", "src/views/admin/AdminProductsView.tsx"),
  "utf8",
);

const TEXTO_MIUDO = /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g;

/** A tag JSX de abertura que começa em `inicio` (até o `>` fora de `{}` e de aspas). */
function tagAPartirDe(texto: string, inicio: number): string {
  let profundidade = 0;
  let aspas: string | null = null;
  for (let i = inicio + 1; i < texto.length; i++) {
    const c = texto[i];
    if (aspas) {
      if (c === aspas) aspas = null;
      continue;
    }
    if (profundidade === 0 && (c === '"' || c === "'")) aspas = c;
    else if (c === "{") profundidade++;
    else if (c === "}") profundidade--;
    else if (c === ">" && profundidade === 0) return texto.slice(inicio, i + 1);
  }
  return "";
}

/** O `<button` mais próximo ANTES de `ancora`. */
function botaoAntesDe(ancora: string): string {
  const posicao = FONTE.indexOf(ancora);
  expect(posicao, `âncora ausente: ${ancora}`).toBeGreaterThan(-1);
  const inicio = FONTE.lastIndexOf("<button", posicao);
  expect(inicio, `<button antes de ${ancora}`).toBeGreaterThan(-1);
  return tagAPartirDe(FONTE, inicio);
}

describe("Produtos — guia com 44px e letra de 11px (L4)", () => {
  it("a. as abas Dicionário e Simulador do guia têm min-h-11", () => {
    const dicionario = botaoAntesDe('setHelpTab("concepts")');
    const simulador = botaoAntesDe('setHelpTab("simulator")');
    expect(dicionario).toContain("min-h-11");
    expect(simulador).toContain("min-h-11");

    // os textos das abas não mudam (produtos-cabem-no-celular acha por textContent)
    expect(FONTE).toMatch(/<BookOpen[^>]*\/>\s*Dicionário\s*<\/button>/);
    expect(FONTE).toMatch(/<Calculator[^>]*\/>\s*Simulador\s*<\/button>/);
  });

  it("b. o arquivo todo não tem texto abaixo de 11px", () => {
    const sobras = [...FONTE.matchAll(TEXTO_MIUDO)].map((m) => {
      const linha = FONTE.slice(0, m.index).split("\n").length;
      return `${m[0]} (linha ${linha})`;
    });
    expect(sobras).toEqual([]);
  });

  it("c. as linhas rótulo/fórmula da aba Conceitos deixam folga entre si", () => {
    const abre = FONTE.indexOf('{helpTab === "concepts" ? (');
    const fecha = FONTE.indexOf("/* Simulador de Lucratividade */");
    expect(abre).toBeGreaterThan(-1);
    expect(fecha).toBeGreaterThan(abre);

    const conceitos = FONTE.slice(abre, fecha);
    const linhas = [
      ...conceitos.matchAll(/className="[^"]*justify-between[^"]*"/g),
    ];
    // 5 caixas de fórmula/regra + 4 linhas internas (fórmula e exemplo, 2 métricas)
    expect(linhas.length).toBe(9);
    for (const linha of linhas) {
      expect(linha[0], linha[0]).toContain("gap-2");
    }
  });
});
