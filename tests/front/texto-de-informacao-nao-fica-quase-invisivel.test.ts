// Informação que a cliente precisa ler estava em cinza quase da cor do fundo
// (zinc-300 / slate-400 / zinc-400, abaixo de 3:1) e em 9–10 px: o valor
// riscado do frete, o "De:" do preço, o subtítulo das Avaliações, o selo de
// frete e a categoria da busca. Só classes mudam; o desenho é o mesmo.
//
// Varredura do fonte nos pontos exatos (e não do arquivo inteiro: outros
// rótulos desses arquivos têm decisão própria e não fazem parte deste ajuste).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const fonte = (caminho: string) =>
  // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo do próprio repositório
  readFileSync(caminho, "utf-8");

// Classe solta, por igualdade de palavra (`lg:text-zinc-500` é outra classe).
const tem = (classes: string, utilitario: string) =>
  classes.split(/\s+/).includes(utilitario);

/** Classes do `className="..."` / string que contém o âncora. */
const classesDe = (texto: string, ancora: RegExp) => {
  const achado = texto.match(ancora);
  expect(achado, `âncora ${ancora} não achada`).not.toBeNull();
  return achado![1];
};

describe("texto de informação legível (contraste e tamanho)", () => {
  it("CheckoutView: o frete riscado é zinc-500, igual ao riscado da barra", () => {
    const checkout = fonte("src/views/customer/CheckoutView.tsx");
    expect(checkout).not.toMatch(/text-zinc-300 line-through/);
    expect(checkout.match(/text-zinc-500 line-through/g)?.length).toBe(3);
  });

  describe("PremiumOffers", () => {
    const ofertas = fonte("src/components/ui/custom/PremiumOffers.tsx");
    it("o preço antigo riscado é slate-500 e de 11 px", () => {
      const classes = classesDe(
        ofertas,
        /className="([^"]*line-through[^"]*)">\s*De: \{formatCurrency\(precoAntigo\)\}/,
      );
      expect(tem(classes, "text-slate-400")).toBe(false);
      expect(tem(classes, "text-slate-500")).toBe(true);
      expect(tem(classes, "text-[10px]")).toBe(false);
      expect(tem(classes, "text-[11px]")).toBe(true);
    });
    it("o selo de frete grátis e o 'Economize' têm 11 px, não 9", () => {
      for (const ancora of [
        /className="([^"]*)">\s*<Truck [^>]*\/>\s*<span>\{frase\}<\/span>/,
        /className="([^"]*)">\s*Economize \{formatCurrency\(savings\)\}/,
      ]) {
        const classes = classesDe(ofertas, ancora);
        expect(tem(classes, "text-[9px]")).toBe(false);
        expect(tem(classes, "text-[11px]")).toBe(true);
      }
    });
  });

  describe("ProductView", () => {
    const produto = fonte("src/views/customer/ProductView.tsx");
    it("o 'De:' do preço é zinc-500", () => {
      const classes = classesDe(
        produto,
        /"([^"]*line-through)",\s*"lg:text-sm",\s*\)\}\s*>\s*De: /,
      );
      expect(tem(classes, "text-zinc-400")).toBe(false);
      expect(tem(classes, "text-zinc-500")).toBe(true);
    });
    it("o subtítulo das Avaliações é zinc-600 e de 11 px", () => {
      const classes = classesDe(
        produto,
        /"([^"]*tracking-widest[^"]*)",\s*ROTULO_NO_COMPUTADOR,\s*\)\}\s*>\s*\{reviewCount > 0/,
      );
      expect(tem(classes, "text-zinc-400")).toBe(false);
      expect(tem(classes, "text-zinc-600")).toBe(true);
      expect(tem(classes, "text-[10px]")).toBe(false);
      expect(tem(classes, "text-[11px]")).toBe(true);
    });
  });

  describe("SearchBar", () => {
    const busca = fonte("src/components/ui/custom/SearchBar.tsx");
    it("a categoria do resultado é zinc-600 e não tem 9 px", () => {
      const classes = classesDe(
        busca,
        /className="([^"]*)">\s*\{item\.category\}/,
      );
      expect(tem(classes, "text-zinc-400")).toBe(false);
      expect(tem(classes, "text-zinc-600")).toBe(true);
      expect(tem(classes, "text-[9px]")).toBe(false);
      expect(tem(classes, "text-[10px]")).toBe(true);
    });
    it("o 'Tente pesquisar...' é zinc-600 e text-xs", () => {
      const classes = classesDe(
        busca,
        /className="([^"]*)">\s*Tente pesquisar por categorias/,
      );
      expect(tem(classes, "text-zinc-400")).toBe(false);
      expect(tem(classes, "text-zinc-600")).toBe(true);
      expect(tem(classes, "text-[11px]")).toBe(false);
      expect(tem(classes, "text-xs")).toBe(true);
    });
  });
});
