// O preço digitado na grade de variações com MAIS DE UM ponto de milhar
// ("1.234.567,89"). Os testes que já existiam só usavam um ponto ("1.234,56"):
// tirar só o PRIMEIRO ponto deixava "1234.567.89", e a regra do "ponto extra"
// colava o resto — o preço virava 1234,56789 em vez de 1.234.567,89 e a loja
// cobraria um valor mil vezes menor sem nenhum aviso.
import { describe, expect, it } from "vitest";

import {
  limparNumero,
  precoDaLinha,
  precoPositivoOuVazio,
  resolverPrecoDaGrade,
} from "@/utils/preco-da-grade";

describe("preço da grade com vários pontos de milhar e vírgula decimal", () => {
  it("tira TODOS os pontos de milhar antes de trocar a vírgula", () => {
    expect(limparNumero("1.234.567,89")).toBe("1234567.89");
    expect(limparNumero("12.345.678.901,50")).toBe("12345678901.50");
  });

  it("a linha da grade lê o valor inteiro, não um número mil vezes menor", () => {
    expect(precoDaLinha("1.234.567,89")).toBe(1234567.89);
  });

  it("o botão 'Aplicar para todas' guarda o valor inteiro", () => {
    expect(precoPositivoOuVazio("1.000.000,50")).toBe("1000000.50");
  });

  it("o Preço de Venda que a grade dá ao produto é o menor valor inteiro", () => {
    const r = resolverPrecoDaGrade("", ["2.500.000,00", "3.500.000,00"]);
    expect(r.precoDoProduto).toBe(2500000);
    expect(r.precos).toEqual([undefined, 3500000]);
  });
});
