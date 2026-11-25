// @ts-nocheck
/**
 * Caça por mutação (25/11/2026) em `diagnostico-do-cartao.ts` — o registro de
 * POR QUE o cartão foi recusado ou ficou em análise (é o que o lojista lê para
 * não perder a venda). 35 mutantes plantados; 18 sobreviviam às 4 provas de
 * `diagnostico-do-cartao_test.ts`, que só usam `failed`/`processing`. Os que
 * mudam o que é gravado viram os casos abaixo:
 *
 *   * os seis estados que entram (`failed`, `rejected`, `processing`,
 *     `in_process`, `pending`, `action_required`) e os que NÃO entram; só a
 *     recusa (`failed`/`rejected`) SOBRESCREVE uma análise anterior — análise
 *     atrasada nunca apaga o motivo de uma recusa;
 *   * o status do PAGAMENTO vale mais que o da raiz, e a raiz só cobre a falta;
 *   * `cartaoConhecido` registra mesmo quando a order não diz que é cartão;
 *   * valor: o do pagamento (texto ou número) vence o total da order; zero,
 *     negativo e ilegível não gravam (nunca uma linha de R$ 0,00);
 *   * identificador e código: o tamanho máximo (100 e 120) e o alfabeto valem
 *     exatamente, e id ilegível não grava linha com buraco;
 *   * cada pagamento da order grava as PRÓPRIAS parcelas.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { registrarDiagnosticoDoCartao } from "./diagnostico-do-cartao.ts";

const pedidoId = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

function pagamento(extra = {}) {
  return {
    id: "PAYTESTE",
    status: "failed",
    status_detail: "cc_rejected_high_risk",
    amount: "37.27",
    payment_method: { type: "credit_card", installments: 2 },
    ...extra,
  };
}
function order(extra = {}, pagamentos = [pagamento()]) {
  return {
    id: "ORDTESTE",
    status: "failed",
    status_detail: "detalhe_da_raiz",
    total_amount: "37.27",
    transactions: { payments: pagamentos },
    ...extra,
  };
}

async function gravar(o: unknown, extra = {}) {
  const chamadas: Array<{ linha: Record<string, unknown>; opcoes: Record<string, unknown> }> = [];
  const avisos: unknown[] = [];
  const original = console.warn;
  console.warn = (...v: unknown[]) => avisos.push(v);
  try {
    await registrarDiagnosticoDoCartao({
      pedidoId,
      order: o,
      supabase: {
        from: () => ({
          upsert: (linha: Record<string, unknown>, opcoes: Record<string, unknown>) => {
            chamadas.push({ linha, opcoes });
            return Promise.resolve({ error: null });
          },
        }),
      },
      ...extra,
    });
  } finally {
    console.warn = original;
  }
  return { chamadas, avisos };
}

Deno.test("estados: os seis que entram gravam (só recusa sobrescreve); os demais não gravam", async () => {
  for (
    const [status, ignoraDuplicata] of [
      ["failed", false],
      ["rejected", false],
      ["processing", true],
      ["in_process", true],
      ["pending", true],
      ["action_required", true],
    ] as const
  ) {
    const { chamadas } = await gravar(order({ status }, [pagamento({ status })]));
    assertEquals(chamadas.length, 1, status);
    assertEquals(chamadas[0].linha.status, status);
    assertEquals(chamadas[0].opcoes.ignoreDuplicates, ignoraDuplicata, status);
  }
  for (const status of ["approved", "processed", "canceled", "refunded", "charged_back", "expired"]) {
    const { chamadas } = await gravar(order({ status }, [pagamento({ status })]));
    assertEquals(chamadas.length, 0, status);
  }
});

Deno.test("status: o do pagamento vale mais que o da raiz; a raiz cobre só a falta ou o ilegível", async () => {
  let r = await gravar(order({ status: "processing" }, [pagamento({ status: "rejected" })]));
  assertEquals(r.chamadas[0].linha.status, "rejected");
  r = await gravar(order({ status: "rejected" }, [pagamento({ status: undefined })]));
  assertEquals(r.chamadas[0].linha.status, "rejected");
  r = await gravar(order({ status: "pending" }, [pagamento({ status: "Falhou!" })]));
  assertEquals(r.chamadas[0].linha.status, "pending");
});

Deno.test("cartaoConhecido grava mesmo sem a order dizer que é cartão; sem ele, order sem tipo não grava", async () => {
  const semTipo = order({}, [pagamento({ payment_method: {} })]);
  assertEquals((await gravar(semTipo)).chamadas.length, 0);
  assertEquals((await gravar(semTipo, { cartaoConhecido: false })).chamadas.length, 0);
  assertEquals((await gravar(semTipo, { cartaoConhecido: true })).chamadas.length, 1);
});

Deno.test("valor: o do pagamento (texto ou número) vence o total da order; sem ele, vale o total", async () => {
  let r = await gravar(order({ total_amount: "37.27" }, [pagamento({ amount: "10.00" })]));
  assertEquals(r.chamadas[0].linha.valor, 10);
  r = await gravar(order({ total_amount: "37.27" }, [pagamento({ amount: 12.5 })]));
  assertEquals(r.chamadas[0].linha.valor, 12.5);
  r = await gravar(order({ total_amount: "37.27" }, [pagamento({ amount: undefined })]));
  assertEquals(r.chamadas[0].linha.valor, 37.27);
});

Deno.test("valor zero, negativo ou ilegível não grava linha (e avisa uma vez por tentativa)", async () => {
  for (const amount of ["0", 0, "-5.00", -5, "abc", Number.NaN, Number.POSITIVE_INFINITY]) {
    const r = await gravar(order({ total_amount: "37.27" }, [pagamento({ amount })]));
    assertEquals(r.chamadas.length, 0, String(amount));
    assertEquals(r.avisos.length, 1, String(amount));
  }
  const r = await gravar(order({ total_amount: "0", transactions: undefined }));
  assertEquals(r.chamadas.length, 0);
});

Deno.test("identificadores: até 100 caracteres de letras, números, _ e -; vazio, longo ou com símbolo não grava", async () => {
  const comId = (idDaOrder: unknown, idDoPagamento: unknown) =>
    gravar(order({ id: idDaOrder }, [pagamento({ id: idDoPagamento })]));
  assertEquals((await comId("A".repeat(100), "P-1_b")).chamadas.length, 1);
  assertEquals((await comId("ORD-1_a", "B".repeat(100))).chamadas.length, 1);
  for (const ruim of ["A".repeat(101), "", "ORD 1", "ORD.1", "ORD/1", null, 123, undefined]) {
    assertEquals((await comId(ruim, "PAY1")).chamadas.length, 0, `order ${String(ruim)}`);
    assertEquals((await comId("ORD1", ruim)).chamadas.length, 0, `pagamento ${String(ruim)}`);
  }
});

Deno.test("códigos: até 120 caracteres, minúsculos, começando por letra; o resto cai no da raiz", async () => {
  const comDetalhe = async (detalhe: unknown) =>
    (await gravar(order({ status_detail: "detalhe_da_raiz" }, [pagamento({ status_detail: detalhe })])))
      .chamadas[0].linha.status_detail;
  assertEquals(await comDetalhe("a" + "b".repeat(119)), "a" + "b".repeat(119));
  assertEquals(await comDetalhe("a" + "b".repeat(120)), "detalhe_da_raiz");
  assertEquals(await comDetalhe("Cc_rejected"), "detalhe_da_raiz");
  assertEquals(await comDetalhe("cc_Rejected"), "detalhe_da_raiz");
  assertEquals(await comDetalhe("9_rejected"), "detalhe_da_raiz");
  assertEquals(await comDetalhe("cc rejected"), "detalhe_da_raiz");
  assertEquals(await comDetalhe("cc_rejected_9"), "cc_rejected_9");
});

Deno.test("detalhe ilegível nos dois lados grava null (nunca texto livre)", async () => {
  const r = await gravar(order({ status_detail: "Nao Grave" }, [pagamento({ status_detail: "Nao Grave" })]));
  assertEquals(r.chamadas[0].linha.status_detail, null);
});

Deno.test("duas tentativas na mesma order: cada pagamento grava as PRÓPRIAS parcelas e o próprio id", async () => {
  const r = await gravar(order({}, [
    pagamento({ id: "P1", payment_method: { type: "credit_card", installments: 2 } }),
    pagamento({ id: "P2", payment_method: { type: "credit_card", installments: 6 } }),
  ]));
  assertEquals(r.chamadas.map((c) => [c.linha.mp_payment_id, c.linha.parcelas]), [["P1", 2], ["P2", 6]]);
});
