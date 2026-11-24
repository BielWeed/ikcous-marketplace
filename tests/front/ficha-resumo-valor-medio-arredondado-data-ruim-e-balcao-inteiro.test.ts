// Caça por mutação na ficha do cliente (24/11/2026): três regras de
// `calcularResumoFicha` / `lerBalcaoDoMesmoWhatsapp` podiam ser removidas sem
// que nenhum teste caísse. Aqui cada uma ganha o seu caso de borda.
//   1. o valor médio por venda é arredondado em centavos (100 ÷ 3 = 33,33);
//   2. pedido com data ilegível não pode virar "Invalid Date" na última compra;
//   3. o balcão chega como número inteiro de pedidos (2,9 não vira 2,9 pedido).
// Só fixtures inventadas: nenhum dado de cliente de verdade.
import {
  calcularResumoFicha,
  lerBalcaoDoMesmoWhatsapp,
} from "@/components/admin/users/ficha-resumo";
import type { Order } from "@/types";
import { describe, expect, it } from "vitest";

function pedido(sobrescreve: Partial<Order>): Order {
  return {
    id: "pedido-prova",
    status: "delivered",
    total: 0,
    createdAt: "2026-08-01T12:00:00Z",
    paymentStatus: "pago",
    ...sobrescreve,
  } as unknown as Order;
}

describe("valor médio por venda da ficha — arredondado em centavos", () => {
  it("R$ 100 em 3 pedidos pagos dá R$ 33,33, não 33,3333…", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "a", total: 40 }),
      pedido({ id: "b", total: 30 }),
      pedido({ id: "c", total: 30 }),
    ]);
    expect(resumo.totalGasto).toBe(100);
    expect(resumo.ticketMedio).toBe(33.33);
  });

  it("arredonda para cima quando passa de meio centavo (R$ 20,02 ÷ 3)", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "a", total: 10 }),
      pedido({ id: "b", total: 10 }),
      pedido({ id: "c", total: 0.02 }),
    ]);
    // 2002 centavos ÷ 3 = 667,33 -> 667 -> R$ 6,67
    expect(resumo.ticketMedio).toBe(6.67);
  });

  it("o balcão também entra na conta em centavos (R$ 100 na conta + R$ 0,01 no balcão ÷ 2)", () => {
    const resumo = calcularResumoFicha([pedido({ id: "a", total: 100 })], {
      pedidos: 1,
      total: 0.01,
    });
    // 10001 centavos ÷ 2 = 5000,5 -> 5001 (Math.round) -> R$ 50,01
    expect(resumo.ticketMedio).toBe(50.01);
  });
});

describe("última compra da ficha — data ilegível não estraga a data boa", () => {
  it("pedido de data ilegível ANTES de um pedido bom: a última compra é a do bom", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "ruim", createdAt: "isto-nao-e-data" }),
      pedido({ id: "bom", createdAt: "2026-07-15T10:00:00Z" }),
    ]);
    expect(resumo.ultimaCompra?.toISOString()).toBe("2026-07-15T10:00:00.000Z");
  });

  it("pedido de data ilegível DEPOIS de um pedido bom: a última compra continua a do bom", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "bom", createdAt: "2026-07-15T10:00:00Z" }),
      pedido({ id: "ruim", createdAt: "" }),
    ]);
    expect(resumo.ultimaCompra?.toISOString()).toBe("2026-07-15T10:00:00.000Z");
  });

  it("só pedidos de data ilegível: não há última compra (nada de Invalid Date)", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "ruim", createdAt: "isto-nao-e-data" }),
    ]);
    expect(resumo.ultimaCompra).toBeNull();
    // ...mas o pedido continua contando e o dinheiro continua somando.
    expect(resumo.pedidosQueContam).toHaveLength(1);
  });
});

describe("balcão do mesmo WhatsApp — pedidos são sempre inteiros", () => {
  it("2,9 pedidos do servidor viram 2 (descarta a fração, não arredonda para cima)", () => {
    expect(lerBalcaoDoMesmoWhatsapp({ pedidos: 2.9, total: 50 })).toEqual({
      pedidos: 2,
      total: 50,
    });
  });

  it("o total de pedidos da ficha soma inteiros mesmo com fração vinda do servidor", () => {
    const resumo = calcularResumoFicha([pedido({ id: "a", total: 10 })], {
      pedidos: 2.9,
      total: 50,
    });
    expect(resumo.balcao.pedidos).toBe(2);
    expect(resumo.totalDePedidos).toBe(3);
    // R$ 60 ÷ (1 pago da conta + 2 do balcão) = R$ 20,00
    expect(resumo.ticketMedio).toBe(20);
  });

  it("menos de 1 pedido (0,9) não é balcão: a ficha fica como era", () => {
    expect(lerBalcaoDoMesmoWhatsapp({ pedidos: 0.9, total: 50 })).toEqual({
      pedidos: 0,
      total: 0,
    });
  });
});
