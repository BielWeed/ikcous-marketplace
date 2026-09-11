// A implementação REAL de `ResolverLojaNaCaderneta` mora em `middleware.ts`
// (nunca em `src/hospedagem/porteiro.ts`, que só recebe a função injetada —
// ver o comentário lá). Rodada B (11/09/2026, brief T3b item 1): convenção
// de chamada nova — `apikey`/`Authorization` levam `IKCOUS_FROTA_APIKEY`
// (a chave PÚBLICA do projeto da PRINCIPAL), o segredo (`IKCOUS_FROTA_CHAVE`)
// viaja SÓ no corpo JSON como `p_chave`, por `POST`, NUNCA em cabeçalho nem
// em URL. Este arquivo testa `resolverNaCaderneta` isolado, com
// `globalThis.fetch` substituído (nunca rede de verdade) — os testes
// obrigatórios (i)-(iv) do brief.
import { afterEach, describe, expect, it } from "vitest";

import { resolverNaCaderneta } from "../../middleware";

const SEGREDO = "segredo-de-32-bytes-nunca-deveria-viajar-em-header-ou-url";
const APIKEY_PRINCIPAL = "sb_publishable_da_principal";
const FROTA_URL = "https://principal.supabase.co";

function comFetch<T>(fetchFalso: typeof fetch, executar: () => Promise<T>) {
  const anterior = globalThis.fetch;
  globalThis.fetch = fetchFalso;
  return executar().finally(() => {
    globalThis.fetch = anterior;
  });
}

describe("resolverNaCaderneta — convenção de chamada (teste obrigatório i)", () => {
  it("usa POST; o segredo NUNCA aparece na URL nem em nenhum cabeçalho — só no corpo", async () => {
    const chamadas: Array<{ url: string; init: RequestInit }> = [];
    const fetchDuble: typeof fetch = (async (input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      chamadas.push({ url, init: init ?? {} });
      return new Response(
        JSON.stringify([
          {
            supabase_url: "https://loja-a.supabase.co",
            publishable_key: "sb_publishable_da_loja_a",
          },
        ]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const resultado = await comFetch(fetchDuble, () =>
      resolverNaCaderneta(
        "loja-a.exemplo",
        FROTA_URL,
        APIKEY_PRINCIPAL,
        SEGREDO,
      ),
    );

    expect(resultado).toEqual({
      tipo: "hit",
      conexao: {
        supabaseUrl: "https://loja-a.supabase.co",
        publishableKey: "sb_publishable_da_loja_a",
        origem: "caderneta",
      },
    });
    expect(chamadas).toHaveLength(1);
    const [chamada] = chamadas;
    expect(chamada.init.method).toBe("POST");
    expect(chamada.url).not.toContain(SEGREDO);
    expect(chamada.url).toContain("/rest/v1/rpc/resolver_loja");
    const cabecalhos = JSON.stringify(
      chamada.init.headers instanceof Headers
        ? Object.fromEntries(chamada.init.headers.entries())
        : chamada.init.headers,
    );
    expect(cabecalhos).not.toContain(SEGREDO);
    expect(cabecalhos).toContain(APIKEY_PRINCIPAL);
    expect(String(chamada.init.body)).toContain(SEGREDO);
    expect(String(chamada.init.body)).toContain('"p_chave"');
  });
});

describe("resolverNaCaderneta — classificação da resposta (testes obrigatórios ii/iii)", () => {
  afterEach(() => {
    // Defensivo: qualquer teste que falhe antes do `finally` de `comFetch`
    // não deixa `globalThis.fetch` substituído para o próximo arquivo.
  });

  it("zero linhas (200, array vazio) -> miss", async () => {
    const fetchDuble: typeof fetch = (async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const resultado = await comFetch(fetchDuble, () =>
      resolverNaCaderneta(
        "loja-nova.exemplo",
        FROTA_URL,
        APIKEY_PRINCIPAL,
        SEGREDO,
      ),
    );
    expect(resultado).toEqual({ tipo: "miss" });
  });

  it("401 (apikey inválida ou RPC recusada) -> erro", async () => {
    const fetchDuble: typeof fetch = (async () =>
      new Response("unauthorized", { status: 401 })) as typeof fetch;

    const resultado = await comFetch(fetchDuble, () =>
      resolverNaCaderneta(
        "loja-a.exemplo",
        FROTA_URL,
        APIKEY_PRINCIPAL,
        SEGREDO,
      ),
    );
    expect(resultado).toEqual({ tipo: "erro" });
  });

  it("resposta com forma inesperada (linha sem supabase_url) -> erro", async () => {
    const fetchDuble: typeof fetch = (async () =>
      new Response(JSON.stringify([{ supabase_url: 42 }]), {
        status: 200,
        headers: { "content-type": "application/json" },
      })) as typeof fetch;

    const resultado = await comFetch(fetchDuble, () =>
      resolverNaCaderneta(
        "loja-a.exemplo",
        FROTA_URL,
        APIKEY_PRINCIPAL,
        SEGREDO,
      ),
    );
    expect(resultado).toEqual({ tipo: "erro" });
  });

  it("fetch lança (rede fora do ar) -> erro, nunca propaga a exceção", async () => {
    const fetchDuble: typeof fetch = (async () => {
      throw new Error("rede fora do ar");
    }) as typeof fetch;

    const resultado = await comFetch(fetchDuble, () =>
      resolverNaCaderneta(
        "loja-a.exemplo",
        FROTA_URL,
        APIKEY_PRINCIPAL,
        SEGREDO,
      ),
    );
    expect(resultado).toEqual({ tipo: "erro" });
  });
});
