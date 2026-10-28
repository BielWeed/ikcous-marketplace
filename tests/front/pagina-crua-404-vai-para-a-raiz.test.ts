// "/404.html" é uma cópia do índice feita no build (scripts/hospedagem.mjs) e o
// matcher do porteiro a tira da lista de documentos: na Vercel ela saía CRUA
// (HTTP 200, sem a ficha da loja) e o app subia com a marca e o banco assados no
// build dentro do endereço de outra loja. O vercel.json agora manda esse
// endereço para "/", onde o porteiro entrega a ficha. Os outros caminhos crus
// (arquivo inexistente em /icons, /images...) são pegos pela guarda do boot
// (guarda-do-index-cru*.test.ts).
//
// Este teste prova o contrato do roteamento sem subir servidor:
//   1. o redirecionamento existe, é temporário e vai para "/";
//   2. "/" é DOCUMENTO do porteiro (é lá que a ficha chega);
//   3. as rotas legítimas do app continuam sendo documentos (recebem ficha);
//   4. a regra que manda tudo ao índice continua existindo.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { ehCaminhoDeDocumento } from "@/hospedagem/porteiro";

const vercel = JSON.parse(readFileSync("vercel.json", "utf8")) as {
  redirects?: Array<{
    source: string;
    destination: string;
    permanent?: boolean;
  }>;
  rewrites?: Array<{ source: string; destination: string }>;
};

describe("vercel.json: /404.html não serve a página crua", () => {
  it("redireciona /404.html para / (temporário, para não ficar guardado no navegador)", () => {
    const regra = (vercel.redirects ?? []).find(
      (r) => r.source === "/404.html",
    );
    expect(regra).toEqual({
      source: "/404.html",
      destination: "/",
      permanent: false,
    });
  });

  it("o destino do redirecionamento é um documento do porteiro (recebe a ficha), e a origem não", () => {
    expect(ehCaminhoDeDocumento("/")).toBe(true);
    // Sem o redirecionamento, a origem sairia crua: o matcher não a atende.
    expect(ehCaminhoDeDocumento("/404.html")).toBe(false);
  });

  it("nenhum redirecionamento aponta para uma rota reservada (sem laço)", () => {
    for (const r of vercel.redirects ?? []) {
      expect(r.destination).toBe("/");
      expect(r.source).not.toBe("/");
    }
  });

  it.each([
    "/produto/abc",
    "/product-detail",
    "/carrinho",
    "/cart",
    "/admin-orders",
    "/admin/free-shipping-card",
  ])("rota legítima %s continua passando pelo porteiro (recebe ficha)", (p) => {
    expect(ehCaminhoDeDocumento(p)).toBe(true);
  });

  it("a regra que manda as rotas do app ao índice continua lá", () => {
    expect(vercel.rewrites).toContainEqual({
      source: "/(.*)",
      destination: "/index.html",
    });
  });
});
