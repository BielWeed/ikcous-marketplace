// `acimaDoTetoDePreco` (`src/utils/teto-de-preco.ts`): o teto é R$ 9.999.999,99
// e a conta é sobre o valor inteiro, centavos e fração incluídos. Ler o texto
// só até o ponto ("9999999.995" virando 9999999) deixaria passar um valor acima
// do teto para o banco.
import { acimaDoTetoDePreco } from "@/utils/teto-de-preco";
import { describe, expect, it } from "vitest";

describe("acimaDoTetoDePreco — fração em cima do teto", () => {
  it("o próprio teto não está acima dele, em texto e em número", () => {
    expect(acimaDoTetoDePreco("9999999.99")).toBe(false);
    expect(acimaDoTetoDePreco(9_999_999.99)).toBe(false);
  });

  it("uma fração de centavo acima do teto está acima, em texto e em número", () => {
    expect(acimaDoTetoDePreco("9999999.995")).toBe(true);
    expect(acimaDoTetoDePreco(9_999_999.995)).toBe(true);
  });

  it("vazio, nulo e texto sem número nunca estão acima do teto", () => {
    expect(acimaDoTetoDePreco("")).toBe(false);
    expect(acimaDoTetoDePreco(null)).toBe(false);
    expect(acimaDoTetoDePreco(undefined)).toBe(false);
    expect(acimaDoTetoDePreco("abc")).toBe(false);
  });
});
