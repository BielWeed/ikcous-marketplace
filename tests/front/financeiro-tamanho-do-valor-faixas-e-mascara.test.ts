// Tamanho da letra dos valores do Financeiro: faixas e máscara.
//
// Os testes "classes-geram-css" provam que as classes existem no CSS final e cobrem
// parte das faixas; as fronteiras 9 (meia largura) e 13/14 (valor grande) e o
// `valor < 0` do sinal não caíam com a troca. Aqui todas ficam escritas à mão
// (valores fictícios), sem derivar da tabela que se testa.
import { describe, expect, it } from "vitest";

import {
  MASCARA_DO_VALOR,
  classeDoValorGrande,
  comprimentoDoValor,
  tamanhoDeMeiaLargura,
} from "@/components/admin/financeiro/tamanhoDoValor";

describe("comprimentoDoValor", () => {
  it("conta os caracteres do valor como a tela o escreve (R$ 1.234,56 = 11)", () => {
    expect(comprimentoDoValor(1234.56, false, false)).toBe(11);
    expect(comprimentoDoValor(0, false, false)).toBe(7);
  });

  it("valor com sinal escrito (+/−) ganha um caractere", () => {
    expect(comprimentoDoValor(1234.56, true, false)).toBe(12);
  });

  it("valor negativo ganha o caractere do sinal mesmo sem pedir sinal", () => {
    // formatarBRL escreve o valor absoluto: "R$ 5,00" tem 7; o "−" é o 8º.
    expect(comprimentoDoValor(-5, false, false)).toBe(8);
    expect(comprimentoDoValor(-5, true, false)).toBe(8);
  });

  it("zero não ganha caractere de sinal", () => {
    expect(comprimentoDoValor(0, false, false)).toBe(7);
  });

  it("oculto: sempre o comprimento da máscara, qualquer que seja o valor", () => {
    expect(MASCARA_DO_VALOR).toBe("R$ ••••••");
    expect(comprimentoDoValor(50, false, true)).toBe(9);
    expect(comprimentoDoValor(123456.78, true, true)).toBe(9);
    expect(comprimentoDoValor(-99999999.99, false, true)).toBe(9);
  });
});

describe("tamanhoDeMeiaLargura", () => {
  it.each([
    [0, "text-[22px]"],
    [8, "text-[22px]"],
    [9, "text-[20px]"],
    [10, "text-[18px]"],
    [11, "text-[15px]"],
    [12, "text-[15px]"],
    [13, "text-[13px]"],
    [14, "text-[13px]"],
  ])("%i caracteres usam %s", (n, classe) => {
    expect(tamanhoDeMeiaLargura(n)).toContain(classe);
  });

  it("acima de 14 caracteres cai para o tamanho mínimo", () => {
    expect(tamanhoDeMeiaLargura(15)).toBe("text-xs leading-tight");
    expect(tamanhoDeMeiaLargura(40)).toBe("text-xs leading-tight");
  });

  it("a máscara (9 caracteres) fica numa faixa só, igual para qualquer valor oculto", () => {
    const tamanhoOculto = tamanhoDeMeiaLargura(
      comprimentoDoValor(50, false, true),
    );
    expect(tamanhoOculto).toContain("text-[20px]");
    expect(
      tamanhoDeMeiaLargura(comprimentoDoValor(12345678.9, true, true)),
    ).toBe(tamanhoOculto);
  });
});

describe("classeDoValorGrande", () => {
  it("até 13 caracteres: letra grande; de 14 em diante: menor", () => {
    expect(classeDoValorGrande(13)).toContain(
      "text-[clamp(2rem,10vw,2.75rem)]",
    );
    expect(classeDoValorGrande(14)).toContain("text-[clamp(1.5rem,7vw,2rem)]");
    expect(classeDoValorGrande(14)).not.toContain("2.75rem");
  });

  it("dinheiro nunca quebra de linha", () => {
    expect(classeDoValorGrande(5)).toContain("whitespace-nowrap");
    expect(classeDoValorGrande(30)).toContain("whitespace-nowrap");
  });
});
