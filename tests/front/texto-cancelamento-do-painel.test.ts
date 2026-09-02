import { describe, expect, it } from "vitest";
import { textoCancelamentoDoPainel } from "../../src/lib/texto-cancelamento-do-painel";

describe("textoCancelamentoDoPainel — a pergunta muda com o dinheiro e a rota (laudo #2, L-1)", () => {
  it("pedido pago: avisa que o dinheiro NÃO volta automático e cita a lista de estorno", () => {
    for (const payment_status of [
      "pago",
      "pago_apos_expirar",
      "recebido_na_entrega",
    ]) {
      const texto = textoCancelamentoDoPainel({ payment_status });
      expect(texto).toContain("PAGO");
      expect(texto).toContain("não devolve o dinheiro automaticamente");
      expect(texto).toContain("Devolver agora");
    }
  });

  it("pedido em rota: avisa que a mercadoria não volta sozinha", () => {
    const texto = textoCancelamentoDoPainel({
      status: "shipping",
      payment_status: "aguardando",
    });
    expect(texto).toContain("saiu para entrega");
    expect(texto).toContain("fale com o cliente");
  });

  it("pedido novo sem dinheiro: fala do estoque e do aviso ao cliente", () => {
    const texto = textoCancelamentoDoPainel({
      status: "pending",
      payment_status: "aguardando",
    });
    expect(texto).toContain("O estoque volta");
    expect(texto).toContain("o cliente é avisado");
  });

  it("nenhum texto dispensa a pergunta — todos terminam perguntando", () => {
    for (const pedido of [
      { status: "pending", payment_status: "aguardando" },
      { status: "processing", payment_status: "pago" },
      { status: "shipping", payment_status: "aguardando" },
      {},
    ]) {
      expect(textoCancelamentoDoPainel(pedido).endsWith("?")).toBe(true);
    }
  });
});
