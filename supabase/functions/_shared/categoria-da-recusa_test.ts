/**
 * Testes da CATEGORIA da recusa do cartão (16/10/2026).
 *
 * O que se prova: o mapa fechado (cada `status_detail` conhecido cai na
 * categoria certa, com e sem o prefixo `cc_rejected_`), a categoria "outra"
 * como rede de segurança de TUDO o resto (inclusive lixo e nulos), a leitura
 * da order (detalhe do pagamento vence, depois o da raiz) e do corpo de erro
 * do 402 — e que nenhum valor devolvido é um código cru do MP.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  CATEGORIAS_DA_RECUSA,
  categoriaDaRecusaDaOrder,
  categoriaDaRecusaDoErro,
  categoriaDoStatusDetail,
} from "./categoria-da-recusa.ts";

const comESemPrefixo = (detalhe: string) => [detalhe, `cc_rejected_${detalhe}`];

for (
  const [categoria, detalhes] of [
    [
      "dados_do_cartao",
      [
        "bad_filled_card_data",
        "bad_filled_date",
        "bad_filled_other",
        "bad_filled_security_code",
        "bad_filled_card_number",
        "invalid_card_token",
      ],
    ],
    ["sem_limite", ["insufficient_amount", "card_insufficient_amount", "amount_limit_exceeded"]],
    ["banco_pediu_autorizacao", ["required_call_for_authorize", "call_for_authorize"]],
    ["banco_pediu_confirmacao", ["3ds_challenge_expired", "3ds_challenge", "3ds_challenge_failed"]],
  ] as const
) {
  for (const detalhe of detalhes) {
    for (const forma of comESemPrefixo(detalhe)) {
      Deno.test(`categoriaDoStatusDetail: '${forma}' -> ${categoria}`, () => {
        assertEquals(categoriaDoStatusDetail(forma), categoria);
      });
    }
  }
}

Deno.test("categoriaDoStatusDetail: os códigos do brief, literais, com e sem prefixo", () => {
  assertEquals(categoriaDoStatusDetail("cc_rejected_insufficient_amount"), "sem_limite");
  assertEquals(categoriaDoStatusDetail("cc_rejected_call_for_authorize"), "banco_pediu_autorizacao");
  assertEquals(categoriaDoStatusDetail("call_for_authorize"), "banco_pediu_autorizacao");
  assertEquals(categoriaDoStatusDetail("cc_rejected_3ds_challenge"), "banco_pediu_confirmacao");
  assertEquals(categoriaDoStatusDetail("cc_rejected_bad_filled_security_code"), "dados_do_cartao");
});

for (
  const detalhe of [
    "high_risk",
    "other_reason",
    "blacklist",
    "rejected_by_issuer",
    "card_disabled",
    "max_attempts_exceeded",
    "max_attempts",
    "duplicated_payment",
    "invalid_installments",
    "failed",
    "in_process",
  ]
) {
  for (const forma of comESemPrefixo(detalhe)) {
    Deno.test(`categoriaDoStatusDetail: '${forma}' -> outra (nunca exposto)`, () => {
      assertEquals(categoriaDoStatusDetail(forma), "outra");
    });
  }
}

Deno.test("categoriaDoStatusDetail: lixo, vazio e nulos -> outra, sem estourar", () => {
  for (
    const lixo of [
      undefined,
      null,
      "",
      "   ",
      42,
      0,
      true,
      {},
      [],
      ["bad_filled_card_data"],
      { toString: () => "bad_filled_card_data" },
      "bad_filled_", // o prefixo sozinho, sem o que vem depois, não é um detalhe conhecido
      "bad_fill",
      "cc_rejected_",
      "cc_rejected_cc_rejected_insufficient_amount", // o prefixo sai UMA vez só
      "BAD_FILLED_CARD_DATA", // o MP manda minúsculo; maiúsculo é desconhecido
      "insufficient_amount_extra",
      "xcall_for_authorize",
    ]
  ) {
    assertEquals(categoriaDoStatusDetail(lixo), "outra", `entrada: ${JSON.stringify(lixo)}`);
  }
});

Deno.test("CATEGORIAS_DA_RECUSA é o conjunto FECHADO de cinco valores, sem código cru do MP", () => {
  assertEquals(
    [...CATEGORIAS_DA_RECUSA].sort(),
    ["banco_pediu_autorizacao", "banco_pediu_confirmacao", "dados_do_cartao", "outra", "sem_limite"],
  );
  for (const bruto of ["high_risk", "other_reason", "blacklist", "antifraude", "fraud"]) {
    assertEquals(CATEGORIAS_DA_RECUSA.some((c) => c.includes(bruto)), false);
  }
});

const orderRecusada = (
  { raiz, pagamento }: { raiz?: string; pagamento?: string },
): Record<string, unknown> => ({
  id: "ORDTST00RECUSADA0000000000000",
  status: "failed",
  ...(raiz === undefined ? {} : { status_detail: raiz }),
  transactions: {
    payments: [{
      id: "PAY01",
      status: "failed",
      ...(pagamento === undefined ? {} : { status_detail: pagamento }),
    }],
  },
});

Deno.test("categoriaDaRecusaDaOrder: o detalhe do PAGAMENTO é onde o MP põe o motivo", () => {
  assertEquals(categoriaDaRecusaDaOrder(orderRecusada({ raiz: "failed", pagamento: "cc_rejected_insufficient_amount" })), "sem_limite");
  assertEquals(categoriaDaRecusaDaOrder(orderRecusada({ raiz: "failed", pagamento: "bad_filled_date" })), "dados_do_cartao");
});

Deno.test("categoriaDaRecusaDaOrder: sem detalhe conhecido no pagamento, vale o da raiz", () => {
  assertEquals(categoriaDaRecusaDaOrder(orderRecusada({ raiz: "cc_rejected_call_for_authorize" })), "banco_pediu_autorizacao");
  assertEquals(categoriaDaRecusaDaOrder(orderRecusada({ raiz: "3ds_challenge_expired", pagamento: "failed" })), "banco_pediu_confirmacao");
});

Deno.test("categoriaDaRecusaDaOrder: pagamento e raiz desconhecidos, ausentes ou nulos -> outra", () => {
  assertEquals(categoriaDaRecusaDaOrder(orderRecusada({ raiz: "failed", pagamento: "high_risk" })), "outra");
  assertEquals(categoriaDaRecusaDaOrder(orderRecusada({})), "outra");
  assertEquals(categoriaDaRecusaDaOrder({}), "outra");
  assertEquals(categoriaDaRecusaDaOrder(null), "outra");
  assertEquals(categoriaDaRecusaDaOrder(undefined), "outra");
  assertEquals(categoriaDaRecusaDaOrder({ transactions: { payments: [] } }), "outra");
  assertEquals(categoriaDaRecusaDaOrder({ transactions: { payments: [null] } }), "outra");
  assertEquals(categoriaDaRecusaDaOrder({ transactions: "lixo" }), "outra");
});

Deno.test("categoriaDaRecusaDaOrder: um detalhe ESPECÍFICO no pagamento (ex.: risco) nunca é revertido por um conhecido na raiz", () => {
  // O motivo real mora no pagamento; a raiz só repete "failed". Se algum dia
  // as duas divergirem, o pagamento manda — senão uma recusa por risco poderia
  // aparecer ao cliente como "sem limite".
  assertEquals(
    categoriaDaRecusaDaOrder(orderRecusada({ raiz: "cc_rejected_insufficient_amount", pagamento: "high_risk" })),
    "outra",
  );
  assertEquals(
    categoriaDaRecusaDaOrder(orderRecusada({ raiz: "cc_rejected_insufficient_amount", pagamento: "cc_rejected_other_reason" })),
    "outra",
  );
});

Deno.test("categoriaDaRecusaDoErro: a order recusada vem em `data` (402)", () => {
  assertEquals(
    categoriaDaRecusaDoErro({
      errors: [{ code: "failed" }],
      data: orderRecusada({ raiz: "failed", pagamento: "cc_rejected_insufficient_amount" }),
    }),
    "sem_limite",
  );
});

Deno.test("categoriaDaRecusaDoErro: sem `data` conhecida, lê o sufixo de errors[].details", () => {
  assertEquals(
    categoriaDaRecusaDoErro({ errors: [{ code: "failed", details: ["PAY01: cc_rejected_call_for_authorize"] }] }),
    "banco_pediu_autorizacao",
  );
  assertEquals(
    categoriaDaRecusaDoErro({ errors: [{ details: ["lixo", 7, "PAY01: bad_filled_card_data"] }] }),
    "dados_do_cartao",
  );
});

Deno.test("categoriaDaRecusaDoErro: corpo ilegível, vazio ou de risco -> outra, sem estourar", () => {
  for (
    const corpo of [
      undefined,
      null,
      "texto",
      42,
      {},
      { errors: "lixo" },
      { errors: [null, 3, {}, { details: "nao-lista" }] },
      { errors: [{ details: ["PAY01: high_risk"] }] },
      { data: "lixo" },
      { data: orderRecusada({ raiz: "failed", pagamento: "rejected_by_issuer" }) },
    ]
  ) {
    assertEquals(categoriaDaRecusaDoErro(corpo), "outra", `corpo: ${JSON.stringify(corpo)}`);
  }
});

Deno.test("nenhum retorno é um código cru do MP: todo valor está no conjunto fechado", () => {
  const entradas: unknown[] = [
    "high_risk",
    "cc_rejected_other_reason",
    "blacklist",
    "bad_filled_security_code",
    "cc_rejected_insufficient_amount",
    "xyz",
    null,
  ];
  for (const e of entradas) {
    assertEquals(CATEGORIAS_DA_RECUSA.includes(categoriaDoStatusDetail(e)), true);
  }
});
