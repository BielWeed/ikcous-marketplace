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

  it("a regra que manda as rotas do app ao índice continua lá, sem cobrir /assets/", () => {
    expect(vercel.rewrites).toContainEqual({
      source: "/((?!assets/).*)",
      destination: "/index.html",
    });
  });
});

// Depois de uma release, o aparelho ainda pede o chunk ANTIGO em /assets/. Com a
// reescrita cobrindo /assets/, a Vercel respondia 200 com o HTML do app e cache de
// 1 ano: o service worker guardava o HTML no lugar do chunk e o app travava no
// carregamento. Excluída a pasta da reescrita, o arquivo inexistente vira 404 de
// verdade (e o SW/escada de recuperação sabem lidar com 404).
describe("vercel.json: arquivo inexistente em /assets/ responde 404, não o índice", () => {
  // A Vercel casa `source` por path-to-regexp ANCORADO no caminho inteiro; esta
  // regra não tem parâmetro nomeado, então `^...$` sobre o texto reproduz o casamento.
  const regra = (vercel.rewrites ?? []).find(
    (r) => r.destination === "/index.html",
  );
  const casa = (caminho: string): boolean =>
    // eslint-disable-next-line security/detect-non-literal-regexp -- o padrão vem do vercel.json versionado, nunca de entrada externa.
    new RegExp(`^${regra?.source ?? "(?!)"}$`).test(caminho);

  it("a reescrita para o índice existe e é a única", () => {
    expect(vercel.rewrites).toHaveLength(1);
    expect(regra).toBeDefined();
  });

  it.each([
    "/assets/chunk-antigo-AbC123.js",
    "/assets/index-AbC123.css",
    "/assets/sub/pasta/x.js",
    "/assets/",
  ])("%s NÃO é reescrito (fica 404 se o arquivo não existe)", (p) => {
    expect(casa(p)).toBe(false);
  });

  it.each([
    "/",
    "/product-detail",
    "/admin/orders",
    "/icons/x.png",
    "/xyz",
    "/assets", // sem a barra não é a pasta: segue para o índice
    "/assetsfoo/x.js", // só a pasta exata é excluída
    "/loja/assets/x.js", // só a pasta da RAIZ (onde o build escreve)
  ])("%s continua reescrito para o índice", (p) => {
    expect(casa(p)).toBe(true);
  });
});
