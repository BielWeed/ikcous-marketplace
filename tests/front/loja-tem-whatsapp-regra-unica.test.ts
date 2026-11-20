import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
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

  it.each([
    "551122345678",
    "551132345678",
    "551142345678",
    "551152345678",
    "551167654321",
  ])("mantém o botão do WhatsApp disponível para o fixo %s", (numero) => {
    expect(lojaTemWhatsapp(numero)).toBe(true);
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

  // A régua conta os dígitos DEPOIS de normalizar (a mesma função que monta o
  // link). Dez zeros tinham 10 dígitos crus, mas a normalização tira os zeros
  // da frente: sobrava um destinatário vazio e o botão abria `wa.me/?text=`.
  it("dez zeros (ou zeros na frente que deixam menos de 10 dígitos) NÃO têm WhatsApp", () => {
    expect(lojaTemWhatsapp("0000000000")).toBe(false);
    expect(lojaTemWhatsapp("(00) 00000-0000")).toBe(false);
    expect(lojaTemWhatsapp("0123456789")).toBe(false);
  });

  it("controles: número válido com e sem o 55 do país continua tendo WhatsApp", () => {
    expect(lojaTemWhatsapp("(11) 98888-7777")).toBe(true);
    expect(lojaTemWhatsapp("+55 11 98888-7777")).toBe(true);
    expect(lojaTemWhatsapp("551188887777")).toBe(true);
    expect(lojaTemWhatsapp("5511988887777")).toBe(true);
    expect(lojaTemWhatsapp("1188887777")).toBe(true);
    expect(lojaTemWhatsapp("11988887777")).toBe(true);
  });

  it("controle: o zero de tronco na frente não esconde um número que fica com 10 ou 11 dígitos", () => {
    expect(lojaTemWhatsapp("011 98888-7777")).toBe(true);
    expect(lojaTemWhatsapp("0 11 8888-7777")).toBe(true);
  });
});
