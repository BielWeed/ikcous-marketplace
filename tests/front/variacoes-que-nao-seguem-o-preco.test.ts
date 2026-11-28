// O aviso sob o Preço de Venda (`variacoes-que-nao-seguem-o-preco.ts`) — a
// regra pura, sem tela.
//
// Defeito: o produto custava R$ 89,90 e a lojista pôs 89,90 em "Preço para
// todas" da grade; cada tamanho gravou 89,90 como preço próprio. Ao baixar o
// Preço de Venda para 69,90, a loja seguia cobrando 89,90 e nada avisava.
// Decisão do sócio (28/11/2026): ao mudar o preço, a tela lista os tamanhos
// PRESOS no preço antigo (com botão para fazê-los seguir o produto) e só
// informa os que têm um preço próprio diferente.
//
// Teste de função pura — ambiente node.
import { describe, expect, it } from "vitest";

import {
  juntarNomes,
  semPrecoProprio,
  variacoesQueNaoSeguemOPreco,
} from "@/utils/variacoes-que-nao-seguem-o-preco";

const tamanho = (
  value: string,
  priceOverride?: number | null,
  active = true,
) => ({ id: `v-${value}`, name: "Tamanho", value, priceOverride, active });

describe("variacoesQueNaoSeguemOPreco — quando avisa", () => {
  it("preço não mudou: não avisa nada", () => {
    const variacoes = [tamanho("P", 89.9), tamanho("M", 89.9)];
    expect(variacoesQueNaoSeguemOPreco("89.9", "89.90", variacoes)).toBeNull();
  });

  it('"89,9" e 89.90 são o mesmo preço (vírgula, ponto e casas não contam como mudança)', () => {
    const variacoes = [tamanho("P", 89.9)];
    expect(variacoesQueNaoSeguemOPreco(89.9, "89,9", variacoes)).toBeNull();
    expect(variacoesQueNaoSeguemOPreco("89,9", "89.90", variacoes)).toBeNull();
  });

  it("três tamanhos presos no preço antigo: lista os três, na ordem, com o preço antigo e o novo", () => {
    const variacoes = [
      tamanho("P", 89.9),
      tamanho("M", 89.9),
      tamanho("G", 89.9),
    ];
    const aviso = variacoesQueNaoSeguemOPreco("89.9", "69.90", variacoes);
    expect(aviso).not.toBeNull();
    expect(aviso?.presas.map((v) => v.value)).toEqual(["P", "M", "G"]);
    expect(aviso?.diferentes).toEqual([]);
    expect(aviso?.precoAntigo).toBe(89.9);
    expect(aviso?.precoNovo).toBe(69.9);
  });

  it('o preço próprio "preso" é comparado em centavos com o preço SALVO ("89,9" salvo, 89.90 na variação)', () => {
    const aviso = variacoesQueNaoSeguemOPreco("89,9", "69.90", [
      tamanho("P", 89.9),
      tamanho("M", 89.90000000001),
    ]);
    expect(aviso?.presas.map((v) => v.value)).toEqual(["P", "M"]);
  });

  it("preço próprio diferente do antigo vai para a linha informativa, não para o botão", () => {
    const aviso = variacoesQueNaoSeguemOPreco("89.9", "69.90", [
      tamanho("P", 89.9),
      tamanho("GG", 109.9),
    ]);
    expect(aviso?.presas.map((v) => v.value)).toEqual(["P"]);
    expect(aviso?.diferentes.map((v) => v.value)).toEqual(["GG"]);
  });

  it("só preços diferentes: avisa só com a linha informativa", () => {
    const aviso = variacoesQueNaoSeguemOPreco("89.9", "69.90", [
      tamanho("GG", 109.9),
      tamanho("P"),
    ]);
    expect(aviso?.presas).toEqual([]);
    expect(aviso?.diferentes.map((v) => v.value)).toEqual(["GG"]);
  });
});

describe("variacoesQueNaoSeguemOPreco — o que fica de fora", () => {
  it("tamanho com preço zero (brinde) e tamanho desligado não entram em lista nenhuma", () => {
    const aviso = variacoesQueNaoSeguemOPreco("89.9", "69.90", [
      tamanho("P", 89.9),
      tamanho("BRINDE", 0),
      tamanho("M", 89.9, false),
      tamanho("GG", 109.9, false),
    ]);
    expect(aviso?.presas.map((v) => v.value)).toEqual(["P"]);
    expect(aviso?.diferentes).toEqual([]);
  });

  it("tamanhos que já seguem o produto (sem preço próprio, null ou ausente) não avisam", () => {
    expect(
      variacoesQueNaoSeguemOPreco("89.9", "69.90", [
        tamanho("P"),
        tamanho("M", null),
      ]),
    ).toBeNull();
  });

  it("só zero e desligados: nada para avisar", () => {
    expect(
      variacoesQueNaoSeguemOPreco("89.9", "69.90", [
        tamanho("BRINDE", 0),
        tamanho("M", 89.9, false),
      ]),
    ).toBeNull();
  });

  it("produto sem preço salvo (novo, vazio ou zero): não avisa", () => {
    const variacoes = [tamanho("P", 89.9)];
    expect(variacoesQueNaoSeguemOPreco("", "69.90", variacoes)).toBeNull();
    expect(variacoesQueNaoSeguemOPreco("0", "69.90", variacoes)).toBeNull();
    expect(
      variacoesQueNaoSeguemOPreco(undefined, "69.90", variacoes),
    ).toBeNull();
  });

  it("preço digitado vazio, zero ou que não é número: não avisa (não há preço novo para seguir)", () => {
    const variacoes = [tamanho("P", 89.9)];
    expect(variacoesQueNaoSeguemOPreco("89.9", "", variacoes)).toBeNull();
    expect(variacoesQueNaoSeguemOPreco("89.9", "0.00", variacoes)).toBeNull();
    expect(variacoesQueNaoSeguemOPreco("89.9", "abc", variacoes)).toBeNull();
  });

  it("sem variações: não avisa", () => {
    expect(variacoesQueNaoSeguemOPreco("89.9", "69.90", [])).toBeNull();
  });
});

describe("semPrecoProprio", () => {
  it("grava null (nunca undefined): o caminho de gravação pula a chave undefined e o preço antigo sobreviveria", () => {
    const antes = tamanho("P", 89.9);
    const depois = semPrecoProprio(antes);
    expect(depois).toHaveProperty("priceOverride", null);
    expect(depois.priceOverride).toBeNull();
    expect(depois.value).toBe("P");
    // Não muta a variação que veio do formulário.
    expect(antes.priceOverride).toBe(89.9);
  });
});

describe("juntarNomes", () => {
  it.each([
    [[], ""],
    [["P"], "P"],
    [["P", "M"], "P e M"],
    [["P", "M", "G"], "P, M e G"],
  ])("%j vira %j", (nomes, esperado) => {
    expect(juntarNomes(nomes)).toBe(esperado);
  });
});
