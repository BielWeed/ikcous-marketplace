// Duas bordas do que a vitrine faz com o link JÁ GRAVADO de um banner:
//
//  1. `/produtos` (endereço que a loja não tem) vira a Home em qualquer forma
//     que a cliente ainda possa ter gravada -- inclusive com `#ancora` e sem
//     `?consulta`. Se a regra só cortasse o link na `?`, o banner antigo
//     `/produtos#ofertas` abriria uma tela que não existe.
//  2. O nome de categoria que já veio codificado (`Cal%C3%A7ados`, `Mesa%2FBanho`)
//     NÃO é codificado de novo: `%` seguido de um par hexadecimal, em maiúscula
//     ou minúscula, é codificação pronta. Se a regra só reconhecesse dígitos
//     (`%41`), o banner de "Calçados" abriria `Cal%25C3%25A7ados` e a vitrine
//     ficaria sem nenhum produto, sem botão marcado.
//
// Do outro lado da régua, o `%` que NÃO abre um par hexadecimal continua sendo
// texto cru e é codificado -- e cada separador que o endereço trataria à parte
// (espaço, `+`, `#`, `&`, até o separador de linha Unicode) basta, SOZINHO, para
// o nome ser codificado. Um parâmetro de verdade depois do nome pode ter ponto
// na chave (`utm.source=x`) e segue como parâmetro, fora do nome.
import { destinoDoBanner } from "@/lib/destino-do-banner";
import { describe, expect, it } from "vitest";

describe("/produtos com âncora volta para a Home", () => {
  it.each([
    ["/produtos#ofertas", "/"],
    ["/produtos/#ofertas", "/"],
    ["/PRODUTOS#topo", "/"],
    ["/produtos?x=1#ofertas", "/"],
    ["/produtos?x=1", "/"],
  ])("%s abre %s", (gravado, esperado) => {
    expect(destinoDoBanner(gravado)).toBe(esperado);
  });

  it("um caminho que só COMEÇA com /produtos não é a Home", () => {
    expect(destinoDoBanner("/produtos-novos#ofertas")).toBe(
      "/produtos-novos#ofertas",
    );
  });
});

describe("categoria já codificada não é codificada de novo", () => {
  it.each([
    ["/?category=Cal%C3%A7ados", "/?category=Cal%C3%A7ados"],
    ["/?category=Cal%c3%a7ados", "/?category=Cal%c3%a7ados"],
    ["/?category=Mesa%2FBanho", "/?category=Mesa%2FBanho"],
    ["/?category=Mesa%2fBanho", "/?category=Mesa%2fBanho"],
    ["/?category=Roupa%20Infantil", "/?category=Roupa%20Infantil"],
  ])("%s fica como está", (gravado, esperado) => {
    expect(destinoDoBanner(gravado)).toBe(esperado);
  });

  it("% que não abre um par hexadecimal é texto cru e ganha codificação", () => {
    expect(destinoDoBanner("/?category=100%Algodão")).toBe(
      "/?category=100%25Algod%C3%A3o",
    );
    expect(destinoDoBanner("/?category=50%G")).toBe("/?category=50%25G");
  });

  it.each([
    ["Cama Banho", "Cama%20Banho"],
    ["Mais+Vendidos", "Mais%2BVendidos"],
    ["Moda#1", "Moda%231"],
    ["Cama&Banho", "Cama%26Banho"],
    ["Moda\u2028Praia", "Moda%E2%80%A8Praia"],
  ])(
    "o nome cru %j, com um único separador, ganha a codificação",
    (nome, codificado) => {
      expect(destinoDoBanner(`/?category=${nome}`)).toBe(
        `/?category=${codificado}`,
      );
    },
  );

  it("parâmetro depois do nome, com ponto na chave, continua sendo parâmetro", () => {
    expect(destinoDoBanner("/?category=Cama & Banho&utm.source=x")).toBe(
      "/?category=Cama%20%26%20Banho&utm.source=x",
    );
    expect(destinoDoBanner("/?category=Moda&utm-medium=x&a_b=1")).toBe(
      "/?category=Moda&utm-medium=x&a_b=1",
    );
  });

  it("nome cru com espaço e & ganha a codificação que faltava", () => {
    expect(destinoDoBanner("/?category=Cama & Banho")).toBe(
      "/?category=Cama%20%26%20Banho",
    );
  });
});
