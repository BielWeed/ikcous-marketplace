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
//
// POR QUE O HOOK É PROVADO POR FONTE (e não montado): `useUpdateCheck.ts`
// importa `virtual:pwa-register/react`, módulo virtual do vite-plugin-pwa
// que NÃO resolve neste runner — a fábrica do `vi.mock` não impede o
// vite:import-analysis de recusar o import (tentado e medido nesta peça,
// 14/09). O mesmo motivo dos testes-contrato irmãos
// (update-check-sonda-de-versao-sem-carimbo, recuperacao-chunk-contrato-dos-
// arquivos). A MECÂNICA extraída para lib (`aplicarAtualizacaoPendenteERecarregar`)
// é provada por comportamento em aplicar-atualizacao-recarrega-sozinho.test.tsx.
import { describe, expect, it } from "vitest";

import {
  nucleoSemver,
  partesDoNucleoSemver,
  versaoLegivelDeResposta,
} from "@/lib/versao-do-servidor";

const FONTES = import.meta.glob<string>(
  ["/src/hooks/useUpdateCheck.ts", "/src/lib/recuperacao-chunk.ts"],
  { query: "?raw", import: "default", eager: true },
);

function resposta(corpo: string, tipo: string, status = 200): Response {
  return new Response(corpo, {
    status,
    headers: { "content-type": tipo },
  });
}

describe("versaoLegivelDeResposta — o portão falha ABERTO", () => {
  it("200 application/json com version string → a versão", async () => {
    const versao = await versaoLegivelDeResposta(
      resposta(
        JSON.stringify({ version: "1.33.0-sha.0a1b2c3" }),
        "application/json",
      ),
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

describe("contrato por fonte — o portão (useUpdateCheck) falha aberto", () => {
  // CONTROLE: glob vazio faz "não contém" passar de graça.
  const FONTE_DO_HOOK = FONTES["/src/hooks/useUpdateCheck.ts"] ?? "";
  const FONTE_DA_ESCADA = FONTES["/src/lib/recuperacao-chunk.ts"] ?? "";

  function normalizar(texto: string): string {
    return texto.replace(/\s+/g, " ");
  }

  it("controle: os glob acharam os fontes certos", () => {
    expect(FONTE_DO_HOOK).toContain("useRegisterSW");
    expect(FONTE_DA_ESCADA).toContain("CHAVE_RECUPERACAO_CHUNK");
  });

  it("a sonda do portão é versaoLegivelDeResposta (contrato único), sem leitura fraca paralela", () => {
    const fonte = normalizar(FONTE_DO_HOOK);
    expect({
      usaOContratoUnico: fonte.includes(
        "return await versaoLegivelDeResposta(response)",
      ),
      leituraFracaVelha: fonte.includes("data.version as string"),
      devNemBusca: fonte.includes(
        "if (import.meta.env.DEV) return SAFE_APP_VERSION",
      ),
    }).toEqual({
      usaOContratoUnico: true,
      leituraFracaVelha: false,
      devNemBusca: true,
    });
  });

  it("nunca grava versão inventada: os padrões antigos do falso valor saíram do hook", () => {
    const fonte = normalizar(FONTE_DO_HOOK);
    expect({
      falsoValorNaAtribuicao: fonte.includes('ver || "Nova Versão"'),
      falsoValorNaGuarda: fonte.includes('newVersion === "Nova Versão"'),
      soVersaoLegivelDiferente: fonte.includes(
        "if (ver && ver !== SAFE_APP_VERSION) {",
      ),
    }).toEqual({
      falsoValorNaAtribuicao: false,
      falsoValorNaGuarda: false,
      soVersaoLegivelDiferente: true,
    });
  });

  it("o apply delega ao módulo único com o prazo exportado", () => {
    const fonte = normalizar(FONTE_DO_HOOK);
    expect({
      delega: fonte.includes("aplicarAtualizacaoPendenteERecarregar({"),
      prazoDoModulo: fonte.includes("prazoMs: PRAZO_APLICACAO_UPDATE_MS"),
      mecanismoAntigoNoHook: fonte.includes(
        'addEventListener("controllerchange"',
      ),
    }).toEqual({
      delega: true,
      prazoDoModulo: true,
      mecanismoAntigoNoHook: false,
    });
  });

  it("a sonda de rede da escada usa o MESMO contrato e mantém a decisão fechada", () => {
    const fonte = normalizar(FONTE_DA_ESCADA);
    expect({
      lePeloContratoUnico: fonte.includes(
        "await versaoLegivelDeResposta(resposta)",
      ),
      validacaoInlineVelha: fonte.includes(
        "const corpo = (await resposta.json()) as { version?: unknown }",
      ),
    }).toEqual({
      lePeloContratoUnico: true,
      validacaoInlineVelha: false,
    });
  });
});
