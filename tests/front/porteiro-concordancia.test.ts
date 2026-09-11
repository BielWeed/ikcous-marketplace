// `decidirConcordancia` é o ponto onde nasce (ou não) "loja A com dado de
// loja B" (parecer do sócio, PARA A HUB, risco/revisão). Falha fechada:
// divergiu, faltou (NULL) ou é preview de outro projeto -> nunca "ok".
import { describe, expect, it } from "vitest";

import { decidirConcordancia } from "@/hospedagem/porteiro";

describe("decidirConcordancia — produção", () => {
  it("host e dominio_publico batem (mesma caixa) -> ok", () => {
    expect(
      decidirConcordancia({
        host: "loja-a.exemplo",
        dominioPublico: "loja-a.exemplo",
        vercelEnv: "production",
        producaoUrl: undefined,
      }),
    ).toBe("ok");
  });

  it("host e dominio_publico batem só se ignorar caixa -> ok (RPC/CHECK exigem minúsculo, mas o header do host pode chegar em qualquer caixa)", () => {
    expect(
      decidirConcordancia({
        host: "Loja-A.Exemplo",
        dominioPublico: "loja-a.exemplo",
        vercelEnv: "production",
        producaoUrl: undefined,
      }),
    ).toBe("ok");
  });

  it("dominio_publico NULL -> sem-loja", () => {
    expect(
      decidirConcordancia({
        host: "loja-a.exemplo",
        dominioPublico: null,
        vercelEnv: "production",
        producaoUrl: undefined,
      }),
    ).toBe("sem-loja");
  });

  it("host diferente do dominio_publico -> discorda (o teste negativo central)", () => {
    // Banco de A diz que o dono é `b.exemplo`, mas o host que a Vercel
    // atendeu é `a.exemplo`: isto é EXATAMENTE "loja A com dado de loja B",
    // e a resposta nunca pode ser "ok".
    expect(
      decidirConcordancia({
        host: "a.exemplo",
        dominioPublico: "b.exemplo",
        vercelEnv: "production",
        producaoUrl: undefined,
      }),
    ).toBe("discorda");
  });
});

describe("decidirConcordancia — preview (VERCEL_ENV !== production)", () => {
  it("preview: host de deploy, banco diz o domínio de PRODUÇÃO do MESMO projeto -> ok", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: "preview",
        producaoUrl: "a.exemplo",
      }),
    ).toBe("ok");
  });

  it("preview: banco diz um domínio de produção DIFERENTE do deploy atual -> discorda", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "b.exemplo",
        vercelEnv: "preview",
        producaoUrl: "a.exemplo",
      }),
    ).toBe("discorda");
  });

  it("mesmo cenário, mas VERCEL_ENV=production -> discorda (o relaxamento só vale fora de produção)", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: "production",
        producaoUrl: "a.exemplo",
      }),
    ).toBe("discorda");
  });

  it("preview sem VERCEL_PROJECT_PRODUCTION_URL no ambiente -> discorda (nada para comparar, falha fechada)", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: "preview",
        producaoUrl: undefined,
      }),
    ).toBe("discorda");
  });

  it("VERCEL_ENV ausente (undefined) conta como produção — falha fechada por padrão", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: undefined,
        producaoUrl: "a.exemplo",
      }),
    ).toBe("discorda");
  });

  it("rodada B (achado do revisor): VERCEL_ENV=development NUNCA ganha o relaxamento, mesmo com producaoUrl batendo — só 'preview' exatamente", () => {
    // Antes da rodada B, `ehPreview` valia para QUALQUER coisa != "production"
    // (inclusive "development", um ambiente de teste local) — sob a regra
    // antiga este caso daria "ok". A regra nova exige a igualdade exata
    // com "preview".
    expect(
      decidirConcordancia({
        host: "loja-a-dev.internal",
        dominioPublico: "a.exemplo",
        vercelEnv: "development",
        producaoUrl: "a.exemplo",
      }),
    ).toBe("discorda");
  });

  it("preview com VERCEL_PROJECT_PRODUCTION_URL vazio (string) -> discorda (vazio não conta como presente)", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: "preview",
        producaoUrl: "",
      }),
    ).toBe("discorda");
  });
});
