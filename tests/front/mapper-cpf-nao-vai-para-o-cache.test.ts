import { mapOrderFromDB } from "@/lib/mappers";
import type { Database } from "@/types/database.types";
import { describe, expect, it } from "vitest";

/**
 * Revisão Opus (23/09/2026) do CPF do destinatário: a migration 20261172
 * grava `customer_data.cpf` (11 dígitos). O pedido mapeado por
 * `mapOrderFromDB` é o que o `useOrders` guarda no cache de pedidos do
 * `localStorage` — e CPF nunca entra em storage do navegador. O mapper
 * tem de devolver o pedido SEM o CPF, sem perder o resto do customer_data.
 */

type OrderRow = Database["public"]["Tables"]["marketplace_orders"]["Row"];

const PEDIDO_BASE: OrderRow = {
  address_id: "end-1",
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
  shipping: null,
  shipping_cost: null,
  shipping_label_id: null,
  shipping_label_url: null,
  status: "pending",
  stock_returned_at: null,
  subtotal: 100,
  total: 120,
  total_amount: null,
  tracking_code: null,
  updated_at: "2026-08-01T11:00:00.000Z",
  user_id: "u-1",
  vendedor_id: null,
};

const CPF = "52998224725";

describe("mapOrderFromDB — CPF do destinatário fica no banco", () => {
  it("customer_data.cpf NÃO aparece em lugar nenhum do pedido mapeado (é ele que vai para o cache do localStorage)", () => {
    const pedido = mapOrderFromDB({
      ...PEDIDO_BASE,
      customer_data: {
        whatsapp: "34999998888",
        cpf: CPF,
        address: {
          cep: "01001000",
          street: "Praça da Sé",
          number: "1",
          neighborhood: "Sé",
          city: "São Paulo",
          state: "SP",
        },
      },
    } as OrderRow);

    expect(JSON.stringify(pedido)).not.toContain(CPF);
    expect("cpf" in pedido.customer).toBe(false);
    // O resto do customer_data continua chegando.
    expect(pedido.customer.whatsapp).toBe("34999998888");
    expect(pedido.customer.address).toBe("Praça da Sé");
  });
});
