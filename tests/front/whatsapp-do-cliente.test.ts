// @vitest-environment jsdom
//
// Laudo 0109 (A-7) — o painel montava `wa.me/${phone}` com QUALQUER lixo de
// dígito: WhatsApp vazio virava `wa.me/` (janela morta) e "99999-9999" (sem
// DDD) abria a conversa com um número inválido. A decisão "este número abre
// conversa?" agora mora em UMA função pura, usada pelos DOIS pontos (lista
// de pedidos e ficha do pedido).
import { linkWhatsappDoCliente } from "@/lib/whatsapp-do-cliente";
import { describe, expect, it } from "vitest";

describe("linkWhatsappDoCliente — null quando não abre conversa (laudo 0109, A-7)", () => {
  it("vazio, undefined e null: null", () => {
    expect(linkWhatsappDoCliente("")).toBeNull();
    expect(linkWhatsappDoCliente(undefined)).toBeNull();
    expect(linkWhatsappDoCliente(null)).toBeNull();
  });

  it("9 dígitos (sem DDD, '99999-9999'): null — número sem DDD+numero não abre conversa válida", () => {
    expect(linkWhatsappDoCliente("99999-9999")).toBeNull();
    expect(linkWhatsappDoCliente("999999999")).toBeNull();
  });

  it("10 dígitos (DDD + 8): URL com prefixo 55", () => {
    expect(linkWhatsappDoCliente("3499999999")).toBe(
      "https://wa.me/553499999999",
    );
  });

  it("11 dígitos (DDD + 9): URL com prefixo 55", () => {
    expect(linkWhatsappDoCliente("(34) 99999-9999")).toBe(
      "https://wa.me/5534999999999",
    );
  });

  it("já vem com país (12-13 dígitos, começa com 55): passa como está", () => {
    expect(linkWhatsappDoCliente("5534999999999")).toBe(
      "https://wa.me/5534999999999",
    );
  });
});
