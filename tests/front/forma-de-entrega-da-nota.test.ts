// Redesenho da ficha do pedido (08/10/2026): a linha "Como vai: <nome> · <prazo>"
// do bloco Entrega lê a forma de entrega da nota do pedido ("Frete Escolhido:
// <nome> (Prazo: <prazo>)", gravada pelo checkout — ver `notaDoFreteEscolhido`
// em CheckoutView.tsx). Só LEITURA para exibir: quem decide compra de etiqueta
// continua sendo `elegibilidade-da-etiqueta.ts`, que não é tocada.
import { formaDeEntregaDaNota } from "@/lib/forma-de-entrega-da-nota";
import { describe, expect, it } from "vitest";

describe("formaDeEntregaDaNota", () => {
  it("lê nome e prazo da frase do checkout", () => {
    expect(
      formaDeEntregaDaNota("Frete Escolhido: Correios — SEDEX (Prazo: 3 dias)"),
    ).toEqual({ nome: "Correios — SEDEX", prazo: "3 dias" });
  });

  it("'1 dias' (o checkout não trata plural) vira '1 dia' — único ajuste de plural", () => {
    expect(
      formaDeEntregaDaNota("Frete Escolhido: Entrega local (Prazo: 1 dias)"),
    ).toEqual({ nome: "Entrega local", prazo: "1 dia" });
  });

  it("não mexe em '11 dias', '21 dias' nem em 'no mesmo dia'", () => {
    expect(
      formaDeEntregaDaNota("Frete Escolhido: A (Prazo: 11 dias)")?.prazo,
    ).toBe("11 dias");
    expect(
      formaDeEntregaDaNota("Frete Escolhido: A (Prazo: 21 dias)")?.prazo,
    ).toBe("21 dias");
    expect(
      formaDeEntregaDaNota("Frete Escolhido: A (Prazo: no mesmo dia)")?.prazo,
    ).toBe("no mesmo dia");
  });

  it("a ÚLTIMA ocorrência vence: texto livre ANTES da frase não engana (o checkout acrescenta no fim)", () => {
    expect(
      formaDeEntregaDaNota(
        "Cliente escreveu: Frete Escolhido: Falso (Prazo: 9 dias)\nFrete Escolhido: Loggi Ponto (Prazo: 3 dias)",
      ),
    ).toEqual({ nome: "Loggi Ponto", prazo: "3 dias" });
  });

  it("nome com parênteses (ex.: 'SuperFrete (PAC)') não corta o nome", () => {
    expect(
      formaDeEntregaDaNota("Frete Escolhido: SuperFrete (PAC) (Prazo: 5 dias)"),
    ).toEqual({ nome: "SuperFrete (PAC)", prazo: "5 dias" });
  });

  it.each([
    ["nota vazia", ""],
    ["só espaços", "   "],
    ["null", null],
    ["undefined", undefined],
    ["tipo errado", 42],
    ["nota sem a frase", "Entregar depois das 18h"],
    ["frase sem prazo", "Frete Escolhido: Correios"],
    [
      "retirada na loja (outra frase do checkout)",
      "Retirada na loja: Rua A, 10",
    ],
  ])("%s → null", (_nome, nota) => {
    expect(formaDeEntregaDaNota(nota)).toBeNull();
  });
});
