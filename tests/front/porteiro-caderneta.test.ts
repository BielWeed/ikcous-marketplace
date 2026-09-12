// A implementação REAL de `ResolverLojaNaCaderneta` mora em `middleware.ts`
// (nunca em `src/hospedagem/porteiro.ts`, que só recebe a função injetada —
// ver o comentário lá). Rodada B (11/09/2026, brief T3b item 1): convenção
// de chamada nova — `apikey`/`Authorization` levam `IKCOUS_FROTA_APIKEY`
// (a chave PÚBLICA do projeto da PRINCIPAL), o segredo (`IKCOUS_FROTA_CHAVE`)
// viaja SÓ no corpo JSON como `p_chave`, por `POST`, NUNCA em cabeçalho nem
// em URL. Este arquivo testa `resolverNaCaderneta` isolado, com
// `globalThis.fetch` substituído (nunca rede de verdade) — os testes
// obrigatórios (i)-(iv) do brief.
import { afterEach, describe, expect, it, vi } from "vitest";

import { FalhaRpcCaderneta, resolverConexao } from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  ResolverLojaNaCaderneta,
} from "@/hospedagem/porteiro";
import middleware, { resolverNaCaderneta } from "../../middleware";

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

// ETAPA 3 (ADENDO A.3): unidade de `resolverConexao` — a decisão de NÃO
// cair no ambiente do projeto ("doProjeto()") quando a caderneta está
// CONFIGURADA e devolve miss/erro. O ambiente injetado abaixo tem as DUAS
// coisas ao mesmo tempo (variáveis da frota E do projeto) de propósito: se
// `resolverConexao` regredisse para o comportamento antigo, o teste
// receberia a conexão do projeto em vez de `null`.
describe("resolverConexao — com a caderneta CONFIGURADA, miss/erro NUNCA caem no ambiente do projeto (ADENDO A.3)", () => {
  const ambienteComOsDois: AmbientePorteiro = {
    VITE_SUPABASE_URL: "https://projeto-hospedeiro.supabase.co",
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_do_projeto_hospedeiro",
    IKCOUS_FROTA_URL: FROTA_URL,
    IKCOUS_FROTA_APIKEY: APIKEY_PRINCIPAL,
    IKCOUS_FROTA_CHAVE: SEGREDO,
  };

  it("miss -> { conexao: null, caderneta: 'miss' }", async () => {
    const cadernetaMiss: ResolverLojaNaCaderneta = async () => ({
      tipo: "miss",
    });
    const resultado = await resolverConexao(
      "host-desconhecido.exemplo",
      ambienteComOsDois,
      cadernetaMiss,
    );
    expect(resultado).toEqual({ conexao: null, caderneta: "miss" });
  });

  it("erro (RPC fora do ar) -> LANÇA FalhaRpcCaderneta com caderneta 'erro' (ADENDO B.1: nunca fecha a loja aqui — quem chama herda o stale-if-error)", async () => {
    const cadernetaErro: ResolverLojaNaCaderneta = async () => ({
      tipo: "erro",
    });
    const promessa = resolverConexao(
      "host-desconhecido.exemplo",
      ambienteComOsDois,
      cadernetaErro,
    );
    await expect(promessa).rejects.toBeInstanceOf(FalhaRpcCaderneta);
    await expect(promessa).rejects.toMatchObject({ caderneta: "erro" });
  });

  it("chave anômala (não-pública) devolvida pela caderneta -> tratada como 'erro', também null (SUPOSIÇÃO desta tarefa)", async () => {
    const cadernetaChaveSecreta: ResolverLojaNaCaderneta = async () => ({
      tipo: "hit",
      conexao: {
        supabaseUrl: "https://loja-secreta.supabase.co",
        // Curta de propósito: o secretlint do pre-commit casa `sb_secret_` com
        // 16+ caracteres depois do prefixo, e a fixture só precisa do prefixo
        // para o porteiro classificá-la como NÃO pública.
        publishableKey: "sb_secret_curta",
        origem: "caderneta",
      },
    });
    const resultado = await resolverConexao(
      "loja-secreta.exemplo",
      ambienteComOsDois,
      cadernetaChaveSecreta,
    );
    expect(resultado).toEqual({ conexao: null, caderneta: "erro" });
  });

  it("hit -> devolve a conexão da caderneta, não a do projeto", async () => {
    const cadernetaHit: ResolverLojaNaCaderneta = async () => ({
      tipo: "hit",
      conexao: {
        supabaseUrl: "https://loja-a.supabase.co",
        publishableKey: "sb_publishable_da_loja_a",
        origem: "caderneta",
      },
    });
    const resultado = await resolverConexao(
      "loja-a.exemplo",
      ambienteComOsDois,
      cadernetaHit,
    );
    expect(resultado).toEqual({
      conexao: {
        supabaseUrl: "https://loja-a.supabase.co",
        publishableKey: "sb_publishable_da_loja_a",
        origem: "caderneta",
      },
      caderneta: "hit",
    });
  });

  it("caderneta AUSENTE (nenhuma das três variáveis) -> continua caindo no ambiente do projeto, inalterado", async () => {
    const resultado = await resolverConexao(
      "host-qualquer.exemplo",
      {
        VITE_SUPABASE_URL: "https://projeto-hospedeiro.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_do_projeto_hospedeiro",
      },
      undefined,
    );
    expect(resultado).toEqual({
      conexao: {
        supabaseUrl: "https://projeto-hospedeiro.supabase.co",
        publishableKey: "sb_publishable_do_projeto_hospedeiro",
        origem: "projeto",
      },
      caderneta: "ausente",
    });
  });
});

// RODADA DE CORREÇÃO 2 (achado 1 do revisor): o ramo de robô do
// `middleware.ts` (`isBot` + `/product-detail`, middleware.ts:181-190) chama
// `obterFichaValidada` — a MESMA trava que o documento usa — mas nenhum
// teste desta peça pinava esse caminho com a caderneta em MISS. Sem este
// teste, quem voltasse a resolver conexão por fora dali (por fora de
// `obterFichaValidada`) reabriria exatamente o vazamento que a rodada C já
// consertou: o robô servindo o catálogo de outra loja com 200 enquanto o
// navegador no MESMO host recebe 503. Testa através do `middleware()` REAL
// (import default de `middleware.ts`), com `globalThis.fetch` e
// `process.env` substituídos — nunca rede de verdade.
describe("middleware — robô em /product-detail com a caderneta CONFIGURADA em miss recebe o MESMO 503 sem-loja (achado 1, rodada 2)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("host desconhecido da caderneta + user-agent de robô -> 503 sem-loja, x-ikcous-caderneta: miss, nunca 200/passthrough, corpo sem byte de loja nenhuma", async () => {
    vi.stubEnv("IKCOUS_FROTA_URL", FROTA_URL);
    vi.stubEnv("IKCOUS_FROTA_APIKEY", APIKEY_PRINCIPAL);
    vi.stubEnv("IKCOUS_FROTA_CHAVE", SEGREDO);

    const fetchDuble: typeof fetch = (async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/rest/v1/rpc/resolver_loja") {
        // Zero linhas -> miss (o host não está cadastrado na caderneta).
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`URL não mapeada no dublê de teste: ${url.toString()}`);
    }) as typeof fetch;

    const resp = await comFetch(fetchDuble, () =>
      middleware(
        new Request(
          "https://loja-robo-desconhecida.exemplo/product-detail?id=9",
          { headers: { "user-agent": "WhatsApp/2.23" } },
        ),
      ),
    );

    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("miss");
    // Nunca a resposta de robô (produto/sem-produto) nem passthrough: prova
    // que caiu na MESMA trava de manutenção do documento, não no ramo que
    // consultaria o banco por fora dela.
    expect(resp.headers.get("x-ikcous-og")).toBeNull();
    expect(resp.headers.get("x-middleware-next")).toBeNull();
    const corpo = await resp.text();
    expect(corpo).toContain("manutenção");
    expect(corpo).not.toContain("supabase.co");
    expect(corpo).not.toContain("sb_publishable");
  });
});
