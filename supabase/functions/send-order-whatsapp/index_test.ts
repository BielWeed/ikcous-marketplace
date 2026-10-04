// @ts-nocheck
/**
 * Testes da send-order-whatsapp: o número do pedido na mensagem que o cliente
 * recebe no WhatsApp é o MESMO que ele vê no app ("#3884BE": 6 últimos
 * caracteres do id, em maiúsculas). Antes saía "#3884be" — o cliente via duas
 * grafias do mesmo pedido.
 *
 * Nada aqui toca rede nem banco: só a montagem do texto.
 */
import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import { montarMensagem } from "./index.ts";

const ID_DO_PEDIDO = "c35ce4dd-7a1b-4c2d-9e8f-0a1b2c3884be";

Deno.test("o número do pedido na mensagem sai em maiúsculas, como no app", () => {
  const texto = montarMensagem({
    orderId: ID_DO_PEDIDO,
    customerName: "Maria",
    itemsList: "- Sanduíche (2x)",
    totalPrice: 24.9,
    paymentMethod: "pix",
  });

  assertStringIncludes(texto, "*#3884BE*");
  assertEquals(texto.includes("#3884be"), false);
});

Deno.test("o resto da mensagem continua igual (nome, resumo, total, pagamento)", () => {
  const texto = montarMensagem({
    orderId: ID_DO_PEDIDO,
    customerName: "Maria",
    itemsList: "- Sanduíche (2x)",
    totalPrice: 24.9,
    paymentMethod: "card",
  });

  assertStringIncludes(texto, "Olá *Maria*");
  assertStringIncludes(texto, "- Sanduíche (2x)");
  assertStringIncludes(texto, "*Total:* R$ 24,90");
  assertStringIncludes(texto, "*Pagamento:* Cartão");
});
