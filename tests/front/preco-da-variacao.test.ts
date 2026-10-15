// O preço próprio da variação que o formulário grava: vazio, zero e texto sem
// número são "sem preço próprio" (a variação segue o preço do produto). Zero só
// sobrevive em uma variação que JÁ estava salva com zero — o dado existente não
// é corrigido por trás da lojista.
import { describe, expect, it } from "vitest";

import { precoProprioDaVariacao } from "@/utils/preco-da-variacao";

describe("precoProprioDaVariacao", () => {
  it("preço maior que zero vira o preço próprio", () => {
    expect(precoProprioDaVariacao("49.90")).toBe(49.9);
    expect(precoProprioDaVariacao("0.05")).toBe(0.05);
    expect(precoProprioDaVariacao("1200")).toBe(1200);
  });

  it("vazio não é preço próprio", () => {
    expect(precoProprioDaVariacao("")).toBeUndefined();
    expect(precoProprioDaVariacao("   ")).toBeUndefined();
  });

  it("zero NÃO é preço próprio (o campo apagado de uma máscara que mostra 0,00)", () => {
    expect(precoProprioDaVariacao("0")).toBeUndefined();
    expect(precoProprioDaVariacao("0.00")).toBeUndefined();
    expect(precoProprioDaVariacao("0.0")).toBeUndefined();
  });

  it("negativo e texto sem número nunca viram preço (nem NaN)", () => {
    expect(precoProprioDaVariacao("-5")).toBeUndefined();
    expect(precoProprioDaVariacao("-")).toBeUndefined();
    expect(precoProprioDaVariacao(".")).toBeUndefined();
  });

  it("variação que já estava salva com zero mantém o zero enquanto o campo seguir em zero", () => {
    expect(precoProprioDaVariacao("0", true)).toBe(0);
    expect(precoProprioDaVariacao("0.00", true)).toBe(0);
  });

  it("variação que já estava em zero: campo apagado volta a ser sem preço próprio; preço novo vale", () => {
    expect(precoProprioDaVariacao("", true)).toBeUndefined();
    expect(precoProprioDaVariacao("55.00", true)).toBe(55);
  });
});
