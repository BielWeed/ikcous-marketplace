// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `prova-de-pagamento.ts`, a porta do dinheiro
 * (webhook, cron e `criar-pagamento` decidem "pago" aqui). 68 dos 282 mutantes
 * sobreviviam; quase todos eram `Math.round` trocado por `Math.floor`/`ceil`,
 * e a razão é uma só: os testes de lá usam poucos valores, e quase nenhum tem o
 * ruído de ponto flutuante de `19.99 * 100 = 1998.9999999999998`.
 *
 * Em vez de escolher valores a dedo, este arquivo VARRE os centavos — todo
 * total de R$ 0,01 a ~R$ 15 (e vários valores de cada fronteira) — contra um
 * ORACULO em aritmética de INTEIROS (centavos), escrito a partir das regras do
 * cabeçalho do módulo e NÃO do código:
 *
 *   * tolerância: 5 centavos (`TOLERANCIA_DE_VALOR = 0.05`);
 *   * PIX: a captura nunca pode ficar mais de 5 centavos abaixo do total; não há teto;
 *   * cartão à vista: captura dentro de ±5 centavos do total;
 *   * cartão parcelado (2..12x): principal NUNCA abaixo do total (sem tolerância,
 *     porque o principal é o que vai à loja), captura >= total, e acima de
 *     total+5 só até 150% do total;
 *   * juros: principal acima do pedido exige a soma das parcelas coerente
 *     (no máximo 1 centavo de distribuição por parcela).
 *
 * Um erro de arredondamento de 1 centavo aqui é o que aprova ou recusa um
 * pagamento de verdade na fronteira — por isso a varredura, não o exemplo.
 *
 * Mais os casos de borda que nenhum teste vigiava: pagamento `null`/texto,
 * status do PAGAMENTO diferente de `processed`, vaga vazia, captura zerada,
 * captura ilegível, e o aviso de juros sem parcela.
 *
 * Fixtures inventadas (ids e valores de teste).
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  avisarJurosSemParcelaConferida,
  conferirValorDoPagamento,
  estornoIntegralComJurosComprovado,
  provarPagamentoPelaConsulta,
} from "./prova-de-pagamento.ts";
import { orderPixPagaDaDoc } from "./prova-de-pagamento_fixtures.ts";

const TOL = 5; // centavos
const reais = (c: number): number => Number((c / 100).toFixed(2));
const texto = (c: number): string => (c / 100).toFixed(2);
const teto = (t: number): number => Math.floor(t * 1.5);

/** Pagamento único, só o que a conferência lê. */
function ordem(
  tipo: string,
  extra: { parcelas?: number; capturadoC?: number; principalC?: number; parcelaC?: number } = {},
) {
  const metodo: Record<string, unknown> = { type: tipo };
  if (extra.parcelas !== undefined) metodo.installments = extra.parcelas;
  if (extra.parcelaC !== undefined) metodo.installment_amount = reais(extra.parcelaC);
  const o: Record<string, unknown> = {
    transactions: { payments: [{ payment_method: metodo }] },
  };
  if (extra.principalC !== undefined) o.total_amount = texto(extra.principalC);
  if (extra.capturadoC !== undefined) o.total_paid_amount = texto(extra.capturadoC);
  return o;
}

function conferir(valorC: number, totalC: number, order?: Record<string, unknown>) {
  return conferirValorDoPagamento(reais(valorC), reais(totalC), order);
}

// ─── A. valor x total, sem order ─────────────────────────────────────────────

Deno.test("varredura: valor contra total, tolerância de 5 centavos exatos, de R$ 0,01 a R$ 15", () => {
  for (let t = 1; t <= 1500; t++) {
    for (let d = -7; d <= 7; d++) {
      const v = t + d;
      if (v <= 0) continue;
      assertEquals(
        conferir(v, t).provado,
        Math.abs(d) <= TOL,
        `total=${t} valor=${v} (diferença ${d} centavos)`,
      );
    }
  }
});

// ─── B. PIX: captura nunca > 5 centavos abaixo; sem teto ─────────────────────

Deno.test("varredura PIX: captura até 5 centavos abaixo do total passa; 6 abaixo recusa; acima nunca recusa", () => {
  for (let t = 1; t <= 1500; t++) {
    for (let e = -7; e <= 7; e++) {
      const c = t + e;
      if (c < 0) continue;
      assertEquals(
        conferir(t, t, ordem("bank_transfer", { capturadoC: c })).provado,
        e >= -TOL,
        `PIX total=${t} captura=${c} (${e})`,
      );
    }
  }
});

// ─── C. cartão à vista: captura dentro de ±5 centavos ────────────────────────

Deno.test("varredura cartão à vista (1x): captura dentro de ±5 centavos do total; fora disso recusa", () => {
  for (let t = 1; t <= 1500; t++) {
    for (let e = -7; e <= 7; e++) {
      const c = t + e;
      if (c < 0) continue;
      assertEquals(
        conferir(t, t, ordem("credit_card", { parcelas: 1, capturadoC: c })).provado,
        Math.abs(e) <= TOL,
        `cartão 1x total=${t} captura=${c} (${e})`,
      );
    }
  }
});

// ─── D. cartão parcelado: principal >= total, captura no teto ────────────────

Deno.test("varredura cartão 3x: captura >= total e, acima de total+5, só até 150% do total", () => {
  for (let t = 1; t <= 1500; t++) {
    const fronteiras = [-7, -6, -5, -1, 0, 1, 4, 5, 6, 7, teto(t) - t - 1, teto(t) - t, teto(t) - t + 1, teto(t) - t + 2];
    for (const e of fronteiras) {
      const c = t + e;
      if (c < 0) continue;
      const esperado = c >= t && (c - t <= TOL || c <= teto(t));
      assertEquals(
        conferir(t, t, ordem("credit_card", { parcelas: 3, capturadoC: c })).provado,
        esperado,
        `cartão 3x total=${t} captura=${c} teto=${teto(t)}`,
      );
    }
  }
});

Deno.test("varredura cartão 3x: PRINCIPAL abaixo do total recusa mesmo dentro da tolerância (o principal é o que vai à loja)", () => {
  for (let t = 40; t <= 1500; t++) {
    for (const dv of [-7, -6, -5, -2, -1, 0, 1, 5, 6]) {
      const v = t + dv;
      assertEquals(
        conferir(v, t, ordem("credit_card", { parcelas: 3, capturadoC: t + 10 })).provado,
        dv >= 0 && dv <= TOL,
        `principal=${v} total=${t}`,
      );
    }
  }
});

// ─── E. juros: principal acima do pedido exige parcelas coerentes ────────────

Deno.test("varredura juros: principal acima do pedido só passa com a soma das parcelas coerente (±1 centavo por parcela) e dentro do teto de 150%", () => {
  for (const n of [2, 3, 12]) {
    for (let t = 100; t <= 900; t++) {
      for (const v of [t + 6, teto(t) - 1, teto(t), teto(t) + 1]) {
        for (const k of [-2, -1, 0, 1, 2]) {
          const p = Math.floor(v / n) + k;
          if (p <= 0) continue;
          const order = ordem("credit_card", { parcelas: n, principalC: v, capturadoC: v, parcelaC: p });
          const esperado = v <= teto(t) && Math.abs(v - p * n) <= n - 1;
          assertEquals(
            conferir(v, t, order).provado,
            esperado,
            `${n}x total=${t} principal=${v} parcela=${p} (soma ${p * n})`,
          );
        }
      }
    }
  }
});

Deno.test("juros: parcela ausente, zerada ou captura menor que o principal NÃO justificam o principal acima do pedido", () => {
  const t = 1000;
  const v = 1100;
  const base = { parcelas: 3, principalC: v, capturadoC: v };
  assertEquals(conferir(v, t, ordem("credit_card", base)).provado, false, "sem installment_amount");
  assertEquals(conferir(v, t, ordem("credit_card", { ...base, parcelaC: 0 })).provado, false, "parcela zero");
  // Captura (1050) acima do pedido (1000) mas ABAIXO do principal declarado (1100),
  // com as parcelas batendo com a captura (350 x 3 = 1050): a parcela coerente com
  // o que foi capturado NÃO basta, o principal inteiro precisa ter sido capturado.
  assertEquals(
    conferir(v, t, ordem("credit_card", { ...base, parcelaC: 350, capturadoC: 1050 })).provado,
    false,
    "captura menor que o principal",
  );
  assertEquals(conferir(v, t, ordem("credit_card", { ...base, parcelaC: 367 })).provado, true, "o controle: 367 x 3 = 1101");
});

Deno.test("juros: parcela ILEGÍVEL (texto) não justifica o principal acima do pedido", () => {
  const order = ordem("credit_card", { parcelas: 3, principalC: 1100, capturadoC: 1100, parcelaC: 367 });
  order.transactions.payments[0].payment_method.installment_amount = "trezentos";
  assertEquals(conferir(1100, 1000, order).provado, false);
});

// ─── F. estorno integral de cartão financiado ────────────────────────────────

function refundsDe(...valores: Array<[string, number]>) {
  return valores.map(([id, c]) => ({ id, amount: texto(c), status: "processed" }));
}

Deno.test("varredura estorno integral: só vale com juros (captura > total) e a soma devolvida >= captura", () => {
  for (let t = 40; t <= 1500; t++) {
    for (const g of [0, 1, 3, 5]) {
      const c = t + g;
      const order = ordem("credit_card", { parcelas: 3, principalC: t, capturadoC: c });
      for (const e of [-2, -1, 0, 1]) {
        assertEquals(
          estornoIntegralComJurosComprovado(order, reais(t), refundsDe(["R1", c + e]), "processed"),
          g > 0 && e >= 0,
          `total=${t} captura=${c} devolvido=${c + e}`,
        );
      }
    }
  }
});

Deno.test("estorno integral: cartão à vista (1x) com captura 3 centavos acima do total NÃO é financiamento", () => {
  const order = ordem("credit_card", { parcelas: 1, principalC: 1000, capturadoC: 1003 });
  assertEquals(estornoIntegralComJurosComprovado(order, 10, refundsDe(["R1", 1003]), "processed"), false);
});

Deno.test("estorno integral: uma devolução de valor ZERO contamina o conjunto; pedaços de 4 centavos somam normalmente", () => {
  const order = ordem("credit_card", { parcelas: 3, principalC: 1000, capturadoC: 1100 });
  assertEquals(
    estornoIntegralComJurosComprovado(order, 10, refundsDe(["R1", 1100], ["R2", 0]), "processed"),
    false,
    "devolução zerada",
  );
  assertEquals(
    estornoIntegralComJurosComprovado(order, 10, refundsDe(["R1", 1096], ["R2", 4]), "processed"),
    true,
    "1096 + 4 = 1100",
  );
});

// ─── G. aviso de juros sem parcela conferida ─────────────────────────────────

function capturandoWarn(fn: () => void): unknown[][] {
  const original = console.warn;
  const chamadas: unknown[][] = [];
  console.warn = (...args: unknown[]) => {
    chamadas.push(args);
  };
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return chamadas;
}

Deno.test("varredura do aviso: avisa só quando a prova passa, a captura excede o total em mais de 5 centavos e não há parcela para conferir", () => {
  for (let t = 40; t <= 600; t++) {
    for (const dv of [-1, 0, 4, 5, 6]) {
      for (const g of [4, 5, 6, 7]) {
        const c = t + g;
        const order = ordem("credit_card", { parcelas: 3, principalC: t + dv, capturadoC: c });
        const chamadas = capturandoWarn(() => avisarJurosSemParcelaConferida("PED1", reais(t), order));
        const prova = dv >= 0 && dv <= TOL && (g <= TOL || c <= teto(t));
        assertEquals(chamadas.length, prova && g > TOL ? 1 : 0, `total=${t} principal=${t + dv} captura=${c}`);
      }
    }
  }
});

Deno.test("aviso: cartão parcelado cuja prova NÃO passa (principal ≠ pedido) não avisa", () => {
  const order = ordem("credit_card", { parcelas: 3, principalC: 20000, capturadoC: 20000 });
  assertEquals(capturandoWarn(() => avisarJurosSemParcelaConferida("PED1", 100, order)).length, 0);
});

Deno.test("aviso: cartão à vista e PIX não avisam; parcelado com a parcela conferida não avisa; sem parcela avisa uma vez, sem vazar o objeto", () => {
  const aVista = ordem("credit_card", { parcelas: 1, principalC: 1000, capturadoC: 1003 });
  const pix = ordem("bank_transfer", { principalC: 1000, capturadoC: 1100 });
  assertEquals(capturandoWarn(() => avisarJurosSemParcelaConferida("PED1", 10, aVista)).length, 0);
  assertEquals(capturandoWarn(() => avisarJurosSemParcelaConferida("PED1", 10, pix)).length, 0);
  const conferida = ordem("credit_card", { parcelas: 3, principalC: 1000, capturadoC: 1100, parcelaC: 367 });
  assertEquals(capturandoWarn(() => avisarJurosSemParcelaConferida("PED1", 10, conferida)).length, 0);
  const semParcela = ordem("credit_card", { parcelas: 3, principalC: 1000, capturadoC: 1100 });
  const chamadas = capturandoWarn(() => avisarJurosSemParcelaConferida("PED1", 10, semParcela));
  assertEquals(chamadas.length, 1);
  assertEquals(chamadas[0][1], { pedido: "PED1", total: 10, capturado: 11, parcelas: 3 });
});

// ─── H. order sem a forma esperada não derruba a conferência ─────────────────

Deno.test("order sem transactions ou com payments fora de lista: a conferência não lança e segue pelo valor", () => {
  assertEquals(conferirValorDoPagamento(100, 100, {}).provado, true);
  assertEquals(conferirValorDoPagamento(100, 100, { transactions: {} }).provado, true);
  assertEquals(conferirValorDoPagamento(100, 100, { transactions: { payments: null } }).provado, true);
  assertEquals(conferirValorDoPagamento(100, 100, { transactions: { payments: [{}, {}] } }).provado, true);
});

// ─── I. a prova inteira: bordas que nenhum teste vigiava ─────────────────────

const ID = "ORDTST01PROVACENTAVOS000001";
const PEDIDO = "7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

function prova(order: unknown, over: Record<string, unknown> = {}) {
  return provarPagamentoPelaConsulta({
    origem: "get_por_id",
    idConsultado: ID,
    vagaRelida: ID,
    pedidoId: PEDIDO,
    totalRelido: 50,
    order,
    ...over,
  });
}
const pix = (valor = "50.00") => orderPixPagaDaDoc({ id: ID, externalReference: PEDIDO, valor });

Deno.test("controle: o PIX da doc, com os parâmetros deste arquivo, PROVA", () => {
  assertEquals(prova(pix()), { provado: true, valor: 50, valorPago: 50 });
});

Deno.test("vaga relida VAZIA nunca prova, mesmo com id consultado e id da order também vazios", () => {
  const order = { ...pix(), id: "" };
  assertEquals(prova(order, { idConsultado: "", vagaRelida: "" }), { provado: false, motivo: "vaga" });
});

Deno.test("pagamento null ou texto na lista: recusa pagamentos, não lança", () => {
  for (const item of [null, "PAY1", 3]) {
    const order = { ...pix(), transactions: { payments: [item] } };
    assertEquals(prova(order), { provado: false, motivo: "pagamentos" }, JSON.stringify(item));
  }
});

Deno.test("status do PAGAMENTO diferente de processed recusa, mesmo com a order processed:accredited", () => {
  for (const status of ["refunded", "failed", "pending", "canceled"]) {
    const base = pix();
    const order = {
      ...base,
      transactions: { payments: [{ ...base.transactions.payments[0], status }] },
    };
    assertEquals(prova(order), { provado: false, motivo: "status_do_pagamento" }, status);
  }
});

Deno.test("captura ZERADA nunca prova, mesmo num pedido de 3 centavos (dentro da tolerância)", () => {
  const base = pix("0.03");
  const order = {
    ...base,
    total_paid_amount: "0.00",
    transactions: { payments: [{ ...base.transactions.payments[0], paid_amount: "0.00" }] },
  };
  assertEquals(prova(order, { totalRelido: 0.03 }), { provado: false, motivo: "valor_pago" });
});

Deno.test("captura ILEGÍVEL (texto vazio ou lixo) recusa como valor_pago, não como se fosse zero", () => {
  for (const ilegivel of ["", "  ", "abc"]) {
    const order = { ...pix(), total_paid_amount: ilegivel };
    assertEquals(prova(order), { provado: false, motivo: "valor_pago" }, JSON.stringify(ilegivel));
  }
});
