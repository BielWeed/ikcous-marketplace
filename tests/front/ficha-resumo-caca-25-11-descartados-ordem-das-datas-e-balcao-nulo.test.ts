// Caça por mutação na ficha do cliente (25/11/2026). Seis defeitos de uma
// linha em `calcularResumoFicha` / `lerBalcaoDoMesmoWhatsapp` passavam em todos
// os testes de função pura; cada bloco abaixo fecha um deles:
//   1. cancelado e devolvido ficam FORA da contagem e entram em "descartados"
//      (trocar `&&` por `||` os deixava dentro; trocar `-` por `+` inflava o
//      "ficaram fora");
//   2. a última compra é a MAIS RECENTE, em qualquer ordem da lista (o defeito
//      devolvia o primeiro ou o último pedido, conforme a ordem);
//   3. o campo do balcão chegando `null` (servidor antigo) não derruba a ficha;
//   4. o balcão SOMA ao total gasto (o defeito subtraía);
//   5. sem pedido pago, o valor médio é zero medido, nunca NaN.
// Só fixtures inventadas: nenhum dado de cliente de verdade.
import {
  type BalcaoDoMesmoWhatsapp,
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

describe("ficha do cliente — cancelado e devolvido ficam fora, e a ficha conta quantos", () => {
  it("1 entregue + 1 cancelado + 1 devolvido: conta 1, descarta 2, dinheiro só do entregue", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "ok", status: "delivered", total: 50 }),
      pedido({ id: "cancelado", status: "cancelled", total: 30 }),
      pedido({ id: "devolvido", status: "returned" as never, total: 20 }),
    ]);
    expect(resumo.pedidosQueContam.map((p) => p.id)).toEqual(["ok"]);
    expect(resumo.pedidosDescartados).toBe(2);
    expect(resumo.totalGasto).toBe(50);
    expect(resumo.totalDePedidos).toBe(1);
  });

  it("só pedidos cancelados: nada conta, 3 descartados, nenhuma última compra", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "a", status: "cancelled", total: 10 }),
      pedido({ id: "b", status: "cancelled", total: 20 }),
      pedido({ id: "c", status: "cancelled", total: 30 }),
    ]);
    expect(resumo.pedidosQueContam).toHaveLength(0);
    expect(resumo.pedidosDescartados).toBe(3);
    expect(resumo.totalGasto).toBe(0);
    expect(resumo.ultimaCompra).toBeNull();
  });

  it("só um devolvido (status que o tipo não lista, mas o banco pode mandar): fica fora", () => {
    const resumo = calcularResumoFicha([
      pedido({ id: "d", status: "returned" as never, total: 80 }),
    ]);
    expect(resumo.pedidosQueContam).toHaveLength(0);
    expect(resumo.pedidosDescartados).toBe(1);
    expect(resumo.totalGasto).toBe(0);
  });
});

describe("ficha do cliente — a última compra é a mais recente, em qualquer ordem da lista", () => {
  const velho = pedido({ id: "velho", createdAt: "2026-03-10T09:00:00Z" });
  const novo = pedido({ id: "novo", createdAt: "2026-07-20T09:00:00Z" });

  it("o mais recente vem primeiro na lista", () => {
    expect(calcularResumoFicha([novo, velho]).ultimaCompra?.toISOString()).toBe(
      "2026-07-20T09:00:00.000Z",
    );
  });

  it("o mais recente vem por último na lista", () => {
    expect(calcularResumoFicha([velho, novo]).ultimaCompra?.toISOString()).toBe(
      "2026-07-20T09:00:00.000Z",
    );
  });

  it("três datas embaralhadas: vence a do meio da lista quando é a maior", () => {
    const meio = pedido({ id: "meio", createdAt: "2026-09-05T09:00:00Z" });
    expect(
      calcularResumoFicha([velho, meio, novo]).ultimaCompra?.toISOString(),
    ).toBe("2026-09-05T09:00:00.000Z");
  });
});

describe("ficha do cliente — o balcão do mesmo WhatsApp", () => {
  it("campo `balcao_mesmo_whatsapp` nulo (servidor antigo) não derruba a leitura", () => {
    expect(lerBalcaoDoMesmoWhatsapp(null)).toEqual({ pedidos: 0, total: 0 });
  });

  it("valor que nem é objeto (texto, número) também vira 'sem balcão'", () => {
    expect(lerBalcaoDoMesmoWhatsapp("100")).toEqual({ pedidos: 0, total: 0 });
    expect(lerBalcaoDoMesmoWhatsapp(7)).toEqual({ pedidos: 0, total: 0 });
  });

  it("a ficha inteira aceita o balcão nulo e fica como era", () => {
    const resumo = calcularResumoFicha(
      [pedido({ id: "a", total: 40 })],
      null as unknown as BalcaoDoMesmoWhatsapp,
    );
    expect(resumo.totalGasto).toBe(40);
    expect(resumo.balcao).toEqual({ pedidos: 0, total: 0 });
    expect(resumo.totalDePedidos).toBe(1);
  });

  it("R$ 100 na conta + R$ 50 em 2 pedidos de balcão: total R$ 150, 3 pedidos, médio R$ 50", () => {
    const resumo = calcularResumoFicha([pedido({ id: "a", total: 100 })], {
      pedidos: 2,
      total: 50,
    });
    expect(resumo.totalDaConta).toBe(100);
    expect(resumo.totalGasto).toBe(150);
    expect(resumo.totalDePedidos).toBe(3);
    expect(resumo.ticketMedio).toBe(50);
  });
});

describe("ficha do cliente — sem nenhum pedido pago o valor médio é zero medido", () => {
  it("só pedido aguardando pagamento: total 0 e médio 0, nunca NaN", () => {
    const resumo = calcularResumoFicha([
      pedido({
        id: "pix",
        status: "pending",
        paymentStatus: "aguardando",
        total: 90,
      }),
    ]);
    expect(resumo.pedidosPagos).toHaveLength(0);
    expect(resumo.totalGasto).toBe(0);
    expect(resumo.ticketMedio).toBe(0);
    expect(Number.isNaN(resumo.ticketMedio)).toBe(false);
  });

  it("cliente sem nenhum pedido: tudo zero e sem data", () => {
    const resumo = calcularResumoFicha([]);
    expect(resumo.ticketMedio).toBe(0);
    expect(resumo.totalGasto).toBe(0);
    expect(resumo.totalDePedidos).toBe(0);
    expect(resumo.ultimaCompra).toBeNull();
  });
});
