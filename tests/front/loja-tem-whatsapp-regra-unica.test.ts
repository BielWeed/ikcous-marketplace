// Laudo caça-bugs 31/08 (C1/C2): a régua "sem número de WhatsApp, o botão
// some" vivia só no ProductView; OrderDetailsView, ProfileView e a promessa
// do OrderSuccessView ficaram para trás e `wa.me/` sem destinatário voltou
// a aparecer no pós-venda. A régua agora é uma função só
// (`src/lib/loja-tem-whatsapp.ts`) usada nos 4 pontos — esta suíte guarda a
// FUNÇÃO, que é o lugar onde uma régua única pode ser testada de verdade.
//
// Casos que matam mutação: 9 dígitos (recusa — era o buraco), 10 e 11
// (aceita), formatado com pontuação (aceita), com prefixo 55 (aceita),
// null/undefined/vazio/letras (recusa — e nunca vira `wa.me/` vazio).
import { describe, expect, it } from "vitest";
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";

describe("lojaTemWhatsapp — a régua dos 10 dígitos, em um lugar só", () => {
  it("null, undefined, vazio e só pontuação NÃO têm WhatsApp", () => {
    expect(lojaTemWhatsapp(null)).toBe(false);
    expect(lojaTemWhatsapp(undefined)).toBe(false);
    expect(lojaTemWhatsapp("")).toBe(false);
    expect(lojaTemWhatsapp("(  )     -")).toBe(false);
  });

  it("9 dígitos NÃO bastam — era o buraco que abria link sem destinatário", () => {
    expect(lojaTemWhatsapp("999999999")).toBe(false);
  });

  it("10 e 11 dígitos (DDD + telefone) têm WhatsApp", () => {
    expect(lojaTemWhatsapp("3499999999")).toBe(true);
    expect(lojaTemWhatsapp("34999999999")).toBe(true);
  });

  it("número formatado com pontuação vale igual ao cru", () => {
    expect(lojaTemWhatsapp("(34) 99999-9999")).toBe(true);
  });

  it("número com prefixo 55 do país também vale", () => {
    expect(lojaTemWhatsapp("5534999999999")).toBe(true);
  });

  it("letras sozinhas não enganam a régua", () => {
    expect(lojaTemWhatsapp("whatsapp da loja")).toBe(false);
  });
});
