// O aviso (push) e a mensagem de WhatsApp que a lojista dispara falam COM A
// CLIENTE, então usam o nome da etapa como a cliente lê no app
// (ROTULOS_DAS_ETAPAS), não o rótulo do painel ("Em Trânsito", "Finalizado",
// "Novo Pedido"). O toast da própria lojista continua no vocabulário dela.
import { rotuloDoStatusParaACliente } from "@/lib/mensagem-do-status-no-whatsapp";
import { describe, expect, it } from "vitest";

describe("rotuloDoStatusParaACliente", () => {
  it("entrega: cada status vira o nome da etapa que o app da cliente mostra", () => {
    expect(rotuloDoStatusParaACliente("pending")).toBe("Recebido");
    expect(rotuloDoStatusParaACliente("processing")).toBe("Separado");
    expect(rotuloDoStatusParaACliente("shipping")).toBe("A caminho");
    expect(rotuloDoStatusParaACliente("delivered")).toBe("Entregue");
    expect(rotuloDoStatusParaACliente("cancelled")).toBe("Cancelado");
  });

  it("retirada na loja: 'shipping' é 'Pronto para retirar' e 'delivered' é 'Retirado'; o resto não muda", () => {
    expect(rotuloDoStatusParaACliente("shipping", true)).toBe(
      "Pronto para retirar",
    );
    // Ninguém "entrega" nada na retirada: o app da cliente diz "Retirado".
    expect(rotuloDoStatusParaACliente("delivered", true)).toBe("Retirado");
    expect(rotuloDoStatusParaACliente("delivered", false)).toBe("Entregue");
    expect(rotuloDoStatusParaACliente("cancelled", true)).toBe("Cancelado");
    expect(rotuloDoStatusParaACliente("pending", true)).toBe("Recebido");
  });

  it("nunca devolve o vocabulário do painel nem o valor cru do banco", () => {
    const proibidos = ["Em Trânsito", "Finalizado", "Novo Pedido", "shipping"];
    for (const status of [
      "pending",
      "processing",
      "shipping",
      "delivered",
      "cancelled",
      "new",
    ]) {
      expect(proibidos).not.toContain(rotuloDoStatusParaACliente(status));
    }
  });
});
