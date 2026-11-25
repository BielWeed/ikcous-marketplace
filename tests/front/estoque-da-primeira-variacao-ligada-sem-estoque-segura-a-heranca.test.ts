// A "herança" do estoque do produto pela primeira variação: com variação
// LIGADA no produto — mesmo uma ligada com zero peças — a nova variação começa
// em 0. O teste que já existia só provava variação DESLIGADA com quantidade; se
// a ligada com zero deixasse de segurar a herança, o produto de 20 peças
// ganharia uma variação nova com 20 JUNTO da ligada, e a soma que a tela mostra
// (e a vitrine vende) passaria a ser 40 para 20 peças de verdade.
import { describe, expect, it } from "vitest";

import { estoqueQueAPrimeiraVariacaoHerda } from "@/utils/estoque-das-variacoes";

const form = (
  stock: string,
  variants: Array<{ active: boolean; stockIncrement: number }>,
) => ({ stock, variants });

describe("a primeira variação só herda o estoque quando não há nenhuma ligada", () => {
  it("uma variação ligada com zero peças já segura a herança: a nova começa em 0", () => {
    expect(
      estoqueQueAPrimeiraVariacaoHerda(
        form("20", [{ active: true, stockIncrement: 0 }]),
      ),
    ).toBe(0);
  });

  it("ligada com zero ao lado de uma desligada vazia também segura", () => {
    expect(
      estoqueQueAPrimeiraVariacaoHerda(
        form("20", [
          { active: true, stockIncrement: 0 },
          { active: false, stockIncrement: 0 },
        ]),
      ),
    ).toBe(0);
  });

  it("sem variação nenhuma o produto de 20 peças passa as 20 à primeira", () => {
    expect(estoqueQueAPrimeiraVariacaoHerda(form("20", []))).toBe(20);
  });

  it("só com desligadas vazias (nada a guardar) a herança ainda vale", () => {
    expect(
      estoqueQueAPrimeiraVariacaoHerda(
        form("20", [{ active: false, stockIncrement: 0 }]),
      ),
    ).toBe(20);
  });
});
