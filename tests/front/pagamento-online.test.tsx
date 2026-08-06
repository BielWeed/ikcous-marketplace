import { describe, expect, it } from "vitest";
import { lerFlagPagamentoOnline } from "@/lib/flags";

describe("flag de pagamento online", () => {
  it("liga apenas com a string exata 'true'", () => {
    expect(lerFlagPagamentoOnline("true")).toBe(true);
  });

  it("fica desligada para tudo o mais — inclusive ausente", () => {
    // Falha fechada de propósito: enquanto o webhook não existe (Fase 3),
    // ligar por engano faz TODO pedido pago expirar em 30 minutos.
    for (const v of [undefined, "", "false", "TRUE", "1", "yes", " true"]) {
      expect(lerFlagPagamentoOnline(v)).toBe(false);
    }
  });
});
