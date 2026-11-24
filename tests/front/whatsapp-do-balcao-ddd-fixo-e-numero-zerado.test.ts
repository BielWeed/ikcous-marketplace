// O link de WhatsApp do recibo do balcão só sai para um telefone brasileiro
// COMPLETO, e o botão da loja só nasce com número que existe. Os testes de
// `whatsapp-do-cliente.test.ts` e `loja-tem-whatsapp-regra-unica.test.ts`
// cobrem o caminho comum; aqui ficam as bordas que mandariam o recibo (ou o
// cliente) para um número que não existe:
//   - DDD que não existe;
//   - fixo (10 dígitos) só com o 1º dígito do número entre 2 e 5, celular (11)
//     só com o 9 na frente — "1198765432" e "11887654321" não são telefone;
//   - número que só tem zeros depois do DDD, mas um zero só NÃO basta para
//     reprovar ("3410000000" é número de verdade).
import { lojaTemWhatsapp } from "@/lib/loja-tem-whatsapp";
import { telefoneNacionalZerado } from "@/lib/telefone-nacional-zerado";
import { linkWhatsappDoClienteDoBalcao } from "@/lib/whatsapp-do-cliente";
import { describe, expect, it } from "vitest";

describe("linkWhatsappDoClienteDoBalcao — só telefone brasileiro completo e real", () => {
  it("celular com DDD válido e 9 na frente: link com o 55 do Brasil", () => {
    expect(linkWhatsappDoClienteDoBalcao("(11) 98765-4321")).toBe(
      "https://wa.me/5511987654321",
    );
  });

  it("fixo: o número começa com 2, 3, 4 ou 5", () => {
    for (const primeiro of ["2", "3", "4", "5"]) {
      expect(
        linkWhatsappDoClienteDoBalcao(`11${primeiro}3334444`),
        `fixo começando em ${primeiro}`,
      ).toBe(`https://wa.me/5511${primeiro}3334444`);
    }
  });

  it("fixo com 6, 7, 8 ou 9 na frente (celular antigo sem o 9) NÃO vira link", () => {
    for (const primeiro of ["6", "7", "8", "9", "0", "1"]) {
      expect(
        linkWhatsappDoClienteDoBalcao(`11${primeiro}3334444`),
        `10 dígitos começando em ${primeiro}`,
      ).toBeNull();
    }
  });

  it("11 dígitos sem o 9 na frente do número NÃO vira link", () => {
    for (const terceiro of ["0", "1", "2", "3", "4", "5", "6", "7", "8"]) {
      expect(
        linkWhatsappDoClienteDoBalcao(`11${terceiro}87654321`),
        `11 dígitos com ${terceiro} depois do DDD`,
      ).toBeNull();
    }
  });

  it("DDD que não existe NÃO vira link, nem celular nem fixo", () => {
    for (const ddd of ["10", "20", "23", "30", "00", "90"]) {
      expect(
        linkWhatsappDoClienteDoBalcao(`${ddd}987654321`),
        `celular com DDD ${ddd}`,
      ).toBeNull();
      expect(
        linkWhatsappDoClienteDoBalcao(`${ddd}33334444`),
        `fixo com DDD ${ddd}`,
      ).toBeNull();
    }
  });

  it("quantidade de dígitos errada NÃO vira link (9, 12 e 14 dígitos)", () => {
    expect(linkWhatsappDoClienteDoBalcao("987654321")).toBeNull();
    expect(linkWhatsappDoClienteDoBalcao("119876543210")).toBeNull();
    expect(linkWhatsappDoClienteDoBalcao("11987654321999")).toBeNull();
  });

  it("vazio, nulo e indefinido: sem link", () => {
    expect(linkWhatsappDoClienteDoBalcao("")).toBeNull();
    expect(linkWhatsappDoClienteDoBalcao(null)).toBeNull();
    expect(linkWhatsappDoClienteDoBalcao(undefined)).toBeNull();
  });

  it("'+55' vale (é o Brasil); outro país com '+' não vira link brasileiro", () => {
    expect(linkWhatsappDoClienteDoBalcao("+55 11 98765-4321")).toBe(
      "https://wa.me/5511987654321",
    );
    expect(linkWhatsappDoClienteDoBalcao("  +55 11 98765-4321")).toBe(
      "https://wa.me/5511987654321",
    );
    expect(linkWhatsappDoClienteDoBalcao("+44 11 98765-4321")).toBeNull();
    expect(linkWhatsappDoClienteDoBalcao("  +1 415 555 2671")).toBeNull();
    // Os dígitos de "+1 199 876 5432" (11) formariam um celular brasileiro válido:
    // o "+" que não é "+55" é quem impede o link para o número errado.
    expect(linkWhatsappDoClienteDoBalcao("+1 199 876 5432")).toBeNull();
  });

  it("campo avulso do caixa (jaNacional): o 55 do começo é DDD, nunca país", () => {
    expect(
      linkWhatsappDoClienteDoBalcao("55987654321", { jaNacional: true }),
    ).toBe("https://wa.me/5555987654321");
    expect(
      linkWhatsappDoClienteDoBalcao("11987654321", { jaNacional: true }),
    ).toBe("https://wa.me/5511987654321");
    // 13 dígitos já com o país colado NÃO é nacional: recusa em vez de reinterpretar.
    expect(
      linkWhatsappDoClienteDoBalcao("5511987654321", { jaNacional: true }),
    ).toBeNull();
    // Com pontuação, o campo avulso não é "já nacional" de verdade.
    expect(
      linkWhatsappDoClienteDoBalcao("(11) 98765-4321", { jaNacional: true }),
    ).toBeNull();
  });
});

describe("telefoneNacionalZerado — zeros depois do DDD", () => {
  it("só zeros depois do DDD: zerado", () => {
    expect(telefoneNacionalZerado("3400000000")).toBe(true);
    expect(telefoneNacionalZerado("34000000000")).toBe(true);
    expect(telefoneNacionalZerado("3400")).toBe(true);
  });

  it("qualquer dígito diferente de zero depois do DDD: não é zerado", () => {
    expect(telefoneNacionalZerado("3410000000")).toBe(false);
    expect(telefoneNacionalZerado("3400000001")).toBe(false);
    expect(telefoneNacionalZerado("3499999999")).toBe(false);
  });

  it("sem nada depois do DDD não conta como zerado (o tamanho é quem reprova)", () => {
    expect(telefoneNacionalZerado("")).toBe(false);
    expect(telefoneNacionalZerado("34")).toBe(false);
  });

  it("o DDD não conta: zeros no DDD e número normal não é zerado", () => {
    expect(telefoneNacionalZerado("0099999999")).toBe(false);
  });
});

describe("lojaTemWhatsapp — o botão só nasce com número real", () => {
  it("um único dígito diferente de zero depois do DDD já basta", () => {
    expect(lojaTemWhatsapp("3410000000")).toBe(true);
    expect(lojaTemWhatsapp("(34) 00000-0001")).toBe(true);
  });

  it("só zeros depois do DDD: sem botão", () => {
    expect(lojaTemWhatsapp("3400000000")).toBe(false);
    expect(lojaTemWhatsapp("(34) 00000-0000")).toBe(false);
    expect(lojaTemWhatsapp("+55 34 00000-0000")).toBe(false);
  });
});
