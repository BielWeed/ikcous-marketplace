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

  // DEVICE ID (03/10/2026). O antifraude do Mercado Pago recusou um cartão real
  // com `high_risk` porque não recebia o Device ID. O SDK v2 NÃO o cria sozinho
  // aqui: o script de "device profiling" que ele injeta é INLINE e a CSP o
  // barra (`script-src-elem inline`). Quem cria `window.MP_DEVICE_SESSION_ID` é
  // o `security.js` do próprio Mercado Pago, servido de www.mercadopago.com — e
  // `script-src` é a ÚNICA diretiva que ele precisa (medido em Chrome com a CSP
  // desta loja: com o host só em script-src o valor nasce; sem ele, o script é
  // bloqueado; nenhuma violação de connect-src/img-src/frame-src — o frame-src
  // já cobre www por `*.mercadopago.com`, e o api.mercadopago.com que o script
  // chama já está no connect-src). Revisão Opus do 02985934: liberar só o
  // CAMINHO exato do arquivo, não a origem inteira — medido de novo com a CSP
  // da loja e só este caminho em script-src: o ID nasce igual (231 chars).
  it("script-src libera SÓ o arquivo security.js do Mercado Pago (Device ID), SEM 'unsafe-inline'", () => {
    const scripts = diretiva(csp, "script-src");
    expect(scripts).toContain("https://www.mercadopago.com/v2/security.js");
    expect(scripts).not.toContain("https://www.mercadopago.com");
    expect(scripts).not.toContain("'unsafe-inline'");
  });

  it("o host do security.js entra SÓ onde foi medido necessário (script-src); frame-src já o cobre pelo curinga", () => {
    expect(diretiva(csp, "connect-src")).not.toContain(
      "https://www.mercadopago.com",
    );
    expect(diretiva(csp, "img-src")).not.toContain(
      "https://www.mercadopago.com",
    );
    expect(diretiva(csp, "frame-src")).toContain("https://*.mercadopago.com");
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

  // Guarda: COEP removido em 26/09/2026 (decisão do dono) porque bloqueava o
  // Card Payment Brick — sob credentialless, iframe cross-origin só escapa
  // do bloqueio se o documento embutido responder com COEP +
  // Cross-Origin-Resource-Policy: cross-origin, e nada garante que os
  // Secure Fields do Mercado Pago façam isso. Reintroduzir exige nova
  // decisão documentada do dono.
  it("COEP não volta sem decisão documentada do dono", () => {
    expect(
      hospedagem.cabecalhosDeFuncao(vercel)["Cross-Origin-Embedder-Policy"],
    ).toBeUndefined();
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
