// Guarda de jargão do painel, com TETO QUE SÓ DESCE.
//
// Varre src/views/admin/** e src/components/admin/**, ignora linha de
// comentário (`//`, `/*`, `*`, `{/*`) e conta, por arquivo, os termos técnicos
// que o glossário (src/lib/glossario-do-painel.ts) manda trocar. A contagem de
// cada arquivo não pode passar do teto de painel-sem-jargao.teto.json.
//
// Arquivo ausente do teto = teto 0 (arquivo novo nasce limpo). Quem trocar um
// termo e baixar a contagem baixa o teto daquele arquivo no .json; subir o
// teto é decisão do dono, nunca de quem está com pressa.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp, security/detect-object-injection --
   varredura da própria árvore do repositório (caminhos e padrões vêm do glossário e do disco, não de entrada de usuário) */
import {
  GLOSSARIO_DO_PAINEL,
  padroesProibidosDoPainel,
  termoDoLojista,
} from "@/lib/glossario-do-painel";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const PASTAS_VARRIDAS = ["src/views/admin", "src/components/admin"];

function arquivosDe(pasta: string): string[] {
  const achados: string[] = [];
  for (const nome of readdirSync(pasta)) {
    const caminho = join(pasta, nome);
    if (statSync(caminho).isDirectory()) achados.push(...arquivosDe(caminho));
    else if (/\.tsx?$/.test(nome)) achados.push(caminho);
  }
  return achados;
}

function ehLinhaDeComentario(linha: string): boolean {
  const limpa = linha.trim();
  return (
    limpa.startsWith("//") ||
    limpa.startsWith("/*") ||
    limpa.startsWith("*") ||
    limpa.startsWith("{/*")
  );
}

function contarOcorrencias(texto: string, padroes: readonly RegExp[]): number {
  let total = 0;
  for (const linha of texto.split("\n")) {
    if (ehLinhaDeComentario(linha)) continue;
    for (const padrao of padroes) {
      const global = new RegExp(padrao.source, `${padrao.flags}g`);
      total += linha.match(global)?.length ?? 0;
    }
  }
  return total;
}

/** Contagem por arquivo (caminho relativo, com `/`), só dos que têm > 0. */
function medirJargao(): Record<string, number> {
  const padroes = padroesProibidosDoPainel();
  const medido: Record<string, number> = {};
  for (const pasta of PASTAS_VARRIDAS) {
    for (const arquivo of arquivosDe(join(RAIZ, pasta))) {
      const total = contarOcorrencias(readFileSync(arquivo, "utf8"), padroes);
      if (total > 0) {
        medido[relative(RAIZ, arquivo).split(sep).join("/")] = total;
      }
    }
  }
  return Object.fromEntries(
    Object.entries(medido).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
}

function lerTeto(): Record<string, number> {
  return JSON.parse(
    readFileSync(join(__dirname, "painel-sem-jargao.teto.json"), "utf8"),
  ) as Record<string, number>;
}

describe("glossário do painel", () => {
  it("toda entrada tem termo técnico e termo do lojista", () => {
    for (const entrada of GLOSSARIO_DO_PAINEL) {
      expect(entrada.tecnico.trim()).not.toBe("");
      expect(entrada.lojista.trim()).not.toBe("");
    }
  });

  it("consulta o termo do lojista pelo técnico", () => {
    expect(termoDoLojista("Ticket médio")).toBe("Valor médio por venda");
    expect(termoDoLojista("DRE")).toBe("Resultado do mês");
    expect(termoDoLojista("termo que não existe")).toBeNull();
  });
});

describe("contagem de jargão", () => {
  const padroes = padroesProibidosDoPainel();

  it("ignora linha de comentário e conta o resto", () => {
    const texto = [
      "// Ticket médio no comentário não conta",
      "  * LTV no bloco de comentário não conta",
      "{/* DRE em comentário JSX não conta */}",
      '<h2>Ticket médio</h2> {"LTV"}',
    ].join("\n");
    expect(contarOcorrencias(texto, padroes)).toBe(2);
  });

  it("respeita caixa: `reviews` (variável) não é o rótulo `Reviews`", () => {
    expect(contarOcorrencias("const reviews = []", padroes)).toBe(0);
    expect(contarOcorrencias("<Tab>Reviews</Tab>", padroes)).toBe(1);
  });
});

describe("painel sem jargão (teto que só desce)", () => {
  it("nenhum arquivo passa do teto", () => {
    const medido = medirJargao();
    const teto = lerTeto();
    const excedentes = Object.entries(medido)
      .filter(([arquivo, total]) => total > (teto[arquivo] ?? 0))
      .map(
        ([arquivo, total]) =>
          `${arquivo}: ${total} termos técnicos (teto ${teto[arquivo] ?? 0}, +${total - (teto[arquivo] ?? 0)})`,
      );
    expect(
      excedentes,
      "Termo técnico novo no painel. Troque pelo termo do lojista (src/lib/glossario-do-painel.ts).",
    ).toEqual([]);
  });

  it("o teto está em ordem de caminho e não tem número inválido", () => {
    const chaves = Object.keys(lerTeto());
    expect(chaves).toEqual([...chaves].sort());
    for (const valor of Object.values(lerTeto())) {
      expect(Number.isInteger(valor) && valor > 0).toBe(true);
    }
  });
});
