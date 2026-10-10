// Onda L · frente "banners" — prova ESTÁTICA (lê o fonte; o jsdom não aplica CSS,
// então a medida de verdade — nenhuma caixa estourando a 360px — é a do render).
//
// A tela de Banners não tem texto abaixo de 11px (a régua do painel:
// `text-[6px]` … `text-[10.5px]`), com UMA exceção deliberada: são desenhos de
// outra tela, em escala reduzida, e subir a letra distorce a proporção:
//   (1) a pré-visualização ao vivo do banner (entre o comentário "CARD SUPERIOR…"
//       e o "Draft Recovery Alert");
//   (2) as miniaturas de celular do seletor de posição (do título "Posição de
//       Exibição" até o comentário "Navigation mock"), uma no modo simples e
//       outra no Passo 1.
// Elas continuam contadas pela régua: 16 ocorrências no total.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-unsafe-regex --
   lê o fonte do próprio repositório (caminho constante deste teste, não entrada de usuário); regex constantes, sem backtracking sobre entrada externa; os índices são de arrays locais do próprio teste */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const ARQUIVO = "src/views/admin/AdminBannersView.tsx";
// Mesma expressão da régua visual do painel.
const LETRA_MIUDA = /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g;

const fonte = readFileSync(join(RAIZ, ARQUIVO), "utf8");
const linhas = fonte.split("\n");

type Faixa = { inicio: number; fim: number };

/** Índices (0-based, fim exclusivo) das linhas entre dois marcadores textuais. */
function faixas(marcadorInicio: string, marcadorFim: string): Faixa[] {
  const achadas: Faixa[] = [];
  let i = 0;
  while (i < linhas.length) {
    if (linhas[i].includes(marcadorInicio)) {
      let fim = i + 1;
      while (fim < linhas.length && !linhas[fim].includes(marcadorFim)) fim++;
      achadas.push({ inicio: i, fim });
      i = fim;
    } else {
      i++;
    }
  }
  return achadas;
}

const PREVIA = faixas(
  "CARD SUPERIOR: PAINEL DE PRÉ-VISUALIZAÇÃO AO VIVO",
  "Draft Recovery Alert",
);
const MINIATURAS = faixas("Posição de Exibição", "Navigation mock");
const ISENTAS = [...PREVIA, ...MINIATURAS];

function dentroDeIsenta(indice: number): boolean {
  return ISENTAS.some((f) => indice >= f.inicio && indice < f.fim);
}

function ocorrencias(): { linha: number; trecho: string }[] {
  const achadas: { linha: number; trecho: string }[] = [];
  linhas.forEach((texto, indice) => {
    for (const m of texto.matchAll(LETRA_MIUDA)) {
      achadas.push({ linha: indice + 1, trecho: m[0] });
    }
  });
  return achadas;
}

describe("Banners · letra mínima de 11px (onda L)", () => {
  it("acha a pré-visualização e as duas miniaturas (os marcadores existem)", () => {
    expect(PREVIA).toHaveLength(1);
    expect(MINIATURAS).toHaveLength(2);
  });

  it("fora da pré-visualização e das miniaturas, nenhum texto abaixo de 11px", () => {
    const sobras = ocorrencias().filter((o) => !dentroDeIsenta(o.linha - 1));
    expect(sobras.map((o) => `${o.linha}: ${o.trecho}`)).toEqual([]);
  });

  it("a pré-visualização e as miniaturas seguem como estavam (16 ocorrências, o que a régua ainda conta)", () => {
    const dentro = ocorrencias().filter((o) => dentroDeIsenta(o.linha - 1));
    expect(dentro).toHaveLength(16);
    expect(ocorrencias()).toHaveLength(16);
  });
});
