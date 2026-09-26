import { mapOrderFromDB } from "@/lib/mappers";
import type { Database } from "@/types/database.types";
import { describe, expect, it } from "vitest";

/**
 * Migration 20261181000000 (achado LGPD, alto — auditoria de 26/09/2026):
 * `get_orders_by_otp_v1` (a RPC que a tela de rastreio por OTP chama via
 * `fetchOrdersByOtp`, `src/hooks/useOrders.ts:3415`) para de devolver `cpf`
 * dentro de `customer_data` — nem no nível raiz, nem dentro de
 * `customer_data.address` (janela 23-26/09, antes de o INSERT do pedido
 * aprender a tirar a chave do endereço).
 *
 * Este teste prova que a tela CONTINUA funcionando: o pedido mapeado por
 * `mapOrderFromDB` — a mesma tradução que `fetchOrdersByOtp` usa em cima do
 * envelope `{ ok, orders }` — sai IDÊNTICO em todos os campos que a tela
 * usa (nome, whatsapp, endereço completo), com ou sem CPF no
 * `customer_data` que a RPC manda. Se a implementação do strip sumisse (o
 * corpo voltasse a mandar CPF), este teste continuaria passando — quem prova
 * a REMOÇÃO em si é o teste de banco (tests/migration_pedido_por_whatsapp_
 * fecha_para_anon_test.ts); este aqui prova que a remoção é INÓCUA para a
 * tela, o motivo pelo qual esta migration pôde tirar o campo sem quebrar
 * nada.
 */

type OrderRow = Database["public"]["Tables"]["marketplace_orders"]["Row"];

const PEDIDO_BASE: OrderRow = {
  address_id: null,
  canal: "online",
  cancelled_after_shipping: false,
  confirmation_email_sent_at: null,
  coupon_code: null,
  coupon_id: null,
  coupon_usage_returned: false,
  created_at: "2026-09-20T10:00:00.000Z",
  customer_data: {},
  customer_name: "Joana",
  customer_phone: null,
  discount: null,
  expires_at: null,
  gateway_payment_id: null,
  id: "ped-otp-1",
  idempotency_key: null,
  notes: null,
  observation: null,
  paid_at: null,
  pagamento_recebido_em: null,
  pagamento_recebido_por: null,
  payment_method: "pix",
  payment_status: "pago",
  returned_to_seller_at: null,
  valor_estornado: 0,
  tentativas_de_pagamento: 0,
  metodo_online: "pix",
  parcelas: null,
  shipping: 15,
  shipping_cost: null,
  shipping_label_id: null,
  shipping_label_url: null,
  status: "shipping",
  stock_returned_at: null,
  estorno_manual_registrado_em: null,
  subtotal: 100,
  total: 115,
  total_amount: null,
  tracking_code: "BR123456789",
  updated_at: "2026-09-20T11:00:00.000Z",
  user_id: null,
  vendedor_id: null,
};

const ENDERECO_SEM_CPF = {
  cep: "01001000",
  street: "Praça da Sé",
  number: "1",
  neighborhood: "Sé",
  city: "São Paulo",
  state: "SP",
};

const CUSTOMER_DATA_COM_CPF = {
  whatsapp: "34999998888",
  cpf: "52998224725",
  address: { ...ENDERECO_SEM_CPF, cpf: "52998224725" },
};

// O formato que a RPC manda DEPOIS desta migration: exatamente o mesmo
// customer_data, sem a chave `cpf` em lugar nenhum (nem raiz, nem address) —
// é isso que a CASE de get_orders_by_otp_v1 produz.
const CUSTOMER_DATA_SEM_CPF = {
  whatsapp: "34999998888",
  address: { ...ENDERECO_SEM_CPF },
};

describe("mapOrderFromDB — a tela de rastreio por OTP não depende do CPF", () => {
  it("o pedido mapeado é igual, campo a campo, com ou sem cpf no customer_data que a RPC manda", () => {
    const comCpf = mapOrderFromDB({
      ...PEDIDO_BASE,
      customer_data: CUSTOMER_DATA_COM_CPF,
    } as OrderRow);
    const semCpf = mapOrderFromDB({
      ...PEDIDO_BASE,
      customer_data: CUSTOMER_DATA_SEM_CPF,
    } as OrderRow);

    expect(semCpf).toEqual(comCpf);
  });

  it("endereço, whatsapp e nome continuam corretos quando a RPC já manda sem cpf (formato pós-20261181000000)", () => {
    const pedido = mapOrderFromDB({
      ...PEDIDO_BASE,
      customer_data: CUSTOMER_DATA_SEM_CPF,
    } as OrderRow);

    expect(pedido.customer.name).toBe("Joana");
    expect(pedido.customer.whatsapp).toBe("34999998888");
    expect(pedido.customer.address).toBe("Praça da Sé");
    expect(pedido.customer.number).toBe("1");
    expect(pedido.customer.neighborhood).toBe("Sé");
    expect(pedido.customer.city).toBe("São Paulo");
    expect(pedido.customer.state).toBe("SP");
    expect(pedido.customer.cep).toBe("01001000");
    expect("cpf" in pedido.customer).toBe(false);
    expect(JSON.stringify(pedido)).not.toContain("52998224725");
  });
});
