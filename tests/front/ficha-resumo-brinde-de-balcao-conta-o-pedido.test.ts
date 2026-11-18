import {
  calcularResumoFicha,
  lerBalcaoDoMesmoWhatsapp,
} from "@/components/admin/users/ficha-resumo";
import { describe, expect, it } from "vitest";

describe("brinde de balcão conta na ficha sem inventar dinheiro", () => {
  it("aceita um pedido com total zero", () => {
    expect(lerBalcaoDoMesmoWhatsapp({ pedidos: 1, total: 0 })).toEqual({
      pedidos: 1,
      total: 0,
    });
  });

  it("continua recusando total negativo e NaN", () => {
    for (const total of [-1, Number.NaN]) {
      expect(lerBalcaoDoMesmoWhatsapp({ pedidos: 1, total })).toEqual({
        pedidos: 0,
        total: 0,
      });
    }
  });

  it("conta o brinde sozinho com total e média zero, sem divisão por zero", () => {
    const resumo = calcularResumoFicha([], { pedidos: 1, total: 0 });
    expect(resumo.totalDePedidos).toBe(1);
    expect(resumo.totalGasto).toBe(0);
    expect(resumo.ticketMedio).toBe(0);
  });
});
