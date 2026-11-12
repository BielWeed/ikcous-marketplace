import {
  assertEquals,
  assertStringIncludes,
} from "https://deno.land/std@0.177.0/testing/asserts.ts";
import {
  guardaAntesDeChamar,
  type LinhaEstorno,
  type PedidoParaEstorno,
} from "./estorno.ts";

const AGORA = new Date("2026-09-07T12:00:00.000Z");
const DIA_MS = 24 * 60 * 60 * 1000;

function linhaCom(): LinhaEstorno {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    order_id: "22222222-2222-4222-8222-222222222222",
    amount: 100,
    status: "solicitado",
    mp_refund_id: null,
    tentativas: 0,
  };
}

function pedidoPagoCom(extras: Partial<PedidoParaEstorno>): PedidoParaEstorno {
  return {
    id: "22222222-2222-4222-8222-222222222222",
    gateway_payment_id: "123456789",
    total: 100,
    valor_estornado: 0,
    payment_status: "pago",
    paid_at: new Date(AGORA.getTime() - DIA_MS).toISOString(),
    status: "cancelled",
    ...extras,
  };
}

Deno.test("estorno aceita pagamento feito há exatamente 180 dias", () => {
  const paid_at = new Date(AGORA.getTime() - 180 * DIA_MS).toISOString();

  assertEquals(
    guardaAntesDeChamar(linhaCom(), pedidoPagoCom({ paid_at }), AGORA),
    { ok: true },
  );
});

Deno.test("estorno recusa pagamento feito há 180 dias e 1 ms com motivo do prazo", () => {
  const paid_at = new Date(AGORA.getTime() - 180 * DIA_MS - 1).toISOString();

  const resultado = guardaAntesDeChamar(linhaCom(), pedidoPagoCom({ paid_at }), AGORA);

  assertEquals(resultado.ok, false);
  if (!resultado.ok) {
    assertStringIncludes(resultado.motivo, "180 dias");
  }
});

Deno.test("estorno aceita pagamento feito há 179 dias e 23 horas", () => {
  const paid_at = new Date(AGORA.getTime() - 179 * DIA_MS - 23 * 60 * 60 * 1000)
    .toISOString();

  assertEquals(
    guardaAntesDeChamar(linhaCom(), pedidoPagoCom({ paid_at }), AGORA),
    { ok: true },
  );
});
