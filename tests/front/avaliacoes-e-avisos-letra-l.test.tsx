// Onda L · frente "avaliacoes-e-notificacoes" — prova ESTÁTICA (lê o fonte; o
// jsdom não aplica CSS, então o encaixe real das pílulas a 360px é do render).
//
//  (a) Avaliações e Avisos não têm texto abaixo de 11px (a régua do painel:
//      `text-[6px]` … `text-[10.5px]`, inclusive com prefixo `sm:`), fora de comentário.
//  (b) Onde a mesma tag junta `uppercase` e `tracking-widest` numa caixa que não
//      pode crescer (`whitespace-nowrap`, `truncate`, `leading-none`), o rastro
//      aperta para `tracking-wider`: texto maior com o mesmo espaçamento estoura.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex --
   lê arquivos-fonte do próprio repositório (caminhos constantes deste teste, não entrada de usuário); regex constantes, sem backtracking sobre entrada externa */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

const TELAS = [
  "src/views/admin/AdminReviewsView.tsx",
  "src/views/admin/AdminNotificationsView.tsx",
] as const;

const PEQUENO = /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g;

function ler(caminho: string): string {
  return readFileSync(join(RAIZ, caminho), "utf8");
}

function semComentarios(fonte: string): string {
  return fonte
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((linha) => !linha.trim().startsWith("//"))
    .join("\n");
}

/** Linhas (sem comentário) que casam `marcador` — o teste só vale se achar o elemento. */
function linhasCom(fonte: string, marcador: RegExp): string[] {
  return semComentarios(fonte)
    .split("\n")
    .filter((linha) => marcador.test(linha));
}

describe("Avaliações e Avisos sem texto abaixo de 11px", () => {
  for (const arquivo of TELAS) {
    it(`${arquivo}: nenhum text-[6px … 10.5px] fora de comentário`, () => {
      const pequenos = semComentarios(ler(arquivo)).match(PEQUENO);
      expect(pequenos ?? []).toEqual([]);
    });
  }

  it("o auxiliar enxerga o texto pequeno (não é vácuo)", () => {
    const fonte = `<span className="text-[9px] sm:text-[10px]">a</span>\n// text-[8px]\n<b className="text-[11px]">b</b>`;
    expect(semComentarios(fonte).match(PEQUENO)).toEqual([
      "text-[9px]",
      "text-[10px]",
    ]);
  });
});

describe("Avaliações: abas, pílulas e rótulos continuam cabendo", () => {
  const fonte = ler("src/views/admin/AdminReviewsView.tsx");

  it("as abas e filtros `whitespace-nowrap` têm 11px e rastro `tracking-wider`", () => {
    const abas = linhasCom(fonte, /whitespace-nowrap rounded-lg .*uppercase/);
    expect(abas.length).toBeGreaterThanOrEqual(2);
    for (const linha of abas) {
      expect(linha).toContain("text-[11px]");
      expect(linha).not.toContain("tracking-widest");
    }
  });

  it("o rótulo `leading-none` do cartão tem 11px e rastro `tracking-wider`", () => {
    const rotulos = linhasCom(fonte, /uppercase leading-none/);
    expect(rotulos.length).toBeGreaterThanOrEqual(1);
    for (const linha of rotulos) {
      expect(linha).toContain("text-[11px]");
      expect(linha).not.toContain("tracking-widest");
    }
  });

  it("a pílula `truncate` e o texto `line-clamp-2` têm 11px", () => {
    const pilula = linhasCom(fonte, /items-center gap-1 truncate rounded-full/);
    const citacao = linhasCom(fonte, /line-clamp-2 text-/);
    expect(pilula).toHaveLength(1);
    expect(citacao).toHaveLength(1);
    expect(pilula[0]).toContain("text-[11px]");
    expect(citacao[0]).toContain("text-[11px]");
  });
});

describe("Avisos: o rótulo `leading-none` com `max-w` não estoura", () => {
  const fonte = ler("src/views/admin/AdminNotificationsView.tsx");

  it("o rótulo do cartão tem 11px e rastro `tracking-wider`", () => {
    const rotulos = linhasCom(fonte, /block text-.*uppercase leading-none/);
    expect(rotulos).toHaveLength(1);
    expect(rotulos[0]).toContain("text-[11px]");
    expect(rotulos[0]).not.toContain("tracking-widest");
  });
});
