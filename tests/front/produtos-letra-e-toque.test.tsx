// Painel simples, onda K, frente K-B (B1-B3) — Produtos: toque de 44px, letra
// de 11px e vidro sem classe que perde.
//
// A lojista usa a lista de Produtos e o guia de ajuda no celular. O render da
// onda J2 mediu o botão "?" com 32px, os campos do simulador com ~36px, o
// "Resetar Simulador" com 24px e rótulos de 8-10px. O jsdom não aplica CSS, então
// a prova é sobre a classe escrita no arquivo (a medida real é do render do
// integrador):
//   a. os acessos discretos ao guia e aos valores mantêm altura mínima
//      de 44px, sem o antigo botão de largura completa;
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
const CSS = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "src/components/admin/products/catalogo-produtos.css",
  ),
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
  it("a foto quadrada tem reserva maior e o esqueleto acompanha a grade", () => {
    const altura = CSS.match(/--produto-altura-compacto:\s*(\d+)px/)?.[1];
    expect(Number(altura)).toBeGreaterThanOrEqual(360);
    expect(CSS).toContain(
      "contain-intrinsic-size: auto var(--produto-altura-compacto)",
    );
    expect(CSS).toMatch(
      /\.produto-esqueleto\.overflow-hidden\s*\{\s*min-height: var\(--produto-altura-compacto\)/,
    );
    expect(CSS).toMatch(
      /\.produto-esqueleto\.overflow-hidden > :first-child\s*\{\s*height: auto;\s*aspect-ratio: 1;/,
    );
  });

  it("Fechar faz parte dos itens navegáveis do menu do produto", () => {
    const fechar = tagAntesDe(FONTE, "DropdownMenuItem", "setAberto(false)");
    expect(fechar).toContain("onClick={() => setAberto(false)}");
    expect(fechar).toContain("produto-secundario");
  });

  it("a. o acesso único ao guia e simulador mantém uma área de toque de 44px", () => {
    const botao = tagAntesDe(FONTE, "button", 'toggleHelp("global-guide")}');
    const metricas = readFileSync(
      join(__dirname, "..", "..", "src/components/admin/MetricasDoPainel.tsx"),
      "utf8",
    );
    const valores = tagAntesDe(
      metricas,
      "button",
      'aria-label="Entender valores"',
    );
    expect(FONTE).toContain(
      'onEntender={() => toggleHelp("financial-values")}',
    );
    expect(botao).toContain("min-h-11");
    expect(botao).toContain("text-xs");
    expect(botao).toContain("focus-visible:outline");
    expect(botao).not.toContain("w-full");
    expect(metricas).toContain("min-h-11 min-w-11");
    expect(metricas).toContain("text-xs font-semibold");
    expect(metricas).toContain("focus-visible:outline");
    expect(valores).toContain("size-11");
    expect(FONTE.match(/aria-label="Guia e simulador"/g)).toHaveLength(1);
    expect(botao).not.toContain("expandedHelp");
    expect(valores).toContain('aria-haspopup="dialog"');
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

  it("f. rótulos de métrica sem cinza 600/700 (contraste mínimo zinc-400)", () => {
    // rótulos uppercase miúdos que carregam informação: cartão de detalhe,
    // "Fórmula/Exemplo/Regra" do guia e especificações do estoque
    expect(FONTE).not.toMatch(/uppercase[^"]*text-zinc-[67]00/);
    expect(FONTE).not.toMatch(/text-zinc-[67]00[^"]*uppercase/);
  });

  it("e. cartões usam superfícies próprias e os dois modos têm esqueleto", () => {
    expect(FONTE).not.toContain("admin-glass");
    const cartoes = [...FONTE.matchAll(/"produto-cartao[^"\n]*"/g)].map(
      (m) => m[0],
    );
    expect(cartoes).toHaveLength(2);
    for (const cartao of cartoes) {
      expect(cartao).toContain("bg-admin-surface");
      expect(cartao).toContain("border-admin-border");
      expect(cartao).not.toMatch(/shadow-lg|shadow-\[|border-y/);
    }
    expect(FONTE.match(/produto-esqueleto/g)).toHaveLength(2);
    expect(FONTE.match(/produto-esqueleto[^"\n]*animate-pulse/g)).toHaveLength(
      2,
    );
  });
});
