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
/* eslint-disable security/detect-non-literal-fs-filename, security/detect-unsafe-regex, security/detect-non-literal-regexp --
   lê arquivos-fonte do próprio repositório (caminhos constantes deste teste, não entrada de usuário); regex constantes (os rótulos interpolados são literais fixos do próprio teste), sem backtracking sobre entrada externa */
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

// Redesenho de 10/10/2026 — as mini-caixas do bilhete na LISTA seguem o desenho
// do cartão de métrica (KpiCard): casca com brilho no topo, rótulo em frase
// normal 12px cinza 300 (não mais "uppercase miúdo cinza 500") e valor branco
// tabular. Só visual: os textos "Desconto", "Mínimo Compra", "Aproveitamento"
// e "Expira em:" continuam os mesmos.
describe("cupons — mini-caixas do bilhete no desenho novo do cartão de métrica", () => {
  const fonte = semComentarios(ler(LISTA));

  for (const rotulo of ["Desconto", "Mínimo Compra", "Aproveitamento"]) {
    it(`o rótulo "${rotulo}" é 12px semibold cinza 300, sem uppercase`, () => {
      const m = new RegExp(
        `<(?:p|span) className="([^"]*)">\\s*${rotulo}\\s*</(?:p|span)>`,
      ).exec(fonte);
      expect(m, `rótulo ${rotulo}`).not.toBeNull();
      const classes = m?.[1] ?? "";
      expect(classes).toMatch(/\btext-xs\b/);
      expect(classes).toMatch(/\bfont-semibold\b/);
      expect(classes).toMatch(/\btext-zinc-300\b/);
      expect(classes).not.toMatch(/\buppercase\b/);
    });
  }

  it("as caixas Desconto e Mínimo Compra têm a casca do KpiCard", () => {
    // Ancorado nos rótulos: o <div> que abre logo antes de cada um.
    for (const rotulo of ["Desconto", "Mínimo Compra"]) {
      const posRotulo = fonte.search(
        new RegExp(`<p className="[^"]*">\\s*${rotulo}\\s*</p>`),
      );
      expect(posRotulo, `rótulo ${rotulo}`).toBeGreaterThan(-1);
      const caixa = fonte.slice(
        fonte.lastIndexOf("<div", posRotulo),
        posRotulo,
      );
      expect(caixa).toMatch(/\brounded-2xl\b/);
      expect(caixa).toMatch(/\bborder-white\/10\b/);
      expect(caixa).toMatch(/\bbg-gradient-to-b\b/);
      expect(caixa).toMatch(/\bfrom-white\/\[0\.06\]/);
      expect(caixa).toMatch(/\bmin-w-0\b/);
    }
  });

  it("o dinheiro das caixas nunca parte no meio do número (whitespace-nowrap, 18px)", () => {
    for (const ancora of ["% OFF`", "formatCurrency(coupon.minPurchase"]) {
      const antes = fonte.slice(0, fonte.indexOf(ancora));
      const abertura = antes.slice(antes.lastIndexOf('<p className="'));
      const classes = /^<p className="([^"]*)"/.exec(abertura)?.[1] ?? "";
      expect(classes, ancora).toMatch(/\bwhitespace-nowrap\b/);
      expect(classes, ancora).toMatch(/\btext-lg\b/);
      expect(classes, ancora).not.toMatch(/\bbreak-words\b/);
      expect(classes, ancora).not.toMatch(/\btext-(?:xl|2xl|3xl)\b/);
    }
  });

  it("o valor do mínimo é branco e tabular (era cinza 400)", () => {
    // O <p> que abre logo antes de `formatCurrency(coupon.minPurchase`.
    const antes = fonte.slice(
      0,
      fonte.indexOf("formatCurrency(coupon.minPurchase"),
    );
    const abertura = antes.slice(antes.lastIndexOf('<p className="'));
    const classes = /^<p className="([^"]*)"/.exec(abertura)?.[1] ?? "";
    expect(classes).toMatch(/\btext-white\b/);
    expect(classes).toMatch(/\btabular-nums\b/);
    expect(classes).not.toMatch(/\btext-zinc-400\b/);
  });

  it('"Expira em:" e o contador de usos não usam cinza 500/600', () => {
    const bloco = fonte.slice(
      fonte.indexOf("Expira em"),
      fonte.indexOf("usos"),
    );
    expect(bloco.length).toBeGreaterThan(0);
    expect(bloco).not.toMatch(/\btext-zinc-[567]00\b/);
  });
});
