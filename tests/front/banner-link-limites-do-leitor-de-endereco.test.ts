// O LINK DO BANNER É UM ENDEREÇO QUE A LOJA ABRE NO TOQUE: precisa ser lido do
// jeito que o NAVEGADOR o lê (tab, quebra de linha e espaços do começo somem),
// só abrir o que o banner PODE abrir (caminho do app, http/https e quatro
// esquemas que não rodam código) e corrigir, na leitura, o que versões antigas
// do painel gravaram (`/produtos`, `/checkout`, nome de categoria cru).
//
// Os testes vizinhos de banner provam o miolo (esquemas perigosos, `//outro-site`,
// o link sem barra com dois-pontos); este arquivo prende os limites que ficaram
// sem prova: os disfarces com tab/quebra DENTRO do endereço, o espaço do começo,
// `http` e `https` separados, cada esquema liberado, `/checkout` → `/cart` só
// exato, `/produtos` em maiúsculas, a codificação do nome da categoria e a
// separação do nome dos parâmetros de verdade, e o endereço de site sem
// esquema digitado no painel.
import { describe, expect, it } from "vitest";

import {
  comoONavegadorLe,
  destinoDoBanner,
  destinoSeguroDoBanner,
} from "@/lib/destino-do-banner";
import {
  avisoDoLinkDigitado,
  linkDaCategoria,
  linkDoBannerParaSalvar,
} from "@/lib/link-do-banner-no-painel";

describe("comoONavegadorLe — o endereço como o navegador o lê", () => {
  it("tab, quebra de linha e retorno somem em QUALQUER posição (cada um sozinho)", () => {
    expect(comoONavegadorLe("java\tscript:x")).toBe("javascript:x");
    expect(comoONavegadorLe("java\nscript:x")).toBe("javascript:x");
    expect(comoONavegadorLe("java\rscript:x")).toBe("javascript:x");
  });

  it("controles e espaços do COMEÇO somem, inclusive o espaço (0x20); o 0x21 fica", () => {
    expect(comoONavegadorLe("\u0001\u001f  /x")).toBe("/x");
    expect(comoONavegadorLe(" /x")).toBe("/x");
    expect(comoONavegadorLe("! /x")).toBe("! /x");
  });

  it("espaço no meio e no fim fica (só o começo é aparado)", () => {
    expect(comoONavegadorLe("/a b ")).toBe("/a b ");
  });
});

describe("destinoSeguroDoBanner — só abre o que o banner PODE abrir", () => {
  it.each([
    ["/\t/evil.com"],
    ["/\n/evil.com"],
    ["/\r/evil.com"],
    [" //evil.com"],
    ["\u0001//evil.com"],
    ["//evil.com"],
    ["/\\evil.com"],
    ["java\tscript:alert(1)"],
    ["\tjavascript:alert(1)"],
    ["javascript:alert(1)"],
    ["data:text/html,x"],
    ["vbscript:x"],
    ["file:///etc/passwd"],
    ["blob:https://a.com/x"],
    ["intent://x#Intent;end"],
    ["ftp://a.com/x"],
    [""],
    ["   "],
  ])("%j é recusado (null)", (link) => {
    expect(destinoSeguroDoBanner(link)).toBeNull();
  });

  it("o disfarce com tab dentro de // vira // e é recusado (o navegador leria OUTRO site)", () => {
    // Sem tirar o tab, "/\t/evil.com" parecia caminho do app (segundo
    // caractere diferente de barra) e saía como link seguro.
    expect(destinoSeguroDoBanner("/\t/evil.com")).toBeNull();
  });

  it.each([null, undefined, 42, {}] as const)(
    "valor que nem texto é (%j) é recusado sem quebrar",
    (valor) => {
      expect(
        destinoSeguroDoBanner(valor as unknown as string | null | undefined),
      ).toBeNull();
    },
  );

  it("o link liberado volta JÁ LIDO como o navegador lê (sem tab nem quebra)", () => {
    expect(destinoSeguroDoBanner("/pro\tmo\ncao\r")).toBe("/promocao");
    expect(destinoSeguroDoBanner("https://loja.com/a\tb")).toBe(
      "https://loja.com/ab",
    );
    expect(destinoSeguroDoBanner("  tel:+55\n11")).toBe("tel:+5511");
  });

  it("http e https valem cada um (nenhum depende do outro)", () => {
    expect(destinoSeguroDoBanner("http://loja.com/x")).toBe(
      "http://loja.com/x",
    );
    expect(destinoSeguroDoBanner("https://loja.com/x")).toBe(
      "https://loja.com/x",
    );
  });

  it.each([
    ["tel:+5511999999999"],
    ["mailto:oi@loja.com"],
    ["sms:+5511999999999"],
    ["whatsapp://send?phone=5511999999999"],
  ])("o esquema que não roda código passa inteiro: %s", (link) => {
    expect(destinoSeguroDoBanner(link)).toBe(link);
  });

  it("link antigo sem barra é lido como caminho do app (como o painel o gravaria)", () => {
    expect(destinoSeguroDoBanner("promocoes/natal")).toBe("/promocoes/natal");
    expect(destinoSeguroDoBanner("?category=Bebidas")).toBe(
      "/?category=Bebidas",
    );
    expect(destinoSeguroDoBanner("#ofertas")).toBe("/#ofertas");
  });
});

describe("destinoDoBanner — o que versões antigas do painel gravaram", () => {
  it("/checkout (o antigo atalho Carrinho) vira /cart, mas SÓ o endereço exato", () => {
    expect(destinoDoBanner("/checkout")).toBe("/cart");
    expect(destinoDoBanner("/checkout/")).toBe("/checkout/");
    expect(destinoDoBanner("/checkout?x=1")).toBe("/checkout?x=1");
  });

  it.each([
    "/produtos",
    "/produtos/",
    "/PRODUTOS",
    "/Produtos/?x=1",
    "/produtos#topo",
  ])("%s (endereço que a loja não tem) vira a Início", (link) => {
    expect(destinoDoBanner(link)).toBe("/");
  });

  it("LIMITE: um caminho que só COMEÇA com /produtos não é o /produtos", () => {
    expect(destinoDoBanner("/produtos-novos")).toBe("/produtos-novos");
  });

  it("nome de categoria cru ganha a codificação que faltava", () => {
    expect(destinoDoBanner("/?category=Cama & Banho")).toBe(
      "/?category=Cama%20%26%20Banho",
    );
    expect(destinoDoBanner("/?category=Cama Banho")).toBe(
      "/?category=Cama%20Banho",
    );
    expect(destinoDoBanner("/?category=A+B")).toBe("/?category=A%2BB");
    expect(destinoDoBanner("/?category=A#B")).toBe("/?category=A%23B");
    expect(destinoDoBanner("/?category=Cama&Banho")).toBe(
      "/?category=Cama%26Banho",
    );
  });

  it("nome já codificado não é codificado de novo (com maiúscula ou minúscula no hexadecimal)", () => {
    expect(destinoDoBanner("/?category=Cama%20%26%20Banho")).toBe(
      "/?category=Cama%20%26%20Banho",
    );
    expect(destinoDoBanner("/?category=a%2fb")).toBe("/?category=a%2fb");
    expect(destinoDoBanner("/?category=a%2Fb")).toBe("/?category=a%2Fb");
  });

  it("um % que não abre um par hexadecimal é texto: ganha a codificação", () => {
    expect(destinoDoBanner("/?category=100%")).toBe("/?category=100%25");
    expect(destinoDoBanner("/?category=50%A")).toBe("/?category=50%25A");
  });

  it("o nome vai até o primeiro parâmetro de verdade; os parâmetros seguem como estão", () => {
    expect(destinoDoBanner("/?category=Cama&Banho&page=2")).toBe(
      "/?category=Cama%26Banho&page=2",
    );
    // parâmetro com hífen e com ponto também é parâmetro de verdade.
    expect(destinoDoBanner("/?category=Cama&utm-source=x")).toBe(
      "/?category=Cama&utm-source=x",
    );
    expect(destinoDoBanner("/?category=Cama&utm.source=x")).toBe(
      "/?category=Cama&utm.source=x",
    );
  });

  it("separador de linha Unicode no nome também é espaço: o nome é codificado, não deixado cru", () => {
    expect(destinoDoBanner("/?category=A B")).toBe("/?category=A%E2%80%A8B");
  });

  it("link recusado continua recusado (null), mesmo com cara de categoria", () => {
    expect(destinoDoBanner("//evil.com/?category=A")).toBeNull();
    expect(destinoDoBanner(null)).toBeNull();
  });
});

describe("linkDoBannerParaSalvar — o que o painel grava quando a dona digita", () => {
  it("endereço de site sem esquema ganha https://", () => {
    expect(linkDoBannerParaSalvar("wa.me/5511999999999")).toBe(
      "https://wa.me/5511999999999",
    );
    expect(linkDoBannerParaSalvar("minha-loja.com.br")).toBe(
      "https://minha-loja.com.br",
    );
    expect(linkDoBannerParaSalvar("loja.com:8080/x")).toBe(
      "https://loja.com:8080/x",
    );
  });

  it("espaços em volta da digitação são aparados antes de decidir", () => {
    expect(linkDoBannerParaSalvar("  loja.com  ")).toBe("https://loja.com");
  });

  it("LIMITE: o que não tem cara de site NÃO ganha https:// (vira caminho do app)", () => {
    // parte do domínio com caractere que domínio não tem
    expect(linkDoBannerParaSalvar("loja!.com/x")).toBe("/loja!.com/x");
    // espaço depois do domínio: é texto, não endereço de site
    expect(linkDoBannerParaSalvar("loja.com/minha promo")).toBe(
      "/loja.com/minha promo",
    );
    // porta vazia não é porta
    expect(linkDoBannerParaSalvar("loja.com:")).toBeNull();
  });

  it("vazio é vazio (a dona deixou o campo em branco), nunca recusa", () => {
    expect(linkDoBannerParaSalvar("")).toBe("");
    expect(linkDoBannerParaSalvar("   ")).toBe("");
    expect(linkDoBannerParaSalvar(null)).toBe("");
    expect(linkDoBannerParaSalvar(undefined)).toBe("");
  });

  it("o aviso ao vivo só aparece quando o link seria recusado (não para o campo vazio)", () => {
    expect(avisoDoLinkDigitado("")).toBeNull();
    expect(avisoDoLinkDigitado("wa.me/55")).toBeNull();
    expect(avisoDoLinkDigitado("javascript:alert(1)")).toContain("https://");
  });

  it("o link de categoria sai com o nome codificado", () => {
    expect(linkDaCategoria("Cama & Banho")).toBe(
      "/?category=Cama%20%26%20Banho",
    );
    expect(linkDaCategoria("Café")).toBe("/?category=Caf%C3%A9");
  });
});
