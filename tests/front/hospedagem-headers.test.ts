import { describe, expect, it } from "vitest";
// @ts-expect-error Módulo JS nativo sem declaração; confronto da tradução dos cabeçalhos.
import * as hospedagem from "../../scripts/hospedagem.mjs";

const vercel = hospedagem.lerVercel();

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
    expect(global).toHaveLength(11); // caminho + dez cabeçalhos
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

  it("cabeçalhos da função são os dez do bloco global", () => {
    const dez = hospedagem.cabecalhosDeFuncao(vercel);
    expect(Object.keys(dez).sort()).toEqual([
      "Content-Security-Policy",
      "Cross-Origin-Embedder-Policy",
      "Cross-Origin-Opener-Policy",
      "Cross-Origin-Resource-Policy",
      "Permissions-Policy",
      "Referrer-Policy",
      "Strict-Transport-Security",
      "X-Content-Type-Options",
      "X-Frame-Options",
      "X-XSS-Protection",
    ]);
    expect(Object.isFrozen(dez)).toBe(true);
  });

  it("hosts de imagem vêm do img-src do CSP", () => {
    expect(hospedagem.hostsDeImagem(vercel)).toEqual([
      "*.supabase.co",
      "images.unsplash.com",
      "placehold.co",
      "*.mlstatic.com",
    ]);
  });
});
