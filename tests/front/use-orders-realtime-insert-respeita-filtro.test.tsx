// useOrders-1508 — o realtime INSERT do admin ignorava filtro de status,
// busca, período e página.
//
// O DEFEITO: `handleRealtimeInsert` fazia `[newOrder, ...prev]` para QUALQUER
// pedido novo, sem olhar a última consulta do painel (`ultimaConsultaAdminRef`
// — a mesma ref que `escolherRecargaDeReconexao`, em
// use-orders-reconexao-nao-zera-lista-do-admin.test.ts, usa para repetir
// página/filtro/busca/período). Com o filtro "Cancelado" aberto, um pedido
// `pending` novo furava no topo da lista de cancelados; com o PDV, uma venda
// presencial nascida `delivered` furava no topo de "Em Aberto"; na página 3,
// o card pulava pra lá; e `totalOrders` nunca mudava, deixando "Exibindo X–Y
// de Z" com o Z velho.
//
// `decidirRealtimeInsertAdmin` é essa decisão isolada (mesma ideia de
// `escolherRecargaDeReconexao`/`mesclarAtualizacaoRealtime`, acima dela em
// useOrders.ts): provar o caminho de dentro de `handleRealtimeInsert` exigiria
// montar o canal de realtime inteiro (channel/subscribe/leader election) só
// para medir uma decisão que não toca em rede nenhuma.
import { describe, expect, it, vi } from "vitest";

// Mesmo motivo do dublê em use-orders-reconexao-nao-zera-lista-do-admin.test.ts:
// importar o módulo do hook de verdade instancia o cliente Supabase, que
// tenta ler sessão do localStorage fora de um browser e derruba rejeições não
// tratadas no runner. A função em julgamento não toca em rede nem em sessão.
vi.mock("@/lib/supabase", () => ({ supabase: {} }));

import {
  type ConsultaAdmin,
  decidirRealtimeInsertAdmin,
} from "@/hooks/useOrders";
import type { Order } from "@/types";

/** Pedido mínimo, só com os campos que a decisão olha. */
function pedido(overrides: Partial<Order> = {}): Order {
  return {
    id: "pedido-novo",
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
    ...overrides,
  } as Order;
}

/** Consulta admin completa, na página/filtro dados — os campos que
 * `decidirRealtimeInsertAdmin` ignora (pageSize, silent, paymentStatus) vêm
 * com valor fixo, igual ao teste de `escolherRecargaDeReconexao`. */
function consulta(
  page: number,
  statusFilter?: string,
  searchQuery?: string,
  startDate?: string,
  endDate?: string,
): ConsultaAdmin {
  return [page, 12, statusFilter, searchQuery, startDate, endDate, false];
}

describe("decidirRealtimeInsertAdmin (#1508)", () => {
  it("sem consulta anterior: insere — nada foi carregado ainda pra ter filtro a preservar", () => {
    expect(decidirRealtimeInsertAdmin(pedido(), null)).toBe("inserir");
  });

  it("filtro 'all', página 0: insere e conta no total", () => {
    const decisao = decidirRealtimeInsertAdmin(
      pedido({ status: "pending" }),
      consulta(0, "all"),
    );
    expect(decisao).toBe("inserir");
  });

  it("filtro 'Cancelado' ativo, pedido novo 'pending': ignora — não pertence a esta visão nem ao total dela", () => {
    const decisao = decidirRealtimeInsertAdmin(
      pedido({ status: "pending" }),
      consulta(0, "cancelled"),
    );
    expect(decisao).toBe("ignorar");
  });

  it("filtro 'Em Aberto' ativo, pedido novo 'pending' (não é cancelled/delivered): insere", () => {
    const decisao = decidirRealtimeInsertAdmin(
      pedido({ status: "pending" }),
      consulta(0, "open"),
    );
    expect(decisao).toBe("inserir");
  });

  it("PDV: filtro 'Em Aberto' ativo, venda presencial nasce 'delivered': ignora", () => {
    // Cenário citado no achado: com o PDV, toda venda presencial nasce
    // 'delivered' — sem isto ela furava no topo de "Em Aberto".
    const decisao = decidirRealtimeInsertAdmin(
      pedido({ status: "delivered" }),
      consulta(0, "open"),
    );
    expect(decisao).toBe("ignorar");
  });

  it("busca 'maria' ativa, pedido de outro cliente: ignora", () => {
    const decisao = decidirRealtimeInsertAdmin(
      pedido({ customer: { name: "João da Silva" } as Order["customer"] }),
      consulta(0, "all", "maria"),
    );
    expect(decisao).toBe("ignorar");
  });

  it("busca 'maria' ativa, cliente 'Maria Souza': insere (contém, sem diferenciar maiúscula)", () => {
    const decisao = decidirRealtimeInsertAdmin(
      pedido({ customer: { name: "Maria Souza" } as Order["customer"] }),
      consulta(0, "all", "maria"),
    );
    expect(decisao).toBe("inserir");
  });

  it("período 2026-08-01..2026-08-18 ativo, pedido nasce fora do período (hoje): ignora", () => {
    const decisao = decidirRealtimeInsertAdmin(
      pedido({ createdAt: "2026-09-16T12:00:00.000Z" }),
      consulta(0, "all", "", "2026-08-01", "2026-08-18"),
    );
    expect(decisao).toBe("ignorar");
  });

  it("período ativo, pedido nasce dentro do período: insere", () => {
    const decisao = decidirRealtimeInsertAdmin(
      pedido({ createdAt: "2026-08-10T12:00:00.000Z" }),
      consulta(0, "all", "", "2026-08-01", "2026-08-18"),
    );
    expect(decisao).toBe("inserir");
  });

  it("pedido casa com o filtro mas a lojista está na página 3: recarrega, sem inserir direto na lista visível", () => {
    const decisao = decidirRealtimeInsertAdmin(
      pedido({ status: "pending" }),
      consulta(3, "all"),
    );
    expect(decisao).toBe("recarregar");
  });

  it("filtro de PAGAMENTO ativo (é filtro de servidor), página 0: recarrega — a RPC decide, sem repetir paymentStatusKey aqui", () => {
    const comPagamento: ConsultaAdmin = [
      0,
      12,
      "all",
      undefined,
      undefined,
      undefined,
      false,
      "aguardando",
    ];
    const decisao = decidirRealtimeInsertAdmin(
      pedido({ status: "pending" }),
      comPagamento,
    );
    expect(decisao).toBe("recarregar");
  });

  it("filtro de pagamento 'all' não conta como filtro: página 0 continua inserindo", () => {
    const semPagamento: ConsultaAdmin = [
      0,
      12,
      "all",
      undefined,
      undefined,
      undefined,
      false,
      "all",
    ];
    expect(
      decidirRealtimeInsertAdmin(pedido({ status: "pending" }), semPagamento),
    ).toBe("inserir");
  });

  it("pedido não casa com o filtro E a página não é 0: ignora — não pertence nem ao total desta visão (recarregar não mudaria nada)", () => {
    const decisao = decidirRealtimeInsertAdmin(
      pedido({ status: "pending" }),
      consulta(3, "cancelled"),
    );
    expect(decisao).toBe("ignorar");
  });
});
