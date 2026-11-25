// Caça por mutação na aba Resultado do Financeiro (25/11/2026). Cinco defeitos
// de uma linha em `partesDoResultado.tsx` passavam em todos os testes:
//   1. a cor do valor decide o zero em CENTAVOS: R$ 0,00499 é zero (cinza) e
//      não pode virar verde (o defeito multiplicava por 101 e a fronteira de
//      meio centavo andava);
//   2. o tamanho da letra na coluna da tabela segue os caracteres que a tela
//      mostra, e as fronteiras são 11 (normal), 13 (médio) e daí `text-xs`;
//   3. valor POSITIVO não ganha caractere de sinal na conta do tamanho (o
//      defeito contava um "+" que a tela não escreve).
// Comprimento medido à mão: "R$ 1.234,56" tem 11; "R$ 12.345,67" tem 12;
// "R$ 123.456,78" tem 13; negativo soma 1 (o sinal de menos que a tela escreve).
// Só valores inventados.
import {
  classeDoValorNaTabela,
  corDoResultado,
} from "@/components/admin/financeiro/partesDoResultado";
import { describe, expect, it } from "vitest";

const VERDE = "text-emerald-400";
const VERMELHO = "text-red-400";
const CINZA = "text-zinc-400";

describe("cor do resultado — o zero é decidido em centavos, na fronteira do meio centavo", () => {
  it("R$ 0,00499 (menos de meio centavo) é zero: cinza, positivo ou negativo", () => {
    expect(corDoResultado(0.00499)).toBe(CINZA);
    expect(corDoResultado(-0.00499)).toBe(CINZA);
  });

  it("R$ 0,00501 (mais de meio centavo) já é um centavo: verde ou vermelho", () => {
    expect(corDoResultado(0.00501)).toBe(VERDE);
    expect(corDoResultado(-0.00501)).toBe(VERMELHO);
  });
});

describe("letra do valor na tabela do Resultado — fronteiras de 11 e 13 caracteres", () => {
  const BASE = "whitespace-nowrap tabular-nums";

  it("11 caracteres (R$ 1.234,56) cabem na letra normal da linha comum e da linha de destaque", () => {
    expect(classeDoValorNaTabela(1234.56, false, false)).toBe(
      `${BASE} text-sm`,
    );
    expect(classeDoValorNaTabela(1234.56, true, false)).toBe(
      `${BASE} text-base`,
    );
  });

  it("12 caracteres (R$ 12.345,67) já descem para a letra média", () => {
    expect(classeDoValorNaTabela(12345.67, false, false)).toBe(
      `${BASE} text-[13px]`,
    );
    expect(classeDoValorNaTabela(12345.67, true, false)).toBe(
      `${BASE} text-sm`,
    );
  });

  it("13 caracteres (R$ 123.456,78) ainda são a letra média", () => {
    expect(classeDoValorNaTabela(123456.78, false, false)).toBe(
      `${BASE} text-[13px]`,
    );
  });

  it("valor negativo soma o sinal: -R$ 1.234,56 são 12 caracteres (letra média)", () => {
    expect(classeDoValorNaTabela(-1234.56, false, false)).toBe(
      `${BASE} text-[13px]`,
    );
  });

  it("14 caracteres (-R$ 123.456,78) e 15 (R$ 1.234.567,89) vão para a menor letra", () => {
    expect(classeDoValorNaTabela(-123456.78, false, false)).toBe(
      `${BASE} text-xs`,
    );
    expect(classeDoValorNaTabela(1234567.89, false, false)).toBe(
      `${BASE} text-xs`,
    );
  });

  it("com os valores ocultos o tamanho é o da máscara, igual para qualquer valor", () => {
    expect(classeDoValorNaTabela(1234567.89, false, true)).toBe(
      `${BASE} text-sm`,
    );
    expect(classeDoValorNaTabela(5, false, true)).toBe(`${BASE} text-sm`);
  });
});
