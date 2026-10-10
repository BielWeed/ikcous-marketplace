// O preço digitado na grade de variações vira o Preço de Venda do produto
// (`preco-da-grade.ts`) — a regra pura, sem tela.
//
// Defeito medido pelo dono: ele digitava o preço na grade e o formulário do
// produto pedia o MESMO preço de novo. Decisão aprovada (socio, 09/10/2026),
// ponto a ponto:
//  (1) produto sem preço + preço na grade: o produto recebe o preço, as
//      variações ficam Auto (preço próprio vazio);
//  (2) produto JÁ com preço: a grade só dá preço próprio às combinações novas
//      e o preço do produto não muda;
//  (3) preço só em algumas linhas: não se chuta, o produto continua pedindo;
//  (4) todas as linhas com preço e produto vazio: o produto recebe o MENOR e as
//      linhas iguais a ele viram Auto.
// Mais as bordas: zero e texto inválido nunca viram preço do produto.
//
// Teste de função pura — ambiente node.
import { describe, expect, it } from "vitest";

import { precoDaLinha, resolverPrecoDaGrade } from "@/utils/preco-da-grade";

describe("resolverPrecoDaGrade — produto sem preço", () => {
  it("(1) todas as linhas com o mesmo preço: o produto recebe e todas ficam Auto", () => {
    const r = resolverPrecoDaGrade("", ["60.00", "60.00", "60.00"]);
    expect(r.precoDoProduto).toBe(60);
    expect(r.precos).toEqual([undefined, undefined, undefined]);
  });

  it("(4) todas com preço, valores diferentes: o produto recebe o MENOR; as iguais a ele viram Auto e as outras mantêm o preço", () => {
    const r = resolverPrecoDaGrade("", ["60.00", "80.00", "60.00", "95.50"]);
    expect(r.precoDoProduto).toBe(60);
    expect(r.precos).toEqual([undefined, 80, undefined, 95.5]);
  });

  it("(4) o menor não é o primeiro: acha o menor de verdade", () => {
    const r = resolverPrecoDaGrade("", ["80", "55,90", "70"]);
    expect(r.precoDoProduto).toBe(55.9);
    expect(r.precos).toEqual([80, undefined, 70]);
  });

  it('"60,00" e "60.00" são o mesmo preço (vírgula, ponto e casas decimais não separam linhas iguais)', () => {
    const r = resolverPrecoDaGrade("", ["60,00", "60.00", "60"]);
    expect(r.precoDoProduto).toBe(60);
    expect(r.precos).toEqual([undefined, undefined, undefined]);
  });

  it("(3) só algumas linhas com preço: NÃO chuta — o produto fica sem preço e as linhas sem preço seguem Auto", () => {
    const r = resolverPrecoDaGrade("", ["60.00", "", "70.00"]);
    expect(r.precoDoProduto).toBeUndefined();
    expect(r.precos).toEqual([60, undefined, 70]);
  });

  it("nenhuma linha com preço: nada muda (tudo Auto, produto continua pedindo)", () => {
    const r = resolverPrecoDaGrade("", ["", "", ""]);
    expect(r.precoDoProduto).toBeUndefined();
    expect(r.precos).toEqual([undefined, undefined, undefined]);
  });

  it("produto com o campo só de espaços conta como vazio", () => {
    const r = resolverPrecoDaGrade("   ", ["60.00", "60.00"]);
    expect(r.precoDoProduto).toBe(60);
  });

  it("grade sem linhas: sem preço para o produto", () => {
    expect(resolverPrecoDaGrade("", [])).toEqual({ precos: [] });
  });

  it("uma única linha: o produto recebe o preço dela e a linha vira Auto", () => {
    const r = resolverPrecoDaGrade("", ["49.90"]);
    expect(r.precoDoProduto).toBe(49.9);
    expect(r.precos).toEqual([undefined]);
  });
});

describe("resolverPrecoDaGrade — preço zero e texto inválido nunca viram preço do produto", () => {
  it("todas as linhas em zero: o produto NÃO recebe zero; o zero segue como preço próprio (brinde é legítimo)", () => {
    const r = resolverPrecoDaGrade("", ["0.00", "0.00"]);
    expect(r.precoDoProduto).toBeUndefined();
    expect(r.precos).toEqual([0, 0]);
  });

  it("uma linha em zero entre linhas com preço: não chuta o produto, nem apaga o zero", () => {
    const r = resolverPrecoDaGrade("", ["60.00", "0.00", "60.00"]);
    expect(r.precoDoProduto).toBeUndefined();
    expect(r.precos).toEqual([60, 0, 60]);
  });

  it("texto que não é número conta como linha SEM preço (não trava, não vira preço)", () => {
    const r = resolverPrecoDaGrade("", ["60.00", ".", "abc"]);
    expect(r.precoDoProduto).toBeUndefined();
    expect(r.precos).toEqual([60, undefined, undefined]);
  });

  it("número negativo digitado vira zero (nunca preço negativo) e também não vira preço do produto", () => {
    const r = resolverPrecoDaGrade("", ["-5", "-5"]);
    expect(r.precoDoProduto).toBeUndefined();
    expect(r.precos).toEqual([0, 0]);
  });
});

describe("resolverPrecoDaGrade — produto que JÁ tem preço", () => {
  it("(2) o preço digitado na grade vale só para a combinação nova; o preço do produto não muda", () => {
    const r = resolverPrecoDaGrade("89.90", ["60.00", "", "120.00"]);
    expect(r.precoDoProduto).toBeUndefined();
    expect(r.precos).toEqual([60, undefined, 120]);
  });

  it("(2) linha com o MESMO valor do produto continua com preço próprio (foi digitado de propósito)", () => {
    const r = resolverPrecoDaGrade("89.90", ["89.90", "89.90"]);
    expect(r.precoDoProduto).toBeUndefined();
    expect(r.precos).toEqual([89.9, 89.9]);
  });

  it("(2) todas as linhas vazias: tudo Auto, preço do produto intacto", () => {
    const r = resolverPrecoDaGrade("89.90", ["", ""]);
    expect(r.precoDoProduto).toBeUndefined();
    expect(r.precos).toEqual([undefined, undefined]);
  });

  it('produto com "0.00" (preço inválido já digitado) NÃO é tratado como vazio: a grade não escreve por cima', () => {
    const r = resolverPrecoDaGrade("0.00", ["60.00", "60.00"]);
    expect(r.precoDoProduto).toBeUndefined();
    expect(r.precos).toEqual([60, 60]);
  });
});

describe("precoDaLinha", () => {
  it.each([
    ["60.00", 60],
    ["59,90", 59.9],
    ["0.00", 0],
    ["-5", 0],
    ["", undefined],
    [".", undefined],
    ["abc", undefined],
  ])("%j vira %j", (bruto, esperado) => {
    expect(precoDaLinha(bruto)).toBe(esperado);
  });
});
