// @ts-nocheck
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { calculateSmartFallback, getCartHash, isLocalCep } from "./index.ts";

Deno.test("calculateSmartFallback - same region", () => {
  // Test same region: starts with same character
  const fee = calculateSmartFallback("38500000", "35000000", 10);
  assertEquals(fee, 15); // max of 15 and baseFee (10)
});

Deno.test("calculateSmartFallback - neighboring region group", () => {
  // Test neighboring region group (e.g., 2 and 3)
  const fee = calculateSmartFallback("20000000", "30000000", 10);
  assertEquals(fee, 22); // max of 22 and baseFee + 7 (17)
});

Deno.test("calculateSmartFallback - remote regions", () => {
  // Test remote regions (e.g., 0 and 8)
  const fee = calculateSmartFallback("01000000", "80000000", 10);
  assertEquals(fee, 38); // max of 38 and baseFee + 20 (30)
});

Deno.test("getCartHash - empty cart", () => {
  assertEquals(getCartHash([]), "");
});

Deno.test("getCartHash - null or invalid cart", () => {
  assertEquals(getCartHash(null as any), "empty");
  assertEquals(getCartHash(undefined as any), "empty");
});

Deno.test("getCartHash - stable sorting and hashing", () => {
  const cart1 = [
    { product: { id: "prod-a" }, quantity: 2, variantId: "v1" },
    { product: { id: "prod-b" }, quantity: 1, variantId: "v2" },
  ];
  const cart2 = [
    { product: { id: "prod-b" }, quantity: 1, variantId: "v2" },
    { product: { id: "prod-a" }, quantity: 2, variantId: "v1" },
  ];
  assertEquals(getCartHash(cart1), getCartHash(cart2));
  assertEquals(getCartHash(cart1), "prod-a:v1:2,prod-b:v2:1");
});

Deno.test("isLocalCep - default fallback", () => {
  // Same first 5 digits
  assertEquals(isLocalCep("38500-000", "38500-120"), true);
  // Different first 5 digits
  assertEquals(isLocalCep("38500-000", "38400-000"), false);
});

Deno.test("isLocalCep - custom prefix list", () => {
  // Custom prefix list
  assertEquals(isLocalCep("38500-000", "38400-123", "38500, 38400"), true);
  assertEquals(isLocalCep("38500-000", "38200-123", "38500, 38400"), false);
});

Deno.test("isLocalCep - custom range", () => {
  // Custom range
  assertEquals(isLocalCep("38500-000", "38502000", "38500000-38505000"), true);
  assertEquals(isLocalCep("38500-000", "38506000", "38500000-38505000"), false);
});

Deno.test("isLocalCep - formato do placeholder do admin (dois CEPs formatados)", () => {
  // O placeholder do AdminShippingView ensina "Ex: 38500-000, 38500-999".
  // Antes, o hífen do CEP era lido como separador de faixa e nada casava.
  const range = "38500-000, 38500-999";
  assertEquals(isLocalCep("38500-000", "38500-123", range), true);
  assertEquals(isLocalCep("38500-000", "38500-000", range), true);
  assertEquals(isLocalCep("38500-000", "38500-999", range), true);
  // Fora da faixa
  assertEquals(isLocalCep("38500-000", "38501-000", range), false);
  assertEquals(isLocalCep("38500-000", "38400-123", range), false);
});

Deno.test("isLocalCep - CEP completo isolado casa exato, prefixo curto casa por início", () => {
  assertEquals(isLocalCep("38500-000", "38500-123", "38500-123"), true);
  assertEquals(isLocalCep("38500-000", "38500-124", "38500-123"), false);
  // Três ou mais itens continuam valendo como lista, não como faixa
  assertEquals(isLocalCep("38500-000", "38400-123", "38500, 38400, 38300"), true);
  assertEquals(isLocalCep("38500-000", "38100-123", "38500, 38400, 38300"), false);
});

Deno.test("isLocalCep - faixa invertida e espaços extras", () => {
  // Lojista digita o maior primeiro: deve continuar funcionando
  assertEquals(isLocalCep("38500-000", "38500-500", "38500-999 ,  38500-000"), true);
  // Campo vazio ou só pontuação cai no fallback dos 5 primeiros dígitos
  assertEquals(isLocalCep("38500-000", "38500-120", "   "), true);
  assertEquals(isLocalCep("38500-000", "38400-120", "   "), false);
});
