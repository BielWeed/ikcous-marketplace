import { mapOrderFromDB } from "@/lib/mappers";
import type { Database } from "@/types/database.types";
import { describe, expect, it } from "vitest";

/**
 * C4.1 — o mapper aprende a ler `canal` e `vendedor_id` (migration
 * 20261160000000). `environment: node` porque `mapOrderFromDB` é função pura,
 * sem DOM: não precisa da diretiva jsdom (a config global já é "node").
 *
 * Molde de fixture: tests/front/mappers.test.ts:92-138 (PEDIDO_BASE/pedido()),
 * mas aqui a linha é montada localmente com só as colunas que o mapper lê —
 * evita depender de toda a base do outro arquivo para um teste que é só sobre
 * duas colunas novas.
 */

type OrderRow = Database["public"]["Tables"]["marketplace_orders"]["Row"];

const PEDIDO_MINIMO: OrderRow = {
  address_id: null,
  canal: "online",
  cancelled_after_shipping: false,
  confirmation_email_sent_at: null,
  coupon_code: null,
  coupon_id: null,
  coupon_usage_returned: false,
  created_at: "2026-08-01T10:00:00.000Z",
  customer_data: {},
  customer_name: "Joana",
  customer_phone: null,
  discount: null,
  expires_at: null,
  gateway_payment_id: null,
  id: "ped-1",
  idempotency_key: null,
  notes: null,
  observation: null,
  paid_at: null,
  pagamento_recebido_em: null,
  pagamento_recebido_por: null,
  payment_method: null,
  payment_status: null,
  returned_to_seller_at: null,
  valor_estornado: 0,
  tentativas_de_pagamento: 0,
  metodo_online: null,
  parcelas: null,
  shipping: null,
  shipping_cost: null,
  shipping_label_id: null,
  shipping_label_url: null,
  status: "pending",
  stock_returned_at: null,
  estorno_manual_registrado_em: null,
  subtotal: 100,
  total: 120,
  total_amount: null,
  tracking_code: null,
  updated_at: "2026-08-01T11:00:00.000Z",
  user_id: null,
  vendedor_id: null,
};

function pedido(extra: Partial<OrderRow> = {}): OrderRow {
  return { ...PEDIDO_MINIMO, ...extra };
}

describe("mapOrderFromDB — canal e vendedorId (C4.1)", () => {
  it("linha com canal 'presencial' e vendedor_id vira {canal:'presencial', vendedorId}", () => {
    const o = mapOrderFromDB(
      pedido({ canal: "presencial", vendedor_id: "admin-uuid-1" }),
    );
    expect(o.canal).toBe("presencial");
    expect(o.vendedorId).toBe("admin-uuid-1");
  });

  it("linha com canal 'online' vira 'online' com vendedorId null", () => {
    const o = mapOrderFromDB(pedido({ canal: "online", vendedor_id: null }));
    expect(o.canal).toBe("online");
    expect(o.vendedorId).toBeNull();
  });

  it("linha sem a chave canal (fixture antiga) vira 'online' — nada velho quebra", () => {
    // A coluna é NOT NULL no banco, mas fixture de teste antiga (montada antes
    // da migration 20261160000000) pode não declarar a chave nenhuma. O
    // mapper lê via `(row as any).canal`, então uma chave ausente e uma
    // presente com `undefined` chegam ao mesmo `undefined` — é esse o caminho
    // que este teste prova.
    const semCanal = pedido({ canal: undefined as unknown as "online" });
    const o = mapOrderFromDB(semCanal);
    expect(o.canal).toBe("online");
  });

  it("não confia em lixo: 'PRESENCIAL' (maiúsculo) e 'balcao' (typo) viram 'online'", () => {
    expect(mapOrderFromDB(pedido({ canal: "PRESENCIAL" })).canal).toBe(
      "online",
    );
    expect(mapOrderFromDB(pedido({ canal: "balcao" })).canal).toBe("online");
  });

  it("vendedor_id nulo vira null, não undefined", () => {
    const o = mapOrderFromDB(pedido({ vendedor_id: null }));
    expect(o.vendedorId).toBeNull();
    expect(o.vendedorId).not.toBeUndefined();
  });
});

describe("mapOrderFromDB — canal no pedido do código por e-mail (get_orders_by_otp_v2)", () => {
  // A RPC do código não devolve a coluna `canal`, mas devolve `customer_data`,
  // onde a venda de balcão grava `canal: 'presencial'` (migration 20261280000000).
  const semColunaCanal = (extra: Partial<OrderRow> = {}) =>
    pedido({ canal: undefined as unknown as "online", ...extra });

  it("sem a coluna canal, customer_data.canal 'presencial' vira presencial", () => {
    const o = mapOrderFromDB(
      semColunaCanal({ customer_data: { canal: "presencial" } }),
    );
    expect(o.canal).toBe("presencial");
  });

  it("sem a coluna canal e sem o campo no customer_data (pedido online) continua online", () => {
    const o = mapOrderFromDB(
      semColunaCanal({ customer_data: { whatsapp: "34999998888" } }),
    );
    expect(o.canal).toBe("online");
  });

  it("a coluna canal 'presencial' continua valendo com customer_data vazio", () => {
    expect(mapOrderFromDB(pedido({ canal: "presencial" })).canal).toBe(
      "presencial",
    );
  });

  it("customer_data nulo ou fora de formato não quebra e vira online", () => {
    expect(mapOrderFromDB(semColunaCanal({ customer_data: null })).canal).toBe(
      "online",
    );
    expect(
      mapOrderFromDB(semColunaCanal({ customer_data: "texto" as never })).canal,
    ).toBe("online");
  });

  it("customer_data.canal fora de 'presencial' (lixo) continua online", () => {
    expect(
      mapOrderFromDB(semColunaCanal({ customer_data: { canal: "balcao" } }))
        .canal,
    ).toBe("online");
  });
});
