// A "herança" do estoque do produto pela primeira variação, nos limites da
// quantidade guardada numa variação DESLIGADA: qualquer peça guardada (a partir
// de UMA) segura a herança. Se o corte passasse de "maior que 0" para "maior
// que 1", o produto de 20 peças com uma variação desligada guardando 1 peça
// daria 20 à variação nova, e religar a antiga somaria 20 + 1 para 20 peças de
// verdade.
import { describe, expect, it } from "vitest";

import { estoqueQueAPrimeiraVariacaoHerda } from "@/utils/estoque-das-variacoes";

const form = (
  stock: string,
  variants: Array<{ active: boolean; stockIncrement: number }>,
) => ({ stock, variants });

describe("a herança do estoque nos limites da quantidade guardada", () => {
  it("desligada guardando UMA peça já segura a herança: a nova começa em 0", () => {
    expect(
      estoqueQueAPrimeiraVariacaoHerda(
        form("20", [{ active: false, stockIncrement: 1 }]),
      ),
    ).toBe(0);
  });

  it("desligada guardando duas peças também segura", () => {
    expect(
      estoqueQueAPrimeiraVariacaoHerda(
        form("20", [{ active: false, stockIncrement: 2 }]),
      ),
    ).toBe(0);
  });

  it("desligada com quantidade ilegível (NaN) ou negativa não segura: a herança vale", () => {
    expect(
      estoqueQueAPrimeiraVariacaoHerda(
        form("20", [{ active: false, stockIncrement: Number.NaN }]),
      ),
    ).toBe(20);
    expect(
      estoqueQueAPrimeiraVariacaoHerda(
        form("20", [{ active: false, stockIncrement: -1 }]),
      ),
    ).toBe(20);
  });
});
