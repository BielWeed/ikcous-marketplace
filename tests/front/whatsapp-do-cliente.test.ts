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

// Cadastro antigo guarda o telefone com o zero de tronco ("034 99999-1234").
// O link saía `wa.me/034999991234`, sem o 55, e a ficha do cliente habilitava
// "Conversar no WhatsApp" para um número que não abre conversa nenhuma.
describe("linkWhatsappDoCliente — zero de tronco, operadora e 0055 (painel de clientes)", () => {
  it("zero de tronco + DDD + celular: tira o zero e põe o 55 uma vez", () => {
    expect(linkWhatsappDoCliente("034 99999-1234")).toBe(
      "https://wa.me/5534999991234",
    );
    expect(linkWhatsappDoCliente("(034) 99999-1234")).toBe(
      "https://wa.me/5534999991234",
    );
  });

  it("zero de tronco + fixo de 10 dígitos: tira o zero e põe o 55", () => {
    expect(linkWhatsappDoCliente("034 3333-4444")).toBe(
      "https://wa.me/553433334444",
    );
  });

  it("zero + operadora (014) + DDD + celular: tira zero e operadora", () => {
    expect(linkWhatsappDoCliente("014 34 99999-1234")).toBe(
      "https://wa.me/5534999991234",
    );
  });

  it("discagem internacional 0055: sai o 00 e o 55 não dobra", () => {
    expect(linkWhatsappDoCliente("0055 34 99999-1234")).toBe(
      "https://wa.me/5534999991234",
    );
  });

  it("controles: +55, 55 já presente, número normal e estrangeiro ficam como estavam", () => {
    expect(linkWhatsappDoCliente("+55 34 99999-1234")).toBe(
      "https://wa.me/5534999991234",
    );
    expect(linkWhatsappDoCliente("55 34 99999-1234")).toBe(
      "https://wa.me/5534999991234",
    );
    expect(linkWhatsappDoCliente("34 99999-1234")).toBe(
      "https://wa.me/5534999991234",
    );
    expect(linkWhatsappDoCliente("+44 7911 123456")).toBe(
      "https://wa.me/447911123456",
    );
  });

  it("zero na frente de número curto demais continua sem link", () => {
    expect(linkWhatsappDoCliente("099999-9999")).toBeNull();
    expect(linkWhatsappDoCliente("034 9999")).toBeNull();
  });
});
