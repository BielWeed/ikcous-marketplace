import { mapOrderFromDB } from "@/lib/mappers";
import type { Address } from "@/types";
import type { Database } from "@/types/database.types";
import { describe, expect, it } from "vitest";

/**
 * Migration de dados 20261182000000 (o CPF da janela sai do endereço).
 *
 * O DEFEITO QUE A MIGRATION FECHA: pedido nacional de cliente logado criado
 * entre 23/09 e 26/09/2026 17:46 UTC nasceu com
 * `customer_data.address = {"cpf": "..."}` (a RPC ainda na 20261171000000
 * gravava `p_address_data` inteiro; o front já mandava só o CPF para quem
 * está logado). Esse objeto é `typeof === "object"` e TRUTHY em JS, então
 * VENCE o endereço de verdade (`row.address`, o JOIN com `user_addresses`)
 * na cadeia `||` de `addressSource` — o endereço de entrega aparecia em
 * branco no painel, no comprovante e em "Meus pedidos".
 *
 * A CURA: a migration move o CPF para `customer_data.cpf` (raiz) e deixa
 * `customer_data.address` como SQL `null` (nunca `{}` — `null` também é
 * `typeof === "object"`, mas é FALSY, então cai para a próxima fonte da
 * cadeia). Este teste prova a FORMA DEPOIS da migration: com `address: null`
 * e `cpf` na raiz, o mapper volta a mostrar o endereço do JOIN — e prova, em
 * contraste, que a forma ANTES (o defeito) realmente ficava em branco.
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
  created_at: "2026-09-24T10:00:00.000Z",
  customer_data: {},
  customer_name: "Joana",
  customer_phone: null,
  discount: null,
  expires_at: null,
  gateway_payment_id: null,
  id: "ped-janela-cpf",
  idempotency_key: null,
  notes: null,
  observation: null,
  paid_at: null,
  pagamento_recebido_em: null,
  pagamento_recebido_por: null,
  payment_method: null,
  payment_status: "pago",
  returned_to_seller_at: null,
  valor_estornado: 0,
  tentativas_de_pagamento: 0,
  metodo_online: null,
  parcelas: null,
  shipping: 25,
  shipping_cost: null,
  shipping_label_id: null,
  shipping_label_url: null,
  status: "pending",
  stock_returned_at: null,
  estorno_manual_registrado_em: null,
  subtotal: 100,
  total: 125,
  total_amount: null,
  tracking_code: null,
  updated_at: "2026-09-24T11:00:00.000Z",
  user_id: "u-1",
  vendedor_id: null,
};

/** O endereço de verdade, vindo do JOIN com `user_addresses` (nunca muda
 * nesta migration — só `customer_data` é reescrito). */
const enderecoDoJoin: Address = {
  id: "end-1",
  user_id: "u-1",
  name: "Casa",
  recipient_name: "Joana",
  cep: "38400-000",
  street: "Rua das Flores",
  number: "10",
  complement: "",
  neighborhood: "Centro",
  city: "Uberlândia",
  state: "MG",
  reference: "",
  is_default: true,
};

const CPF = "11144477735";

describe("mapOrderFromDB — pedido da janela do bug do CPF (migration 20261182000000)", () => {
  it("ANTES da migration: customer_data.address = {cpf} sozinho VENCE o JOIN e o endereço fica em branco (o defeito medido)", () => {
    const pedido = mapOrderFromDB({
      ...PEDIDO_BASE,
      address: enderecoDoJoin,
      customer_data: {
        whatsapp: "34999990000",
        address: { cpf: CPF },
        shipping_option_id: "correios-pac",
      },
    } as OrderRow & { address: Address });

    expect(pedido.customer.address).toBe("");
    expect(pedido.customer.city).toBe("");
    expect(pedido.customer.cep).toBe("");
  });

  it("DEPOIS da migration: address vira null e o cpf sobe para a raiz -- o mapper volta a mostrar o endereço do JOIN", () => {
    const pedido = mapOrderFromDB({
      ...PEDIDO_BASE,
      address: enderecoDoJoin,
      customer_data: {
        whatsapp: "34999990000",
        cpf: CPF,
        address: null,
        shipping_option_id: "correios-pac",
      },
    } as OrderRow & { address: Address });

    expect(pedido.customer.address).toBe(enderecoDoJoin.street);
    expect(pedido.customer.number).toBe(enderecoDoJoin.number);
    expect(pedido.customer.city).toBe(enderecoDoJoin.city);
    expect(pedido.customer.state).toBe(enderecoDoJoin.state);
    expect(pedido.customer.cep).toBe(enderecoDoJoin.cep);
    // CPF continua no banco -- nunca espalhado para o pedido mapeado (mesma
    // régua de mapper-cpf-nao-vai-para-o-cache.test.ts), que é o que vai
    // para o cache de pedidos do localStorage.
    expect(JSON.stringify(pedido)).not.toContain(CPF);
    expect("cpf" in pedido.customer).toBe(false);
  });

  it("DEPOIS da migration, quando o pedido foi APENAS limpo (cpf inválido/local/retirada): sem cpf na raiz, o JOIN também vence", () => {
    const pedido = mapOrderFromDB({
      ...PEDIDO_BASE,
      address: enderecoDoJoin,
      customer_data: {
        whatsapp: "34999990000",
        address: null,
        shipping_option_id: "store-pickup",
        pickup_address: "Loja, Rua Y",
      },
    } as OrderRow & { address: Address });

    expect(pedido.customer.address).toBe(enderecoDoJoin.street);
    expect(pedido.customer.city).toBe(enderecoDoJoin.city);
  });
});
