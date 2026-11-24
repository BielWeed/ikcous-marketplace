// Pedido novo chegando ao vivo na lista do painel: as fronteiras de
// `decidirRealtimeInsertAdmin` que o teste principal
// (`use-orders-realtime-insert-respeita-filtro.test.tsx`) deixa passar:
//   - "Em Aberto" também esconde o CANCELADO (não só o entregue);
//   - em qualquer página que não seja a primeira, recarrega (nunca insere);
//   - a busca casa por número, nome, cupom e rastreio, sem ligar para
//     maiúscula nem para espaço nas pontas.
// Quem decide "inserir" errado faz um pedido furar o topo de uma página que
// a lojista está vendo; quem decide "recarregar"/"ignorar" errado esconde o
// pedido que ela está procurando.
import { describe, expect, it, vi } from "vitest";

// O módulo do hook instancia o cliente Supabase ao ser importado; a função
// em julgamento não toca em rede nem em sessão (mesmo dublê do teste irmão).
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import {
  type ConsultaAdmin,
  decidirRealtimeInsertAdmin,
} from "@/hooks/useOrders";
import type { Order } from "@/types";

function pedido(sobre: Partial<Order> = {}): Order {
  return {
    id: "11111111-2222-3333-4444-5555aaaa9999",
    userId: undefined,
    customer: { name: "João da Silva" } as Order["customer"],
    items: [],
    total: 100,
    subtotal: 100,
    shipping: 0,
    discount: 0,
    paymentMethod: "cash",
    paymentStatus: null,
    status: "pending",
    createdAt: "2026-09-16T12:00:00.000Z",
    updatedAt: "2026-09-16T12:00:00.000Z",
    ...sobre,
  } as Order;
}

function consulta(
  page: number,
  statusFilter?: string,
  searchQuery?: string,
): ConsultaAdmin {
  return [page, 12, statusFilter, searchQuery, undefined, undefined, false];
}

describe("decidirRealtimeInsertAdmin — 'Em Aberto'", () => {
  it.each([
    ["pending", "inserir"],
    ["processing", "inserir"],
    ["shipping", "inserir"],
    ["delivered", "ignorar"],
    ["cancelled", "ignorar"],
  ] as const)(
    "pedido novo '%s' com 'Em Aberto' ligado: %s",
    (status, esperado) => {
      expect(
        decidirRealtimeInsertAdmin(pedido({ status }), consulta(0, "open")),
      ).toBe(esperado);
    },
  );
});

describe("decidirRealtimeInsertAdmin — página", () => {
  it.each([1, 2, 7])(
    "na página %i (não é a primeira) recarrega em vez de inserir no topo",
    (pagina) => {
      expect(
        decidirRealtimeInsertAdmin(pedido(), consulta(pagina, "all")),
      ).toBe("recarregar");
    },
  );

  it("página indefinida conta como a primeira: insere", () => {
    const semPagina: ConsultaAdmin = [
      undefined,
      12,
      "all",
      undefined,
      undefined,
      undefined,
      false,
    ];

    expect(decidirRealtimeInsertAdmin(pedido(), semPagina)).toBe("inserir");
  });
});

describe("decidirRealtimeInsertAdmin — a busca", () => {
  it("busca vazia ou só de espaços não filtra nada: insere", () => {
    expect(
      decidirRealtimeInsertAdmin(pedido(), consulta(0, "all", "   ")),
    ).toBe("inserir");
    expect(decidirRealtimeInsertAdmin(pedido(), consulta(0, "all", ""))).toBe(
      "inserir",
    );
  });

  it("acha pelo número do pedido (pedaço do id)", () => {
    expect(
      decidirRealtimeInsertAdmin(pedido(), consulta(0, "all", "aaaa9999")),
    ).toBe("inserir");
  });

  it("acha pelo nome, sem ligar para maiúscula na busca", () => {
    expect(
      decidirRealtimeInsertAdmin(pedido(), consulta(0, "all", "JOÃO DA")),
    ).toBe("inserir");
  });

  it("espaço nas pontas da busca não atrapalha", () => {
    expect(
      decidirRealtimeInsertAdmin(pedido(), consulta(0, "all", "  silva  ")),
    ).toBe("inserir");
  });

  it("acha pelo cupom usado", () => {
    expect(
      decidirRealtimeInsertAdmin(
        pedido({ couponCode: "VERAO10" }),
        consulta(0, "all", "verao10"),
      ),
    ).toBe("inserir");
  });

  it("acha pelo código de rastreio", () => {
    expect(
      decidirRealtimeInsertAdmin(
        pedido({ trackingCode: "BR123456789XX" }),
        consulta(0, "all", "br1234"),
      ),
    ).toBe("inserir");
  });

  it("texto que não está em nenhum campo conhecido manda recarregar (o banco também olha os itens e o telefone)", () => {
    expect(
      decidirRealtimeInsertAdmin(
        pedido({ couponCode: "VERAO10", trackingCode: "BR1" }),
        consulta(0, "all", "camiseta"),
      ),
    ).toBe("recarregar");
  });

  it("pedido sem cupom nem rastreio não quebra a busca por cupom", () => {
    expect(
      decidirRealtimeInsertAdmin(
        pedido({ couponCode: undefined, trackingCode: undefined }),
        consulta(0, "all", "verao10"),
      ),
    ).toBe("recarregar");
  });

  it("filtro de status que não bate ganha da busca: ignora, mesmo com o nome certo", () => {
    expect(
      decidirRealtimeInsertAdmin(
        pedido({ status: "pending" }),
        consulta(0, "cancelled", "joão"),
      ),
    ).toBe("ignorar");
  });
});
