import { describe, expect, it } from "vitest";
// @ts-expect-error Módulo JS nativo sem declaração; mesmo padrão de hospedagem-headers.test.ts.
import * as hospedagem from "../../scripts/hospedagem.mjs";

const vercel = hospedagem.lerVercel();

// C2.4: libera a câmera da PRÓPRIA origem (camera=(self)) para o leitor de
// código de barras do balcão. Sem isso o `getUserMedia` do PDV reprova em
// produção mesmo com o decodificador certo — o teste prende o VALOR, não só
// a lista de chaves (que tests/front/hospedagem-headers.test.ts já cobre).
describe("Permissions-Policy libera a câmera do balcão sem abrir o resto", () => {
  it("camera=(self) sai exatamente assim do bloco global de cabeçalhos", () => {
    const cabecalhos = hospedagem.cabecalhosDeFuncao(vercel);
    expect(cabecalhos["Permissions-Policy"]).toBe(
      "camera=(self), microphone=(), geolocation=(), interest-cohort=()",
    );
  });

  it("a tradução para o _headers do Cloudflare Pages carrega o mesmo valor", () => {
    const texto: string = hospedagem.headers(vercel);
    expect(texto).toContain(
      "  Permissions-Policy: camera=(self), microphone=(), geolocation=(), interest-cohort=()",
    );
  });

  it("microfone e geolocalização continuam negados: abrir a câmera não abre o resto", () => {
    const valor: string =
      hospedagem.cabecalhosDeFuncao(vercel)["Permissions-Policy"];
    expect(valor).toContain("microphone=()");
    expect(valor).toContain("geolocation=()");
  });

  it("a CSP mantém wasm-unsafe-eval e worker-src blob: — o fallback do iPhone depende dos dois", () => {
    const csp: string =
      hospedagem.cabecalhosDeFuncao(vercel)["Content-Security-Policy"];
    expect(csp).toContain("'wasm-unsafe-eval'");
    expect(csp).toContain("worker-src 'self' blob:");
  });

  it("connect-src não ganha jsdelivr nem unpkg: o .wasm tem que sair do nosso domínio", () => {
    const csp: string =
      hospedagem.cabecalhosDeFuncao(vercel)["Content-Security-Policy"];
    expect(csp.toLowerCase()).not.toContain("jsdelivr");
    expect(csp.toLowerCase()).not.toContain("unpkg");
  });
});
