import { describe, expect, it } from "vitest";
// @ts-expect-error Módulo JS nativo sem declaração; mesmo padrão de hospedagem-headers.test.ts.
import * as hospedagem from "../../scripts/hospedagem.mjs";

const vercel = hospedagem.lerVercel();

// O mapa da "Sobre a Loja" (página pública e prévia do painel) embute o
// embed clássico do Google: o src em maps.google.com REDIRECIONA (301) para
// https://www.google.com/maps/embed?origin=mfe&pb=... — e a checagem de
// frame-src vale para CADA salto do redirect da navegação. Sem o destino
// aqui, o iframe morre com ERR_BLOCKED_BY_RESPONSE (quadro cinza no celular,
// 20/09/2026). A lista é FECHADA e comparada token a token: ampliar origem
// aqui deve ser decisão explícita, não efeito colateral de edição da CSP.
const FRAME_SRC_APROVADO = [
  "https://maps.google.com",
  "https://www.google.com/maps/embed",
  "https://*.mercadopago.com",
  "https://*.mercadolibre.com",
];

function frameSrcDaCsp(csp: string): string[] {
  const diretiva = csp
    .split(";")
    .map((parte) => parte.trim())
    .find((parte) => parte.startsWith("frame-src "));
  if (!diretiva) return [];
  return diretiva.split(/\s+/).slice(1);
}

describe("frame-src permite o destino real do embed do mapa, e só ele", () => {
  it("a CSP do bloco global tem EXATAMENTE a lista aprovada de frames", () => {
    const csp: string =
      hospedagem.cabecalhosDeFuncao(vercel)["Content-Security-Policy"];
    expect(frameSrcDaCsp(csp)).toEqual(FRAME_SRC_APROVADO);
  });

  it("a tradução para o _headers do Cloudflare Pages repete a mesma lista", () => {
    const texto: string = hospedagem.headers(vercel);
    const linha = texto
      .split("\n")
      .find((l) => l.startsWith("  Content-Security-Policy:"));
    expect(linha).toBeTruthy();
    expect(frameSrcDaCsp(linha!)).toEqual(FRAME_SRC_APROVADO);
  });

  it("COEP credentialless continua de pé: o embed só carrega com o atributo credentialless no iframe", () => {
    const cabecalhos = hospedagem.cabecalhosDeFuncao(vercel);
    expect(cabecalhos["Cross-Origin-Embedder-Policy"]).toBe("credentialless");
  });
});
