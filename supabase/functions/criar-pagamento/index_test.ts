// @ts-nocheck
/**
 * Testes da criar-pagamento (CHECKOUT-010, #109).
 *
 * Prova a parte que decide SE pode cobrar e DE QUEM — que é onde erro custa
 * caro: cobrar duas vezes o mesmo pedido, cobrar pedido já expirado, ou deixar
 * um estranho disparar cobrança do pedido de outra pessoa.
 *
 * A chamada ao MP em si já é coberta pelos testes de _shared/mercadopago.ts.
 */
import { assertEquals } from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  descricaoDoPedido,
  donoConfere,
  pareceUuid,
  podeCobrar,
} from "./index.ts";

const UUID = "3f2a1b8c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const AGORA = new Date("2026-08-06T12:00:00.000Z");

Deno.test("aceita UUID e recusa o que não é", () => {
  assertEquals(pareceUuid(UUID), true);
  assertEquals(pareceUuid(UUID.toUpperCase()), true);
  for (const ruim of ["", null, undefined, 42, "1; DROP TABLE marketplace_orders", `${UUID} `]) {
    assertEquals(pareceUuid(ruim), false, `deveria recusar: ${String(ruim)}`);
  }
});

Deno.test("podeCobrar aceita pedido aguardando e dentro do prazo", () => {
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T12:20:00.000Z",
      gateway_payment_id: null,
    },
    AGORA,
  );
  assertEquals(r.ok, true);
});

Deno.test("podeCobrar recusa pedido que já tem cobrança", () => {
  // Sem isto, um duplo clique gera dois PIX para o mesmo pedido e o cliente
  // pode pagar os dois.
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T12:20:00.000Z",
      gateway_payment_id: "1234567890",
    },
    AGORA,
  );
  assertEquals(r.ok, false);
});

Deno.test("podeCobrar recusa pedido fora do prazo", () => {
  const r = podeCobrar(
    {
      payment_status: "aguardando",
      expires_at: "2026-08-06T11:59:00.000Z",
      gateway_payment_id: null,
    },
    AGORA,
  );
  assertEquals(r.ok, false);
});

Deno.test("podeCobrar recusa qualquer payment_status que não seja aguardando", () => {
  for (const st of ["pago", "recusado", "expirado", "estornado", "pago_apos_expirar", null]) {
    const r = podeCobrar(
      { payment_status: st, expires_at: "2026-08-06T12:20:00.000Z", gateway_payment_id: null },
      AGORA,
    );
    assertEquals(r.ok, false, `deveria recusar payment_status=${String(st)}`);
  }
});

Deno.test("podeCobrar recusa pedido sem prazo carimbado", () => {
  // Pedido criado pela v23 (flag desligada) não tem expires_at. Cobrar um
  // desses criaria cobrança que a expiração nunca varre.
  const r = podeCobrar(
    { payment_status: "aguardando", expires_at: null, gateway_payment_id: null },
    AGORA,
  );
  assertEquals(r.ok, false);
});

Deno.test("donoConfere: pedido de usuário logado exige o mesmo usuário", () => {
  assertEquals(donoConfere({ user_id: UUID }, UUID), true);
  assertEquals(donoConfere({ user_id: UUID }, "outro-sub"), false);
  assertEquals(donoConfere({ user_id: UUID }, null), false);
});

Deno.test("donoConfere: pedido de convidado passa sem sessão", () => {
  // Checkout de convidado é suportado (v24 grava user_id NULL). A proteção
  // dele não é a sessão — é a janela de 30 min do expires_at, checada em
  // podeCobrar.
  assertEquals(donoConfere({ user_id: null }, null), true);
  assertEquals(donoConfere({ user_id: null }, UUID), true);
});

Deno.test("descricaoDoPedido não vaza o id inteiro", () => {
  const d = descricaoDoPedido(UUID);
  assertEquals(d.includes(UUID), false);
  assertEquals(d.includes("3f2a1b8c"), true);
});
