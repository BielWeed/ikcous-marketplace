// Onda L · frente "cupons" — prova ESTÁTICA (lê o fonte; o jsdom não aplica CSS,
// então a medida de verdade, com a pílula e os selos já crescidos, é a do render).
//
//  (a) A lista e o formulário de cupons não têm texto abaixo de 11px (a régua do
//      painel: `text-[6px]` … `text-[10.5px]`), fora de comentário.
//  (b) A pílula "Ativo/Inativo" do bilhete (era 6px), os rótulos "Desconto" e
//      "Mínimo Compra" do bilhete (7px) e o selo de status da lista (8px) sobem
//      para 11px trocando o espaçamento de letras `tracking-widest` por
//      `tracking-wider`, para a caixa crescer sem estourar.
//  (c) Redesenho aprovado v7: Cancelar mantém 44px e Salvar cresce para 56px.
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
  it("a pílula Ativo/Inativo da prévia cresce para 12px sem comprimir letras", () => {
    const [pilula, ...resto] = linhasCom(
      ler(FORMULARIO),
      "rounded-full border px-3 py-1 text-xs font-bold",
    );
    expect(resto).toEqual([]);
    expect(pilula).toBeDefined();
    expect(pilula).toMatch(/\btext-xs\b/);
    expect(pilula).toMatch(/\bfont-bold\b/);
    expect(pilula).not.toMatch(/\btracking-widest\b/);
  });

  it('os rótulos "Desconto" e "Mínimo Compra" da prévia crescem para 12px legíveis', () => {
    const fonte = semComentarios(ler(FORMULARIO));
    const rotulos = [
      /<p className="([^"]*)">\s*Desconto\s*<\/p>/,
      /<p className="([^"]*)">\s*Mínimo Compra\s*<\/p>/,
    ];
    for (const padrao of rotulos) {
      const m = padrao.exec(fonte);
      expect(m, `rótulo ${padrao} do bilhete`).not.toBeNull();
      const classes = m?.[1] ?? "";
      expect(classes).toMatch(/\btext-xs\b/);
      expect(classes).toMatch(/\btext-zinc-400\b/);
      expect(classes).not.toMatch(/\btracking-widest\b/);
    }
  });

  it("texto de 11px não fica com leading-none (o aviso do modo offline quebra em 2 linhas)", () => {
    const coladas = semComentarios(ler(FORMULARIO))
      .split("\n")
      .filter((l) => /\btext-\[11px\]/.test(l) && /\bleading-none\b/.test(l));
    expect(coladas).toEqual([]);
  });

  it("o selo de status da lista cresce para 12px sem comprimir letras", () => {
    const [selo, ...resto] = linhasCom(ler(LISTA), "classesDoSeloPorRotulo[");
    const alvo = [selo, ...resto].filter((l) => l.includes("className="));
    expect(alvo).toHaveLength(1);
    expect(alvo[0]).toMatch(/\btext-xs\b/);
    expect(alvo[0]).toMatch(/\bfont-bold\b/);
    expect(alvo[0]).not.toMatch(/\btracking-widest\b/);
  });
});

describe("cupons — alvos de toque do formulário", () => {
  it("Cancelar tem pelo menos 44px e Salvar pelo menos 56px", () => {
    const fonte = ler(FORMULARIO);
    const estilos = ler("src/components/admin/coupons/apresentacao.tsx");
    expect(fonte).toMatch(/className=\{SECUNDARIO\}\s*>\s*Cancelar/);
    expect(fonte).toMatch(/className=\{`\$\{PRIMARIO\} h-auto w-full`\}/);
    for (const [nome, altura] of [
      ["SECUNDARIO", "min-h-11"],
      ["PRIMARIO", "min-h-14"],
    ]) {
      const linha = estilos
        .split("\n")
        .find((l) => l.includes(`const ${nome} =`));
      expect(linha).toContain(altura);
      expect(linha).toMatch(/text-(?:sm|base)/);
    }
  });
});

// Redesenho de 10/10/2026 — as mini-caixas do bilhete na LISTA seguem o desenho
// do cartão de métrica (KpiCard): casca com brilho no topo, rótulo em frase
// normal 12px cinza 300 (não mais "uppercase miúdo cinza 500") e valor branco
// tabular. Só visual: os textos "Desconto", "Mínimo Compra", "Aproveitamento"
// e "Expira em:" continuam os mesmos.
// v7 troca as mini-caixas por um resumo compacto e detalhes recolhíveis.
describe("cupons — resumo compacto sem perder valores e detalhes", () => {
  const fonte = semComentarios(ler(LISTA));
  const trechoDoValor = (ancora: string) => {
    const pos = fonte.indexOf(ancora);
    expect(pos, ancora).toBeGreaterThan(-1);
    return fonte.slice(fonte.lastIndexOf("<p", pos), pos);
  };

  for (const rotulo of ["Desconto", "Mínimo Compra", "Aproveitamento"]) {
    it(`o conteúdo de "${rotulo}" permanece legível no resumo ou nos detalhes`, () => {
      expect(fonte).toContain(rotulo);
      expect(fonte).not.toMatch(TEXTO_PEQUENO);
      expect(fonte).toContain("aria-expanded={aberto}");
      expect(fonte).not.toContain('className="truncate');
      expect(fonte).not.toContain("uppercase tracking-widest");
    });
  }

  it("o cartão compacto mantém superfície, borda e espaço para o conteúdo", () => {
    const pos = fonte.indexOf('className="group min-w-0');
    expect(pos).toBeGreaterThan(-1);
    const casca = fonte.slice(pos, fonte.indexOf(">", pos));
    expect(casca).toContain("rounded-[20px]");
    expect(casca).toContain("border-white/10");
    expect(casca).toContain("bg-[#101013]");
    expect(casca).toContain("p-3");
    expect(casca).toContain("min-w-0");
  });

  it("a lista reserva uma coluna no celular e só três no desktop amplo", () => {
    const grade = linhasCom(fonte, "grid grid-cols-1 items-start").join(" ");
    const classes = grade.split(/[\s"]+/);
    expect(classes).toEqual(
      expect.arrayContaining([
        "grid-cols-1",
        "md:grid-cols-2",
        "xl:grid-cols-3",
      ]),
    );
    expect(classes).not.toContain("lg:grid-cols-3");
  });

  it("os dois valores têm espaço para quebrar sem corte por largura fixa", () => {
    for (const ancora of [
      "`${coupon.value",
      "formatCurrency(coupon.minPurchase",
    ]) {
      const trecho = trechoDoValor(ancora);
      expect(trecho).toContain("font-bold");
      expect(trecho).not.toContain("truncate");
      expect(trecho).not.toContain("w-[");
    }
  });

  it("o dinheiro do resumo e do mínimo usa tamanho legível sem esconder dígitos", () => {
    for (const ancora of [
      "`${coupon.value",
      "formatCurrency(coupon.minPurchase",
    ]) {
      const trecho = trechoDoValor(ancora);
      expect(trecho).toMatch(/text-(?:lg|2xl)/);
      expect(trecho).toMatch(/\btabular-nums\b/);
      expect(trecho).not.toMatch(/\btruncate\b/);
      expect(trecho).not.toMatch(/\boverflow-hidden\b/);
    }
  });

  it("o valor do mínimo continua claro e tabular", () => {
    const trecho = trechoDoValor("formatCurrency(coupon.minPurchase");
    expect(trecho).toMatch(/\btext-zinc-50\b/);
    expect(trecho).toMatch(/\btabular-nums\b/);
    expect(trecho).not.toMatch(/\btext-zinc-400\b/);
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
