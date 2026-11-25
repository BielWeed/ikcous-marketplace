// A prova de "devolvido por inteiro pelo próprio app" decide se um pedido
// estornado é caso resolvido (selo neutro) ou chargeback perdido (selo de
// atenção) — `src/lib/devolucao-do-dinheiro-concluida.ts`. A regra é POSITIVA e
// só soma o que é devolução de pessoa; o teste da tela cobre os caminhos
// principais. Aqui as bordas da soma, pela função pura:
//   · uma linha com valor NEGATIVO (estorno do estorno, dado sujo) não abate o
//     que já foi devolvido: soma só o que é positivo, em centavos;
//   · linhas de valor ilegível ou zero não contam, nem estragam a conta;
//   · a soma é de TODAS as linhas de pessoa, de lojista e de cliente juntas;
//   · centavos quebrados (0,1 + 0,2) fecham o total sem erro de ponto flutuante.
import { devolucaoConcluidaPorInteiro } from "@/lib/devolucao-do-dinheiro-concluida";
import { describe, expect, it } from "vitest";

const linha = (
  amount: number | string | null,
  solicitado_por: string | null = "lojista",
  status: string | null = "concluido",
) => ({ amount, status, solicitado_por });

describe("devolucaoConcluidaPorInteiro — bordas da soma", () => {
  it("linha negativa não abate: 50 + (-10) com total 50 continua provando", () => {
    expect(devolucaoConcluidaPorInteiro([linha(50), linha(-10)], 50)).toBe(
      true,
    );
  });

  it("só uma linha negativa não prova nada", () => {
    expect(devolucaoConcluidaPorInteiro([linha(-50)], 50)).toBe(false);
  });

  it("linha de valor zero, nulo ou ilegível não conta e não derruba a soma", () => {
    expect(
      devolucaoConcluidaPorInteiro(
        [linha(0), linha(null), linha("abc"), linha(30), linha(20)],
        50,
      ),
    ).toBe(true);
    expect(
      devolucaoConcluidaPorInteiro([linha(0), linha(null), linha("abc")], 50),
    ).toBe(false);
  });

  it("lojista e cliente somam juntos para fechar o total", () => {
    expect(
      devolucaoConcluidaPorInteiro(
        [linha(30, "lojista"), linha(20, "cliente")],
        50,
      ),
    ).toBe(true);
    expect(
      devolucaoConcluidaPorInteiro(
        [linha(30, "lojista"), linha(19.99, "cliente")],
        50,
      ),
    ).toBe(false);
  });

  it("a linha da contestação (sistema) não completa o que falta", () => {
    expect(
      devolucaoConcluidaPorInteiro(
        [linha(30, "lojista"), linha(20, "sistema")],
        50,
      ),
    ).toBe(false);
  });

  it("valor em texto numérico (o banco devolve numeric como texto) é somado", () => {
    expect(
      devolucaoConcluidaPorInteiro([linha("30.00"), linha("20.00")], 50),
    ).toBe(true);
  });

  it("centavos quebrados fecham o total sem erro de ponto flutuante", () => {
    expect(devolucaoConcluidaPorInteiro([linha(0.1), linha(0.2)], 0.3)).toBe(
      true,
    );
    expect(
      devolucaoConcluidaPorInteiro([linha(20.05), linha(10.1)], 30.15),
    ).toBe(true);
  });

  it("total do pedido ilegível ou zero não prova nada (nunca 'devolvido por inteiro')", () => {
    expect(devolucaoConcluidaPorInteiro([linha(50)], 0)).toBe(false);
    expect(devolucaoConcluidaPorInteiro([linha(50)], Number.NaN)).toBe(false);
    expect(devolucaoConcluidaPorInteiro([linha(50)], -10)).toBe(false);
  });

  it("sem livro (nulo, indefinido ou vazio) não prova nada", () => {
    expect(devolucaoConcluidaPorInteiro(null, 50)).toBe(false);
    expect(devolucaoConcluidaPorInteiro(undefined, 50)).toBe(false);
    expect(devolucaoConcluidaPorInteiro([], 50)).toBe(false);
  });
});
