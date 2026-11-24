// Link de banner escrito sem a barra do começo e com ":" mais adiante
// (`?category=Mesa:Banho`, `#ofertas:hoje`, `promocoes/natal:2026`) é um CAMINHO
// do app, não um esquema como `javascript:`. O ":" só denuncia um esquema quando
// vem ANTES da primeira barra, interrogação ou cerquilha: se a regra olhar o
// texto inteiro, o banner de uma categoria com ":" no nome (ou um link antigo
// com horário/data) é recusado ao salvar e nunca abre na vitrine.
//
// E, do outro lado da mesma régua, esquema de verdade continua recusado.
import {
  destinoDoBanner,
  destinoSeguroDoBanner,
} from "@/lib/destino-do-banner";
import {
  avisoDoLinkDigitado,
  linkDoBannerParaSalvar,
} from "@/lib/link-do-banner-no-painel";
import { describe, expect, it } from "vitest";

const CAMINHOS_COM_DOIS_PONTOS_DEPOIS: ReadonlyArray<
  readonly [string, string]
> = [
  ["?category=Mesa:Banho", "/?category=Mesa:Banho"],
  ["#ofertas:hoje", "/#ofertas:hoje"],
  ["promocoes/natal:2026", "/promocoes/natal:2026"],
];

describe("o ':' depois do começo não faz o link virar esquema", () => {
  it.each(CAMINHOS_COM_DOIS_PONTOS_DEPOIS)(
    "o painel grava %s como o caminho %s",
    (digitado, gravado) => {
      expect(linkDoBannerParaSalvar(digitado)).toBe(gravado);
      expect(avisoDoLinkDigitado(digitado)).toBeNull();
    },
  );

  it.each(CAMINHOS_COM_DOIS_PONTOS_DEPOIS)(
    "a vitrine lê %s já gravado como o caminho %s",
    (gravado, esperado) => {
      expect(destinoSeguroDoBanner(gravado)).toBe(esperado);
      expect(destinoDoBanner(gravado)).toBe(esperado);
    },
  );
});

describe("esquema de verdade, com ':' antes de qualquer barra, segue recusado", () => {
  it.each([
    "javascript:alert(1)",
    "javascript:alert(1)#a",
    "javascript:alert(1)?x=1",
    "data:text/html,<b>x</b>",
    "vbscript:msgbox(1)",
  ])("%s", (perigoso) => {
    expect(linkDoBannerParaSalvar(perigoso)).toBeNull();
    expect(avisoDoLinkDigitado(perigoso)).not.toBeNull();
    expect(destinoSeguroDoBanner(perigoso)).toBeNull();
  });
});

describe("endereço de site digitado sem https", () => {
  it("a terminação precisa ser de letras e ter ao menos duas", () => {
    expect(linkDoBannerParaSalvar("wa.me/5511999999999")).toBe(
      "https://wa.me/5511999999999",
    );
    // Uma letra só, ou números: é nome de arquivo ou versão, não um site.
    expect(linkDoBannerParaSalvar("loja.x")).toBe("/loja.x");
    expect(linkDoBannerParaSalvar("promo.2026")).toBe("/promo.2026");
  });

  it("consulta ou âncora logo depois do domínio não impede de ser um site", () => {
    expect(linkDoBannerParaSalvar("loja.com?ref=insta")).toBe(
      "https://loja.com?ref=insta",
    );
    expect(linkDoBannerParaSalvar("loja.com#sobre")).toBe(
      "https://loja.com#sobre",
    );
  });

  it("dois ':' seguidos de números não formam site com porta", () => {
    expect(linkDoBannerParaSalvar("loja.com:80:90")).toBeNull();
  });

  it("a porta tem de 1 a 5 dígitos", () => {
    expect(linkDoBannerParaSalvar("loja.com:8080/oferta")).toBe(
      "https://loja.com:8080/oferta",
    );
    expect(linkDoBannerParaSalvar("loja.com:12345")).toBe(
      "https://loja.com:12345",
    );
    // Seis dígitos ou letras não são porta: o link é recusado, nunca vira site.
    expect(linkDoBannerParaSalvar("loja.com:123456")).toBeNull();
    expect(linkDoBannerParaSalvar("loja.com:abc")).toBeNull();
  });
});
