// O CONTRATO ÚNICO de "/version.json" (peça "tela de atualização", 14/09).
//
// FAIL-OPEN no portão de versão: resposta que não é uma versão legível —
// 404, HTML do dev server (fallback de SPA), corpo mentido, JSON sem `version`
// — significa "SEM INFORMAÇÃO DE VERSÃO" e NUNCA pode virar decisão de
// atualização, overlay eterno ou versão inventada na tela. Hoje essa regra
// existia SÓ na sonda de rede do recuperacao-chunk (validada por
// recuperacao-chunk-sonda-de-rede.test.ts); o portão do useUpdateCheck tinha
// uma versão MAIS FRACA e divergente (ok → .json() → data.version sem
// validar tipo) — lição #53: regra escrita em dois lugares diverge.
//
// Este módulo novo é a ÚNICA definição; portão e sonda passam a consumi-la.
// Ambiente node: só Response/fetch stubado, nada de DOM.
import { describe, expect, it } from "vitest";

import {
  nucleoSemver,
  partesDoNucleoSemver,
  versaoLegivelDeResposta,
} from "@/lib/versao-do-servidor";

function resposta(corpo: string, tipo: string, status = 200): Response {
  return new Response(corpo, {
    status,
    headers: { "content-type": tipo },
  });
}

describe("versaoLegivelDeResposta — o portão falha ABERTO", () => {
  it("200 application/json com version string → a versão", async () => {
    const versao = await versaoLegivelDeResposta(
      resposta(JSON.stringify({ version: "1.33.0-sha.0a1b2c3" }),
        "application/json"),
    );
    expect(versao).toBe("1.33.0-sha.0a1b2c3");
  });

  it("DEV/PREVIA: 200 text/html (fallback de SPA devolve o index.html) → null", async () => {
    const versao = await versaoLegivelDeResposta(
      resposta("<!doctype html><html>…app…</html>", "text/html"),
    );
    expect(versao).toBeNull();
  });

  it("404 (arquivo ausente na entrega) → null", async () => {
    const versao = await versaoLegivelDeResposta(
      resposta("Not Found", "text/plain", 404),
    );
    expect(versao).toBeNull();
  });

  it("503 → null", async () => {
    const versao = await versaoLegivelDeResposta(
      resposta("indisponível", "text/plain", 503),
    );
    expect(versao).toBeNull();
  });

  it("content-type MENTINDO (html declarado, JSON válido no corpo) → null", async () => {
    // Mesma decisão da sonda: a declaração é o que um portal cativo não
    // finge. Portão e sonda não podem divergir aqui.
    const versao = await versaoLegivelDeResposta(
      resposta(JSON.stringify({ version: "1.33.0" }), "text/html"),
    );
    expect(versao).toBeNull();
  });

  it("content-type json com corpo que não é JSON → null (sem estourar)", async () => {
    const versao = await versaoLegivelDeResposta(
      resposta("{quebrado", "application/json"),
    );
    expect(versao).toBeNull();
  });

  it("JSON sem o campo version → null", async () => {
    const versao = await versaoLegivelDeResposta(
      resposta(JSON.stringify({ qualquer: "coisa" }), "application/json"),
    );
    expect(versao).toBeNull();
  });

  it("version vazio ou não-string → null (nada de `undefined` vestido de versão)", async () => {
    const vazia = await versaoLegivelDeResposta(
      resposta(JSON.stringify({ version: "" }), "application/json"),
    );
    const numero = await versaoLegivelDeResposta(
      resposta(JSON.stringify({ version: 42 }), "application/json"),
    );
    expect(vazia).toBeNull();
    expect(numero).toBeNull();
  });
});

describe("nucleoSemver — o que a tela mostra da versão", () => {
  it("núcleo limpo de uma versão de build com sufixo de hash", () => {
    expect(nucleoSemver("1.32.0-sha.2526bdd")).toBe("1.32.0");
  });

  it("sufixo de build (+) também sai", () => {
    expect(nucleoSemver("1.32.0+build.36692")).toBe("1.32.0");
  });

  it("versão já limpa passa intacta", () => {
    expect(nucleoSemver("1.32.0")).toBe("1.32.0");
  });

  it("lixo do realtime (binary-v24), vazio, nulo → null (o selo nem nasce)", () => {
    expect(nucleoSemver("binary-v24")).toBeNull();
    expect(nucleoSemver("")).toBeNull();
    expect(nucleoSemver(null)).toBeNull();
    expect(nucleoSemver(undefined)).toBeNull();
  });

  it("partesDoNucleoSemver: mesmo parse que a comparação do portão usa", () => {
    expect(partesDoNucleoSemver("1.32.0-sha.2526bdd")).toEqual([1, 32, 0]);
    expect(partesDoNucleoSemver("núcleo-ilegível")).toBeNull();
  });
});
