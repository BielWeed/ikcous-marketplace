// Régua visual do painel, com TETO QUE SÓ DESCE (spec "Painel simples", §7).
//
// Varre src/views/admin/** e src/components/admin/** e conta, por arquivo:
//   - cores literais fora do tema: #09090b (use `bg-admin-bg`) e os três
//     ouros #FFBF00, #e3c25e, #e2c04a (use `admin-gold`);
//   - texto menor que 11px: text-[6px] … text-[10.5px];
//   - `fixed inset-0` numa tag sem role="dialog" (camada de tela cheia que o
//     leitor de tela não anuncia como diálogo).
// Linha de comentário não conta. A soma de cada arquivo não pode passar do
// teto de regua-visual-do-painel.json; arquivo ausente do teto = teto 0
// (arquivo novo nasce limpo). Quem consertar uma ocorrência baixa o teto
// daquele arquivo; subir o teto é decisão do dono.
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-object-injection, security/detect-unsafe-regex --
   varredura da própria árvore do repositório (caminhos vêm do disco, não de entrada de usuário); regex constantes, testadas abaixo */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");
const PASTAS_VARRIDAS = ["src/views/admin", "src/components/admin"];

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

function contarFixedSemDialog(texto: string): number {
  let total = 0;
  for (const achado of texto.matchAll(/fixed inset-0/g)) {
    if (!TEM_ROLE_DIALOG.test(tagQueContem(texto, achado.index ?? 0))) total++;
  }
  return total;
}

/** Contagem de cada regra para um texto de arquivo. */
function contarRegua(textoBruto: string): Record<string, number> {
  const texto = semComentarios(textoBruto);
  const contagem: Record<string, number> = {};
  for (const [nome, padrao] of Object.entries(PADROES_SIMPLES)) {
    contagem[nome] = texto.match(padrao)?.length ?? 0;
  }
  contagem["fixed inset-0 sem role=dialog"] = contarFixedSemDialog(texto);
  return contagem;
}

const somar = (contagem: Record<string, number>) =>
  Object.values(contagem).reduce((a, b) => a + b, 0);

/** Por arquivo (caminho relativo, com `/`): detalhe de cada regra, se > 0. */
function medirRegua(): Record<string, Record<string, number>> {
  const medido: Record<string, Record<string, number>> = {};
  for (const pasta of PASTAS_VARRIDAS) {
    for (const arquivo of arquivosDe(join(RAIZ, pasta))) {
      const contagem = contarRegua(readFileSync(arquivo, "utf8"));
      if (somar(contagem) > 0) {
        medido[relative(RAIZ, arquivo).split(sep).join("/")] = contagem;
      }
    }
  }
  return medido;
}

function lerTeto(): Record<string, number> {
  return JSON.parse(
    readFileSync(join(__dirname, "regua-visual-do-painel.json"), "utf8"),
  ) as Record<string, number>;
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

describe("régua visual do painel (teto que só desce)", () => {
  it("nenhum arquivo passa do teto", () => {
    const teto = lerTeto();
    const excedentes = Object.entries(medirRegua())
      .filter(([arquivo, c]) => somar(c) > (teto[arquivo] ?? 0))
      .map(([arquivo, c]) => {
        const limite = teto[arquivo] ?? 0;
        const detalhe = Object.entries(c)
          .filter(([, n]) => n > 0)
          .map(([nome, n]) => `${nome}: ${n}`)
          .join("; ");
        return `${arquivo}: ${somar(c)} ocorrências (teto ${limite}, +${somar(c) - limite}) [${detalhe}]`;
      });
    expect(
      excedentes,
      'Régua visual estourou. Use bg-admin-bg / admin-gold, texto de 11px para cima e role="dialog" nas camadas de tela cheia.',
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
