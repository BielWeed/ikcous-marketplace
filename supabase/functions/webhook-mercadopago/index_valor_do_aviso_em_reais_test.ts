/**
 * webhook-mercadopago — o valor em reais que o lojista lê nos avisos
 * (caça por mutação "só testes", 25/11/2026).
 *
 * `formatarBRL` é a cópia local do formatador do aviso de pedido novo. A suíte
 * grande prova o valor no texto do aviso, mas nunca pelo lado da AUSÊNCIA: pagamento
 * sem valor legível tem de aparecer como "R$ 0,00" — trocar o padrão de 0 para 1
 * faria o lojista ler "R$ 1,00" num pedido cujo valor ninguém soube.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { formatarBRL } from "./index.ts";

Deno.test("valor ausente ou ilegível aparece como R$ 0,00 — nunca como outro valor, nunca NaN", () => {
  for (const ruim of [null, undefined, "abacaxi", Number.NaN, Infinity, -Infinity, {}]) {
    assertEquals(formatarBRL(ruim), "R$ 0,00", String(ruim));
  }
});

Deno.test("valor legível sai em pt-BR com milhar, centavos e espaço comum depois do R$", () => {
  assertEquals(formatarBRL(0), "R$ 0,00");
  assertEquals(formatarBRL(1234.5), "R$ 1.234,50");
  assertEquals(formatarBRL("59.90"), "R$ 59,90");
  assertEquals(formatarBRL(1), "R$ 1,00");
  assertEquals(formatarBRL(129.8).includes(" "), false, "sem espaço não separável");
});
