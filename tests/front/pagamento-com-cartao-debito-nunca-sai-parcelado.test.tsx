// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

import { montarCorpoDoCartao } from "@/components/checkout/PagamentoComCartao";
import type { ConfigDoCartao } from "@/lib/config-do-cartao";

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ criarPagamento: vi.fn() }),
}));

const OS_DOIS: ConfigDoCartao = { credito: true, debito: true, parcelasMax: 6 };

// Dados fictícios do Brick; a única diferença entre os casos é o tipo do cartão.
const DADOS_DO_BRICK = {
  token: "tok-ficticio",
  issuer_id: "25",
  payment_method_id: "master",
  transaction_amount: 150,
  installments: 3,
  payer: {
    email: "cliente@exemplo.com",
    identification: { type: "CPF", number: "123.456.789-09" },
  },
};

describe("montarCorpoDoCartao — débito nunca sai parcelado", () => {
  it("envia uma parcela no débito mesmo quando o Brick entrega três", () => {
    const resultado = montarCorpoDoCartao({
      orderId: "ped-ficticio",
      dados: DADOS_DO_BRICK,
      adicionais: { paymentTypeId: "debit_card" },
      config: OS_DOIS,
      emailDeTeste: null,
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error(resultado.mensagem);
    expect(resultado.corpo.paymentTypeId).toBe("debit_card");
    expect(resultado.corpo.parcelas).toBe(1);
  });

  it("preserva as três parcelas entregues pelo Brick no crédito", () => {
    const resultado = montarCorpoDoCartao({
      orderId: "ped-ficticio",
      dados: DADOS_DO_BRICK,
      adicionais: { paymentTypeId: "credit_card" },
      config: OS_DOIS,
      emailDeTeste: null,
    });

    expect(resultado.ok).toBe(true);
    if (!resultado.ok) throw new Error(resultado.mensagem);
    expect(resultado.corpo.paymentTypeId).toBe("credit_card");
    expect(resultado.corpo.parcelas).toBe(3);
  });
});
