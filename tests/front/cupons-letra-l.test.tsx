// Onda L · frente "cupons" — prova ESTÁTICA (lê o fonte; o jsdom não aplica CSS,
// então a medida de verdade, com a pílula e os selos já crescidos, é a do render).
//
//  (a) A lista e o formulário de cupons não têm texto abaixo de 11px (a régua do
//      painel: `text-[6px]` … `text-[10.5px]`), fora de comentário.
//  (b) A pílula "Ativo/Inativo" do bilhete (era 6px), os rótulos "Desconto" e
//      "Mínimo Compra" do bilhete (7px) e o selo de status da lista (8px) sobem
//      para 11px trocando o espaçamento de letras `tracking-widest` por
//      `tracking-wider`, para a caixa crescer sem estourar.
//  (c) O que NÃO muda: a altura h-11 dos botões "Cancelar" e "Salvar".
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex --
   lê arquivos-fonte do próprio repositório (caminhos constantes deste teste, não entrada de usuário); regex constantes, sem backtracking sobre entrada externa */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const RAIZ = join(__dirname, "..", "..");

const FORMULARIO = "src/views/admin/AdminCouponFormView.tsx";
const LISTA = "src/views/admin/AdminCouponsView.tsx";

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

// Mesma regex da régua visual do painel (`regua-visual-do-painel.test.ts`).
const TEXTO_PEQUENO = /text-\[(?:[6-9]|10)(?:\.\d+)?px\]/g;

/** As linhas do fonte (sem comentário) que contêm `trecho`. */
function linhasCom(fonte: string, trecho: string): string[] {
  return semComentarios(fonte)
    .split("\n")
    .filter((linha) => linha.includes(trecho));
}

describe("cupons — sem texto abaixo de 11px", () => {
  it("o auxiliar acha o texto pequeno (não é teste vácuo)", () => {
    const amostra = '<p className="text-[6px] md:text-[9.5px] text-[11px]">';
    expect(amostra.match(TEXTO_PEQUENO)).toEqual([
      "text-[6px]",
      "text-[9.5px]",
    ]);
  });

  for (const arquivo of [FORMULARIO, LISTA]) {
    it(`${arquivo} não tem text-[<11px]`, () => {
      const achados = semComentarios(ler(arquivo)).match(TEXTO_PEQUENO) ?? [];
      expect(achados).toEqual([]);
    });
  }
});

describe("cupons — pílula e selos do bilhete crescem sem estourar", () => {
  it("a pílula Ativo/Inativo da prévia é 11px com tracking-wider", () => {
    const [pilula, ...resto] = linhasCom(
      ler(FORMULARIO),
      "flex items-center gap-1 rounded-full border px-2 py-0.5",
    );
    expect(resto).toEqual([]);
    expect(pilula).toBeDefined();
    expect(pilula).toMatch(/\btext-\[11px\]/);
    expect(pilula).toMatch(/\btracking-wider\b/);
    expect(pilula).not.toMatch(/\btracking-widest\b/);
  });

  it('os rótulos "Desconto" e "Mínimo Compra" do bilhete são 11px com tracking-wider', () => {
    const fonte = semComentarios(ler(FORMULARIO));
    const rotulos = [
      /<p className="([^"]*)">\s*Desconto\s*<\/p>/,
      /<p className="([^"]*)">\s*Mínimo Compra\s*<\/p>/,
    ];
    for (const padrao of rotulos) {
      const m = padrao.exec(fonte);
      expect(m, `rótulo ${padrao} do bilhete`).not.toBeNull();
      const classes = m?.[1] ?? "";
      expect(classes).toMatch(/\btext-\[11px\]/);
      expect(classes).toMatch(/\btracking-wider\b/);
      expect(classes).not.toMatch(/\btracking-widest\b/);
    }
  });

  it("texto de 11px não fica com leading-none (o aviso do modo offline quebra em 2 linhas)", () => {
    const coladas = semComentarios(ler(FORMULARIO))
      .split("\n")
      .filter((l) => /\btext-\[11px\]/.test(l) && /\bleading-none\b/.test(l));
    expect(coladas).toEqual([]);
  });

  it("o selo de status da lista é 11px com tracking-wider", () => {
    const [selo, ...resto] = linhasCom(ler(LISTA), "classesDoSeloPorRotulo[");
    const alvo = [selo, ...resto].filter((l) => l.includes("className="));
    expect(alvo).toHaveLength(1);
    expect(alvo[0]).toMatch(/\btext-\[11px\]/);
    expect(alvo[0]).toMatch(/\btracking-wider\b/);
    expect(alvo[0]).not.toMatch(/\btracking-widest\b/);
  });
});

describe("cupons — o que não muda", () => {
  it('os botões "Cancelar" e "Salvar" do formulário continuam h-11', () => {
    const botoes = linhasCom(ler(FORMULARIO), 'className="h-11 flex-');
    expect(botoes).toHaveLength(2);
    for (const linha of botoes) {
      expect(linha).toMatch(/\bh-11\b/);
      expect(linha).toMatch(/\btext-\[11px\]/);
    }
  });
});
