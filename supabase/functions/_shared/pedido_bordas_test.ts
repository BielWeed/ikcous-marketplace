// @ts-nocheck
/**
 * Caça por mutação (24/11/2026) em `pedido.ts` (texto e regra "sem valor a
 * pagar" do comprovante). Os casos abaixo são os mutantes que sobreviveram à
 * suíte de `pedido_test.ts`, `pedido_sem_valor_a_pagar_test.ts` e dos
 * comprovantes — e que mudam o que o cliente LÊ ou o rótulo do pagamento:
 *
 *   * `escaparHtml(0)` é "0", nunca vazio (quantidade 0 não some do e-mail);
 *   * a conta "subtotal − desconto + frete" só vale com os TRÊS presentes e
 *     LEGÍVEIS (NaN e Infinity valem como ausentes), e usa o frete SOMANDO;
 *   * a conta em centavos não pode truncar (0,57 e 0,29 não são 56 e 28);
 *   * número 0 num campo do endereço é "0", não buraco.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { escaparHtml, montarEndereco, pedidoSemValorAPagar } from "./pedido.ts";

Deno.test("escaparHtml: zero e false viram texto, só null e undefined viram vazio", () => {
  assertEquals(escaparHtml(0), "0");
  assertEquals(escaparHtml(false), "false");
  assertEquals(escaparHtml(null), "");
  assertEquals(escaparHtml(undefined), "");
});

Deno.test("sem valor a pagar: subtotal NaN ou Infinity é 'não sei' (vale o total zero), não 'a conta não fecha'", () => {
  for (const ilegivel of [NaN, Infinity, -Infinity]) {
    assertEquals(
      pedidoSemValorAPagar({ total: 0, subtotal: ilegivel, discount: 0, shipping: 0 }),
      true,
      String(ilegivel),
    );
  }
  // O contrário: o TOTAL ilegível nunca vira "grátis".
  assertEquals(pedidoSemValorAPagar({ total: NaN, subtotal: 0, discount: 0, shipping: 0 }), false);
  assertEquals(pedidoSemValorAPagar({ total: Infinity }), false);
});

Deno.test("sem valor a pagar: falta UM dos três (subtotal, desconto ou frete) e vale o total zero, sem fingir que o ausente é zero", () => {
  assertEquals(pedidoSemValorAPagar({ total: 0, discount: 0, shipping: 500 }), true, "sem subtotal");
  assertEquals(pedidoSemValorAPagar({ total: 0, subtotal: 100, shipping: 0 }), true, "sem desconto");
  assertEquals(pedidoSemValorAPagar({ total: 0, subtotal: 100, discount: 100 }), true, "sem frete");
  assertEquals(pedidoSemValorAPagar({ total: 0, subtotal: 100, discount: "100", shipping: 0 }), true, "desconto em texto = ausente");
});

Deno.test("sem valor a pagar: o frete SOMA (cupom que cobre itens e frete); a conta que não fecha NÃO é grátis", () => {
  assertEquals(pedidoSemValorAPagar({ total: 0, subtotal: 10, discount: 20, shipping: 10 }), true);
  assertEquals(pedidoSemValorAPagar({ total: 0, subtotal: 10, discount: 20, shipping: 5 }), false);
  assertEquals(pedidoSemValorAPagar({ total: 0, subtotal: 100, discount: 0, shipping: 0 }), false);
});

Deno.test("sem valor a pagar: a conta em CENTAVOS não trunca (ruído de ponto flutuante de 0,57 / 0,86 / 0,29 etc.)", () => {
  for (let s = 1; s <= 400; s++) {
    for (const f of [0, 1, 7, 29, 57, 599]) {
      const subtotal = Number((s / 100).toFixed(2));
      const frete = Number((f / 100).toFixed(2));
      const desconto = Number(((s + f) / 100).toFixed(2));
      assertEquals(
        pedidoSemValorAPagar({ total: 0, subtotal, discount: desconto, shipping: frete }),
        true,
        `subtotal=${subtotal} desconto=${desconto} frete=${frete}`,
      );
    }
  }
});

Deno.test("endereço: número 0 num campo é '0' (não some como se estivesse vazio)", () => {
  assertEquals(montarEndereco({ street: "Rua A", number: 0 }), "Rua A, 0");
  assertEquals(montarEndereco({ street: "Rua A", number: null }), "Rua A");
});
