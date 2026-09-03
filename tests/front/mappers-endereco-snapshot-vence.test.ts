import { mapOrderFromDB } from "@/lib/mappers";
import type { Address } from "@/types";
import type { Database } from "@/types/database.types";
import { describe, expect, it } from "vitest";

/**
 * Laudo cliente-pós-compra 02/09, achado #4 (parte mapper) — onda 2.
 *
 * O pedido logado mostrava o endereço ATUAL do perfil, não o da compra: o
 * mapper priorizava o endereço do JOIN vivo (`row.address`, junção com
 * `user_addresses` de agora) sobre o snapshot gravado no `customer_data` na
 * hora da compra. Consequência: editar ou apagar o endereço no perfil
 * REESCREVE/APAGA o "Endereço de Entrega" de pedido antigo — comprovante e
 * mediação de disputa perdem a verdade.
 *
 * A REGRA NOVA: snapshot é verdade de COMPRA. Se o `customer_data` traz um
 * snapshot (`addressData` ou `address`-objeto — é o que a RPC
 * `create_marketplace_order_v24` grava em `jsonb_build_object('address',
 * p_address_data)`, migration 20260960000000), ele vence SEMPRE. Sem
 * snapshot, o JOIN continua sendo usado — comportamento de hoje preservado.
 *
 * Função pura: roda sem DOM e sem rede, mesmo padrão de mappers.test.ts.
 */

type OrderRow = Database["public"]["Tables"]["marketplace_orders"]["Row"];

const PEDIDO_BASE: OrderRow = {
  address_id: "end-1",
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
  user_id: "u-1",
};

function pedido(
  extra: Partial<OrderRow> & { items?: never; address?: Address } = {},
) {
  return { ...PEDIDO_BASE, ...extra };
}

/** O endereço ATUAL do perfil — o que o JOIN `user_addresses` devolve hoje. */
const enderecoAtualDoPerfil: Address = {
  id: "end-1",
  user_id: "u-1",
  name: "Casa",
  recipient_name: "Joana",
  cep: "38500-000",
  street: "Rua NOVA (editada depois da compra)",
  number: "999",
  complement: "",
  neighborhood: "Centro Novo",
  city: "Cidade Atual",
  state: "MG",
  reference: "",
  is_default: true,
};

describe("mapOrderFromDB — o endereço do pedido é o da COMPRA (laudo #4)", () => {
  it("snapshot `customer_data.address` (formato da RPC v24) vence o JOIN vivo", () => {
    const o = mapOrderFromDB(
      pedido({
        address: enderecoAtualDoPerfil,
        customer_data: {
          // O que a RPC gravou no dia da compra (jsonb 'address').
          address: {
            street: "Rua Antiga da Compra",
            number: "10",
            neighborhood: "Centro",
            city: "Monte Carmelo",
            state: "MG",
            cep: "38500-100",
          },
        },
      }),
    );

    expect(o.customer.address).toBe("Rua Antiga da Compra");
    expect(o.customer.number).toBe("10");
    expect(o.customer.city).toBe("Monte Carmelo");
    expect(o.customer.cep).toBe("38500-100");
  });

  it("snapshot `customer_data.addressData` também vence o JOIN vivo", () => {
    const o = mapOrderFromDB(
      pedido({
        address: enderecoAtualDoPerfil,
        customer_data: {
          addressData: {
            street: "Rua Antiga da Compra",
            number: "77",
            city: "Patrocínio",
            state: "MG",
            cep: "38740-000",
          },
        },
      }),
    );

    expect(o.customer.address).toBe("Rua Antiga da Compra");
    expect(o.customer.number).toBe("77");
    expect(o.customer.city).toBe("Patrocínio");
  });

  it("o JOIN não vaza campo nenhum por cima do snapshot parcial", () => {
    // Snapshot que só tem rua e cidade. O endereço de entrega NÃO pode
    // herdar o cep/bairro do perfil ATUAL — meio comprovante velho, meio
    // perfil de hoje seria pior que qualquer um dos dois sozinhos.
    const o = mapOrderFromDB(
      pedido({
        address: enderecoAtualDoPerfil,
        customer_data: {
          address: { street: "Rua Antiga da Compra", city: "Monte Carmelo" },
        },
      }),
    );

    expect(o.customer.address).toBe("Rua Antiga da Compra");
    expect(o.customer.city).toBe("Monte Carmelo");
    expect(o.customer.cep).not.toBe(enderecoAtualDoPerfil.cep);
    expect(o.customer.neighborhood).not.toBe(
      enderecoAtualDoPerfil.neighborhood,
    );
  });

  it("sem snapshot, o JOIN continua sendo usado (comportamento de hoje preservado)", () => {
    const o = mapOrderFromDB(pedido({ address: enderecoAtualDoPerfil }));

    expect(o.customer.address).toBe(enderecoAtualDoPerfil.street);
    expect(o.customer.city).toBe(enderecoAtualDoPerfil.city);
    expect(o.customer.cep).toBe(enderecoAtualDoPerfil.cep);
  });
});
