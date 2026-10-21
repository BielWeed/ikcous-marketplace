// @ts-nocheck
/**
 * Testes de `provarPagamentoPelaConsulta` — a régua que decide se a consulta
 * autenticada do cliente (`criar-pagamento`, GET /v1/orders/{id}) PROVA que o
 * Mercado Pago capturou o pedido, e por isso pode confirmar na hora.
 *
 * O que erra caro aqui é o FALSO SIM: confirmar um pedido que não foi pago
 * (produto de graça), ou o pagamento de OUTRO pedido. Por isso cada recusa é
 * isolada: o objeto de partida passa, e o caso muda UM campo só — se a recusa
 * vier de outro campo por acidente, o motivo esperado não bate.
 *
 * Fixtures copiadas da doc oficial (URLs e o que é derivado no cabeçalho de
 * `prova-de-pagamento_fixtures.ts`): o cartão aprovado de
 * https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/cards
 * e o GET da referência
 * https://www.mercadopago.com.br/developers/en/reference/online-payments/checkout-api/get-order/get
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  avisarJurosSemParcelaConferida,
  conferirValorDoPagamento,
  estornoIntegralComJurosComprovado,
  provarPagamentoPelaConsulta,
} from "./prova-de-pagamento.ts";
import {
  orderCartaoAprovadaDaDoc,
  orderDoGetDaReferenciaDaDoc,
  orderPixPagaDaDoc,
} from "./prova-de-pagamento_fixtures.ts";

for (const valor of [undefined, null, NaN, Infinity, -Infinity, "149.90", 0, -1]) {
  Deno.test(`conferência compartilhada: valor não normalizado ${String(valor)} recusa`, () => {
    assertEquals(conferirValorDoPagamento(valor, 149.9), { provado: false, motivo: "valor_ausente" });
  });
}

for (const total of [undefined, null, NaN, Infinity, -Infinity, "ilegível", "", true, {}, 0, -1]) {
  Deno.test(`conferência compartilhada: total imprestável ${String(total)} recusa`, () => {
    assertEquals(conferirValorDoPagamento(149.9, total), { provado: false, motivo: "total_do_pedido" });
  });
}

Deno.test("conferência compartilhada: mantém total numérico em string e tolerância de 4/6 centavos", () => {
  assertEquals(conferirValorDoPagamento(150, "150.00"), { provado: true, valor: 150, total: 150 });
  assertEquals(conferirValorDoPagamento(149.96, 150), { provado: true, valor: 149.96, total: 150 });
  assertEquals(conferirValorDoPagamento(149.94, 150), { provado: false, motivo: "valor_divergente" });
});

for (const [valor, total, esperado] of [
  [59.699999999999996, 59.75, true],
  [59.75, 59.699999999999996, true],
  [100.05, 100, true],
  [99.95, 100, true],
  [59.69, 59.75, false],
  [59.81, 59.75, false],
]) {
  Deno.test(`conferência em centavos: ${valor} contra ${total} → ${esperado}`, () => {
    assertEquals(conferirValorDoPagamento(valor, total).provado, esperado);
  });
}

Deno.test("conferência em centavos: captura à vista no limite de cinco centavos", () => {
  const order = {
    total_paid_amount: "59.70",
    transactions: { payments: [{ payment_method: { type: "credit_card", installments: 1 } }] },
  };
  assertEquals(conferirValorDoPagamento(59.65, 59.65, order).provado, true);
  order.total_paid_amount = "59.71";
  assertEquals(conferirValorDoPagamento(59.65, 59.65, order).provado, false);
});

const PEDIDO = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const OUTRO_PEDIDO = "9e9e9e9e-1111-2222-3333-444455556666";
const VAGA = "ORD01JS2V6CM8KJ0EC4H502TGK1WP";

function base(order: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return {
    origem: "get_por_id",
    idConsultado: VAGA,
    vagaRelida: VAGA,
    pedidoId: PEDIDO,
    totalRelido: 100,
    order,
    ...extra,
  };
}

// Base derivada coerente: a doc publica 200 pagos em cartão 1x de 50.
// O exemplo literal continua testado abaixo, mas não serve de prova de juros.
const cartao = () => ({
  ...orderCartaoAprovadaDaDoc({ id: VAGA, externalReference: PEDIDO, valor: "100.00" }),
  total_paid_amount: "100.00",
});
const pix = () => orderPixPagaDaDoc({ id: VAGA, externalReference: PEDIDO, valor: "100.00" });

function pagamento(o: Record<string, unknown>): Record<string, unknown> {
  return ((o.transactions as Record<string, unknown>).payments as Array<Record<string, unknown>>)[0];
}

for (const tipo of ["bank_transfer", "credit_card", "debit_card"]) {
  for (const [capturado, esperado] of [["49.97", true], ["49.96", false], ["50.07", true]]) {
    Deno.test(`L3a-R2-W5: captura ${capturado} contra 50,02 em ${tipo} usa centavos`, () => {
      const o = tipo === "bank_transfer" ? pix() : cartao();
      o.total_amount = "50.02";
      o.total_paid_amount = capturado;
      pagamento(o).amount = "50.02";
      pagamento(o).payment_method = { type: tipo, installments: 1 };
      const prova = provarPagamentoPelaConsulta(base(o, { totalRelido: 50.02 }));
      assertEquals(prova.provado, esperado);
      if (!esperado) assertEquals(prova.motivo, "valor_pago");
    });
  }
}

Deno.test("L3a-R2-W5: aviso de juros respeita limite de cinco centavos em inteiro", () => {
  const o = cartao();
  o.total_amount = "59.65";
  o.total_paid_amount = "59.70";
  pagamento(o).amount = o.total_amount;
  pagamento(o).payment_method = { type: "credit_card", installments: 2 };
  const logs = [];
  const original = console.warn;
  console.warn = (...args) => logs.push(args);
  try {
    avisarJurosSemParcelaConferida(PEDIDO, 59.65, o);
    assertEquals(logs, [], "cinco centavos não são juros");
    o.total_paid_amount = "59.71";
    avisarJurosSemParcelaConferida(PEDIDO, 59.65, o);
    assertEquals(logs.length, 1);
  } finally {
    console.warn = original;
  }
});

Deno.test("L3a-R2-W1: prova integral financiada soma centavos, não duplica IDs e recusa qualquer dúvida", () => {
  const o = cartao();
  o.total_amount = "40.86";
  o.total_paid_amount = "40.86";
  pagamento(o).amount = "40.86";
  pagamento(o).payment_method = { type: "credit_card", installments: 2, installment_amount: "20.43" };
  const refund = { id: "REF1", amount: "40.86", status: "processed" };
  const provar = (refunds, order = o, status = "processed") =>
    estornoIntegralComJurosComprovado(order, 37.27, refunds, status);
  assertEquals(provar([refund]), true);
  assertEquals(provar([{ ...refund, status: "approved" }], o, "approved"), true);
  assertEquals(provar([
    { ...refund, amount: "20.43" }, { ...refund, id: "REF2", amount: 20.429999999999996 },
  ]), true);
  assertEquals(provar([
    { ...refund, amount: "20.43" }, { ...refund, amount: "20.43" },
  ]), false, "o mesmo refund não pode provar duas devoluções");
  assertEquals(provar([
    { ...refund, amount: "20.43" }, { ...refund, amount: "40.86" },
  ]), false, "um ID com valores contraditórios não prova");
  for (const status of ["processing", "rejected", "cancelled", "in_process", "approved"]) {
    assertEquals(provar([{ ...refund, status }]), false, status);
  }
  for (const amount of [undefined, null, "", "ilegível", NaN, Infinity, true, 0, -1, "40.85"]) {
    assertEquals(provar([{ ...refund, amount }]), false, String(amount));
  }
  assertEquals(provar([{ amount: "40.86", status: "processed" }]), false, "sem identidade não prova a soma");
  assertEquals(provar([{ ...refund, amount: "10.00" }, { ...refund, id: "REF2", status: "processing" }]), false);
  for (const metodo of [
    { type: "credit_card", installments: 1, installment_amount: "40.86" },
    { type: "debit_card", installments: 2, installment_amount: "20.43" },
    { type: "bank_transfer", installments: 2, installment_amount: "20.43" },
  ]) {
    const alterada = structuredClone(o);
    pagamento(alterada).payment_method = metodo;
    assertEquals(provar([refund], alterada), false, JSON.stringify(metodo));
  }
  for (const principal of ["37.27", "40.86"]) {
    for (const parcela of [undefined, "18.64"]) {
      const alterada = structuredClone(o);
      alterada.total_amount = principal;
      pagamento(alterada).amount = principal;
      pagamento(alterada).payment_method = { type: "credit_card", installments: 2 };
      if (parcela !== undefined) pagamento(alterada).payment_method.installment_amount = parcela;
      const aprovado = conferirValorDoPagamento(Number(principal), 37.27, alterada).provado;
      assertEquals(aprovado, principal === "37.27");
      assertEquals(provar([refund], alterada), aprovado, "estorno usa a mesma régua da aprovação");
    }
  }
  const semJuros = structuredClone(o);
  semJuros.total_amount = "37.27";
  semJuros.total_paid_amount = "37.27";
  pagamento(semJuros).amount = "37.27";
  pagamento(semJuros).payment_method.installment_amount = "18.64";
  assertEquals(provar([refund], semJuros), false, "o ledger continua dono do refund sem juros");
});

Deno.test("prova: exemplo contraditório da doc não prova juros — 200 pagos num cartão 1x de 100 recusa", () => {
  const literal = orderCartaoAprovadaDaDoc({ id: VAGA, externalReference: PEDIDO, valor: "100.00" });
  assertEquals(provarPagamentoPelaConsulta(base(literal)), { provado: false, motivo: "valor_divergente" });
});

Deno.test("prova: o PIX pago (exemplo da doc com o par processed:accredited) passa", () => {
  assertEquals(provarPagamentoPelaConsulta(base(pix())), { provado: true, valor: 100, valorPago: 100 });
});

Deno.test("D7: Pix preserva captura >= pedido, mas não recebe exceção no total da order", () => {
  const o = pix();
  o.total_paid_amount = "112.40";
  assertEquals(provarPagamentoPelaConsulta(base(o)).provado, true);
  o.total_amount = "112.40";
  pagamento(o).amount = "112.40";
  assertEquals(provarPagamentoPelaConsulta(base(o)), { provado: false, motivo: "valor_divergente" });
});

Deno.test("prova: o GET da REFERÊNCIA, como publicado, é RECUSADO — traz um chargeback in_process ao lado da raiz processed:accredited", () => {
  const o = orderDoGetDaReferenciaDaDoc({ id: VAGA, externalReference: PEDIDO });
  assertEquals(provarPagamentoPelaConsulta(base(o, { totalRelido: 50 })), { provado: false, motivo: "chargeback" });
});

Deno.test("prova: country_code \"BR\" (referência do GET) e \"BRA\" (páginas de cartão/PIX) passam — as duas grafias publicadas do Brasil", () => {
  for (const pais of ["BR", "BRA"]) {
    assertEquals(provarPagamentoPelaConsulta(base({ ...cartao(), country_code: pais })).provado, true, pais);
  }
});

Deno.test("prova: ausência NÃO recusa — sem currency, sem country_code, sem type na raiz, sem status/amount/paid_amount no pagamento", () => {
  const o = cartao();
  delete o.country_code;
  delete o.type;
  const p = pagamento(o);
  delete p.status;
  delete p.status_detail;
  delete p.amount;
  delete p.paid_amount;
  assertEquals(provarPagamentoPelaConsulta(base(o)), { provado: true, valor: 100, valorPago: 100 });
});

Deno.test("prova: juros — pago MAIOR que o pedido confirma (pela raiz e, sem a raiz, pelo paid_amount do pagamento)", () => {
  const pelaRaiz = cartao();
  pelaRaiz.total_paid_amount = "112.40";
  pagamento(pelaRaiz).payment_method = { type: "credit_card", installments: 2, installment_amount: "56.20" };
  assertEquals(provarPagamentoPelaConsulta(base(pelaRaiz)), { provado: true, valor: 100, valorPago: 112.4 });
  const peloPagamento = cartao();
  delete peloPagamento.total_paid_amount;
  pagamento(peloPagamento).paid_amount = "105.00";
  pagamento(peloPagamento).payment_method = { type: "credit_card", installments: 2, installment_amount: "52.50" };
  assertEquals(provarPagamentoPelaConsulta(base(peloPagamento)), { provado: true, valor: 100, valorPago: 105 });
});

Deno.test("prova: tolerância de centavo — 100,04 contra 100 passa (mesma régua do webhook, ±R$ 0,05)", () => {
  const o = cartao();
  o.total_amount = "100.04";
  pagamento(o).amount = "100.04";
  assertEquals(provarPagamentoPelaConsulta(base(o)).provado, true);
});

for (
  const caso of [
    {
      nome: "objeto que NÃO veio do GET por id (busca, POST, cancelamento, corpo de webhook)",
      montar: () => base(cartao(), { origem: "busca" }),
      motivo: "origem",
    },
    {
      nome: "id consultado diferente da vaga RELIDA (a vaga mudou depois do GET)",
      montar: () => base(cartao(), { idConsultado: "ORDOUTRAVAGA00000000000000000" }),
      motivo: "vaga",
    },
    {
      nome: "order.id diferente do id consultado",
      montar: () => base({ ...cartao(), id: "ORDOUTRAVAGA00000000000000000" }),
      motivo: "id",
    },
    {
      nome: "vaga relida é SENTINELA (`verificando:`)",
      montar: () => {
        const sentinela = `verificando:${PEDIDO}:c0:1700000000000`;
        return base({ ...cartao(), id: sentinela }, { idConsultado: sentinela, vagaRelida: sentinela });
      },
      motivo: "vaga",
    },
    {
      nome: "vaga relida é id CLÁSSICO (PIX legado, /v1/payments)",
      montar: () => base({ ...cartao(), id: "123456789" }, { idConsultado: "123456789", vagaRelida: "123456789" }),
      motivo: "vaga",
    },
    {
      nome: "vaga relida VAZIA",
      montar: () => base(cartao(), { vagaRelida: null }),
      motivo: "vaga",
    },
    {
      nome: "external_reference de OUTRO pedido",
      montar: () => base({ ...cartao(), external_reference: OUTRO_PEDIDO }),
      motivo: "referencia",
    },
    {
      nome: "external_reference AUSENTE",
      montar: () => {
        const o = cartao();
        delete o.external_reference;
        return base(o);
      },
      motivo: "referencia",
    },
    {
      nome: "100,06 contra 100 (acima da tolerância)",
      montar: () => {
        const o = cartao();
        o.total_amount = "100.06";
        pagamento(o).amount = "100.06";
        return base(o);
      },
      motivo: "valor_divergente",
    },
    {
      nome: "valor AUSENTE (nem total_amount nem amount)",
      montar: () => {
        const o = cartao();
        delete o.total_amount;
        delete pagamento(o).amount;
        return base(o);
      },
      motivo: "valor_ausente",
    },
    {
      nome: "valor ZERO",
      montar: () => {
        const o = cartao();
        o.total_amount = "0.00";
        pagamento(o).amount = "0.00";
        return base(o);
      },
      motivo: "valor_ausente",
    },
    {
      nome: "total do pedido relido imprestável (null)",
      montar: () => base(cartao(), { totalRelido: null }),
      motivo: "total_do_pedido",
    },
    { nome: "processed:partially_refunded", montar: () => base({ ...cartao(), status_detail: "partially_refunded" }), motivo: "status" },
    {
      nome: "action_required:waiting_capture",
      montar: () => base({ ...cartao(), status: "action_required", status_detail: "waiting_capture" }),
      motivo: "status",
    },
    {
      nome: "processing:in_process",
      montar: () => base({ ...cartao(), status: "processing", status_detail: "in_process" }),
      motivo: "status",
    },
    {
      nome: "\"approved\" na raiz (vocabulário da Payments API, não da Orders)",
      montar: () => base({ ...cartao(), status: "approved", status_detail: "accredited" }),
      motivo: "status",
    },
    {
      nome: "pagamento ESTORNADO (refunded) com a raiz ainda processed:accredited",
      montar: () => {
        const o = cartao();
        pagamento(o).status = "refunded";
        pagamento(o).status_detail = "refunded";
        return base(o);
      },
      motivo: "status_do_pagamento",
    },
    {
      nome: "pagamento processed com detalhe diferente de accredited",
      montar: () => {
        const o = cartao();
        pagamento(o).status_detail = "partially_refunded";
        return base(o);
      },
      motivo: "status_do_pagamento",
    },
    { nome: "moeda USD", montar: () => base({ ...cartao(), currency: "USD" }), motivo: "moeda" },
    { nome: "país URY", montar: () => base({ ...cartao(), country_code: "URY" }), motivo: "pais" },
    // Só "BR" e "BRA" são o Brasil: o prefixo "BR" não basta (BRN é Brunei).
    { nome: "país BRN (Brunei, começa com BR)", montar: () => base({ ...cartao(), country_code: "BRN" }), motivo: "pais" },
    { nome: "país \"BRAZIL\" (por extenso)", montar: () => base({ ...cartao(), country_code: "BRAZIL" }), motivo: "pais" },
    { nome: "order do tipo qr (presencial)", montar: () => base({ ...cartao(), type: "qr" }), motivo: "tipo" },
    {
      nome: "DOIS pagamentos na order",
      montar: () => {
        const o = cartao();
        const lista = (o.transactions as Record<string, unknown>).payments as Array<Record<string, unknown>>;
        lista.push({ ...lista[0], id: "PAY-SEGUNDO" });
        return base(o);
      },
      motivo: "pagamentos",
    },
    {
      nome: "NENHUM pagamento na order",
      montar: () => base({ ...cartao(), transactions: { payments: [] } }),
      motivo: "pagamentos",
    },
    {
      nome: "amount do pagamento diferente do total_amount da order",
      montar: () => {
        const o = cartao();
        pagamento(o).amount = "90.00";
        return base(o);
      },
      motivo: "valor_do_pagamento",
    },
    {
      nome: "raiz processed/accredited com total_paid_amount 0",
      montar: () => base({ ...cartao(), total_paid_amount: "0.00" }),
      motivo: "valor_pago",
    },
    {
      nome: "pago PARCIAL na raiz (60 de 100)",
      montar: () => base({ ...cartao(), total_paid_amount: "60.00" }),
      motivo: "valor_pago",
    },
    {
      nome: "pago PARCIAL no pagamento (60 de 100), sem a raiz",
      montar: () => {
        const o = cartao();
        delete o.total_paid_amount;
        pagamento(o).paid_amount = "60.00";
        return base(o);
      },
      motivo: "valor_pago",
    },
    {
      nome: "valor pago ilegível na raiz",
      montar: () => base({ ...cartao(), total_paid_amount: "abc" }),
      motivo: "valor_pago",
    },
    {
      nome: "valor pago AUSENTE (nem total_paid_amount nem paid_amount) — pendente, nunca afirma captura",
      montar: () => {
        const o = cartao();
        delete o.total_paid_amount;
        delete pagamento(o).paid_amount;
        return base(o);
      },
      motivo: "valor_pago_ausente",
    },
    {
      nome: "transactions.refunds NÃO vazio",
      montar: () => {
        const o = cartao();
        (o.transactions as Record<string, unknown>).refunds = [{ id: "REF1", amount: "10.00", status: "processed" }];
        return base(o);
      },
      motivo: "estorno",
    },
    {
      nome: "transactions.chargebacks NÃO vazio",
      montar: () => {
        const o = cartao();
        (o.transactions as Record<string, unknown>).chargebacks = [{ id: "CBK1", status: "in_process" }];
        return base(o);
      },
      motivo: "chargeback",
    },
    { nome: "country_code \"AR\"", montar: () => base({ ...cartao(), country_code: "AR" }), motivo: "pais" },
    { nome: "currency_id \"USD\"", montar: () => base({ ...cartao(), currency_id: "USD" }), motivo: "moeda" },
    { nome: "order que não é objeto", montar: () => base(null), motivo: "id" },
  ]
) {
  Deno.test(`prova RECUSA: ${caso.nome} -> '${caso.motivo}'`, () => {
    assertEquals(provarPagamentoPelaConsulta(caso.montar()), { provado: false, motivo: caso.motivo });
  });
}
