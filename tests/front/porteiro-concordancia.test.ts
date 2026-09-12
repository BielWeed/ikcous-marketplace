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
        dominioPrincipal: undefined,
      }),
    ).toBe("ok");
  });

  it("host e dominio_publico batem só se ignorar caixa -> ok (RPC/CHECK exigem minúsculo, mas o header do host pode chegar em qualquer caixa)", () => {
    expect(
      decidirConcordancia({
        host: "Loja-A.Exemplo",
        dominioPublico: "loja-a.exemplo",
        vercelEnv: "production",
        dominioPrincipal: undefined,
      }),
    ).toBe("ok");
  });

  it("dominio_publico NULL -> sem-loja", () => {
    expect(
      decidirConcordancia({
        host: "loja-a.exemplo",
        dominioPublico: null,
        vercelEnv: "production",
        dominioPrincipal: undefined,
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
        dominioPrincipal: undefined,
      }),
    ).toBe("discorda");
  });

  // Item (e) do brief da correção da variável mais curta da Vercel
  // (12/09/2026): em produção, `dominioPrincipal` (a variável NOSSA,
  // `IKCOUS_DOMINIO_PRINCIPAL`) tem de ser tão irrelevante quanto a variável
  // que ela substituiu — o relaxamento de preview NUNCA pode vazar para
  // produção. Aqui `dominioPrincipal` bate com o HOST (o que, sob a regra
  // de preview, daria "ok"), e mesmo assim a resposta continua "discorda":
  // prova que produção nem olha para este campo.
  it("produção + IKCOUS_DOMINIO_PRINCIPAL igual ao HOST (não ao dominio_publico) -> discorda mesmo assim (produção nunca lê esta variável)", () => {
    expect(
      decidirConcordancia({
        host: "a.exemplo",
        dominioPublico: "b.exemplo",
        vercelEnv: "production",
        dominioPrincipal: "a.exemplo",
      }),
    ).toBe("discorda");
  });
});

describe("decidirConcordancia — preview (VERCEL_ENV !== production)", () => {
  it("preview: host de deploy, banco diz o domínio da PRINCIPAL (IKCOUS_DOMINIO_PRINCIPAL) -> ok", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: "preview",
        dominioPrincipal: "a.exemplo",
      }),
    ).toBe("ok");
  });

  it("preview: banco diz um domínio DIFERENTE do dominio da principal -> discorda", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "b.exemplo",
        vercelEnv: "preview",
        dominioPrincipal: "a.exemplo",
      }),
    ).toBe("discorda");
  });

  it("mesmo cenário, mas VERCEL_ENV=production -> encaminha, nunca ok (o relaxamento de preview só vale fora de produção; em produção o alias *.vercel.app cai na regra do encaminhamento, 11/09/2026)", () => {
    // Par de variável ÚNICA com o teste acima: mesmo host, mesmo
    // dominio_publico, mesmo dominioPrincipal — só VERCEL_ENV muda. O que
    // este teste prova é que produção NÃO ganha o "ok" do preview; a
    // resposta deixou de ser "discorda" porque o host é um alias da própria
    // Vercel (revisão Opus, menor M3).
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: "production",
        dominioPrincipal: "a.exemplo",
      }),
    ).toBe("encaminha");
  });

  it("preview sem IKCOUS_DOMINIO_PRINCIPAL no ambiente -> discorda (nada para comparar, falha fechada)", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: "preview",
        dominioPrincipal: undefined,
      }),
    ).toBe("discorda");
  });

  it("preview + IKCOUS_DOMINIO_PRINCIPAL é o domínio de OUTRA loja (não a principal desta prévia) -> discorda", () => {
    // A prévia mostra sempre a PRINCIPAL (caderneta ausente em preview) — se
    // a variável trouxer o domínio de uma loja QUALQUER que não seja a
    // principal, não há concordância nenhuma para conceder.
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: "preview",
        dominioPrincipal: "outra-loja-qualquer.exemplo",
      }),
    ).toBe("discorda");
  });

  it("VERCEL_ENV ausente (undefined) conta como produção — falha fechada por padrão", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: undefined,
        dominioPrincipal: "a.exemplo",
      }),
    ).toBe("discorda");
  });

  it("rodada B (achado do revisor): VERCEL_ENV=development NUNCA ganha o relaxamento, mesmo com dominioPrincipal batendo — só 'preview' exatamente", () => {
    // Antes da rodada B, `ehPreview` valia para QUALQUER coisa != "production"
    // (inclusive "development", um ambiente de teste local) — sob a regra
    // antiga este caso daria "ok". A regra nova exige a igualdade exata
    // com "preview". Cobre também o item (f) da correção da variável mais
    // curta da Vercel (12/09/2026): `development` nunca relaxa, nem com a
    // variável NOSSA batendo.
    expect(
      decidirConcordancia({
        host: "loja-a-dev.internal",
        dominioPublico: "a.exemplo",
        vercelEnv: "development",
        dominioPrincipal: "a.exemplo",
      }),
    ).toBe("discorda");
  });

  it("preview com IKCOUS_DOMINIO_PRINCIPAL vazio -> discorda (vazio nunca é igual a um dominio_publico não vazio)", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: "preview",
        dominioPrincipal: "",
      }),
    ).toBe("discorda");
  });

  // Achado 3 da rodada de correção (revisor Opus): a comparação de
  // `dominioPrincipal` com `dominioPublico` é case-insensitive
  // (`.toLowerCase()` nos dois lados, `porteiro.ts`), mas nenhum teste
  // provava isso — um mutante que removesse o `.toLowerCase()` de
  // `dominioPrincipal` sobrevivia. Caixa diferente nos dois lados, mesma
  // string por baixo.
  it("preview: dominio_publico e IKCOUS_DOMINIO_PRINCIPAL batem só se ignorar caixa -> ok", () => {
    expect(
      decidirConcordancia({
        host: "loja-a-git-branch-x.vercel.app",
        dominioPublico: "a.exemplo",
        vercelEnv: "preview",
        dominioPrincipal: "A.Exemplo",
      }),
    ).toBe("ok");
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
        dominioPrincipal: undefined,
      }),
    ).toBe("encaminha");
  });

  it("produção + host que só CONTÉM .vercel.app no meio (x.vercel.app.evil.com) -> discorda (o sufixo é ancorado no fim; revisão Opus, menor M1)", () => {
    expect(
      decidirConcordancia({
        host: "x.vercel.app.evil.com",
        dominioPublico: "ickous-marketplace.vercel.app",
        vercelEnv: "production",
        dominioPrincipal: undefined,
      }),
    ).toBe("discorda");
  });

  it("produção + host que NÃO termina em .vercel.app + dominio_publico diferente -> discorda (inalterado)", () => {
    expect(
      decidirConcordancia({
        host: "loja.com.br",
        dominioPublico: "outra-loja.com.br",
        vercelEnv: "production",
        dominioPrincipal: undefined,
      }),
    ).toBe("discorda");
  });

  it("produção + host alias + dominio_publico NULL -> sem-loja (a regra 3 vem ANTES da regra do alias)", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: null,
        vercelEnv: "production",
        dominioPrincipal: undefined,
      }),
    ).toBe("sem-loja");
  });

  it("produção + host alias + dominio_publico vazio (string) -> sem-loja (mesma regra 3)", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: "",
        vercelEnv: "production",
        dominioPrincipal: undefined,
      }),
    ).toBe("sem-loja");
  });

  it("preview + host alias, sem bater com dominioPrincipal -> discorda (inalterado, o relaxamento de alias é só produção)", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: "ickous-marketplace.vercel.app",
        vercelEnv: "preview",
        dominioPrincipal: undefined,
      }),
    ).toBe("discorda");
  });

  it("VERCEL_ENV ausente (undefined) + host alias -> discorda (nunca relaxa por omissão de env)", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: "ickous-marketplace.vercel.app",
        vercelEnv: undefined,
        dominioPrincipal: undefined,
      }),
    ).toBe("discorda");
  });

  it("VERCEL_ENV=development + host alias -> discorda (nunca relaxa, só 'production' exatamente)", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: "ickous-marketplace.vercel.app",
        vercelEnv: "development",
        dominioPrincipal: undefined,
      }),
    ).toBe("discorda");
  });

  it("host alias igual ao dominio_publico, só a caixa muda -> ok (nunca laço de redirect)", () => {
    expect(
      decidirConcordancia({
        host: "X-Git-Main-Y.Vercel.App",
        dominioPublico: "x-git-main-y.vercel.app",
        vercelEnv: "production",
        dominioPrincipal: undefined,
      }),
    ).toBe("ok");
  });

  // Item (e) da correção da variável mais curta da Vercel (12/09/2026):
  // mesmo quando `dominioPrincipal` bate com o HOST (o que, em preview,
  // daria "ok"), produção continua indo pela regra do alias — nunca pela
  // regra de preview. `dominioPrincipal` é irrelevante aqui.
  it("produção + host alias + IKCOUS_DOMINIO_PRINCIPAL igual ao HOST -> encaminha mesmo assim (dominioPrincipal ignorado em produção)", () => {
    expect(
      decidirConcordancia({
        host: "x-git-main-y.vercel.app",
        dominioPublico: "ickous-marketplace.vercel.app",
        vercelEnv: "production",
        dominioPrincipal: "x-git-main-y.vercel.app",
      }),
    ).toBe("encaminha");
  });
});
