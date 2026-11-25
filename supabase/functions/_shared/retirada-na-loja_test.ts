// @ts-nocheck
/**
 * `ehRetiradaNaLoja` é o contrato único da retirada na loja nas edge
 * functions (caça por mutação de 25/11/2026: o módulo não tinha teste Deno).
 * Decide se o pedido tem endereço de entrega, se o comprovante diz "retire na
 * loja" e se o antifraude manda `shipment.address`. O literal é o MESMO da RPC
 * do pedido e do front: a comparação é EXATA e fail-closed — "Store-Pickup",
 * com espaço ou em lista não é retirada.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  ehRetiradaNaLoja,
  ID_RETIRADA_NA_LOJA,
} from "./retirada-na-loja.ts";

Deno.test("o id da retirada na loja é o literal que a RPC do pedido e o front usam", () => {
  assertEquals(ID_RETIRADA_NA_LOJA, "store-pickup");
});

Deno.test("retirada: só o id exato é retirada", () => {
  assertEquals(ehRetiradaNaLoja("store-pickup"), true);
  assertEquals(ehRetiradaNaLoja(ID_RETIRADA_NA_LOJA), true);
});

Deno.test("retirada: caixa, espaço, prefixo, sufixo e parecidos NÃO são retirada (fail-closed)", () => {
  for (
    const outro of [
      "STORE-PICKUP",
      "Store-Pickup",
      " store-pickup",
      "store-pickup ",
      "store-pickup\n",
      "store_pickup",
      "store-pickup-2",
      "xstore-pickup",
      "pickup",
      "local-delivery",
      "",
    ]
  ) {
    assertEquals(ehRetiradaNaLoja(outro), false, JSON.stringify(outro));
  }
});

Deno.test("retirada: o que não é texto nunca é retirada (nem 'texto dentro de lista')", () => {
  for (
    const naoTexto of [
      undefined,
      null,
      0,
      1,
      true,
      {},
      ["store-pickup"],
      { toString: () => "store-pickup" },
      new String("store-pickup"),
    ]
  ) {
    assertEquals(ehRetiradaNaLoja(naoTexto), false);
  }
});
