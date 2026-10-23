// Defeito multiloja-frota-3 (onda 2): `robots.txt` e `sitemap.xml` eram
// arquivos ESTÁTICOS do build, com o endereço e os produtos da loja
// principal, e a Vercel os servia a qualquer host — o Google abria o endereço
// da Savy e recebia o mapa do site da IKCOUS. Agora o porteiro responde os dois
// caminhos POR HOST (`atenderMapaDoSite`, porteiro.ts): robots.txt com o
// `Sitemap:` da própria loja; sitemap.xml com as URLs estáticas dela mais os
// produtos públicos lidos do banco DELA, com falha suave (só as estáticas DA
// MESMA loja, nunca as da outra, nunca 500).
//
// Os testes de host passam pelo `middleware()` REAL (import default de
// `middleware.ts`), com `globalThis.fetch` e `process.env` substituídos —
// nunca rede de verdade. Os de cache e relógio chamam `atenderPorteiro`
// direto, com `agora` e `cacheMapa` injetados. O `Map` de módulo do porteiro
// sobrevive entre testes do arquivo: cada caso usa hosts próprios.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { robotsTxt, sitemapXml } from "@/hospedagem/mapaDoSite";
import {
  CACHE_MAPA_FRESCO_MS,
  CACHE_MAPA_STALE_MAX_MS,
  SELECT_CONFIGURACAO_PUBLICA,
  atenderPorteiro,
} from "@/hospedagem/porteiro";
import type { EntradaCacheMapa } from "@/hospedagem/porteiro";
import middleware from "../../middleware";

// A falha de leitura do catálogo é LOGADA de propósito (mapa pequeno nunca é
// silencioso); os casos de falha abaixo a provocam de propósito.
beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

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
const ENV_FROTA = {
  ...ENV_LIMPO,
  IKCOUS_FROTA_URL: "https://principal.supabase.co",
  IKCOUS_FROTA_APIKEY: "sb_publishable_principal",
  IKCOUS_FROTA_CHAVE: "segredo-de-teste",
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
function linhaConfiguracaoPublica(dominioPublico: string | null) {
  return {
    dominio_publico: dominioPublico,
    mp_public_key: null,
    vapid_public_key: null,
    pagamento_online: false,
    manutencao: false,
  };
}
function requestUrl(input: RequestInfo | URL): URL {
  return new URL(input instanceof Request ? input.url : String(input));
}
const json = (corpo: unknown, status = 200) =>
  new Response(JSON.stringify(corpo), {
    status,
    headers: { "content-type": "application/json" },
  });

// A identidade só aceita origem `https://<20 caracteres [a-z0-9]>.supabase.co`.
function origemDe(chave: string): string {
  return `https://${`projeto${chave}`.padEnd(20, "a").slice(0, 20)}.supabase.co`;
}

type Produtos =
  | { readonly tipo: "ids"; readonly ids: readonly string[] }
  | { readonly tipo: "status"; readonly status: number }
  | { readonly tipo: "lanca" }
  | { readonly tipo: "torto" }
  | { readonly tipo: "pendura" };

interface LojaDuble {
  /** Também é o `dominio_publico` — a concordância exige host === domínio. */
  host: string;
  readonly nome: string;
  origem: string;
  /** Mutável: os testes de cache trocam o que o banco devolve entre pedidos. */
  produtos: Produtos;
  /** `true` -> a leitura da ficha (identidade/configuração) dá 500. */
  fichaFalha?: boolean;
}

// `chamadas` registra `origem+caminho` de cada consulta ao banco e `host+
// caminho` do self-fetch: é o que prova "o sitemap da Savy lê o banco da Savy
// e nunca o da IKCOUS".
function criarFetchDeLojas(
  lojas: readonly LojaDuble[],
  chamadas: string[] = [],
): typeof fetch {
  return (async (input, init) => {
    const url = requestUrl(input);
    chamadas.push(`${url.origin}${url.pathname}`);
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
      const p = loja.produtos;
      if (p.tipo === "lanca") throw new Error("rede caiu");
      if (p.tipo === "pendura") return new Promise<Response>(() => {});
      if (p.tipo === "status") return json({ erro: "x" }, p.status);
      if (p.tipo === "torto") return new Response("isto nao e json");
      // Keyset de verdade: `order=id.asc`, `id=gt.<último>`, `limit=<n>`.
      const depois = url.searchParams.get("id")?.replace(/^gt\./, "") ?? null;
      const limite = Number(url.searchParams.get("limit"));
      const pagina = [...p.ids]
        .sort()
        .filter((id) => depois === null || id > depois)
        .slice(0, limite);
      return json(pagina.map((id) => ({ id })));
    }
    throw new Error(`URL não mapeada no dublê: ${url.toString()}`);
  }) as typeof fetch;
}

function pedir(
  lojas: readonly LojaDuble[],
  host: string,
  caminho: string,
  opcoes: { chamadas?: string[]; method?: string; env?: typeof ENV_FROTA } = {},
) {
  return comProcessEnv(opcoes.env ?? ENV_FROTA, () =>
    comFetch(criarFetchDeLojas(lojas, opcoes.chamadas), async () => {
      const resp = await middleware(
        new Request(`https://${host}${caminho}`, {
          method: opcoes.method ?? "GET",
          headers: { "user-agent": "Googlebot/2.1" },
        }),
      );
      return { resp, corpo: await resp.text() };
    }),
  );
}

function urlsDoSitemap(xml: string): string[] {
  return [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
}

// As duas lojas do defeito: a principal e a cliente real. Ids parecidos de
// propósito NÃO — ids distintos, para qualquer vazamento aparecer no texto.
const IDS_IKCOUS = ["ik-0001", "ik-0002", "ik-0003"];
const IDS_SAVY = ["sv-0001", "sv-0002"];
const lojasDoDefeito = (): LojaDuble[] => [
  {
    host: "ikcous-mapa.exemplo",
    nome: "IKCOUS",
    origem: origemDe("ikcous"),
    produtos: { tipo: "ids", ids: IDS_IKCOUS },
  },
  {
    host: "savy-mapa.exemplo",
    nome: "Savy Collection",
    origem: origemDe("savy"),
    produtos: { tipo: "ids", ids: IDS_SAVY },
  },
];

describe("robots.txt por host — o Sitemap aponta para a PRÓPRIA loja", () => {
  it("host da IKCOUS: robots com Allow igual ao de sempre e Sitemap da IKCOUS", async () => {
    const { resp, corpo } = await pedir(
      lojasDoDefeito(),
      "ikcous-mapa.exemplo",
      "/robots.txt",
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("ok");
    expect(resp.headers.get("x-middleware-next")).toBeNull();
    expect(corpo).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://ikcous-mapa.exemplo/sitemap.xml\n",
    );
  });

  it("host da Savy: o Sitemap é savy-mapa.exemplo e NADA da IKCOUS aparece", async () => {
    const { resp, corpo } = await pedir(
      lojasDoDefeito(),
      "savy-mapa.exemplo",
      "/robots.txt",
    );
    expect(resp.status).toBe(200);
    expect(corpo).toBe(
      "User-agent: *\nAllow: /\n\nSitemap: https://savy-mapa.exemplo/sitemap.xml\n",
    );
    expect(corpo).not.toContain("ikcous");
    expect(corpo).not.toContain("ickous");
  });

  it("robots não lê produto nenhum (só a ficha da loja)", async () => {
    const chamadas: string[] = [];
    await pedir(lojasDoDefeito(), "savy-mapa.exemplo", "/robots.txt", {
      chamadas,
    });
    expect(chamadas.some((c) => c.endsWith("/vw_produtos_public"))).toBe(false);
  });
});

describe("sitemap.xml por host — URLs e produtos da PRÓPRIA loja", () => {
  it("host da IKCOUS: 4 URLs estáticas e os 3 produtos dela, no endereço dela", async () => {
    const { resp, corpo } = await pedir(
      lojasDoDefeito(),
      "ikcous-mapa.exemplo",
      "/sitemap.xml",
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe(
      "application/xml; charset=utf-8",
    );
    expect(resp.headers.get("x-ikcous-mapa")).toBe("completo");
    expect(urlsDoSitemap(corpo)).toEqual([
      "https://ikcous-mapa.exemplo/",
      "https://ikcous-mapa.exemplo/?view=cart",
      "https://ikcous-mapa.exemplo/?view=favorites",
      "https://ikcous-mapa.exemplo/?view=orders",
      ...IDS_IKCOUS.map(
        (id) => `https://ikcous-mapa.exemplo/product-detail?id=${id}`,
      ),
    ]);
    expect(corpo).toBe(sitemapXml("https://ikcous-mapa.exemplo", IDS_IKCOUS));
  });

  it("host da Savy: só produtos da Savy, lidos do banco DA SAVY, e nada da IKCOUS no texto", async () => {
    const chamadas: string[] = [];
    const { resp, corpo } = await pedir(
      lojasDoDefeito(),
      "savy-mapa.exemplo",
      "/sitemap.xml",
      { chamadas },
    );
    expect(resp.status).toBe(200);
    expect(urlsDoSitemap(corpo)).toEqual([
      "https://savy-mapa.exemplo/",
      "https://savy-mapa.exemplo/?view=cart",
      "https://savy-mapa.exemplo/?view=favorites",
      "https://savy-mapa.exemplo/?view=orders",
      ...IDS_SAVY.map(
        (id) => `https://savy-mapa.exemplo/product-detail?id=${id}`,
      ),
    ]);
    for (const idDaOutra of IDS_IKCOUS) expect(corpo).not.toContain(idDaOutra);
    expect(corpo).not.toContain("ikcous");
    expect(corpo).not.toContain("ickous");
    // O banco da IKCOUS nem foi consultado para atender a Savy.
    const bancoDaIkcous = new URL(origemDe("ikcous")).origin;
    expect(chamadas.filter((c) => c.startsWith(bancoDaIkcous))).toEqual([]);
    expect(
      chamadas.filter(
        (c) => c === `${origemDe("savy")}/rest/v1/vw_produtos_public`,
      ),
    ).toHaveLength(1);
  });

  it("intercalar os dois hosts (cache por host quente) nunca mistura os mapas", async () => {
    const lojas = lojasDoDefeito();
    const hosts = [
      "ikcous-mapa.exemplo",
      "savy-mapa.exemplo",
      "ikcous-mapa.exemplo",
      "savy-mapa.exemplo",
    ];
    for (const host of hosts) {
      const { corpo } = await pedir(lojas, host, "/sitemap.xml");
      const meus = host.startsWith("savy") ? IDS_SAVY : IDS_IKCOUS;
      const alheios = host.startsWith("savy") ? IDS_IKCOUS : IDS_SAVY;
      for (const id of meus) expect(corpo).toContain(`id=${id}`);
      for (const id of alheios) expect(corpo).not.toContain(id);
      expect(
        urlsDoSitemap(corpo).every((u) => u.startsWith(`https://${host}/`)),
      ).toBe(true);
    }
  });

  it("dois pedidos SIMULTÂNEOS, um por loja, cada um recebe o mapa da sua", async () => {
    const lojas = lojasDoDefeito().map((l, i) => ({
      ...l,
      host: `conc-${l.host}`,
      origem: origemDe(`conc${i}`),
    }));
    const [a, b] = await Promise.all([
      pedir(lojas, lojas[0].host, "/sitemap.xml"),
      pedir(lojas, lojas[1].host, "/sitemap.xml"),
    ]);
    expect(a.corpo).toBe(sitemapXml(`https://${lojas[0].host}`, IDS_IKCOUS));
    expect(b.corpo).toBe(sitemapXml(`https://${lojas[1].host}`, IDS_SAVY));
  });

  it("catálogo grande: pagina por keyset (3 consultas para 2500 produtos) e entrega todos", async () => {
    const ids = Array.from(
      { length: 2500 },
      (_, i) => `p-${String(i).padStart(5, "0")}`,
    );
    const chamadas: string[] = [];
    const loja: LojaDuble = {
      host: "grande-mapa.exemplo",
      nome: "Loja Grande",
      origem: origemDe("grande"),
      produtos: { tipo: "ids", ids },
    };
    const { resp, corpo } = await pedir([loja], loja.host, "/sitemap.xml", {
      chamadas,
    });
    expect(resp.status).toBe(200);
    expect(
      chamadas.filter((c) => c.endsWith("/vw_produtos_public")),
    ).toHaveLength(3);
    expect(urlsDoSitemap(corpo)).toHaveLength(4 + 2500);
    expect(corpo).toContain("id=p-02499");
  });

  it("id de produto hostil sai codificado, nunca fecha o <loc>", async () => {
    const loja: LojaDuble = {
      host: "hostil-mapa.exemplo",
      nome: "Loja Hostil",
      origem: origemDe("hostil"),
      produtos: { tipo: "ids", ids: ["</loc><x>&\"'"] },
    };
    const { corpo } = await pedir([loja], loja.host, "/sitemap.xml");
    expect(corpo).not.toContain("<x>");
    expect(corpo).toContain(
      `https://hostil-mapa.exemplo/product-detail?id=${encodeURIComponent("</loc><x>&\"'")}`,
    );
  });

  it("host com ponto final (FQDN) sai sem o ponto no endereço do mapa", async () => {
    const loja: LojaDuble = {
      host: "fqdn-mapa.exemplo",
      nome: "Loja Fqdn",
      origem: origemDe("fqdn"),
      produtos: { tipo: "ids", ids: ["f-1"] },
    };
    const { resp, corpo } = await pedir(
      [loja],
      "fqdn-mapa.exemplo.",
      "/robots.txt",
    );
    expect(resp.status).toBe(200);
    expect(corpo).toBe(robotsTxt("https://fqdn-mapa.exemplo"));
    const s = await pedir([loja], "fqdn-mapa.exemplo.", "/sitemap.xml");
    expect(s.corpo).toContain(
      "https://fqdn-mapa.exemplo/product-detail?id=f-1",
    );
    expect(s.corpo).not.toContain("exemplo./");
  });
});

describe("sitemap.xml — a leitura dos produtos falha: só as URLs estáticas DA MESMA loja", () => {
  it.each([
    ["banco responde 500", { tipo: "status", status: 500 }],
    ["banco responde 401 (chave recusada)", { tipo: "status", status: 401 }],
    ["rede cai", { tipo: "lanca" }],
    ["corpo que não é JSON", { tipo: "torto" }],
  ] as const)(
    "%s -> 200 com as 4 estáticas da Savy, sem produto, sem nada da IKCOUS, sem cache",
    async (rotulo, produtos) => {
      const lojas = lojasDoDefeito();
      const savy = lojas[1];
      savy.produtos = produtos;
      savy.host = `falha-${rotulo.length}-${savy.host}`;
      savy.origem = origemDe(`falha${rotulo.length}`);
      const { resp, corpo } = await pedir(lojas, savy.host, "/sitemap.xml");
      expect(resp.status).toBe(200);
      expect(resp.headers.get("x-ikcous-mapa")).toBe("estatico");
      expect(resp.headers.get("cache-control")).toBe("no-store");
      expect(urlsDoSitemap(corpo)).toEqual([
        `https://${savy.host}/`,
        `https://${savy.host}/?view=cart`,
        `https://${savy.host}/?view=favorites`,
        `https://${savy.host}/?view=orders`,
      ]);
      expect(corpo).not.toContain("product-detail");
      expect(corpo).not.toContain("ikcous");
      for (const id of IDS_IKCOUS) expect(corpo).not.toContain(id);
    },
  );

  it("banco que PENDURA para sempre: o robô recebe as estáticas dentro do prazo, não fica esperando", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      const loja: LojaDuble = {
        host: "pendura-mapa.exemplo",
        nome: "Loja Pendura",
        origem: origemDe("pendura"),
        produtos: { tipo: "pendura" },
      };
      let terminou = false;
      const promessa = pedir([loja], loja.host, "/sitemap.xml").finally(() => {
        terminou = true;
      });
      // O temporizador do prazo só nasce depois da ficha (várias esperas de
      // microtarefa): avança o relógio aos poucos até a resposta sair. Se o
      // prazo não existisse, o laço esgotaria as voltas e o teste falharia.
      for (let volta = 0; volta < 30 && !terminou; volta++)
        await vi.advanceTimersByTimeAsync(1_000);
      expect(terminou).toBe(true);
      const { resp, corpo } = await promessa;
      expect(resp.status).toBe(200);
      expect(resp.headers.get("x-ikcous-mapa")).toBe("estatico");
      expect(urlsDoSitemap(corpo)).toHaveLength(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a falha de uma loja não derruba a vizinha: a IKCOUS continua completa", async () => {
    const lojas = lojasDoDefeito().map((l, i) => ({
      ...l,
      host: `viz-${l.host}`,
      origem: origemDe(`viz${i}`),
    }));
    lojas[1].produtos = { tipo: "lanca" };
    const savy = await pedir(lojas, lojas[1].host, "/sitemap.xml");
    const ikcous = await pedir(lojas, lojas[0].host, "/sitemap.xml");
    expect(savy.resp.headers.get("x-ikcous-mapa")).toBe("estatico");
    expect(ikcous.resp.headers.get("x-ikcous-mapa")).toBe("completo");
    expect(urlsDoSitemap(ikcous.corpo)).toHaveLength(4 + IDS_IKCOUS.length);
  });
});

describe("host que não é loja confirmada: mesma resposta do documento, nunca o mapa de outra", () => {
  it("host desconhecido da caderneta (miss) -> 503 sem-loja nos DOIS caminhos, sem produto e sem ler banco nenhum", async () => {
    const chamadas: string[] = [];
    for (const caminho of ["/robots.txt", "/sitemap.xml"]) {
      const { resp, corpo } = await pedir(
        lojasDoDefeito(),
        "ninguem-mapa.exemplo",
        caminho,
        { chamadas },
      );
      expect(resp.status).toBe(503);
      expect(resp.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
      expect(resp.headers.get("x-ikcous-caderneta")).toBe("miss");
      expect(corpo).toContain("manutenção");
      for (const id of [...IDS_IKCOUS, ...IDS_SAVY])
        expect(corpo).not.toContain(id);
      expect(corpo).not.toContain("Sitemap:");
    }
    expect(chamadas.some((c) => c.endsWith("/vw_produtos_public"))).toBe(false);
  });

  it("caderneta aponta o host A para o banco de B (discorda) -> 503, sem o mapa de B", async () => {
    const lojas = lojasDoDefeito();
    // `loja-a` pergunta a caderneta, que devolve o banco da Savy; mas o banco
    // da Savy só é dona de `savy-mapa.exemplo`.
    const fetchTroca = (async (input, init) => {
      const url = requestUrl(input);
      if (url.pathname === "/rest/v1/rpc/resolver_loja")
        return json([
          {
            supabase_url: lojas[1].origem,
            publishable_key: "sb_publishable_savy",
          },
        ]);
      return criarFetchDeLojas(lojas)(input, init);
    }) as typeof fetch;
    const resp = await comProcessEnv(ENV_FROTA, () =>
      comFetch(fetchTroca, () =>
        middleware(new Request("https://loja-a-mapa.exemplo/sitemap.xml")),
      ),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("discorda");
    const corpo = await resp.text();
    for (const id of IDS_SAVY) expect(corpo).not.toContain(id);
  });

  it("alias *.vercel.app em produção -> 308 para o domínio da loja, no MESMO caminho (como o documento)", async () => {
    const loja: LojaDuble = {
      host: "ickous-marketplace.vercel.app",
      nome: "IKCOUS",
      origem: origemDe("alias"),
      produtos: { tipo: "ids", ids: IDS_IKCOUS },
    };
    for (const caminho of ["/robots.txt", "/sitemap.xml"]) {
      // O alias pergunta à caderneta pelo PRÓPRIO host; o dublê o mapeia para a
      // loja, mas o `dominio_publico` dela é outro -> "encaminha".
      const fetchAlias = (async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/rest/v1/rpc/resolver_loja")
          return json([
            {
              supabase_url: loja.origem,
              publishable_key: "sb_publishable_alias",
            },
          ]);
        return criarFetchDeLojas([loja])(input, init);
      }) as typeof fetch;
      const resp = await comProcessEnv(
        { ...ENV_FROTA, VERCEL_ENV: "production" },
        () =>
          comFetch(fetchAlias, () =>
            middleware(
              new Request(
                `https://ickous-marketplace-git-main-abc.vercel.app${caminho}`,
              ),
            ),
          ),
      );
      expect(resp.status).toBe(308);
      expect(resp.headers.get("location")).toBe(
        `https://ickous-marketplace.vercel.app${caminho}`,
      );
      expect(resp.headers.get("cache-control")).toBe("no-store");
      expect(await resp.text()).toBe("");
    }
  });

  it("banco da loja fora e sem cache -> 503 banco-indisponivel (a mesma do documento), nunca 500 nem o mapa de outra", async () => {
    const loja: LojaDuble = {
      host: "fora-mapa.exemplo",
      nome: "Loja Fora",
      origem: origemDe("fora"),
      produtos: { tipo: "ids", ids: ["x-1"] },
      fichaFalha: true,
    };
    for (const caminho of ["/robots.txt", "/sitemap.xml"]) {
      const { resp } = await pedir([loja], loja.host, caminho);
      expect(resp.status).toBe(503);
      expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
    }
  });
});

describe("métodos e caminhos vizinhos", () => {
  it("HEAD é atendido como GET; POST é pass-through (como o documento)", async () => {
    const lojas = lojasDoDefeito();
    const head = await pedir(lojas, "savy-mapa.exemplo", "/robots.txt", {
      method: "HEAD",
    });
    expect(head.resp.status).toBe(200);
    expect(head.resp.headers.get("x-ikcous-porteiro")).toBe("ok");
    const post = await pedir(lojas, "savy-mapa.exemplo", "/sitemap.xml", {
      method: "POST",
    });
    expect(post.resp.headers.get("x-middleware-next")).toBe("1");
  });

  it("caminho parecido (/robots.txt.bak, /sitemap.xml/x, /sitemap-1.xml) continua sendo documento, não mapa", async () => {
    for (const caminho of [
      "/robots.txt.bak",
      "/sitemap.xml/x",
      "/sitemap-1.xml",
    ]) {
      const lojas = lojasDoDefeito();
      const chamadas: string[] = [];
      const html = "<!DOCTYPE html><html><head></head><body>app</body></html>";
      const fetchComDocumento = (async (input, init) => {
        const url = requestUrl(input);
        if (url.pathname === "/index.html") return new Response(html);
        return criarFetchDeLojas(lojas, chamadas)(input, init);
      }) as typeof fetch;
      const resp = await comProcessEnv(ENV_FROTA, () =>
        comFetch(fetchComDocumento, () =>
          middleware(new Request(`https://savy-mapa.exemplo${caminho}`)),
        ),
      );
      expect(resp.headers.get("content-type")).toContain("text/html");
      expect(resp.headers.get("x-ikcous-mapa")).toBeNull();
    }
  });
});

// ─── cache e relógio: `atenderPorteiro` direto, com `agora` e `cacheMapa` ───
describe("cache curto do sitemap, com stale-if-error e SEM vazar entre lojas", () => {
  const ambiente = {
    ...ENV_LIMPO,
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_projeto",
  };

  function montar(loja: LojaDuble) {
    const chamadas: string[] = [];
    const cache = new Map();
    const cacheMapa = new Map<string, EntradaCacheMapa>();
    let agora = 1_000_000;
    const fetchImpl = criarFetchDeLojas([loja], chamadas);
    const ler = async (caminho = "/sitemap.xml") => {
      const resp = await atenderPorteiro(
        new Request(`https://${loja.host}${caminho}`),
        { ...ambiente, VITE_SUPABASE_URL: loja.origem },
        { fetchImpl, cache, cacheMapa, agora: () => agora },
      );
      return { resp, corpo: await resp.text() };
    };
    const produtosLidos = () =>
      chamadas.filter((c) => c.endsWith("/vw_produtos_public")).length;
    return {
      ler,
      produtosLidos,
      cacheMapa,
      avancar: (ms: number) => {
        agora += ms;
      },
    };
  }

  it("dentro do prazo fresco o banco de produtos NÃO é consultado de novo; depois dele, é", async () => {
    const loja: LojaDuble = {
      host: "cache-mapa.exemplo",
      nome: "Loja Cache",
      origem: origemDe("cache"),
      produtos: { tipo: "ids", ids: ["c-1", "c-2"] },
    };
    const t = montar(loja);
    const primeira = await t.ler();
    expect(primeira.resp.headers.get("x-ikcous-mapa")).toBe("completo");
    expect(t.produtosLidos()).toBe(1);
    t.avancar(CACHE_MAPA_FRESCO_MS - 1);
    const segunda = await t.ler();
    expect(segunda.corpo).toBe(primeira.corpo);
    expect(t.produtosLidos()).toBe(1);
    // Produto novo no banco só aparece depois do prazo fresco.
    loja.produtos = { tipo: "ids", ids: ["c-1", "c-2", "c-3"] };
    t.avancar(2);
    const terceira = await t.ler();
    expect(t.produtosLidos()).toBe(2);
    expect(terceira.corpo).toContain("id=c-3");
  });

  it("banco cai DEPOIS de ter respondido: serve o último mapa bom da MESMA loja (stale) até o teto; passado o teto, só as estáticas", async () => {
    const loja: LojaDuble = {
      host: "stale-mapa.exemplo",
      nome: "Loja Stale",
      origem: origemDe("stale"),
      produtos: { tipo: "ids", ids: ["s-1"] },
    };
    const t = montar(loja);
    const boa = await t.ler();
    expect(boa.corpo).toContain("id=s-1");
    loja.produtos = { tipo: "status", status: 500 };

    t.avancar(CACHE_MAPA_FRESCO_MS + 1);
    const velha = await t.ler();
    expect(velha.resp.status).toBe(200);
    expect(velha.resp.headers.get("x-ikcous-mapa")).toBe("stale");
    expect(velha.corpo).toBe(boa.corpo);

    t.avancar(CACHE_MAPA_STALE_MAX_MS);
    const vencida = await t.ler();
    expect(vencida.resp.headers.get("x-ikcous-mapa")).toBe("estatico");
    expect(vencida.corpo).not.toContain("product-detail");
  });

  it("o mapa em cache de uma loja NUNCA é servido por outra (cache chaveado por domínio + banco)", async () => {
    const cacheMapa = new Map<string, EntradaCacheMapa>();
    const cache = new Map();
    const lojas: LojaDuble[] = [
      {
        host: "um-mapa.exemplo",
        nome: "Loja Um",
        origem: origemDe("um"),
        produtos: { tipo: "ids", ids: ["u-1"] },
      },
      {
        host: "dois-mapa.exemplo",
        nome: "Loja Dois",
        origem: origemDe("dois"),
        produtos: { tipo: "ids", ids: ["d-1"] },
      },
    ];
    const ler = async (loja: LojaDuble) => {
      const resp = await atenderPorteiro(
        new Request(`https://${loja.host}/sitemap.xml`),
        {
          ...ENV_LIMPO,
          VITE_SUPABASE_URL: loja.origem,
          VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_projeto",
        },
        { fetchImpl: criarFetchDeLojas(lojas), cache, cacheMapa },
      );
      return resp.text();
    };
    const um = await ler(lojas[0]);
    const dois = await ler(lojas[1]);
    expect(um).toContain("id=u-1");
    expect(um).not.toContain("d-1");
    expect(dois).toContain("id=d-1");
    expect(dois).not.toContain("u-1");
    expect([...cacheMapa.keys()].sort()).toEqual([
      `dois-mapa.exemplo|${lojas[1].origem}`,
      `um-mapa.exemplo|${lojas[0].origem}`,
    ]);
  });

  it("o MESMO domínio que muda de banco nunca serve os ids do banco antigo (a chave inclui o banco)", async () => {
    const cacheMapa = new Map<string, EntradaCacheMapa>();
    // Um só dublê, mutado entre as leituras: o domínio é o mesmo, o banco troca.
    const loja: LojaDuble = {
      host: "migrou-mapa.exemplo",
      nome: "Loja Que Migrou",
      origem: origemDe("antiga"),
      produtos: { tipo: "ids", ids: ["antigo-1"] },
    };
    const chamadas: string[] = [];
    const ler = async () => {
      const resp = await atenderPorteiro(
        new Request(`https://${loja.host}/sitemap.xml`),
        {
          ...ENV_LIMPO,
          VITE_SUPABASE_URL: loja.origem,
          VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_projeto",
        },
        {
          fetchImpl: criarFetchDeLojas([loja], chamadas),
          // Ficha nova a cada leitura: só o cache do MAPA persiste, que é o
          // que está sob teste (a ficha em si já tem teste próprio).
          cache: new Map(),
          cacheMapa,
          agora: () => 1_000_000,
        },
      );
      return resp.text();
    };
    expect(await ler()).toContain("id=antigo-1");
    loja.origem = origemDe("novabase");
    loja.produtos = { tipo: "ids", ids: ["novo-1"] };
    const depois = await ler();
    expect(depois).toContain("id=novo-1");
    expect(depois).not.toContain("antigo-1");
    expect(chamadas).toContain(`${loja.origem}/rest/v1/vw_produtos_public`);
    expect(cacheMapa.size).toBe(2);
  });

  it("porta e protocolo NÃO entram na chave: os ids são reaproveitados e o XML sai com o endereço de quem pediu", async () => {
    const loja: LojaDuble = {
      host: "porta-mapa.exemplo",
      nome: "Loja Porta",
      origem: origemDe("porta"),
      produtos: { tipo: "ids", ids: ["p-1"] },
    };
    const chamadas: string[] = [];
    const cacheMapa = new Map<string, EntradaCacheMapa>();
    const cache = new Map();
    const ler = async (base: string) => {
      const resp = await atenderPorteiro(
        new Request(`${base}/sitemap.xml`),
        {
          ...ENV_LIMPO,
          VITE_SUPABASE_URL: loja.origem,
          VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_projeto",
        },
        {
          fetchImpl: criarFetchDeLojas([loja], chamadas),
          cache,
          cacheMapa,
          agora: () => 1_000_000,
        },
      );
      return resp.text();
    };
    const https = await ler(`https://${loja.host}`);
    const local = await ler(`http://${loja.host}:8080`);
    expect(https).toContain(`https://${loja.host}/`);
    expect(local).toContain(`http://${loja.host}:8080/`);
    expect(local).toContain("id=p-1");
    expect(cacheMapa.size).toBe(1);
    expect(
      chamadas.filter((c) => c.endsWith("/vw_produtos_public")),
    ).toHaveLength(1);
  });

  it("sem cacheMapa injetado (teste ou chamada avulsa) funciona, só sem memória", async () => {
    const loja: LojaDuble = {
      host: "semcache-mapa.exemplo",
      nome: "Loja Sem Cache",
      origem: origemDe("semcache"),
      produtos: { tipo: "ids", ids: ["n-1"] },
    };
    const chamadas: string[] = [];
    const deps = {
      fetchImpl: criarFetchDeLojas([loja], chamadas),
      cache: new Map(),
    };
    const amb = {
      ...ambiente,
      VITE_SUPABASE_URL: loja.origem,
    };
    for (let i = 0; i < 2; i++) {
      const resp = await atenderPorteiro(
        new Request(`https://${loja.host}/sitemap.xml`),
        amb,
        deps,
      );
      expect(await resp.text()).toContain("id=n-1");
    }
    expect(
      chamadas.filter((c) => c.endsWith("/vw_produtos_public")),
    ).toHaveLength(2);
  });
});
