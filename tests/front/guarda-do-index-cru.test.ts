// Abrir "/index.html", "/404.html" ou um arquivo que não existe em /icons e
// /images servia o HTML "cru" (o porteiro não passa por eles), sem a ficha da
// loja: o app subia com a marca e o banco assados no build (os da IKCOUS
// antiga) dentro do endereço da Savy. A guarda decide o que fazer com o app
// que sobe SEM ficha: ir para "/" (onde o porteiro entrega a ficha certa) ou,
// se já está em "/", parar numa tela segura. Nunca sobe com o assado.
//
// Sem laço: o destino é sempre "/", e "/" nunca redireciona.
import { describe, expect, it } from "vitest";

import { decidirBootSemFicha } from "@/config/guardaDoIndexCru";

const FICHA = { identidade: {} };

function decidir(parcial: Partial<Parameters<typeof decidirBootSemFicha>[0]>) {
  return decidirBootSemFicha({
    ficha: null,
    pathname: "/",
    hostname: "savy.exemplo",
    dev: false,
    search: "",
    hash: "",
    ...parcial,
  });
}

describe("decidirBootSemFicha", () => {
  it("produção, sem ficha, em /index.html: vai para / levando a busca e o hash", () => {
    expect(
      decidir({ pathname: "/index.html", search: "?utm=a", hash: "#x" }),
    ).toEqual({ tipo: "redirecionar", destino: "/?utm=a#x" });
  });

  it("sem busca nem hash: só /", () => {
    expect(decidir({ pathname: "/index.html" })).toEqual({
      tipo: "redirecionar",
      destino: "/",
    });
  });

  it.each([
    "/404.html",
    "/icons/x.png",
    "/icons/",
    "/images/a/b.webp",
    "/fonts/inexistente.woff2",
    "/assets/index-antigo.js",
    "/carrinho",
    "/produto/abc",
    "/index.html/x",
  ])(
    "produção, sem ficha, em %s: vai para / (nunca sobe com o assado)",
    (p) => {
      expect(decidir({ pathname: p })).toEqual({
        tipo: "redirecionar",
        destino: "/",
      });
    },
  );

  it("em /, sem ficha, produção: tela segura (não há para onde ir; sem laço)", () => {
    expect(decidir({ pathname: "/" })).toEqual({ tipo: "tela-segura" });
    expect(decidir({ pathname: "/", search: "?a=1", hash: "#b" })).toEqual({
      tipo: "tela-segura",
    });
  });

  it("com ficha: segue em qualquer caminho", () => {
    for (const pathname of ["/", "/index.html", "/404.html", "/carrinho"]) {
      expect(decidir({ ficha: FICHA, pathname })).toEqual({ tipo: "seguir" });
    }
  });

  it("em desenvolvimento: segue em qualquer caminho, sem ficha", () => {
    for (const pathname of ["/", "/index.html", "/404.html", "/icons/x.png"]) {
      expect(decidir({ dev: true, pathname })).toEqual({ tipo: "seguir" });
    }
  });

  it.each(["localhost", "127.0.0.1", "[::1]", "loja.localhost"])(
    "endereço local (%s), sem ficha: segue (preview e testes de jornada)",
    (h) => {
      for (const pathname of ["/", "/404.html", "/carrinho"]) {
        expect(decidir({ hostname: h, pathname })).toEqual({ tipo: "seguir" });
      }
    },
  );

  it.each(["localhost.evil.com", "meulocalhost.com", "127.0.0.10", ""])(
    "endereço que só PARECE local (%j) não é local: a guarda age",
    (h) => {
      expect(decidir({ hostname: h, pathname: "/" })).toEqual({
        tipo: "tela-segura",
      });
    },
  );

  it("sem endereço nenhum (pathname vazio, fora de um navegador): segue", () => {
    expect(decidir({ pathname: "", hostname: "" })).toEqual({ tipo: "seguir" });
  });

  it("nunca há laço: o destino do redirecionamento é sempre '/', e dali a decisão não redireciona", () => {
    for (const pathname of ["/index.html", "/404.html", "/icons/x.png", "/a"]) {
      const primeira = decidir({ pathname, search: "?a=1" });
      expect(primeira.tipo).toBe("redirecionar");
      const destino = (primeira as { destino: string }).destino;
      expect(destino.startsWith("/?")).toBe(true);
      const url = new URL(destino, "https://savy.exemplo");
      const segunda = decidir({ pathname: url.pathname, search: url.search });
      expect(segunda.tipo).not.toBe("redirecionar");
    }
  });
});
