import { describe, expect, it } from "vitest";
// @ts-expect-error Módulo JS nativo sem declaração; mesmo padrão de hospedagem-headers.test.ts.
import * as hospedagem from "../../scripts/hospedagem.mjs";

const vercel = hospedagem.lerVercel();

// CARTÃO PELO APP (Fase 3.5, 26/09/2026). O Card Payment Brick carrega o
// SDK (script-src), conversa com as APIs do Mercado Pago para bandeira,
// parcelas, documento e token (connect-src), manda métricas de uso para o
// events.mercadopago.com (connect-src — o SDK liga isso por padrão) e monta
// campos seguros em iframes do Mercado Pago (frame-src). O desafio 3-D
// Secure abre a URL do banco num iframe da nossa tela — num domínio do
// Mercado Pago/Mercado Livre do país (frame-src com .com.br).
function diretiva(csp: string, nome: string): string[] {
  const parte = csp
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${nome} `));
  return parte ? parte.split(/\s+/).slice(1) : [];
}

const csp: string =
  hospedagem.cabecalhosDeFuncao(vercel)["Content-Security-Policy"];

describe("CSP libera o Card Payment Brick e o desafio 3-D Secure", () => {
  it("script-src mantém o SDK do Mercado Pago e o CDN deles", () => {
    expect(diretiva(csp, "script-src")).toEqual(
      expect.arrayContaining([
        "https://sdk.mercadopago.com",
        "https://http2.mlstatic.com",
      ]),
    );
  });

  it("connect-src tem as APIs do Brick e o destino das métricas do SDK", () => {
    expect(diretiva(csp, "connect-src")).toEqual(
      expect.arrayContaining([
        "https://api.mercadopago.com",
        "https://api.mercadolibre.com",
        "https://secure-fields.mercadopago.com",
        "https://api-static.mercadopago.com",
        "https://http2.mlstatic.com",
        "https://events.mercadopago.com",
      ]),
    );
  });

  it("frame-src aceita os campos seguros e o 3-D Secure nos domínios do Brasil", () => {
    expect(diretiva(csp, "frame-src")).toEqual(
      expect.arrayContaining([
        "https://*.mercadopago.com",
        "https://*.mercadolibre.com",
        "https://*.mercadopago.com.br",
        "https://*.mercadolivre.com",
        "https://*.mercadolivre.com.br",
      ]),
    );
  });

  it("form-action continua 'self': o 3DS abre por iframe com a URL pronta, sem POST do nosso documento", () => {
    expect(diretiva(csp, "form-action")).toEqual(["'self'"]);
  });

  it("COEP credentialless continua de pé (o risco conhecido do Brick — por isso o cartão nasce desligado)", () => {
    expect(
      hospedagem.cabecalhosDeFuncao(vercel)["Cross-Origin-Embedder-Policy"],
    ).toBe("credentialless");
  });

  it("a linha da CSP no _headers do Cloudflare Pages fica abaixo do limite de 2000 caracteres", () => {
    const linha = hospedagem
      .headers(vercel)
      .split("\n")
      .find((l: string) => l.startsWith("  Content-Security-Policy:"));
    expect(linha).toBeTruthy();
    expect(linha.length).toBeLessThan(2000);
    expect(diretiva(linha, "connect-src")).toContain(
      "https://events.mercadopago.com",
    );
  });
});
