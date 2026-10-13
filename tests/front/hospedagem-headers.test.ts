import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error Módulo JS nativo sem declaração; confronto da tradução dos cabeçalhos.
import * as hospedagem from "../../scripts/hospedagem.mjs";

const vercel = hospedagem.lerVercel();

// Origens liberadas no `connect-src` do CSP global do vercel.json.
function origensDoConnectSrc(): string[] {
  const csp: string =
    hospedagem.cabecalhosDeFuncao(vercel)["Content-Security-Policy"];
  const diretiva = csp
    .split(";")
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith("connect-src "));
  return diretiva ? diretiva.split(/\s+/).slice(1) : [];
}

describe("_headers traduzido do vercel.json", () => {
  it("cinco nomes de atualização, assets immutable e o bloco global sem Cache-Control", () => {
    const texto: string = hospedagem.headers(vercel);
    const blocos = texto.trimEnd().split("\n\n");
    expect(blocos).toHaveLength(7);
    expect(blocos[0]).toBe(
      "/sw.js\n  Cache-Control: public, max-age=0, must-revalidate, no-cache, no-store",
    );
    expect(blocos.map((b) => b.split("\n")[0])).toEqual([
      "/sw.js",
      "/service-worker.js",
      "/sw.ts",
      "/version.json",
      "/index.html",
      "/assets/*",
      "/*",
    ]);
    expect(blocos[5]).toBe(
      "/assets/*\n  Cache-Control: public, max-age=31536000, immutable",
    );
    const global = blocos[6].split("\n");
    expect(global).toHaveLength(10); // caminho + nove cabeçalhos
    expect(global.some((l) => /^\s+Cache-Control:/i.test(l))).toBe(false);
    expect(global).toContain("  X-Frame-Options: DENY");
    expect(
      global.some((l) =>
        l.startsWith("  Content-Security-Policy: default-src 'self';"),
      ),
    ).toBe(true);
    for (const linha of texto.split("\n"))
      expect(linha.length).toBeLessThanOrEqual(2000);
    expect(texto.endsWith("\n")).toBe(true);
  });

  it("fonte desconhecida no vercel.json reprova em vez de traduzir por aproximação", () => {
    const alterado = structuredClone(vercel);
    alterado.headers.push({
      source: "/api/(.*)",
      headers: [{ key: "X", value: "1" }],
    });
    expect(() => hospedagem.headers(alterado)).toThrow(
      /HOSTING_HEADERS_UNKNOWN_SOURCE/,
    );
  });

  it("Cache-Control no bloco global reprova (regras coincidentes concatenam no Pages)", () => {
    const alterado = structuredClone(vercel);
    const global = alterado.headers.find(
      (b: { source: string }) => b.source === "/(.*)",
    );
    global.headers.push({ key: "Cache-Control", value: "no-store" });
    expect(() => hospedagem.headers(alterado)).toThrow(
      /HOSTING_HEADERS_GLOBAL_CACHE/,
    );
    expect(() => hospedagem.cabecalhosDeFuncao(alterado)).toThrow(
      /HOSTING_HEADERS_GLOBAL_CACHE/,
    );
  });

  it("linha acima de 2000 caracteres reprova", () => {
    const alterado = structuredClone(vercel);
    const global = alterado.headers.find(
      (b: { source: string }) => b.source === "/(.*)",
    );
    global.headers.push({ key: "X-Longo", value: "a".repeat(2001) });
    expect(() => hospedagem.headers(alterado)).toThrow(
      /HOSTING_HEADERS_LINE_TOO_LONG/,
    );
  });

  it("cabeçalhos da função são os nove do bloco global", () => {
    const nove = hospedagem.cabecalhosDeFuncao(vercel);
    expect(Object.keys(nove).sort()).toEqual([
      "Content-Security-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "X-XSS-Protection",
    ]);
    expect(Object.isFrozen(nove)).toBe(true);
  });

  // Guarda: COEP (Cross-Origin-Embedder-Policy) foi removido do vercel.json
  // em 26/09/2026, decisão do dono (Gabriel). Sob `credentialless`, iframe
  // cross-origin só escapa do bloqueio se o documento embutido responder com
  // COEP + `Cross-Origin-Resource-Policy: cross-origin`; nada garante que os
  // iframes de Secure Fields do Card Payment Brick (Mercado Pago) façam isso,
  // e é o principal suspeito por trás do Brick não carregar. Reintroduzir
  // aqui exige nova decisão documentada do dono — não é para voltar sozinho
  // num ajuste de CSP ou de outro cabeçalho.
  it("COEP não volta sem decisão documentada do dono", () => {
    const nove = hospedagem.cabecalhosDeFuncao(vercel);
    expect(nove["Cross-Origin-Embedder-Policy"]).toBeUndefined();
  });

  // O mapa do cartão de endereço (AddressCardMap, Perfil) é vetorial e tudo o
  // que ele pede à rede passa por `fetch`/XHR, ou seja, por `connect-src`: o
  // PRÓPRIO componente busca o estilo "positron" (OpenFreeMap) e o geocode
  // (Photon, komoot); o MapLibre, depois, busca tiles, glyphs e sprite. Sem a
  // origem aqui o mapa "funciona" nos testes (que mockam o fetch) e morre na
  // loja com a CSP bloqueando. Essa linha do vercel.json já foi a única a
  // conflitar num merge, e nenhum outro teste a fixava.
  it("connect-src libera o Photon e o OpenFreeMap do mapa de endereço", () => {
    expect(origensDoConnectSrc()).toEqual(
      expect.arrayContaining([
        "https://photon.komoot.io",
        "https://tiles.openfreemap.org",
      ]),
    );
  });

  // Amarra a CSP ao CÓDIGO: as duas origens acima estão fixas no teste, então
  // trocar o host de `ESTILO_POSITRON`/`GEOCODE` no componente deixaria o
  // teste verde e a loja bloqueada. Aqui a origem sai das constantes reais (o
  // arquivo é só lido) — mesmo padrão de vercel-headers-cep.test.ts, que
  // confronta `PROVEDORES_DE_CEP` com o connect-src.
  it("connect-src cobre a origem de cada URL que o AddressCardMap chama", () => {
    // eslint-disable-next-line security/detect-non-literal-fs-filename -- caminho fixo, relativo a este teste
    const fonte = readFileSync(
      new URL(
        "../../src/components/ui/custom/AddressCardMap.tsx",
        import.meta.url,
      ),
      "utf8",
    );
    const urls = [
      ...fonte.matchAll(
        /const (?:ESTILO_POSITRON|GEOCODE) = "(https:\/\/[^"]+)"/g,
      ),
    ].map((achado) => achado[1]);
    expect(urls, "ESTILO_POSITRON e GEOCODE").toHaveLength(2);
    const conectar = origensDoConnectSrc();
    for (const url of urls)
      expect(conectar, url).toContain(new URL(url).origin);
  });

  it("hosts de imagem vêm do img-src do CSP", () => {
    // tile.openstreetmap.org saiu do img-src em 12/10/2026, decisão do dono:
    // entrou com a frente do mapa de endereço (29/09/2026), mas nada em src/
    // pedia tiles dessa origem — o AddressCardMap é vetorial (MapLibre +
    // OpenFreeMap) e busca estilo, tiles, glyphs e sprite por fetch, ou seja,
    // por connect-src. Esta lista é também a dos hosts que a prévia de
    // compartilhamento aceita embutir, então origem sem consumidor não volta.
    expect(hospedagem.hostsDeImagem(vercel)).toEqual([
      "*.supabase.co",
      "images.unsplash.com",
      "placehold.co",
      "*.mlstatic.com",
    ]);
  });
});
