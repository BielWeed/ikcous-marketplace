// @ts-nocheck
/**
 * Pedido de R$ 0,00 (cupom de 100%): o comprovante diz "Sem valor a pagar".
 *
 * TESTE DE PARIDADE com o front. Os casos abaixo repetem, um a um, os de
 * `tests/front/forma-de-pagamento-sem-valor-a-pagar.test.ts` (PR #884,
 * `src/lib/forma-de-pagamento.ts`). A edge reescreve a regra em Deno puro e
 * nao importa de `src/`; se uma das duas mudar sozinha, este arquivo cai.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  pedidoSemValorAPagar,
  ROTULO_SEM_VALOR_A_PAGAR,
  rotuloDoPagamento,
} from "./pedido.ts";

Deno.test("paridade: total zero (e a conta em centavos) e' sem valor a pagar", () => {
  assertEquals(pedidoSemValorAPagar({ total: 0 }), true);
  assertEquals(pedidoSemValorAPagar({ total: 0.004 }), true);
});

Deno.test("paridade: total com valor, ausente ou invalido NUNCA vira sem valor a pagar", () => {
  assertEquals(pedidoSemValorAPagar({ total: 10 }), false);
  assertEquals(pedidoSemValorAPagar({ total: 100 }), false);
  assertEquals(pedidoSemValorAPagar({ total: 0.01 }), false);
  assertEquals(pedidoSemValorAPagar({}), false);
  assertEquals(pedidoSemValorAPagar({ total: null }), false);
  assertEquals(pedidoSemValorAPagar({ total: undefined }), false);
  assertEquals(pedidoSemValorAPagar({ total: Number.NaN }), false);
  assertEquals(pedidoSemValorAPagar(null), false);
  assertEquals(pedidoSemValorAPagar(undefined), false);
  // Texto nao e' numero: o front so' aceita `number`, a edge tambem.
  assertEquals(pedidoSemValorAPagar({ total: "0" }), false);
});

Deno.test("paridade: total negativo NAO e' sem valor a pagar; zero negativo (-0) e' zero", () => {
  assertEquals(pedidoSemValorAPagar({ total: -1 }), false);
  assertEquals(pedidoSemValorAPagar({ total: -0 }), true);
});

Deno.test("paridade: a conta tem de bater (subtotal 150 e frete 20 com total 0 NAO e' sem valor)", () => {
  assertEquals(
    pedidoSemValorAPagar({ total: 0, subtotal: 150, discount: 0, shipping: 20 }),
    false,
  );
  assertEquals(
    pedidoSemValorAPagar({ total: 0, subtotal: 100, discount: 50, shipping: 0 }),
    false,
  );
});

Deno.test("paridade: cupom de 100% real continua sendo; centavos de ponto flutuante nao quebram a conta", () => {
  assertEquals(
    pedidoSemValorAPagar({ total: 0, subtotal: 100, discount: 100, shipping: 0 }),
    true,
  );
  assertEquals(
    pedidoSemValorAPagar({ total: 0, subtotal: 0.3, discount: 0.1 + 0.2, shipping: 0 }),
    true,
  );
});

Deno.test("paridade: campos da conta ausentes: vale o total (nada a conferir)", () => {
  assertEquals(pedidoSemValorAPagar({ total: 0, subtotal: 100 }), true);
});

Deno.test("paridade: total 0 com qualquer forma/canal -> 'Sem valor a pagar'", () => {
  assertEquals(ROTULO_SEM_VALOR_A_PAGAR, "Sem valor a pagar");
  const casos = [
    ["cash", undefined, "site"],
    ["pix", undefined, "site"],
    ["card", undefined, "site"],
    ["cash", undefined, "presencial"],
    ["card", undefined, "presencial"],
    [null, undefined, "site"],
    ["qualquer-outro", undefined, "site"],
    ["online", "credito", "site"],
  ];
  for (const [metodo, online, canal] of casos) {
    assertEquals(
      rotuloDoPagamento(metodo, online, canal, { total: 0 }),
      "Sem valor a pagar",
    );
  }
});

Deno.test("CONTROLE: com total 10 e 100 o rotulo e' IDENTICO ao de antes, em toda forma e canal", () => {
  const metodos = ["online", "pix", "card", "cash", "ONLINE", "cripto", "", null, undefined];
  const onlines = [undefined, null, "", "pix", "credito", "debito", "CREDITO", "boleto"];
  const canais = [undefined, null, "site", "online", "presencial"];
  let comparados = 0;
  for (const total of [10, 100]) {
    for (const metodo of metodos) {
      for (const online of onlines) {
        for (const canal of canais) {
          const antes = rotuloDoPagamento(metodo, online, canal);
          assertEquals(rotuloDoPagamento(metodo, online, canal, { total }), antes);
          assertEquals(
            rotuloDoPagamento(metodo, online, canal, {
              total,
              subtotal: total,
              discount: 0,
              shipping: 0,
            }),
            antes,
          );
          comparados++;
        }
      }
    }
  }
  assertEquals(comparados, 2 * 9 * 8 * 5);
  // E os literais de sempre, para o controle nao depender dele mesmo.
  assertEquals(rotuloDoPagamento("cash", null, undefined, { total: 10 }), "Dinheiro na entrega");
  assertEquals(rotuloDoPagamento("pix", null, undefined, { total: 100 }), "PIX na entrega");
  assertEquals(rotuloDoPagamento("card", null, "presencial", { total: 10 }), "Cartão na maquininha");
  assertEquals(rotuloDoPagamento("online", "credito", undefined, { total: 100 }), "Cartão de crédito pelo site");
  assertEquals(rotuloDoPagamento("cripto", null, undefined, { total: 10 }), "");
});

Deno.test("sem os valores (chamador antigo), o rotulo e' o de sempre", () => {
  assertEquals(rotuloDoPagamento("cash"), "Dinheiro na entrega");
  assertEquals(rotuloDoPagamento("cash", null, undefined, null), "Dinheiro na entrega");
  assertEquals(rotuloDoPagamento("cash", null, undefined, {}), "Dinheiro na entrega");
});
