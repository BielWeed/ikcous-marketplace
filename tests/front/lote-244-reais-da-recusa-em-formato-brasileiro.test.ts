import { reaisComVirgula } from "@/lib/devolucao";
import { describe, expect, it } from "vitest";

// O banco escreve o dinheiro das recusas e do histórico no formato americano.
// Na tela da lojista o valor tem de sair como no resto do app.
const nbsp = (s: string) => s.replace(/\u00a0/g, " ");

describe("lote 244 — reaisComVirgula nos formatos que o banco escreve", () => {
  it("sangria: ponto decimal, com e sem milhar", () => {
    expect(
      nbsp(reaisComVirgula("A sangria (R$ 150.00) é maior (R$ 100.00).")),
    ).toBe("A sangria (R$ 150,00) é maior (R$ 100,00).");
    expect(nbsp(reaisComVirgula("R$ 1500.00"))).toBe("R$ 1.500,00");
  });

  it("estorno: o zero da frente apagado pelo banco volta", () => {
    expect(nbsp(reaisComVirgula("disponível (R$ .00)"))).toBe(
      "disponível (R$ 0,00)",
    );
    expect(nbsp(reaisComVirgula("pedido (R$ .50)"))).toBe("pedido (R$ 0,50)");
  });

  it("histórico: milhar com vírgula americana", () => {
    expect(
      nbsp(reaisComVirgula("Reembolso de R$ 1,234.50 pelo Mercado Pago")),
    ).toBe("Reembolso de R$ 1.234,50 pelo Mercado Pago");
    expect(nbsp(reaisComVirgula("R$ 12,345.60"))).toBe("R$ 12.345,60");
  });

  it("o que já está em formato brasileiro não muda", () => {
    expect(reaisComVirgula("Faltam R$ 1.234,56 para fechar")).toBe(
      "Faltam R$ 1.234,56 para fechar",
    );
    expect(reaisComVirgula("R$ 0,50")).toBe("R$ 0,50");
  });
});

import { mensagemDeErroFinanceiro } from "@/lib/financeiro";

describe("lote 244 — a recusa da sangria sai com dinheiro brasileiro", () => {
  it("22023 com 'R$ 150.00' vira 'R$ 150,00'", () => {
    const texto = mensagemDeErroFinanceiro({
      code: "22023",
      message:
        "A sangria (R$ 150.00) é maior que o dinheiro esperado no caixa (R$ 1500.00).",
    });
    expect(nbsp(texto)).toBe(
      "A sangria (R$ 150,00) é maior que o dinheiro esperado no caixa (R$ 1.500,00).",
    );
  });
});
