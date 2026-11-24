// O link de WhatsApp do balcão (recibo/cupom pelo caixa) diante do "+" no
// começo do número: "+55" é o Brasil e PRECISA continuar valendo — o 55 é
// descartado antes de contar os dígitos e o link sai com o 55 uma vez só —,
// enquanto "+" de OUTRO país nunca é relido como DDD brasileiro. Achado por
// mutação: afrouxar a guarda de `+55` para `+5` deixava o "+51" (Peru) passar
// como o DDD 51 de Porto Alegre, e todos os testes vizinhos seguiam verdes,
// porque nenhum digitava um país começado em 5 no caixa.
import { describe, expect, it } from "vitest";

import { linkWhatsappDoClienteDoBalcao } from "@/lib/whatsapp-do-cliente";

describe("linkWhatsappDoClienteDoBalcao — o '+' do número", () => {
  it.each([
    ["+55 (34) 99999-1234", "https://wa.me/5534999991234"],
    ["+5534999991234", "https://wa.me/5534999991234"],
    ["  +55 34 99999-1234", "https://wa.me/5534999991234"],
    ["+55 (34) 3333-4444", "https://wa.me/553433334444"],
  ])("aceita %s (Brasil) e não duplica o 55", (digitado, esperado) => {
    expect(linkWhatsappDoClienteDoBalcao(digitado)).toBe(esperado);
  });

  it.each([
    // O mesmo miolo "51 98765-4321" seria um celular de Porto Alegre (DDD 51)
    // se o "+51" (Peru) fosse lido como DDD.
    "+51 987 654 321",
    "+54 11 91234-5678",
    "+1 415 555 2671",
    "+351 912 345 678",
  ])("recusa %s: outro país nunca vira DDD brasileiro", (digitado) => {
    expect(linkWhatsappDoClienteDoBalcao(digitado)).toBeNull();
  });

  it("o mesmo número sem '+' continua sendo um celular de Porto Alegre", () => {
    expect(linkWhatsappDoClienteDoBalcao("51 98765-4321")).toBe(
      "https://wa.me/5551987654321",
    );
  });
});
