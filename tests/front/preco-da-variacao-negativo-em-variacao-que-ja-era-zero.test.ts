// A exceção do zero ("a variação já estava salva com zero") vale SÓ para o
// zero. Um texto negativo que chegue com essa exceção ligada não pode virar
// preço próprio de R$ 0,00 (cobrança de graça): continua "sem preço próprio".
// Trocar `numero === 0` por `numero <= 0` passava em todos os testes antigos,
// porque nenhum combinava negativo com `jaEstavaEmZero = true`.
import { describe, expect, it } from "vitest";

import { precoProprioDaVariacao } from "@/utils/preco-da-variacao";

describe("precoProprioDaVariacao — negativo e texto ilegível com a exceção do zero ligada", () => {
  it("negativo NÃO vira zero só porque a variação já estava em zero", () => {
    expect(precoProprioDaVariacao("-5", true)).toBeUndefined();
    expect(precoProprioDaVariacao("-0.01", true)).toBeUndefined();
  });

  it("texto sem número e menos solto continuam sem preço próprio mesmo com a exceção ligada", () => {
    expect(precoProprioDaVariacao("-", true)).toBeUndefined();
    expect(precoProprioDaVariacao(".", true)).toBeUndefined();
    expect(precoProprioDaVariacao("   ", true)).toBeUndefined();
  });

  it("a exceção do zero não muda um preço positivo", () => {
    expect(precoProprioDaVariacao("0.01", true)).toBe(0.01);
    expect(precoProprioDaVariacao("1", true)).toBe(1);
  });
});
