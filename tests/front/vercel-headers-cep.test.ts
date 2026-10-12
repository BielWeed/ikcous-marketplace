import { describe, expect, it } from "vitest";
// @ts-expect-error Módulo JS nativo sem declaração; mesmo padrão de hospedagem-headers.test.ts.
import * as hospedagem from "../../scripts/hospedagem.mjs";

const vercel = hospedagem.lerVercel();

// BUSCA DE CEP COM VÁRIOS PROVEDORES (03/10/2026). O navegador só deixa o
// `fetch` do hook `useBuscaCep` falar com as origens listadas em `connect-src`
// — sem a origem aqui, o provedor de reserva é bloqueado pela CSP e a busca
// "funciona" no teste (que mocka o fetch) e morre na loja. Já aconteceu uma
// vez: o ViaCEP faltou na CSP e a busca de CEP nunca funcionou em produção
// (#179, CHANGELOG). A lista abaixo TEM de espelhar `PROVEDORES_DE_CEP`.
function diretiva(csp: string, nome: string): string[] {
  const parte = csp
    .split(";")
    .map((p) => p.trim())
    .find((p) => p.startsWith(`${nome} `));
  return parte ? parte.split(/\s+/).slice(1) : [];
}

const csp: string =
  hospedagem.cabecalhosDeFuncao(vercel)["Content-Security-Policy"];

describe("CSP libera os provedores de CEP", () => {
  it("connect-src tem a origem EXATA de cada provedor da cadeia, sem curinga", () => {
    const conectar = diretiva(csp, "connect-src");
    expect(conectar).toEqual(
      expect.arrayContaining([
        "https://viacep.com.br",
        "https://opencep.com",
        "https://cep.awesomeapi.com.br",
      ]),
    );
    // Origem inteira de um domínio genérico seria mais do que o necessário:
    // o subdomínio `cep.` basta para o AwesomeAPI (a API de cotações dele
    // mora em outro subdomínio e não é usada aqui).
    expect(conectar).not.toContain("https://*.awesomeapi.com.br");
    expect(conectar).not.toContain("https://awesomeapi.com.br");
    expect(conectar).not.toContain("https://*.opencep.com");
  });

  it("toda URL de provedor do hook cai numa origem liberada em connect-src", async () => {
    const { PROVEDORES_DE_CEP } = await import("@/lib/provedores-de-cep");
    const conectar = diretiva(csp, "connect-src");
    for (const provedor of PROVEDORES_DE_CEP) {
      const origem = new URL(provedor.url("01310100")).origin;
      expect(conectar, `${provedor.nome} (${origem})`).toContain(origem);
    }
  });

  it("não afrouxa o resto: nenhuma origem de CEP foi parar em script-src nem em frame-src", () => {
    for (const nome of ["script-src", "frame-src", "img-src"]) {
      const lista = diretiva(csp, nome).join(" ");
      expect(lista, nome).not.toMatch(/viacep|opencep|awesomeapi/);
    }
  });
});
