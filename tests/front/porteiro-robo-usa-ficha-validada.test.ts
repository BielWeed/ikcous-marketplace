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

import { SELECT_CONFIGURACAO_PUBLICA } from "@/hospedagem/porteiro";
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

// ETAPA 3: `SELECT_CONFIGURACAO_PUBLICA` (porteiro.ts) passou a pedir 5
// colunas numa consulta só (`dominio_publico` + os 4 valores de
// `configuracao`), no lugar do antigo `select=dominio_publico` sozinho —
// os dubles abaixo precisam casar o select novo e devolver as 5 colunas,
// senão a resposta cai fora do formato esperado e o porteiro fecha a loja
// com `banco-indisponivel`. Os testes deste arquivo não afirmam nada sobre
// `configuracao`, então os 4 valores extras são neutros (desligados).
function linhaConfiguracaoPublica(dominioPublico: string | null) {
  return {
    dominio_publico: dominioPublico,
    mp_public_key: null,
    vapid_public_key: null,
    pagamento_online: false,
    manutencao: false,
  };
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
        if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA) {
          return new Response(
            JSON.stringify([
              linhaConfiguracaoPublica("loja-b-central.exemplo"),
            ]),
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
        if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA) {
          return new Response(
            JSON.stringify([
              linhaConfiguracaoPublica("loja-b-central-2.exemplo"),
            ]),
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

  it("robô + frota CONFIGURADA + host não cadastrado (miss) -> 503 sem-loja, x-ikcous-caderneta: miss, NUNCA serve pelo ambiente do projeto (ADENDO A.3: host sem cadastro é o vazamento que A.3 fechou)", async () => {
    // O ambiente do projeto (VITE_SUPABASE_*) está presente de propósito,
    // igual ao teste de unidade em porteiro-caderneta.test.ts: se o ramo de
    // robô regredisse para o comportamento pré-etapa-3 ("caderneta miss cai
    // no ambiente do projeto hospedeiro"), este host desconhecido serviria o
    // catálogo da loja PRINCIPAL (o projeto hospedeiro, com N lojas
    // compartilhando o build) — o vazamento que o ADENDO A.3 fechou. A RPC
    // `resolver_loja` nunca é seguida de uma consulta a `v_store_config`
    // aqui: `resolverFichaViaRede` lança `DecisaoPorteiro("sem-loja", …)`
    // assim que `resolverConexao` devolve `conexao: null`, antes de ler
    // identidade/configuração — por isso o dublê abaixo só mapeia a RPC.
    const fetchDuble: typeof fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/rpc/resolver_loja") {
        return new Response(JSON.stringify([]), {
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
        VITE_SUPABASE_URL: "https://projetoccccccccccccc.supabase.co",
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
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("miss");
    const html = await resp.text();
    expect(html).toContain("manutenção");
    expect(html).not.toContain("Produto Normal");
    expect(html).not.toContain("supabase.co");
    expect(html).not.toContain("sb_publishable");
  });

  it("robô + produto não encontrado -> sem-produto (pass-through) continua com x-ikcous-caderneta presente", async () => {
    const origemProjeto = "https://projetoddddddddddddd.supabase.co";
    const fetchDuble: typeof fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/v_store_config") {
        if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA) {
          return new Response(
            JSON.stringify([
              linhaConfiguracaoPublica("loja-sem-produto.exemplo"),
            ]),
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
        if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA) {
          return new Response(
            JSON.stringify([
              linhaConfiguracaoPublica("loja-com-ponto.exemplo"),
            ]),
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

  it("robô em alias *.vercel.app em produção -> 308 para o dominio_publico, nunca HTML de produto, nunca passthrough (brief 20260911-brief-aliases-vercel-encaminham)", async () => {
    const origemProjeto = "https://projetofffffffffffff.supabase.co";
    const produtoQueNuncaDeveAparecer = {
      nome: "Produto Que Nao Deveria Aparecer",
      descricao: "desc",
      preco_venda: 42,
      imagem_url: "https://cdn.exemplo.com/f.jpg",
      imagem_urls: null,
    };
    const fetchDuble: typeof fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/v_store_config") {
        if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA) {
          return new Response(
            JSON.stringify([
              linhaConfiguracaoPublica("ickous-marketplace.vercel.app"),
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify([identidadeFixture("Loja Principal", origemProjeto)]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/rest/v1/vw_produtos_public")
        return new Response(JSON.stringify([produtoQueNuncaDeveAparecer]), {
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
        VERCEL_ENV: "production",
      },
      () =>
        comFetch(fetchDuble, () =>
          middleware(
            new Request(
              "https://ickous-marketplace-git-main-abc.vercel.app/product-detail?id=9",
              { headers: { "user-agent": UA_ROBO } },
            ),
          ),
        ),
    );
    expect(resp.status).toBe(308);
    expect(resp.headers.get("location")).toBe(
      "https://ickous-marketplace.vercel.app/product-detail?id=9",
    );
    expect(resp.headers.get("cache-control")).toBe("no-store");
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("encaminha");
    expect(resp.headers.get("x-middleware-next")).toBeNull();
    expect(resp.headers.get("x-ikcous-og")).toBeNull();
    const corpo = await resp.text();
    expect(corpo).toBe("");
    expect(corpo).not.toContain("Produto Que Nao Deveria Aparecer");
  });

  // T5 (11/09/2026): o ramo de robô lia `process.env.VITE_APP_NAME` — um
  // valor ASSADO no build, o mesmo problema que a ficha por host resolve
  // para o resto da página. Título, og:title e twitter:title passam a usar
  // `ficha.identidade.identity.storeName` (a MESMA ficha validada que o
  // documento usa — "uma trava, um lugar" continua valendo para o dado, não
  // só para a decisão de servir).
  it("robô usa o storeName da FICHA no title/og:title/twitter:title, nunca process.env.VITE_APP_NAME", async () => {
    const origemProjeto = "https://projetoggggggggggggg.supabase.co";
    const produtoComNome = {
      nome: "Camiseta Azul",
      descricao: "100% algodão",
      preco_venda: 49.9,
      imagem_url: "https://cdn.exemplo.com/g.jpg",
      imagem_urls: null,
    };
    const fetchDuble: typeof fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/v_store_config") {
        if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA) {
          return new Response(
            JSON.stringify([
              linhaConfiguracaoPublica("loja-com-storename.exemplo"),
            ]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify([identidadeFixture("Loja Da Ficha", origemProjeto)]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/rest/v1/vw_produtos_public")
        return new Response(JSON.stringify([produtoComNome]), {
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
        VITE_APP_NAME: "Nome Do Build Nunca Deveria Aparecer",
      },
      () =>
        comFetch(fetchDuble, () =>
          middleware(
            new Request(
              "https://loja-com-storename.exemplo/product-detail?id=1",
              { headers: { "user-agent": UA_ROBO } },
            ),
          ),
        ),
    );
    expect(resp.status).toBe(200);
    const html = await resp.text();
    expect(html).toContain("<title>Camiseta Azul | Loja Da Ficha</title>");
    expect(html).toContain(
      '<meta property="og:title" content="Camiseta Azul - R$ 49,90 | Loja Da Ficha" />',
    );
    expect(html).toContain(
      '<meta name="twitter:title" content="Camiseta Azul | Loja Da Ficha" />',
    );
    expect(html).not.toContain("Nome Do Build Nunca Deveria Aparecer");
  });

  it("robô + produto sem foto -> og:image usa localUrls.og da FICHA (Storage absoluto), nunca o og-image.png do domínio da loja", async () => {
    const origemProjeto = "https://projetohhhhhhhhhhhhh.supabase.co";
    const produtoSemFoto = {
      nome: "Produto Sem Foto",
      descricao: "desc",
      preco_venda: 30,
      imagem_url: null,
      imagem_urls: null,
    };
    const fetchDuble: typeof fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/v_store_config") {
        if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA) {
          return new Response(
            JSON.stringify([linhaConfiguracaoPublica("loja-sem-foto.exemplo")]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify([identidadeFixture("Loja Sem Foto", origemProjeto)]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      if (url.pathname === "/rest/v1/vw_produtos_public")
        return new Response(JSON.stringify([produtoSemFoto]), {
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
            new Request("https://loja-sem-foto.exemplo/product-detail?id=1", {
              headers: { "user-agent": UA_ROBO },
            }),
          ),
        ),
    );
    expect(resp.status).toBe(200);
    const html = await resp.text();
    const ogEsperado = `${origemProjeto}/storage/v1/object/public/branding/v1/${HASH}/og.png`;
    expect(html).toContain(
      `<meta property="og:image" content="${ogEsperado}" />`,
    );
    expect(html).toContain('<meta property="og:image:width" content="1200" />');
    expect(html).not.toContain("og-image.png");
  });
});
