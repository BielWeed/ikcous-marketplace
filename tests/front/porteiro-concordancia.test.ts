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

  it("mesmo cenário, mas VERCEL_ENV=production -> encaminha, nunca ok (o relaxamento de preview só vale fora de produção; em produção o alias *.vercel.app cai na regra do encaminhamento, 11/09/2026)", () => {
    // Par de variável ÚNICA com o teste acima: mesmo host, mesmo
    // dominio_publico, mesma producaoUrl — só VERCEL_ENV muda. O que este
    // teste prova é que produção NÃO ganha o "ok" do preview; a resposta
    // deixou de ser "discorda" porque o host é um alias da própria Vercel
    // (revisão Opus, menor M3).
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: "production",
        producaoUrl: "a.exemplo",
      }),
    ).toBe("encaminha");
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

// Brief `20260911-brief-aliases-vercel-encaminham.md` — decisão do sócio
// aprovada pelo Gabriel (17:2xZ): alias automático da própria Vercel
// (`*.vercel.app`) que discorda do `dominio_publico` em PRODUÇÃO encaminha
// (308) para a própria loja, em vez de morrer em "manutenção".
describe("decidirConcordancia — alias *.vercel.app em produção (encaminha)", () => {
  it("produção + host alias + dominio_publico de OUTRO host -> encaminha", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: "ickous-marketplace.vercel.app",
        vercelEnv: "production",
        producaoUrl: undefined,
      }),
    ).toBe("encaminha");
  });

  it("produção + host que só CONTÉM .vercel.app no meio (x.vercel.app.evil.com) -> discorda (o sufixo é ancorado no fim; revisão Opus, menor M1)", () => {
    expect(
      decidirConcordancia({
        host: "x.vercel.app.evil.com",
        dominioPublico: "ickous-marketplace.vercel.app",
        vercelEnv: "production",
        producaoUrl: undefined,
      }),
    ).toBe("discorda");
  });

  it("produção + host que NÃO termina em .vercel.app + dominio_publico diferente -> discorda (inalterado)", () => {
    expect(
      decidirConcordancia({
        host: "loja.com.br",
        dominioPublico: "outra-loja.com.br",
        vercelEnv: "production",
        producaoUrl: undefined,
      }),
    ).toBe("discorda");
  });

  it("produção + host alias + dominio_publico NULL -> sem-loja (a regra 3 vem ANTES da regra do alias)", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: null,
        vercelEnv: "production",
        producaoUrl: undefined,
      }),
    ).toBe("sem-loja");
  });

  it("produção + host alias + dominio_publico vazio (string) -> sem-loja (mesma regra 3)", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: "",
        vercelEnv: "production",
        producaoUrl: undefined,
      }),
    ).toBe("sem-loja");
  });

  it("preview + host alias, sem bater com producaoUrl -> discorda (inalterado, o relaxamento de alias é só produção)", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: "ickous-marketplace.vercel.app",
        vercelEnv: "preview",
        producaoUrl: undefined,
      }),
    ).toBe("discorda");
  });

  it("VERCEL_ENV ausente (undefined) + host alias -> discorda (nunca relaxa por omissão de env)", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: "ickous-marketplace.vercel.app",
        vercelEnv: undefined,
        producaoUrl: undefined,
      }),
    ).toBe("discorda");
  });

  it("VERCEL_ENV=development + host alias -> discorda (nunca relaxa, só 'production' exatamente)", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: "ickous-marketplace.vercel.app",
        vercelEnv: "development",
        producaoUrl: undefined,
      }),
    ).toBe("discorda");
  });

  it("host alias igual ao dominio_publico, só a caixa muda -> ok (nunca laço de redirect)", () => {
    expect(
      decidirConcordancia({
        host: "X-Git-Main-Y.Vercel.App",
        dominioPublico: "x-git-main-y.vercel.app",
        vercelEnv: "production",
        producaoUrl: undefined,
      }),
    ).toBe("ok");
  });
});
