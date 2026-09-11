// T3c (ADENDO — RODADA C, 11/09/2026): o ramo de robô do `middleware.ts`
// (`/product-detail` + user-agent de crawler) tinha um bug medido pelo
// revisor Opus na rodada B — ele chamava `resolverConexao` POR FORA de
// `atenderPorteiro`, pulando `decidirConcordancia`: com a caderneta
// apontando o host A para o banco de B, o robô servia o catálogo de B
// (200) enquanto o navegador no MESMO host recebia 503. Este arquivo prova
// que o ramo de robô agora usa `obterFichaValidada` — a MESMA trava que o
// documento usa — e nunca vaza dado de outra loja.
//
// "Uma trava, um lugar" (brief T3c, item 1): `obterFichaValidada` é a
// função extraída de `atenderPorteiro` (resolver + concordar + cachear) e
// exportada para o ramo de robô chamar. Este arquivo testa através do
// `middleware()` REAL (import default de `middleware.ts`), com
// `globalThis.fetch` e `process.env` substituídos — nunca rede de verdade.
import { afterEach, describe, expect, it, vi } from "vitest";

import middleware from "../../middleware";

const UA_ROBO = "WhatsApp/2.23.20.0 A";
const UA_NAVEGADOR = "Mozilla/5.0 (Windows NT 10.0; Win64; x64)";

// `vi.stubEnv`/`vi.unstubAllEnvs` — mesma convenção do resto do repo
// (`tests/front/env-publishable-key-com-fallback-para-legada.test.ts` etc.)
// para não vazar env entre testes, e para não indexar `process.env[chave]`
// dinamicamente (o que o eslint marca como `security/detect-object-injection`).
afterEach(() => {
  vi.unstubAllEnvs();
});

function comProcessEnv<T>(
  pares: Record<string, string | undefined>,
  executar: () => Promise<T>,
): Promise<T> {
  for (const [chave, valor] of Object.entries(pares)) vi.stubEnv(chave, valor);
  return executar();
}

function comFetch<T>(fetchFalso: typeof fetch, executar: () => Promise<T>) {
  const anterior = globalThis.fetch;
  globalThis.fetch = fetchFalso;
  return executar().finally(() => {
    globalThis.fetch = anterior;
  });
}

// Env sempre limpo das três variáveis da caderneta e do projeto — cada
// teste declara só o que precisa, sem herdar nada do ambiente real do
// processo de teste (que pode ter VITE_SUPABASE_* de outro lugar).
const ENV_LIMPO = {
  IKCOUS_FROTA_URL: undefined,
  IKCOUS_FROTA_APIKEY: undefined,
  IKCOUS_FROTA_CHAVE: undefined,
  VITE_SUPABASE_URL: undefined,
  VITE_SUPABASE_PUBLISHABLE_KEY: undefined,
  VITE_SUPABASE_ANON_KEY: undefined,
  VERCEL_ENV: undefined,
  VERCEL_PROJECT_PRODUCTION_URL: undefined,
};

const HASH = "a".repeat(64);
function asset(nome: string, largura: number, altura: number) {
  return {
    path: `v1/${HASH}/${nome}.png`,
    sha256: HASH,
    media_type: "image/png",
    bytes: 100,
    width: largura,
    height: altura,
  };
}
function identidadeFixture(nome: string, origin: string) {
  const header = asset("header", 64, 64);
  return {
    store_name: nome,
    store_city: null,
    store_state: null,
    logo_url: `${origin}/storage/v1/object/public/branding/${header.path}`,
    primary_color: "#111111",
    secondary_color: "#654321",
    accent_color: "#abcdef",
    branding_assets: {
      version: 1,
      originals: [header],
      header,
      loader: asset("loader", 64, 64),
      favicon: asset("favicon", 32, 32),
      apple_touch: asset("apple", 180, 180),
      icon_192: asset("icon192", 192, 192),
      icon_512: asset("icon512", 512, 512),
      maskable_512: asset("maskable", 512, 512),
      og: asset("og", 1200, 630),
    },
  };
}

function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}

describe("middleware — o ramo de robô nunca pula decidirConcordancia (achado do revisor, rodada C)", () => {
  it("caderneta mapeia loja-a-central para o banco de B (dominio_publico=loja-b-central) -> robô recebe 503 discorda, sem nome/preço/supabaseUrl/chave de B", async () => {
    const origemB = "https://projetobbbbbbbbbbbbb.supabase.co";
    const produtoSecretoB = {
      nome: "Produto Secreto Da Loja B",
      descricao: "Não deveria aparecer para o host A",
      preco_venda: 999.9,
      imagem_url: "https://cdn.exemplo.com/b.jpg",
      imagem_urls: null,
    };
    const fetchDuble: typeof fetch = (async (input, init) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/rpc/resolver_loja") {
        return new Response(
          JSON.stringify([
            { supabase_url: origemB, publishable_key: "sb_publishable_b" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/rest/v1/v_store_config") {
        if (url.searchParams.get("select") === "dominio_publico") {
          return new Response(
            JSON.stringify([{ dominio_publico: "loja-b-central.exemplo" }]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify([identidadeFixture("Loja Secreta B", origemB)]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/rest/v1/vw_produtos_public") {
        return new Response(JSON.stringify([produtoSecretoB]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(
        `URL não mapeada no dublê: ${url.toString()} (${init?.method ?? "GET"})`,
      );
    }) as typeof fetch;

    const request = new Request(
      "https://loja-a-central.exemplo/product-detail?id=1",
      { headers: { "user-agent": UA_ROBO } },
    );

    const resp = await comProcessEnv(
      {
        ...ENV_LIMPO,
        IKCOUS_FROTA_URL: "https://principal.supabase.co",
        IKCOUS_FROTA_APIKEY: "sb_publishable_principal",
        IKCOUS_FROTA_CHAVE: "segredo-de-teste",
      },
      () => comFetch(fetchDuble, () => middleware(request)),
    );

    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("discorda");
    // Item 2 do brief: x-ikcous-caderneta em TODAS as respostas do ramo de
    // robô, inclusive o 503 — "hit" porque a caderneta RESPONDEU (achou
    // uma loja), o que discordou foi o domínio dela com o host atendido.
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("hit");
    const corpo = await resp.text();
    expect(corpo).not.toContain("Produto Secreto Da Loja B");
    expect(corpo).not.toContain("999");
    expect(corpo).not.toContain(origemB);
    expect(corpo).not.toContain("sb_publishable_b");
    expect(corpo).not.toContain("Loja Secreta B");
  });

  it("mesmo cenário, mas o navegador (não robô) no MESMO host recebe o MESMO 503 discorda — antes do conserto os dois discordavam entre si", async () => {
    const origemB = "https://projetobbbbbbbbbbbbb.supabase.co";
    const fetchDuble: typeof fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/rpc/resolver_loja") {
        return new Response(
          JSON.stringify([
            { supabase_url: origemB, publishable_key: "sb_publishable_b" },
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/rest/v1/v_store_config") {
        if (url.searchParams.get("select") === "dominio_publico") {
          return new Response(
            JSON.stringify([{ dominio_publico: "loja-b-central-2.exemplo" }]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify([identidadeFixture("Loja Secreta B2", origemB)]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/index.html")
        return new Response(
          "<!DOCTYPE html><html><head></head><body></body></html>",
          { status: 200, headers: { "content-type": "text/html" } },
        );
      throw new Error(`URL não mapeada no dublê: ${url.toString()}`);
    }) as typeof fetch;

    const env = {
      ...ENV_LIMPO,
      IKCOUS_FROTA_URL: "https://principal.supabase.co",
      IKCOUS_FROTA_APIKEY: "sb_publishable_principal",
      IKCOUS_FROTA_CHAVE: "segredo-de-teste",
    };
    const respNavegador = await comProcessEnv(env, () =>
      comFetch(fetchDuble, () =>
        middleware(
          new Request("https://loja-a-central-2.exemplo/product-detail?id=1", {
            headers: { "user-agent": UA_NAVEGADOR },
          }),
        ),
      ),
    );
    expect(respNavegador.status).toBe(503);
    expect(respNavegador.headers.get("x-ikcous-porteiro")).toBe("discorda");

    const respRobo = await comProcessEnv(env, () =>
      comFetch(fetchDuble, () =>
        middleware(
          new Request("https://loja-a-central-2.exemplo/product-detail?id=1", {
            headers: { "user-agent": UA_ROBO },
          }),
        ),
      ),
    );
    expect(respRobo.status).toBe(503);
    expect(respRobo.headers.get("x-ikcous-porteiro")).toBe("discorda");
  });

  it("robô + caderneta ausente (miss) -> serve pelo ambiente do projeto com x-ikcous-caderneta: miss, produto normal", async () => {
    const origemProjeto = "https://projetoccccccccccccc.supabase.co";
    const produto = {
      nome: "Produto Normal",
      descricao: "desc",
      preco_venda: 10,
      imagem_url: "https://cdn.exemplo.com/c.jpg",
      imagem_urls: null,
    };
    const fetchDuble: typeof fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/rpc/resolver_loja") {
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      if (url.pathname === "/rest/v1/v_store_config") {
        if (url.searchParams.get("select") === "dominio_publico") {
          return new Response(
            JSON.stringify([{ dominio_publico: "loja-projeto.exemplo" }]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify([identidadeFixture("Loja Do Projeto", origemProjeto)]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/rest/v1/vw_produtos_public") {
        return new Response(JSON.stringify([produto]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      throw new Error(`URL não mapeada no dublê: ${url.toString()}`);
    }) as typeof fetch;

    const resp = await comProcessEnv(
      {
        ...ENV_LIMPO,
        IKCOUS_FROTA_URL: "https://principal.supabase.co",
        IKCOUS_FROTA_APIKEY: "sb_publishable_principal",
        IKCOUS_FROTA_CHAVE: "segredo-de-teste",
        VITE_SUPABASE_URL: origemProjeto,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_projeto",
      },
      () =>
        comFetch(fetchDuble, () =>
          middleware(
            new Request("https://loja-projeto.exemplo/product-detail?id=1", {
              headers: { "user-agent": UA_ROBO },
            }),
          ),
        ),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-og")).toBe("produto");
    // Item 2 do brief: header presente também na resposta de sucesso.
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("miss");
    const html = await resp.text();
    expect(html).toContain("Produto Normal");
  });

  it("robô + produto não encontrado -> sem-produto (pass-through) continua com x-ikcous-caderneta presente", async () => {
    const origemProjeto = "https://projetoddddddddddddd.supabase.co";
    const fetchDuble: typeof fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/v_store_config") {
        if (url.searchParams.get("select") === "dominio_publico") {
          return new Response(
            JSON.stringify([{ dominio_publico: "loja-sem-produto.exemplo" }]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify([
            identidadeFixture("Loja Sem Produto", origemProjeto),
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/rest/v1/vw_produtos_public")
        return new Response(JSON.stringify([]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      throw new Error(`URL não mapeada no dublê: ${url.toString()}`);
    }) as typeof fetch;

    const resp = await comProcessEnv(
      {
        ...ENV_LIMPO,
        VITE_SUPABASE_URL: origemProjeto,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_projeto",
      },
      () =>
        comFetch(fetchDuble, () =>
          middleware(
            new Request(
              "https://loja-sem-produto.exemplo/product-detail?id=1",
              { headers: { "user-agent": UA_ROBO } },
            ),
          ),
        ),
    );
    expect(resp.headers.get("x-middleware-next")).toBe("1");
    expect(resp.headers.get("x-ikcous-og")).toBe("sem-produto");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("ausente");
  });

  it("o ramo de robô usa normalizarHost: host com PONTO FINAL (FQDN) concorda com dominio_publico sem ponto", async () => {
    // `new URL(...)` NÃO remove o ponto final de FQDN (só normalizarHost o
    // faz — ver o comentário em `normalizarHost`, porteiro.ts). Se o ramo
    // de robô ainda usasse `url.hostname` cru, o host chegaria com o ponto
    // e NUNCA bateria com o `dominio_publico` salvo sem ponto -> 503
    // discorda. Este teste prova que ele normaliza.
    const origemProjeto = "https://projetoeeeeeeeeeeeee.supabase.co";
    const produto = {
      nome: "Produto Com Ponto Final",
      descricao: "desc",
      preco_venda: 5,
      imagem_url: "https://cdn.exemplo.com/e.jpg",
      imagem_urls: null,
    };
    const fetchDuble: typeof fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/v_store_config") {
        if (url.searchParams.get("select") === "dominio_publico") {
          return new Response(
            JSON.stringify([{ dominio_publico: "loja-com-ponto.exemplo" }]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify([
            identidadeFixture("Loja Com Ponto Final", origemProjeto),
          ]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/rest/v1/vw_produtos_public")
        return new Response(JSON.stringify([produto]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      throw new Error(`URL não mapeada no dublê: ${url.toString()}`);
    }) as typeof fetch;

    const resp = await comProcessEnv(
      {
        ...ENV_LIMPO,
        VITE_SUPABASE_URL: origemProjeto,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_projeto",
      },
      () =>
        comFetch(fetchDuble, () =>
          middleware(
            new Request("https://loja-com-ponto.exemplo./product-detail?id=1", {
              headers: { "user-agent": UA_ROBO },
            }),
          ),
        ),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-og")).toBe("produto");
    const html = await resp.text();
    expect(html).toContain("Produto Com Ponto Final");
  });
});
