// Guarda de jargão do painel, com TETO QUE SÓ DESCE.
//
// Varre src/views/admin/** e src/components/admin/**, ignora linha de
// comentário (`//`, `/*`, `*`, `{/*`) e conta, por arquivo, os termos técnicos
// que o glossário (src/lib/glossario-do-painel.ts) manda trocar. A contagem de
// cada arquivo tem que ser IGUAL ao teto de painel-sem-jargao.teto.json:
// passou do teto = termo novo (falha); ficou abaixo = o teto tem que descer
// junto (falha com "baixe o teto para N"), senão a folga vira licença para
// voltar. Arquivo ausente do teto = teto 0 (arquivo novo nasce limpo).
//
// Para baixar os tetos de uma vez:
//   ATUALIZAR_TETOS=1 npx vitest run tests/front/painel-sem-jargao.test.ts
// Esse modo só GRAVA valor <= teto atual; se algum arquivo passou do teto ele
// falha como sempre. Nunca sobe teto.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-non-literal-regexp, security/detect-object-injection --
   varredura da própria árvore do repositório (caminhos e padrões vêm do glossário e do disco, não de entrada de usuário) */
import {
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, sep } from "node:path";
import {
  GLOSSARIO_DO_PAINEL,
  padroesProibidosDoPainel,
  termoDoLojista,
} from "@/lib/glossario-do-painel";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const PASTAS_VARRIDAS = ["src/views/admin", "src/components/admin"];
const CAMINHO_DO_TETO = join(__dirname, "painel-sem-jargao.teto.json");

type Contagem = Record<string, number>;

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

const emOrdemDeCaminho = (c: Contagem): Contagem =>
  Object.fromEntries(
    Object.entries(c).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

/** Varredura: arquivos vistos e contagem (caminho com `/`) dos que têm > 0. */
function medirJargao(): { varridos: number; medido: Contagem } {
  const padroes = padroesProibidosDoPainel();
  const medido: Contagem = {};
  let varridos = 0;
  for (const pasta of PASTAS_VARRIDAS) {
    for (const arquivo of arquivosDe(join(RAIZ, pasta))) {
      varridos++;
      const total = contarOcorrencias(readFileSync(arquivo, "utf8"), padroes);
      if (total > 0) {
        medido[relative(RAIZ, arquivo).split(sep).join("/")] = total;
      }
    }
  }
  return { varridos, medido: emOrdemDeCaminho(medido) };
}

function lerTeto(caminho = CAMINHO_DO_TETO): Contagem {
  return JSON.parse(readFileSync(caminho, "utf8")) as Contagem;
}

/** Compara o medido com o teto: o que subiu e o que folgou. */
function compararComTeto(medido: Contagem, teto: Contagem) {
  const excedentes: string[] = [];
  const folgas: string[] = [];
  for (const arquivo of new Set([
    ...Object.keys(medido),
    ...Object.keys(teto),
  ])) {
    const atual = medido[arquivo] ?? 0;
    const limite = teto[arquivo] ?? 0;
    if (atual > limite) {
      excedentes.push(
        `${arquivo}: ${atual} termos técnicos (teto ${limite}, +${atual - limite})`,
      );
    } else if (atual < limite) {
      folgas.push(
        `${arquivo}: ${atual} termos técnicos e o teto é ${limite} — baixe o teto para ${atual}`,
      );
    }
  }
  return { excedentes: excedentes.sort(), folgas: folgas.sort() };
}

/** Regrava o JSON do teto com o medido; recusa (lança) se algo subiu. */
function gravarTeto(caminho: string, medido: Contagem): void {
  if (compararComTeto(medido, lerTeto(caminho)).excedentes.length > 0) {
    throw new Error("teto não sobe: arquivo passou do teto");
  }
  writeFileSync(
    caminho,
    `${JSON.stringify(emOrdemDeCaminho(medido), null, 2)}\n`,
  );
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

  it("conta `Leais` como palavra inteira", () => {
    expect(
      contarOcorrencias("<li>Campeões, Leais, Em risco</li>", padroes),
    ).toBe(3);
    expect(contarOcorrencias("const leaisDoMes = 1", padroes)).toBe(0);
  });
});

describe("comparação com o teto", () => {
  it("passou do teto = excedente; abaixo = folga com o número a gravar", () => {
    const r = compararComTeto(
      { "a.tsx": 3, "b.tsx": 1, "c.tsx": 2 },
      { "a.tsx": 2, "b.tsx": 3 },
    );
    expect(r.excedentes).toEqual([
      "a.tsx: 3 termos técnicos (teto 2, +1)",
      "c.tsx: 2 termos técnicos (teto 0, +2)",
    ]);
    expect(r.folgas).toEqual([
      "b.tsx: 1 termos técnicos e o teto é 3 — baixe o teto para 1",
    ]);
  });

  it("arquivo que zerou (some do medido) pede para baixar o teto a 0", () => {
    const r = compararComTeto({}, { "a.tsx": 2 });
    expect(r.folgas).toEqual([
      "a.tsx: 0 termos técnicos e o teto é 2 — baixe o teto para 0",
    ]);
  });

  it("igual ao teto não reclama de nada", () => {
    expect(compararComTeto({ "a.tsx": 2 }, { "a.tsx": 2 })).toEqual({
      excedentes: [],
      folgas: [],
    });
  });
});

describe("modo ATUALIZAR_TETOS", () => {
  function comArquivoDeTeto(conteudo: Contagem, fn: (caminho: string) => void) {
    const pasta = mkdtempSync(join(tmpdir(), "teto-jargao-"));
    const caminho = join(pasta, "teto.json");
    try {
      writeFileSync(caminho, JSON.stringify(conteudo));
      fn(caminho);
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  }

  it("grava o medido (mais baixo), em ordem de caminho, sem o arquivo zerado", () => {
    comArquivoDeTeto({ "b.tsx": 5, "a.tsx": 2, "c.tsx": 1 }, (caminho) => {
      gravarTeto(caminho, { "b.tsx": 3, "a.tsx": 2 });
      expect(readFileSync(caminho, "utf8")).toBe(
        `${JSON.stringify({ "a.tsx": 2, "b.tsx": 3 }, null, 2)}\n`,
      );
    });
  });

  it("nunca sobe: se algum arquivo passou do teto, recusa e não grava", () => {
    comArquivoDeTeto({ "a.tsx": 2 }, (caminho) => {
      expect(() => gravarTeto(caminho, { "a.tsx": 3 })).toThrow(/não sobe/);
      expect(() => gravarTeto(caminho, { "a.tsx": 1, "novo.tsx": 1 })).toThrow(
        /não sobe/,
      );
      expect(lerTeto(caminho)).toEqual({ "a.tsx": 2 });
    });
  });
});

describe("painel sem jargão (teto que só desce)", () => {
  it("a varredura acha arquivos (controle positivo)", () => {
    const { varridos, medido } = medirJargao();
    expect(varridos).toBeGreaterThan(50);
    expect(Object.keys(medido).length).toBeGreaterThan(0);
  });

  it("a contagem de cada arquivo é igual ao teto", () => {
    const { medido } = medirJargao();
    if (process.env.ATUALIZAR_TETOS === "1") {
      try {
        gravarTeto(CAMINHO_DO_TETO, medido);
      } catch {
        // Algum arquivo passou do teto: não grava; a comparação abaixo falha.
      }
    }
    const { excedentes, folgas } = compararComTeto(medido, lerTeto());
    expect(
      excedentes,
      "Termo técnico novo no painel. Troque pelo termo do lojista (src/lib/glossario-do-painel.ts).",
    ).toEqual([]);
    expect(
      folgas,
      "Menos jargão que o teto: baixe o teto (ATUALIZAR_TETOS=1 npx vitest run tests/front/painel-sem-jargao.test.ts).",
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
