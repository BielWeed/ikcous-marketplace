import { beforeEach, describe, expect, it } from "vitest";

import {
  esquecerAcaoPropriaDoPedido,
  marcarAcaoPropriaDoPedido,
} from "../../src/lib/acao-propria-do-painel";
import {
  completarOldDoEvento,
  tipoDoAvisoDoPedido,
} from "../../src/lib/aviso-de-pedido-atualizado";

// Formato REAL do evento em produção: com RLS ligada o `old` do UPDATE traz só
// a chave primária. O "antes" vem do pedido que a tela já tinha.
const noAr = (novo: Record<string, unknown>) => ({
  eventType: "UPDATE",
  old: { id: "p1" },
  new: { id: "p1", ...novo },
});

describe("aviso de pedido atualizado — old só com a chave primária (formato real)", () => {
  beforeEach(() => esquecerAcaoPropriaDoPedido("p1"));

  it("status igual ao que a tela tinha (salvou rastreio): NÃO avisa", () => {
    const evento = completarOldDoEvento(
      noAr({ status: "shipping", payment_status: "pago" }),
      { status: "shipping", paymentStatus: "pago" },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBeNull();
  });

  it("status mudou em relação ao que a tela tinha: avisa o status", () => {
    const evento = completarOldDoEvento(
      noAr({ status: "processing", payment_status: "pago" }),
      { status: "pending", paymentStatus: "pago" },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBe("status");
  });

  it("pagamento foi de aguardando a pago (PIX): avisa o pagamento, não 'Novo Pedido'", () => {
    const evento = completarOldDoEvento(
      noAr({ status: "pending", payment_status: "pago" }),
      { status: "pending", paymentStatus: "aguardando" },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBe("pagamento");
  });

  it("pagamento que não tinha valor (null) e virou pago também conta", () => {
    const evento = completarOldDoEvento(
      noAr({ status: "pending", payment_status: "pago" }),
      { status: "pending", paymentStatus: null },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBe("pagamento");
  });

  it("pedido que a tela não conhece: avisa como antes (nunca engole)", () => {
    const evento = completarOldDoEvento(
      noAr({ status: "shipping", payment_status: "pago" }),
      undefined,
    );
    expect(evento.old).toEqual({ id: "p1" });
    expect(tipoDoAvisoDoPedido(evento)).toBe("status");
  });

  it("já pago e continua pago, mesmo status: nada novo", () => {
    const evento = completarOldDoEvento(
      noAr({ status: "pending", payment_status: "pago" }),
      { status: "pending", paymentStatus: "pago" },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBeNull();
  });

  it("o que o servidor mandou no old prevalece sobre a memória da tela", () => {
    const evento = completarOldDoEvento(
      {
        eventType: "UPDATE",
        old: { id: "p1", status: "processing", payment_status: "pago" },
        new: { id: "p1", status: "shipping", payment_status: "pago" },
      },
      { status: "pending", paymentStatus: "aguardando" },
    );
    expect(evento.old).toMatchObject({ status: "processing" });
    expect(tipoDoAvisoDoPedido(evento)).toBe("status");
  });

  it("a ação própria da lojista continua silenciando o aviso de status", () => {
    marcarAcaoPropriaDoPedido("p1", "processing");
    const evento = completarOldDoEvento(
      noAr({ status: "processing", payment_status: "pago" }),
      { status: "pending", paymentStatus: "pago" },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBeNull();
  });

  it("não altera INSERT nem DELETE", () => {
    const insert = { eventType: "INSERT", new: { id: "p1" } };
    expect(
      completarOldDoEvento(insert, { status: "pending", paymentStatus: null }),
    ).toBe(insert);
  });
});
