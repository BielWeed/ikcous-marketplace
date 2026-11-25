// Achado por mutação, 25/11/2026, em `mapOrderFromDB` (a CÓPIA do endereço no
// pedido). A suíte provava que o retrato da compra vence o endereço vivo do
// perfil, mas 9 mudanças de uma linha passavam todas verdes:
//   · `customer_data.address` em TEXTO (pedido antigo) tratado como retrato, o
//     que escondia o endereço do perfil (JOIN) que o pedido sem retrato usa;
//   · o texto flat do `customer_data` (rua, número, bairro...) ignorado quando
//     não há retrato nem JOIN;
//   · cada campo que o retrato NÃO trouxe (número, complemento, bairro, cidade,
//     UF, referência) deixando de vir do `customer_data` da raiz: o pedido
//     antigo mostrava "Rua X, " sem número ou sem o "apto 302" que o motoboy
//     precisa para tocar a campainha certa.
// Só dados fictícios.
import { mapOrderFromDB } from "@/lib/mappers";
import type { Address } from "@/types";
import type { Database } from "@/types/database.types";
import { describe, expect, it } from "vitest";

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
  user_id: "u-1",
  vendedor_id: null,
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
  street: "Rua Atual do Perfil",
  number: "999",
  complement: "Fundos",
  neighborhood: "Centro Novo",
  city: "Cidade Atual",
  state: "MG",
  reference: "Em frente ao mercado",
  is_default: true,
};

describe("mapOrderFromDB — endereço em texto (pedido antigo) não é retrato", () => {
  it("`customer_data.address` em texto: o endereço do perfil (JOIN) preenche a ficha", () => {
    const o = mapOrderFromDB(
      pedido({
        address: enderecoAtualDoPerfil,
        customer_data: { address: "Rua Texto Antiga, 10" },
      }),
    );
    expect(o.customer.address).toBe("Rua Atual do Perfil");
    expect(o.customer.number).toBe("999");
    expect(o.customer.complement).toBe("Fundos");
    expect(o.customer.neighborhood).toBe("Centro Novo");
    expect(o.customer.city).toBe("Cidade Atual");
    expect(o.customer.reference).toBe("Em frente ao mercado");
  });

  it("`customer_data.address` nulo também cai no endereço do perfil", () => {
    const o = mapOrderFromDB(
      pedido({
        address: enderecoAtualDoPerfil,
        customer_data: { address: null },
      }),
    );
    expect(o.customer.address).toBe("Rua Atual do Perfil");
    expect(o.customer.number).toBe("999");
  });

  it("texto do endereço sem retrato e sem perfil: a própria frase vira a rua", () => {
    const o = mapOrderFromDB(
      pedido({ customer_data: { address: "Rua Texto Antiga, 10" } }),
    );
    expect(o.customer.address).toBe("Rua Texto Antiga, 10");
  });
});

describe("mapOrderFromDB — campos soltos na raiz do customer_data", () => {
  it("sem retrato e sem perfil, a rua e os demais campos vêm da raiz", () => {
    const o = mapOrderFromDB(
      pedido({
        customer_data: {
          street: "Rua Solta da Raiz",
          number: "5",
          complement: "Casa 2",
          neighborhood: "Bairro Solto",
          city: "Cidade Solta",
          state: "SP",
          cep: "01310-100",
          reference: "Portão azul",
        },
      }),
    );
    expect(o.customer).toMatchObject({
      address: "Rua Solta da Raiz",
      number: "5",
      complement: "Casa 2",
      neighborhood: "Bairro Solto",
      city: "Cidade Solta",
      state: "SP",
      cep: "01310-100",
      reference: "Portão azul",
    });
  });

  it("retrato que não trouxe número, complemento, bairro, cidade, UF e referência: cada um vem da raiz, nunca do perfil de hoje", () => {
    const o = mapOrderFromDB(
      pedido({
        address: enderecoAtualDoPerfil,
        customer_data: {
          addressData: { street: "Rua da Compra", cep: "38500-100" },
          number: "7",
          complement: "Apto 302",
          neighborhood: "Bairro da Compra",
          city: "Cidade da Compra",
          state: "SP",
          reference: "Perto da praça",
        },
      }),
    );
    expect(o.customer).toMatchObject({
      address: "Rua da Compra",
      cep: "38500-100",
      number: "7",
      complement: "Apto 302",
      neighborhood: "Bairro da Compra",
      city: "Cidade da Compra",
      state: "SP",
      reference: "Perto da praça",
    });
  });

  it("retrato sem esses campos e raiz sem eles: ficam vazios, o perfil de hoje não os empresta", () => {
    const o = mapOrderFromDB(
      pedido({
        address: enderecoAtualDoPerfil,
        customer_data: { addressData: { street: "Rua da Compra" } },
      }),
    );
    expect(o.customer.address).toBe("Rua da Compra");
    expect(o.customer.number).toBe("");
    expect(o.customer.complement).toBe("");
    expect(o.customer.neighborhood).toBe("");
    expect(o.customer.city).toBe("");
    expect(o.customer.state).toBe("");
    expect(o.customer.reference).toBe("");
  });
});
