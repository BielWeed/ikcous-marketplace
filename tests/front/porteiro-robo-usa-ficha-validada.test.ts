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
  vi.restoreAllMocks();
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
  IKCOUS_DOMINIO_PRINCIPAL: undefined,
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

// ─── dublê de lojas (prévia de produto sumido, 14/10/2026) ──────────────────
//
// O HTML "assado" do build compartilhado: tem a identidade da loja PRINCIPAL
// (o build roda uma vez, com o ambiente dela). Se QUALQUER parte dele chegar
// ao robô de uma loja que não é a principal, o quadrinho de prévia sai com a
// cara errada — é a prova de vazamento que os testes abaixo procuram.
const MARCA_DO_BUILD = "Loja Do Build Principal";
const HTML_DO_BUILD = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>${MARCA_DO_BUILD} | Lugar Nenhum</title>
<meta name="description" content="Produtos e novidades de ${MARCA_DO_BUILD}" />
<meta property="og:title" content="${MARCA_DO_BUILD}" />
<meta property="og:url" content="https://build-principal.exemplo/" />
<style id="dynamic-branding-style">:root {--primary-color:#000000;}</style>
</head>
<body>
<div class="cinematic-text">${MARCA_DO_BUILD}</div>
</body>
</html>`;

type RespostaProdutos =
  | { readonly tipo: "lista"; readonly linhas: readonly unknown[] }
  | { readonly tipo: "status"; readonly status: number }
  | { readonly tipo: "lanca" };

type RespostaDocumento =
  | { readonly tipo: "ok" }
  | { readonly tipo: "status"; readonly status: number }
  | { readonly tipo: "lanca" };

interface LojaDuble {
  /** Também é o `dominio_publico` — a concordância exige host === domínio. */
  readonly host: string;
  readonly nome: string;
  readonly origem: string;
  readonly produtos: RespostaProdutos;
  readonly documento?: RespostaDocumento;
  /** `true` -> a leitura da ficha (identidade/configuração) dá 500. */
  readonly fichaFalha?: boolean;
}

const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });

// `chamadas` registra `host/caminho` de cada consulta: é o que prova "o robô
// de um produto ATIVO nunca baixa o documento" e "sem produto = UMA ficha".
function criarFetchDeLojas(
  lojas: readonly LojaDuble[],
  chamadas: string[],
): typeof fetch {
  return (async (input, init) => {
    const url = requestUrl(input);
    chamadas.push(`${url.hostname}${url.pathname}`);
    if (url.pathname === "/index.html") {
      const loja = lojas.find((l) => l.host === url.hostname);
      const resposta = loja?.documento ?? { tipo: "ok" };
      if (resposta.tipo === "lanca") throw new Error("rede caiu no documento");
      if (resposta.tipo === "status")
        return new Response("erro", { status: resposta.status });
      return new Response(HTML_DO_BUILD, {
        status: 200,
        headers: { "content-type": "text/html" },
      });
    }
    if (url.pathname === "/rest/v1/rpc/resolver_loja") {
      const corpo = JSON.parse(String(init?.body ?? "{}")) as {
        p_host?: string;
      };
      const loja = lojas.find((l) => l.host === corpo.p_host);
      return json(
        loja
          ? [
              {
                supabase_url: loja.origem,
                publishable_key: `sb_publishable_${new URL(loja.origem).hostname.split(".")[0]}`,
              },
            ]
          : [],
      );
    }
    const loja = lojas.find((l) => l.origem === url.origin);
    if (!loja) throw new Error(`URL não mapeada no dublê: ${url.toString()}`);
    if (url.pathname === "/rest/v1/v_store_config") {
      if (loja.fichaFalha) return json({ erro: "banco fora" }, 500);
      if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA)
        return json([linhaConfiguracaoPublica(loja.host)]);
      return json([identidadeFixture(loja.nome, loja.origem)]);
    }
    if (url.pathname === "/rest/v1/vw_produtos_public") {
      if (loja.produtos.tipo === "lanca") throw new Error("rede caiu");
      if (loja.produtos.tipo === "status")
        return json({ erro: "x" }, loja.produtos.status);
      return json(loja.produtos.linhas);
    }
    throw new Error(`URL não mapeada no dublê: ${url.toString()}`);
  }) as typeof fetch;
}

const ENV_FROTA = {
  ...ENV_LIMPO,
  IKCOUS_FROTA_URL: "https://principal.supabase.co",
  IKCOUS_FROTA_APIKEY: "sb_publishable_principal",
  IKCOUS_FROTA_CHAVE: "segredo-de-teste",
};

// A identidade só aceita origem `https://<20 caracteres [a-z0-9]>.supabase.co`
// (`parseStoreIdentity`); `chave` precisa ser única entre os casos.
function origemDe(chave: string): string {
  return `https://${`projeto${chave}`.padEnd(20, "a").slice(0, 20)}.supabase.co`;
}

function robo(host: string, caminho = "/product-detail?id=1") {
  return new Request(`https://${host}${caminho}`, {
    headers: { "user-agent": UA_ROBO },
  });
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

  it("robô + produto não encontrado -> o documento da PRÓPRIA loja do endereço (nome e og:url dela), nunca o HTML assado do build, com x-ikcous-caderneta presente", async () => {
    // Antes: `return passthrough("sem-produto")` devolvia `x-middleware-next`
    // e a Vercel entregava `/index.html` assado = a identidade da loja
    // PRINCIPAL no quadrinho de prévia de QUALQUER loja (defeito medido
    // 14/10/2026). Agora o robô recebe o documento da loja, com a ficha
    // injetada pelo mesmo caminho do navegador.
    const origemProjeto = "https://projetoddddddddddddd.supabase.co";
    const chamadas: string[] = [];
    const fetchDuble = criarFetchDeLojas(
      [
        {
          host: "loja-sem-produto.exemplo",
          nome: "Loja Sem Produto",
          origem: origemProjeto,
          produtos: { tipo: "lista", linhas: [] },
        },
      ],
      chamadas,
    );

    const resp = await comProcessEnv(
      {
        ...ENV_LIMPO,
        VITE_SUPABASE_URL: origemProjeto,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_projeto",
      },
      () =>
        comFetch(fetchDuble, () =>
          middleware(robo("loja-sem-produto.exemplo")),
        ),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-middleware-next")).toBeNull();
    expect(resp.headers.get("x-ikcous-og")).toBe("sem-produto");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("ausente");
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("ok");
    expect(resp.headers.get("content-type")).toContain("text/html");
    expect(resp.headers.get("cache-control")).toBe("no-store");
    const html = await resp.text();
    expect(html).toContain("<title>Loja Sem Produto</title>");
    expect(html).toContain(
      '<meta property="og:title" content="Loja Sem Produto" />',
    );
    expect(html).toContain(
      '<meta property="og:url" content="https://loja-sem-produto.exemplo/" />',
    );
    expect(html).not.toContain(MARCA_DO_BUILD);
    expect(html).not.toContain("build-principal.exemplo");
    // É a home da loja: nada de produto nem de preço na prévia.
    expect(html).not.toContain('content="product"');
    expect(html).not.toMatch(/R\$/);
    // Custo: a ficha foi resolvida UMA vez (identidade + configuração, as
    // duas consultas da MESMA resolução) para decidir a concordância — o robô
    // sem produto não pede ficha a mais, só baixa o documento estático.
    expect(
      chamadas.filter(
        (c) => c === "projetoddddddddddddd.supabase.co/rest/v1/v_store_config",
      ),
    ).toHaveLength(2);
    expect(chamadas).toContain("loja-sem-produto.exemplo/index.html");
  });

  // `chave` entra no host/nome: o cache do porteiro é um `Map` de módulo,
  // chaveado por host — hosts repetidos entre casos herdariam a ficha anterior.
  it.each([
    {
      chave: "pausado",
      rotulo: "produto pausado/apagado (lista vazia)",
      produtos: { tipo: "lista", linhas: [] },
    },
    {
      chave: "erro500",
      rotulo: "consulta do produto com erro de banco (500)",
      produtos: { tipo: "status", status: 500 },
    },
    {
      chave: "rede",
      rotulo: "consulta do produto derrubada pela rede",
      produtos: { tipo: "lanca" },
    },
  ] as const)(
    "robô + $rotulo -> documento da loja, sem produto",
    async ({ chave, produtos }) => {
      const host = `loja-${chave}-sumido.exemplo`;
      const origem = origemDe(chave);
      const nome = `Loja ${chave}`;
      const espiao = vi.spyOn(console, "error").mockImplementation(() => {});
      try {
        const resp = await comProcessEnv(ENV_FROTA, () =>
          comFetch(
            criarFetchDeLojas([{ host, nome, origem, produtos }], []),
            () => middleware(robo(host)),
          ),
        );
        expect(resp.status).toBe(200);
        expect(resp.headers.get("x-ikcous-og")).toBe("sem-produto");
        expect(resp.headers.get("x-ikcous-caderneta")).toBe("hit");
        const html = await resp.text();
        expect(html).toContain(`<title>${nome}</title>`);
        expect(html).toContain(`content="https://${host}/"`);
        expect(html).not.toContain(MARCA_DO_BUILD);
      } finally {
        espiao.mockRestore();
      }
    },
  );

  it("robô sem `id` na URL (/product-detail sozinho) -> documento da loja do endereço, nunca o assado do build", async () => {
    const host = "loja-sem-id.exemplo";
    const resp = await comProcessEnv(ENV_FROTA, () =>
      comFetch(
        criarFetchDeLojas(
          [
            {
              host,
              nome: "Loja Sem Id",
              origem: origemDe("semid"),
              produtos: { tipo: "lista", linhas: [] },
            },
          ],
          [],
        ),
        () => middleware(robo(host, "/product-detail")),
      ),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-og")).toBe("sem-produto");
    const html = await resp.text();
    expect(html).toContain("<title>Loja Sem Id</title>");
    expect(html).not.toContain(MARCA_DO_BUILD);
  });

  it("dois hosts, dois bancos, ambos com produto sumido -> cada robô recebe a ficha do SEU host (e a de um não vaza para o outro, nem pelo cache por host)", async () => {
    const lojas: LojaDuble[] = [
      {
        host: "loja-x-sumido.exemplo",
        nome: "Loja Xis Doces",
        origem: origemDe("xis"),
        produtos: { tipo: "lista", linhas: [] },
      },
      {
        host: "loja-y-sumido.exemplo",
        nome: "Loja Ipsilon Moda",
        origem: origemDe("ipsilon"),
        produtos: { tipo: "lista", linhas: [] },
      },
    ];
    const fetchDuble = criarFetchDeLojas(lojas, []);
    const pedir = (host: string) =>
      comProcessEnv(ENV_FROTA, () =>
        comFetch(fetchDuble, async () => {
          const resp = await middleware(robo(host));
          return { resp, html: await resp.text() };
        }),
      );

    const x1 = await pedir("loja-x-sumido.exemplo");
    const y1 = await pedir("loja-y-sumido.exemplo");
    // De novo o X, agora com a entrada do Y já no cache.
    const x2 = await pedir("loja-x-sumido.exemplo");

    for (const x of [x1, x2]) {
      expect(x.resp.status).toBe(200);
      expect(x.html).toContain("<title>Loja Xis Doces</title>");
      expect(x.html).toContain('content="https://loja-x-sumido.exemplo/"');
      expect(x.html).not.toContain("Loja Ipsilon Moda");
      expect(x.html).not.toContain(new URL(origemDe("ipsilon")).hostname);
      expect(x.html).not.toContain(MARCA_DO_BUILD);
    }
    expect(y1.resp.status).toBe(200);
    expect(y1.html).toContain("<title>Loja Ipsilon Moda</title>");
    expect(y1.html).toContain('content="https://loja-y-sumido.exemplo/"');
    expect(y1.html).not.toContain("Loja Xis Doces");
    expect(y1.html).not.toContain(new URL(origemDe("xis")).hostname);
    expect(y1.html).not.toContain(MARCA_DO_BUILD);
  });

  it("robô + produto sumido + a FICHA falha (banco da loja fora, sem cache) -> 503 de manutenção, NUNCA o HTML do build", async () => {
    const host = "loja-ficha-fora.exemplo";
    const resp = await comProcessEnv(ENV_FROTA, () =>
      comFetch(
        criarFetchDeLojas(
          [
            {
              host,
              nome: "Loja Ficha Fora",
              origem: origemDe("fichafora"),
              produtos: { tipo: "lista", linhas: [] },
              fichaFalha: true,
            },
          ],
          [],
        ),
        () => middleware(robo(host)),
      ),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
    expect(resp.headers.get("x-middleware-next")).toBeNull();
    const html = await resp.text();
    expect(html).toContain("manutenção");
    expect(html).not.toContain(MARCA_DO_BUILD);
    expect(html).not.toContain("Loja Ficha Fora");
  });

  it.each([
    {
      chave: "doc500",
      rotulo: "o documento estático responde 500",
      documento: { tipo: "status", status: 500 },
    },
    {
      chave: "docrede",
      rotulo: "a rede cai ao baixar o documento",
      documento: { tipo: "lanca" },
    },
  ] as const)(
    "robô + produto sumido + $rotulo -> 503 html-indisponivel, NUNCA o HTML do build",
    async ({ chave, documento }) => {
      // O middleware registra a falha de rede no log; o teste não precisa dele.
      vi.spyOn(console, "error").mockImplementation(() => {});
      const host = `loja-${chave}.exemplo`;
      const resp = await comProcessEnv(ENV_FROTA, () =>
        comFetch(
          criarFetchDeLojas(
            [
              {
                host,
                nome: "Loja Doc Fora",
                origem: origemDe(chave),
                produtos: { tipo: "lista", linhas: [] },
                documento,
              },
            ],
            [],
          ),
          () => middleware(robo(host)),
        ),
      );
      expect(resp.status).toBe(503);
      expect(resp.headers.get("x-ikcous-porteiro")).toBe("html-indisponivel");
      expect(resp.headers.get("x-middleware-next")).toBeNull();
      const html = await resp.text();
      expect(html).toContain("manutenção");
      expect(html).not.toContain(MARCA_DO_BUILD);
    },
  );

  it("produto ATIVO continua com a prévia do produto (não baixa o documento) e a pessoa no navegador continua recebendo o documento da loja", async () => {
    const host = "loja-ativo.exemplo";
    const chamadas: string[] = [];
    const fetchDuble = criarFetchDeLojas(
      [
        {
          host,
          nome: "Loja Nova Da Maria",
          origem: origemDe("ativo"),
          produtos: {
            tipo: "lista",
            linhas: [
              {
                nome: "Vestido Floral",
                descricao: "Vestido leve",
                preco_venda: 129.9,
                imagem_url: "https://cdn.exemplo.com/vestido.jpg",
                imagem_urls: [],
              },
            ],
          },
        },
      ],
      chamadas,
    );

    const resp = await comProcessEnv(ENV_FROTA, () =>
      comFetch(fetchDuble, () => middleware(robo(host))),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-og")).toBe("produto");
    const html = await resp.text();
    expect(html).toContain(
      'og:title" content="Vestido Floral - R$ 129,90 | Loja Nova Da Maria"',
    );
    expect(html).not.toContain(MARCA_DO_BUILD);
    // Prévia de produto não depende do documento do build.
    expect(chamadas).not.toContain(`${host}/index.html`);

    const navegador = await comProcessEnv(ENV_FROTA, () =>
      comFetch(fetchDuble, () =>
        middleware(
          new Request(`https://${host}/product-detail?id=1`, {
            headers: { "user-agent": UA_NAVEGADOR },
          }),
        ),
      ),
    );
    expect(navegador.status).toBe(200);
    expect(navegador.headers.get("x-ikcous-porteiro")).toBe("ok");
    expect(navegador.headers.get("x-ikcous-og")).toBeNull();
    const htmlNavegador = await navegador.text();
    expect(htmlNavegador).toContain("<title>Loja Nova Da Maria</title>");
    expect(htmlNavegador).not.toContain(MARCA_DO_BUILD);
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

  // L11 (13/10/2026): o nome da loja é escrito pelo lojista e entrava CRU em
  // title/og:title/twitter:title (os vizinhos nome/descrição já eram
  // escapados). Um `<` ou `"` no nome fecharia a tag/atributo no HTML que o
  // robô de prévia lê.
  it("robô escapa o storeName no title/og:title/twitter:title (nome com <script> e aspas nunca aparece cru)", async () => {
    const origemProjeto = "https://projetoiiiiiiiiiiiii.supabase.co";
    const nomeHostil = '<script>alert(1)</script> "Loja" & Cia';
    const produto = {
      nome: "Camiseta Azul",
      descricao: "desc",
      preco_venda: 49.9,
      imagem_url: "https://cdn.exemplo.com/i.jpg",
      imagem_urls: null,
    };
    const fetchDuble: typeof fetch = (async (input) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/v_store_config") {
        if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA) {
          return new Response(
            JSON.stringify([linhaConfiguracaoPublica("loja-hostil.exemplo")]),
            { status: 200, headers: { "content-type": "application/json" } },
          );
        }
        return new Response(
          JSON.stringify([identidadeFixture(nomeHostil, origemProjeto)]),
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
            new Request("https://loja-hostil.exemplo/product-detail?id=1", {
              headers: { "user-agent": UA_ROBO },
            }),
          ),
        ),
    );
    expect(resp.status).toBe(200);
    const html = await resp.text();
    const nomeEscapado =
      "&lt;script&gt;alert(1)&lt;/script&gt; &quot;Loja&quot; &amp; Cia";
    expect(html).not.toContain("<script>");
    expect(html).not.toContain(nomeHostil);
    expect(html).toContain(`<title>Camiseta Azul | ${nomeEscapado}</title>`);
    expect(html).toContain(
      `<meta property="og:title" content="Camiseta Azul - R$ 49,90 | ${nomeEscapado}" />`,
    );
    expect(html).toContain(
      `<meta name="twitter:title" content="Camiseta Azul | ${nomeEscapado}" />`,
    );
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
