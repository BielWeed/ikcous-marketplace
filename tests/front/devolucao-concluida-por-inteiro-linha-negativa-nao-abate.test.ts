// Caça de mutação "só testes" (pedidos, 25/11/2026). Em
// `devolucaoConcluidaPorInteiro`, tirar o `if (centavos > 0)` (que ignora
// linha do livro com valor negativo) não derrubava nenhum teste. Linha negativa
// é dado corrompido (ou estorno do estorno): se ela ABATESSE do que foi
// devolvido, uma devolução de R$ 100 num pedido de R$ 100 deixaria de provar,
// e o painel passaria a tratar como contestação perdida um pedido já resolvido.
import { describe, expect, it } from "vitest";

import { devolucaoConcluidaPorInteiro } from "@/lib/devolucao-do-dinheiro-concluida";

const linha = (amount: number | string, solicitado_por = "lojista") => ({
  amount,
  status: "concluido",
  solicitado_por,
});

describe("devolucaoConcluidaPorInteiro — linha de valor negativo nunca abate", () => {
  it("R$ 100 devolvidos + uma linha de -R$ 30: continua provando o pedido de R$ 100", () => {
    expect(devolucaoConcluidaPorInteiro([linha(100), linha(-30)], 100)).toBe(
      true,
    );
  });

  it("a ordem das linhas não muda o resultado (negativa primeiro)", () => {
    expect(devolucaoConcluidaPorInteiro([linha(-30), linha(100)], 100)).toBe(
      true,
    );
  });

  it("valor negativo vindo como texto do banco também é ignorado", () => {
    expect(
      devolucaoConcluidaPorInteiro([linha(100), linha("-30.00")], 100),
    ).toBe(true);
  });

  it("controle: só R$ 70 devolvidos (a linha negativa não completa nada) NÃO prova", () => {
    expect(devolucaoConcluidaPorInteiro([linha(70), linha(-30)], 100)).toBe(
      false,
    );
  });

  it("controle: linha negativa sozinha não prova pedido nenhum", () => {
    expect(devolucaoConcluidaPorInteiro([linha(-100)], 100)).toBe(false);
  });
});
