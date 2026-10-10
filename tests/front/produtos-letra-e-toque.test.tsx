// Painel simples, onda K, frente K-B (B1-B3) — Produtos: toque de 44px, letra
// de 11px e vidro sem classe que perde.
//
// A lojista usa a lista de Produtos e o guia de ajuda no celular. O render da
// onda J2 mediu o botão "?" com 32px, os campos do simulador com ~36px, o
// "Resetar Simulador" com 24px e rótulos de 8-10px. O jsdom não aplica CSS, então
// a prova é sobre a classe escrita no arquivo (a medida real é do render do
// integrador):
//   a. o botão de ajuda do cabeçalho é um envoltório de 44px (`min-h-11
//      min-w-11`); o círculo visível mora no <span> interno (padrão A3);
//   b. os três campos do simulador têm `min-h-11`;
//   c. "Resetar Simulador" tem `min-h-11` e letra de 11px;
//   d. nenhum texto abaixo de 11px no arquivo todo (a aba "Conceitos" do guia
//      foi a última a subir, na onda L);
//   e. `admin-glass` não divide o elemento com classe que ele apaga
//      (`shadow-lg`, `shadow-[…]`, `border-y`); o esqueleto continua com
//      `admin-glass` (o seletor `.admin-glass.animate-pulse` de
//      produtos-detalhado-nao-esconde-o-preco.test.tsx depende dele).
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

/** A tag de abertura JSX que começa em `inicio` (até o `>` fora de `{}` e de aspas). */
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

/** A tag `<nome` mais próxima ANTES de `ancora`. */
function tagAntesDe(texto: string, nome: string, ancora: string): string {
  const posicao = texto.indexOf(ancora);
  expect(posicao, `âncora ausente: ${ancora}`).toBeGreaterThan(-1);
  const inicio = texto.lastIndexOf(`<${nome}`, posicao);
  expect(inicio, `<${nome} antes de ${ancora}`).toBeGreaterThan(-1);
  return tagAPartirDe(texto, inicio);
}

describe("Produtos — toque de 44px, letra de 11px e vidro (K-B)", () => {
  it("a. o botão de ajuda do cabeçalho é um envoltório de 44px", () => {
    const botao = tagAntesDe(FONTE, "button", 'toggleHelp("global-guide")}');
    expect(botao).toContain("min-h-11");
    expect(botao).toContain("min-w-11");
    // o estado aberto/fechado passou para o círculo visível (o <span> interno)
    expect(botao).not.toContain("expandedHelp");
  });

  it("b. os campos do simulador (custo, preço, estoque) têm min-h-11", () => {
    for (const valor of ["simCost", "simPrice", "simStock"]) {
      const campo = tagAntesDe(FONTE, "input", `value={${valor}}`);
      expect(campo, valor).toContain("min-h-11");
    }
  });

  it("c. 'Resetar Simulador' tem 44px de altura e letra de 11px", () => {
    const botao = tagAntesDe(FONTE, "button", "Resetar Simulador");
    expect(botao).toContain("min-h-11");
    expect(botao).toContain("text-[11px]");
    expect(botao.match(TEXTO_MIUDO)).toBeNull();
    expect(FONTE).toContain("Resetar Simulador"); // o texto não muda
  });

  it("d. o arquivo todo não tem texto abaixo de 11px (aba Conceitos incluída)", () => {
    const sobras = [...FONTE.matchAll(TEXTO_MIUDO)].map((m) => {
      const linha = FONTE.slice(0, m.index).split("\n").length;
      return `${m[0]} (linha ${linha})`;
    });
    expect(sobras).toEqual([]);
  });

  it("e. nenhum literal com admin-glass carrega classe que ele apaga", () => {
    const literais: string[] = [];
    let desde = 0;
    for (;;) {
      const i = FONTE.indexOf("admin-glass", desde);
      if (i === -1) break;
      const inicio = Math.max(
        FONTE.lastIndexOf('"', i),
        FONTE.lastIndexOf("`", i),
      );
      const fimAspas = FONTE.indexOf('"', i);
      const fimCrase = FONTE.indexOf("`", i);
      const fim = [fimAspas, fimCrase]
        .filter((n) => n > -1)
        .sort((a, b) => a - b)[0];
      literais.push(FONTE.slice(inicio + 1, fim));
      desde = i + 1;
    }
    expect(literais.length).toBeGreaterThanOrEqual(5);

    for (const literal of literais) {
      expect(literal, literal).not.toMatch(/(?:^|\s)shadow-lg(?:\s|$)/);
      expect(literal, literal).not.toMatch(/(?:^|\s)shadow-\[/);
      expect(literal, literal).not.toMatch(/(?:^|\s)border-y(?:\s|$)/);
    }

    // o esqueleto segue com admin-glass (seletor `.admin-glass.animate-pulse`)
    expect(literais.filter((l) => l.includes("animate-pulse")).length).toBe(2);
  });
});
