import { mapOrderFromDB } from "@/lib/mappers";
import type { Database } from "@/types/database.types";
import { describe, expect, it } from "vitest";

/**
 * src/lib/mappers.ts — mapOrderFromDB (:190) precisa carregar os dois campos
 * novos de `docs/superpowers/plans/2026-08-24-cancelamento-com-estorno.md`
 * (Task 3): se o pedido já tinha saído quando foi cancelado, e quando o
 * produto voltou à mão do lojista.
 *
 * O banco ainda não tem as colunas geradas em `database.types.ts` (migration
 * da Task 1, em paralelo, não aplicada) — por isso o `as never` no cast da
 * linha de entrada, igual ao plano pede.
 */

type OrderRow = Database["public"]["Tables"]["marketplace_orders"]["Row"];

/** Base copiada de tests/front/mappers.test.ts (PEDIDO_BASE) — não inventar o formato. */
const PEDIDO_BASE: OrderRow = {
  address_id: null,
  coupon_code: null,
  coupon_id: null,
  created_at: "2026-08-01T10:00:00.000Z",
  customer_data: {},
  customer_name: "Joana",
  customer_phone: null,
  discount: null,
  expires_at: null,
  gateway_payment_id: null,
  id: "ped-1",
  notes: null,
  observation: null,
  payment_method: null,
  payment_status: null,
  shipping: null,
  shipping_cost: null,
  status: null,
  subtotal: 100,
  total: 120,
  total_amount: null,
  tracking_code: null,
  updated_at: "2026-08-01T11:00:00.000Z",
  user_id: null,
};

describe("mapper do pedido — o estado do retorno do produto", () => {
  it("traz cancelled_after_shipping e returned_to_seller_at para o app", () => {
    const pedido = mapOrderFromDB({
      ...PEDIDO_BASE,
      cancelled_after_shipping: true,
      returned_to_seller_at: "2026-08-25T10:00:00Z",
    } as never);

    expect(pedido.cancelledAfterShipping).toBe(true);
    expect(pedido.returnedToSellerAt).toBe("2026-08-25T10:00:00Z");
  });

  it("pedido antigo, com as colunas ausentes, NAO vira 'já voltou'", () => {
    const pedido = mapOrderFromDB({ ...PEDIDO_BASE } as never);
    // O default do banco é false; o mapper não pode inventar true.
    expect(pedido.cancelledAfterShipping).toBe(false);
    expect(pedido.returnedToSellerAt ?? null).toBeNull();
  });
});
