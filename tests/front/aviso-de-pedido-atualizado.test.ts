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

  it("pedido cancelado que recebe pago_apos_expirar avisa o pagamento", () => {
    const evento = completarOldDoEvento(
      noAr({ status: "cancelled", payment_status: "pago_apos_expirar" }),
      { status: "cancelled", paymentStatus: "aguardando" },
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

  it("pedido que a tela não conhece: avisa sem afirmar mudança de status", () => {
    const evento = completarOldDoEvento(
      noAr({ status: "shipping", payment_status: "pago" }),
      undefined,
    );
    expect(evento.old).toEqual({ id: "p1" });
    expect(tipoDoAvisoDoPedido(evento)).toBe("generico");
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

// Lote 502: o aviso usava a memória da tela como "antes" sem olhar a DATA. Um
// UPDATE atrasado (socket lento, rajada após a reconexão) que a lista descarta
// por ser mais velho que o que ela já tem (`mesclarAtualizacaoRealtime`) ainda
// virava "Pedido #N atualizado para Em preparo" com o pedido já Enviado. O
// aviso agora segue a MESMA regra de data da lista: evento estritamente mais
// velho que a versão da tela não avisa nada.
describe("aviso de pedido atualizado — evento atrasado que a lista descarta", () => {
  beforeEach(() => esquecerAcaoPropriaDoPedido("p1"));

  const NA_TELA = "2026-11-27T10:05:00.000Z";

  it("status velho chegando depois de a lista já ter o mais novo: NÃO avisa", () => {
    const evento = completarOldDoEvento(
      noAr({
        status: "processing",
        payment_status: "pago",
        updated_at: "2026-11-27T10:00:00.000Z",
      }),
      { status: "shipping", paymentStatus: "pago", updatedAt: NA_TELA },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBeNull();
  });

  it("pedido estornado recebendo o evento velho de 'pago': NÃO anuncia pagamento", () => {
    const evento = completarOldDoEvento(
      noAr({
        status: "cancelled",
        payment_status: "pago",
        updated_at: "2026-11-27T10:00:00.000Z",
      }),
      { status: "cancelled", paymentStatus: "estornado", updatedAt: NA_TELA },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBeNull();
  });

  it("evento um milissegundo mais velho também é descartado (estritamente anterior)", () => {
    const evento = completarOldDoEvento(
      noAr({
        status: "processing",
        payment_status: "pago",
        updated_at: "2026-11-27T10:04:59.999Z",
      }),
      { status: "pending", paymentStatus: "pago", updatedAt: NA_TELA },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBeNull();
  });

  it("evento mais novo que a tela: avisa normalmente", () => {
    const evento = completarOldDoEvento(
      noAr({
        status: "shipping",
        payment_status: "pago",
        updated_at: "2026-11-27T10:06:00.000Z",
      }),
      { status: "processing", paymentStatus: "pago", updatedAt: NA_TELA },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBe("status");
  });

  it("data IGUAL à da tela continua avisando (a lista também aplica)", () => {
    const evento = completarOldDoEvento(
      noAr({ status: "shipping", payment_status: "pago", updated_at: NA_TELA }),
      { status: "processing", paymentStatus: "pago", updatedAt: NA_TELA },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBe("status");
  });

  it("data ausente ou ilegível de um dos lados não é 'velha': avisa como antes", () => {
    const semDataNoEvento = completarOldDoEvento(
      noAr({ status: "shipping", payment_status: "pago" }),
      { status: "processing", paymentStatus: "pago", updatedAt: NA_TELA },
    );
    expect(tipoDoAvisoDoPedido(semDataNoEvento)).toBe("status");
    const telaIlegivel = completarOldDoEvento(
      noAr({
        status: "shipping",
        payment_status: "pago",
        updated_at: "2026-11-27T10:00:00.000Z",
      }),
      { status: "processing", paymentStatus: "pago", updatedAt: "" },
    );
    expect(tipoDoAvisoDoPedido(telaIlegivel)).toBe("status");
  });

  it("a data que vale é a da TELA, mesmo se o servidor mandou a dele no old", () => {
    // O old do servidor (se um dia vier completo) é a versão anterior NO
    // BANCO, sempre mais velha que o evento; a lista compara com a memória.
    const evento = completarOldDoEvento(
      {
        eventType: "UPDATE",
        old: {
          id: "p1",
          status: "pending",
          payment_status: "pago",
          updated_at: "2026-11-27T09:00:00.000Z",
        },
        new: {
          id: "p1",
          status: "processing",
          payment_status: "pago",
          updated_at: "2026-11-27T10:00:00.000Z",
        },
      },
      { status: "shipping", paymentStatus: "pago", updatedAt: NA_TELA },
    );
    expect(tipoDoAvisoDoPedido(evento)).toBeNull();
  });
});
