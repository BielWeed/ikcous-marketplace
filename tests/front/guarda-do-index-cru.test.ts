// Abrir "/index.html" no endereço de uma loja cliente servia o HTML "cru"
// (o porteiro não passa por esse arquivo), sem a ficha da loja: o app subia
// com a marca e o banco da IKCOUS dentro do endereço da Savy. A guarda manda
// quem chegou ali para "/", onde o porteiro entrega a ficha certa.
//
// Sem laço: só "/index.html" redireciona, e o destino é "/".
import { describe, expect, it } from "vitest";

import { destinoDoIndexCru } from "@/config/guardaDoIndexCru";

const FICHA = { identidade: {} };

describe("destinoDoIndexCru", () => {
  it("produção, sem ficha, em /index.html: vai para / levando a busca e o hash", () => {
    expect(
      destinoDoIndexCru({
        ficha: null,
        pathname: "/index.html",
        dev: false,
        search: "?utm=a",
        hash: "#x",
      }),
    ).toBe("/?utm=a#x");
  });

  it("sem busca nem hash: só /", () => {
    expect(
      destinoDoIndexCru({
        ficha: null,
        pathname: "/index.html",
        dev: false,
        search: "",
        hash: "",
      }),
    ).toBe("/");
  });

  it("com ficha: não mexe", () => {
    expect(
      destinoDoIndexCru({
        ficha: FICHA,
        pathname: "/index.html",
        dev: false,
        search: "",
        hash: "",
      }),
    ).toBeNull();
  });

  it("em desenvolvimento: não mexe", () => {
    expect(
      destinoDoIndexCru({
        ficha: null,
        pathname: "/index.html",
        dev: true,
        search: "",
        hash: "",
      }),
    ).toBeNull();
  });

  it.each(["/", "/carrinho", "/index.html/x", "/INDEX.HTML.bak", ""])(
    "outro caminho (%s) nunca redireciona (sem laço)",
    (pathname) => {
      expect(
        destinoDoIndexCru({
          ficha: null,
          pathname,
          dev: false,
          search: "",
          hash: "",
        }),
      ).toBeNull();
    },
  );

  it("o destino nunca é ele mesmo", () => {
    const destino = destinoDoIndexCru({
      ficha: null,
      pathname: "/index.html",
      dev: false,
      search: "?a=1",
      hash: "",
    });
    expect(destino?.startsWith("/index.html")).toBe(false);
  });
});
