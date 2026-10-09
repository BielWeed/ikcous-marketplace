// Régua visual do painel, com TETO QUE SÓ DESCE (spec "Painel simples", §7).
//
// Varre src/views/admin/** e src/components/admin/** e conta, por arquivo:
//   - cores literais fora do tema: #09090b (use `bg-admin-bg`) e os três
//     ouros #FFBF00, #e3c25e, #e2c04a (use `admin-gold`);
//   - texto menor que 11px: text-[6px] … text-[10.5px];
//   - `fixed inset-0` numa tag sem role="dialog" (camada de tela cheia que o
//     leitor de tela não anuncia como diálogo). Não contam: o `<X.Overlay>` do
//     Radix (o role="dialog" nasce no Content, e pô-lo no Overlay faria o
//     leitor de tela anunciar dois diálogos) e o fundo decorativo com
//     `pointer-events-none` (não é camada interativa).
// Linha de comentário não conta (só a linha inteira; comentário no fim de uma
// linha de código conta como código). A soma de cada arquivo tem que ser IGUAL
// ao teto de regua-visual-do-painel.json: passou = falha; abaixo = falha com
// "baixe o teto para N", senão a folga vira licença para voltar. Arquivo
// ausente do teto = teto 0 (arquivo novo nasce limpo).
//
// Para baixar os tetos de uma vez:
//   ATUALIZAR_TETOS=1 npx vitest run tests/front/regua-visual-do-painel.test.ts
// Esse modo só GRAVA valor <= teto atual; se algum arquivo passou do teto ele
// falha como sempre. Nunca sobe teto.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-unsafe-regex --
   varredura da própria árvore do repositório (caminhos vêm do disco, não de entrada de usuário); regex constantes, testadas abaixo */
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
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const PASTAS_VARRIDAS = ["src/views/admin", "src/components/admin"];
const CAMINHO_DO_TETO = join(__dirname, "regua-visual-do-painel.json");

type Contagem = Record<string, number>;

const PADROES_SIMPLES = {
  "cor literal": /#09090b|#FFBF00|#e3c25e|#e2c04a/gi,
  "texto < 11px": /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g,
} as const;

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

/** Troca a linha de comentário por linha vazia (os índices do resto ficam). */
function semComentarios(texto: string): string {
  return texto
    .split("\n")
    .map((linha) => (ehLinhaDeComentario(linha) ? "" : linha))
    .join("\n");
}

/** A tag JSX que contém a posição `indice` (de `<` até o `>` fora de `{}`). */
function tagQueContem(texto: string, indice: number): string {
  const inicio = texto.lastIndexOf("<", indice);
  if (inicio === -1) return "";
  let profundidade = 0;
  for (let i = inicio + 1; i < texto.length; i++) {
    const c = texto[i];
    if (c === "{") profundidade++;
    else if (c === "}") profundidade--;
    else if (c === ">" && profundidade <= 0 && texto[i - 1] !== "=") {
      return texto.slice(inicio, i + 1);
    }
  }
  return texto.slice(inicio);
}

const TEM_ROLE_DIALOG = /role=(?:\{\s*)?["']dialog["']/;
/** `<DialogPrimitive.Overlay …>`: o Overlay do Radix. */
const ABRE_OVERLAY_DO_RADIX = /^<\w+\.Overlay\b/;
const FUNDO_DECORATIVO = /pointer-events-none/;

function contarFixedSemDialog(texto: string): number {
  let total = 0;
  for (const achado of texto.matchAll(/fixed inset-0/g)) {
    const tag = tagQueContem(texto, achado.index ?? 0);
    if (
      TEM_ROLE_DIALOG.test(tag) ||
      ABRE_OVERLAY_DO_RADIX.test(tag) ||
      FUNDO_DECORATIVO.test(tag)
    ) {
      continue;
    }
    total++;
  }
  return total;
}

/** Contagem de cada regra para um texto de arquivo. */
function contarRegua(textoBruto: string): Contagem {
  const texto = semComentarios(textoBruto);
  const contagem: Contagem = {};
  for (const [nome, padrao] of Object.entries(PADROES_SIMPLES)) {
    contagem[nome] = texto.match(padrao)?.length ?? 0;
  }
  contagem["fixed inset-0 sem role=dialog"] = contarFixedSemDialog(texto);
  return contagem;
}

const somar = (contagem: Contagem) =>
  Object.values(contagem).reduce((a, b) => a + b, 0);

const emOrdemDeCaminho = (c: Contagem): Contagem =>
  Object.fromEntries(
    Object.entries(c).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );

/** Varredura: arquivos vistos e, dos que têm > 0, o detalhe de cada regra. */
function medirRegua(): {
  varridos: number;
  detalhe: Record<string, Contagem>;
  medido: Contagem;
} {
  const detalhe: Record<string, Contagem> = {};
  const medido: Contagem = {};
  let varridos = 0;
  for (const pasta of PASTAS_VARRIDAS) {
    for (const arquivo of arquivosDe(join(RAIZ, pasta))) {
      varridos++;
      const contagem = contarRegua(readFileSync(arquivo, "utf8"));
      const total = somar(contagem);
      if (total > 0) {
        const caminho = relative(RAIZ, arquivo).split(sep).join("/");
        detalhe[caminho] = contagem;
        medido[caminho] = total;
      }
    }
  }
  return { varridos, detalhe, medido: emOrdemDeCaminho(medido) };
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
        `${arquivo}: ${atual} ocorrências (teto ${limite}, +${atual - limite})`,
      );
    } else if (atual < limite) {
      folgas.push(
        `${arquivo}: ${atual} ocorrências e o teto é ${limite} — baixe o teto para ${atual}`,
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

describe("contagem da régua visual", () => {
  it("conta as quatro cores literais, sem ligar para a caixa", () => {
    const c = contarRegua(
      '<div className="bg-[#09090b] text-[#ffbf00] border-[#E3C25E]" style={{ color: "#e2c04a" }} />',
    );
    expect(c["cor literal"]).toBe(4);
  });

  it("conta texto de 6px a 10.5px e deixa passar 11px", () => {
    const c = contarRegua(
      '<i className="text-[6px] text-[9px] text-[10px] text-[10.5px] text-[11px] text-[12px]" />',
    );
    expect(c["texto < 11px"]).toBe(4);
  });

  it("`fixed inset-0` com role=dialog na mesma tag não conta", () => {
    const limpo = contarRegua(
      '<div role="dialog" aria-modal="true" className="fixed inset-0 z-50" />',
    );
    expect(limpo["fixed inset-0 sem role=dialog"]).toBe(0);
    const sujo = contarRegua(
      '<div className="fixed inset-0 z-50"><div role="dialog" /></div>',
    );
    expect(sujo["fixed inset-0 sem role=dialog"]).toBe(1);
  });

  it("o Overlay do Radix (`<X.Overlay>`) não conta: o dialog nasce no Content", () => {
    const c = contarRegua(
      '<DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60" />',
    );
    expect(c["fixed inset-0 sem role=dialog"]).toBe(0);
    // Um <div> comum que só se chama "overlay" continua contando.
    const falso = contarRegua('<div className="overlay fixed inset-0 z-50" />');
    expect(falso["fixed inset-0 sem role=dialog"]).toBe(1);
  });

  it("fundo decorativo com pointer-events-none não conta", () => {
    const c = contarRegua(
      '<div className="pointer-events-none fixed inset-0 z-[-1] overflow-hidden">',
    );
    expect(c["fixed inset-0 sem role=dialog"]).toBe(0);
    // Sem pointer-events-none a camada pode capturar toque: conta.
    const camada = contarRegua('<div className="fixed inset-0 z-[-1]">');
    expect(camada["fixed inset-0 sem role=dialog"]).toBe(1);
  });

  it("ignora linha de comentário", () => {
    const c = contarRegua(
      [
        "// bg-[#09090b] text-[9px] no comentário não contam",
        "  * #FFBF00 no bloco de comentário não conta",
        "{/* fixed inset-0 em comentário JSX não conta */}",
      ].join("\n"),
    );
    expect(somar(c)).toBe(0);
  });
});

describe("comparação com o teto", () => {
  it("passou do teto = excedente; abaixo = folga com o número a gravar", () => {
    const r = compararComTeto(
      { "a.tsx": 3, "b.tsx": 1, "c.tsx": 2 },
      { "a.tsx": 2, "b.tsx": 3 },
    );
    expect(r.excedentes).toEqual([
      "a.tsx: 3 ocorrências (teto 2, +1)",
      "c.tsx: 2 ocorrências (teto 0, +2)",
    ]);
    expect(r.folgas).toEqual([
      "b.tsx: 1 ocorrências e o teto é 3 — baixe o teto para 1",
    ]);
  });

  it("arquivo que zerou (some do medido) pede para baixar o teto a 0", () => {
    const r = compararComTeto({}, { "a.tsx": 2 });
    expect(r.folgas).toEqual([
      "a.tsx: 0 ocorrências e o teto é 2 — baixe o teto para 0",
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
    const pasta = mkdtempSync(join(tmpdir(), "teto-regua-"));
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

describe("régua visual do painel (teto que só desce)", () => {
  it("a varredura acha arquivos (controle positivo)", () => {
    const { varridos, medido } = medirRegua();
    expect(varridos).toBeGreaterThan(50);
    expect(Object.keys(medido).length).toBeGreaterThan(0);
  });

  it("a contagem de cada arquivo é igual ao teto", () => {
    const { medido, detalhe } = medirRegua();
    if (process.env.ATUALIZAR_TETOS === "1") {
      try {
        gravarTeto(CAMINHO_DO_TETO, medido);
      } catch {
        // Algum arquivo passou do teto: não grava; a comparação abaixo falha.
      }
    }
    const { excedentes, folgas } = compararComTeto(medido, lerTeto());
    const comDetalhe = excedentes.map((linha) => {
      const arquivo = linha.slice(0, linha.indexOf(":"));
      const partes = Object.entries(detalhe[arquivo] ?? {})
        .filter(([, n]) => n > 0)
        .map(([nome, n]) => `${nome}: ${n}`)
        .join("; ");
      return `${linha} [${partes}]`;
    });
    expect(
      comDetalhe,
      'Régua visual estourou. Use bg-admin-bg / admin-gold e texto de 11px para cima. Camada `fixed inset-0` que é diálogo de verdade leva role="dialog" (no Radix o Content já traz; não ponha no Overlay); fundo decorativo leva pointer-events-none.',
    ).toEqual([]);
    expect(
      folgas,
      "Menos ocorrências que o teto: baixe o teto (ATUALIZAR_TETOS=1 npx vitest run tests/front/regua-visual-do-painel.test.ts).",
    ).toEqual([]);
  });

  it("o teto está em ordem de caminho e não tem número inválido", () => {
    const teto = lerTeto();
    const chaves = Object.keys(teto);
    expect(chaves).toEqual([...chaves].sort());
    for (const valor of Object.values(teto)) {
      expect(Number.isInteger(valor) && valor > 0).toBe(true);
    }
  });
});
