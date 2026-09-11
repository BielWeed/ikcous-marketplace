// Fluxo ponta a ponta de `atenderPorteiro`, com `fetch` dublê (nunca rede de
// verdade) — os testes obrigatórios (1)-(6) do brief T3. O teste (7) mora em
// `porteiro-ficha.test.ts`/`porteiro-injecao-html.test.ts`, e o (8) é o
// `deno test` sobre `middleware.ts` (colado no relatório da tarefa).
import { afterEach, describe, expect, it, vi } from "vitest";

import { atenderPorteiro } from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  DependenciasPorteiro,
  EntradaCachePorteiro,
  ResolverLojaNaCaderneta,
} from "@/hospedagem/porteiro";

const HTML_ASSADO = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Loja Fixture | Lugar Nenhum</title>
<meta name="description" content="Produtos e novidades de Loja Fixture" />
<meta name="theme-color" content="#000000" />
<style id="dynamic-branding-style">:root {--primary-color:#000000;}</style>
</head>
<body>
<div class="cinematic-text">Loja Fixture</div>
</body>
</html>`;

const MANIFEST_ASSADO = {
  name: "IKCOUS Marketplace",
  short_name: "IKCOUS",
  description: "loja de ninguém",
  theme_color: "#000000",
  background_color: "#000000",
  icons: [
    {
      src: "/store-identity/fixture/icon-192.png",
      sizes: "192x192",
      type: "image/png",
    },
    {
      src: "/store-identity/fixture/icon-512.png",
      sizes: "512x512",
      type: "image/png",
    },
    {
      src: "/store-identity/fixture/maskable.png",
      sizes: "512x512",
      type: "image/png",
      purpose: "maskable",
    },
  ],
};

function linhaFixture(nome: string, primary: string, origin: string) {
  const hash = "a".repeat(64);
  const asset = (arquivo: string, largura: number, altura: number) => ({
    path: `v1/${hash}/${arquivo}.png`,
    sha256: hash,
    media_type: "image/png",
    bytes: 100,
    width: largura,
    height: altura,
  });
  const header = asset("header", 64, 64);
  return {
    store_name: nome,
    store_city: null,
    store_state: null,
    logo_url: `${origin}/storage/v1/object/public/branding/${header.path}`,
    primary_color: primary,
    secondary_color: "#654321",
    accent_color: "#ABCDEF",
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

interface BancoFake {
  readonly linha: ReturnType<typeof linhaFixture>;
  readonly dominioPublico: string | null;
}

function criarFetchDuble(
  bancos: Record<string, BancoFake>,
  opcoes: { bancoIndisponivel?: string[] } = {},
): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/index.html")
      return new Response(HTML_ASSADO, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    if (url.pathname === "/manifest.webmanifest")
      return new Response(JSON.stringify(MANIFEST_ASSADO), {
        status: 200,
        headers: { "content-type": "application/manifest+json" },
      });
    if (url.pathname === "/rest/v1/v_store_config") {
      const banco = bancos[url.origin];
      if (!banco || opcoes.bancoIndisponivel?.includes(url.origin))
        return new Response("erro", { status: 500 });
      const select = url.searchParams.get("select");
      if (select === "dominio_publico") {
        return new Response(
          JSON.stringify([{ dominio_publico: banco.dominioPublico }]),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      return new Response(JSON.stringify([banco.linha]), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`URL não mapeada no dublê de teste: ${url.toString()}`);
  }) as typeof fetch;
}

function pedido(host: string, path = "/", init: RequestInit = {}): Request {
  return new Request(`https://${host}${path}`, init);
}

function deps(
  fetchImpl: typeof fetch,
  extra: Partial<DependenciasPorteiro> = {},
): DependenciasPorteiro {
  return {
    fetchImpl,
    cache: new Map<string, EntradaCachePorteiro>(),
    ...extra,
  };
}

describe("atenderPorteiro — host A e host B, mesmo HTML assado (teste obrigatório 1)", () => {
  it("devolvem duas fichas diferentes, dois <style> diferentes, título diferente", async () => {
    const origemA = "https://projetoaaaaaaaaaaaaa.supabase.co";
    const origemB = "https://projetobbbbbbbbbbbbb.supabase.co";
    const fetchImpl = criarFetchDuble({
      [origemA]: {
        linha: linhaFixture("Loja A", "#111111", origemA),
        dominioPublico: "loja-a.exemplo",
      },
      [origemB]: {
        linha: linhaFixture("Loja B", "#222222", origemB),
        dominioPublico: "loja-b.exemplo",
      },
    });
    const ambienteA: AmbientePorteiro = {
      VITE_SUPABASE_URL: origemA,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
    };
    const ambienteB: AmbientePorteiro = {
      VITE_SUPABASE_URL: origemB,
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_b",
    };
    const respA = await atenderPorteiro(
      pedido("loja-a.exemplo"),
      ambienteA,
      deps(fetchImpl),
    );
    const respB = await atenderPorteiro(
      pedido("loja-b.exemplo"),
      ambienteB,
      deps(fetchImpl),
    );
    expect(respA.status).toBe(200);
    expect(respB.status).toBe(200);
    const htmlA = await respA.text();
    const htmlB = await respB.text();
    expect(htmlA).toContain("<title>Loja A</title>");
    expect(htmlB).toContain("<title>Loja B</title>");
    expect(htmlA).toContain("--primary-color:#111111");
    expect(htmlB).toContain("--primary-color:#222222");
    expect(htmlA).not.toBe(htmlB);
    expect(respA.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(respA.headers.get("cache-control")).toBe("no-store");
    expect(respA.headers.get("vary")).toBe("host");
    // Achado 5 da revisão: sem este cabeçalho, "o porteiro rodou" e "o
    // matcher foi ignorado e a Vercel serviu o index.html assado direto"
    // produzem respostas indistinguíveis — é o mesmo instrumento que
    // `x-ikcous-og` já é no ramo de robô (middleware.ts:131-134).
    expect(respA.headers.get("x-ikcous-porteiro")).toBe("ok");
    expect(respB.headers.get("x-ikcous-porteiro")).toBe("ok");
  });
});

describe("atenderPorteiro — host desconhecido (teste obrigatório 2)", () => {
  it("503 com x-ikcous-porteiro: sem-loja", async () => {
    const resp = await atenderPorteiro(
      pedido("host-que-nao-existe.exemplo"),
      {},
      deps(criarFetchDuble({})),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
    expect(resp.headers.get("retry-after")).toBe("60");
  });
});

describe("atenderPorteiro — teste negativo central: banco de A diz dominio_publico de B (teste obrigatório 3)", () => {
  it("503 discorda, e o corpo NÃO contém nenhum byte da ficha de A", async () => {
    const origemA = "https://projetoaaaaaaaaaaaaa.supabase.co";
    const fetchImpl = criarFetchDuble({
      [origemA]: {
        linha: linhaFixture("Loja Secreta A", "#111111", origemA),
        dominioPublico: "b.exemplo", // o banco de A afirma ser dono de B
      },
    });
    const resp = await atenderPorteiro(
      pedido("a.exemplo"),
      {
        VITE_SUPABASE_URL: origemA,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
      },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("discorda");
    const corpo = await resp.text();
    expect(corpo).not.toContain("projetoaaaaaaaaaaaaa.supabase.co");
    expect(corpo).not.toContain("sb_publishable_a");
    expect(corpo).not.toContain("Loja Secreta A");
  });
});

describe("atenderPorteiro — preview (teste obrigatório 4)", () => {
  const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
  const ambienteBase: AmbientePorteiro = {
    VITE_SUPABASE_URL: origem,
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
  };

  it("VERCEL_ENV=preview, host de deploy, banco concorda com VERCEL_PROJECT_PRODUCTION_URL -> ok", async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
      },
    });
    const resp = await atenderPorteiro(
      pedido("loja-a-git-branch-x.vercel.app"),
      {
        ...ambienteBase,
        VERCEL_ENV: "preview",
        VERCEL_PROJECT_PRODUCTION_URL: "a.exemplo",
      },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
  });

  it("mesmo cenário com VERCEL_ENV=production -> 503 discorda (host NÃO é .vercel.app para não cruzar com a regra do alias, rodada 11/09/2026)", async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
      },
    });
    const resp = await atenderPorteiro(
      pedido("loja-a-git-branch-x.exemplo"),
      {
        ...ambienteBase,
        VERCEL_ENV: "production",
        VERCEL_PROJECT_PRODUCTION_URL: "a.exemplo",
      },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("discorda");
  });
});

describe("atenderPorteiro — cache (teste obrigatório 5)", () => {
  const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
  const ambiente: AmbientePorteiro = {
    VITE_SUPABASE_URL: origem,
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
  };

  it("banco fora do ar sem cache -> 503 banco-indisponivel", async () => {
    const fetchImpl = criarFetchDuble(
      {
        [origem]: {
          linha: linhaFixture("Loja A", "#111111", origem),
          dominioPublico: "a.exemplo",
        },
      },
      { bancoIndisponivel: [origem] },
    );
    const resp = await atenderPorteiro(
      pedido("a.exemplo"),
      ambiente,
      deps(fetchImpl),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
  });

  it("com cache fresco (< 60s) -> serve do cache, mesmo com o banco fora do ar", async () => {
    let relogio = 0;
    const fetchOk = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
      },
    });
    const cache = new Map<string, EntradaCachePorteiro>();
    const primeira = await atenderPorteiro(pedido("a.exemplo"), ambiente, {
      fetchImpl: fetchOk,
      cache,
      agora: () => relogio,
    });
    expect(primeira.status).toBe(200);

    relogio = 30_000; // 30s depois, ainda fresco (< 60s)
    const fetchQuebrado = criarFetchDuble(
      {
        [origem]: {
          linha: linhaFixture("Loja A", "#111111", origem),
          dominioPublico: "a.exemplo",
        },
      },
      { bancoIndisponivel: [origem] },
    );
    const segunda = await atenderPorteiro(pedido("a.exemplo"), ambiente, {
      fetchImpl: fetchQuebrado,
      cache,
      agora: () => relogio,
    });
    expect(segunda.status).toBe(200);
    const html = await segunda.text();
    expect(html).toContain("Loja A");
  });

  it("com cache de 2h (> 1h) -> 503, o stale-if-error não cobre mais", async () => {
    let relogio = 0;
    const fetchOk = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
      },
    });
    const cache = new Map<string, EntradaCachePorteiro>();
    const primeira = await atenderPorteiro(pedido("a.exemplo"), ambiente, {
      fetchImpl: fetchOk,
      cache,
      agora: () => relogio,
    });
    expect(primeira.status).toBe(200);

    relogio = 2 * 60 * 60 * 1000; // 2h depois
    const fetchQuebrado = criarFetchDuble(
      {
        [origem]: {
          linha: linhaFixture("Loja A", "#111111", origem),
          dominioPublico: "a.exemplo",
        },
      },
      { bancoIndisponivel: [origem] },
    );
    const segunda = await atenderPorteiro(pedido("a.exemplo"), ambiente, {
      fetchImpl: fetchQuebrado,
      cache,
      agora: () => relogio,
    });
    expect(segunda.status).toBe(503);
    expect(segunda.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
  });
});

describe("atenderPorteiro — método e matcher (teste obrigatório 6)", () => {
  it("POST -> passthrough (x-middleware-next), nunca toca o banco", async () => {
    let chamouFetch = false;
    const fetchImpl: typeof fetch = async () => {
      chamouFetch = true;
      return new Response(null, { status: 500 });
    };
    const resp = await atenderPorteiro(
      pedido("a.exemplo", "/", { method: "POST" }),
      {},
      deps(fetchImpl),
    );
    expect(resp.headers.get("x-middleware-next")).toBe("1");
    expect(chamouFetch).toBe(false);
  });

  it("HEAD segue o mesmo caminho de GET (não é pass-through)", async () => {
    const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
      },
    });
    const resp = await atenderPorteiro(
      pedido("a.exemplo", "/", { method: "HEAD" }),
      {
        VITE_SUPABASE_URL: origem,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
      },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
  });
});

describe("atenderPorteiro — /identidade.json e /manifest.webmanifest", () => {
  const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
  const ambiente: AmbientePorteiro = {
    VITE_SUPABASE_URL: origem,
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
  };
  const fetchImpl = criarFetchDuble({
    [origem]: {
      linha: linhaFixture("Loja A", "#111111", origem),
      dominioPublico: "a.exemplo",
    },
  });

  it("/identidade.json devolve a MESMA ficha em application/json, cache-control no-store", async () => {
    const resp = await atenderPorteiro(
      pedido("a.exemplo", "/identidade.json"),
      ambiente,
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("content-type")).toBe(
      "application/json; charset=utf-8",
    );
    expect(resp.headers.get("cache-control")).toBe("no-store");
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("ok");
    const ficha = await resp.json();
    expect(ficha.host).toBe("a.exemplo");
    expect(ficha.identidade.identity.storeName).toBe("Loja A");
  });

  it("/manifest.webmanifest troca name/short_name/description/cores/ícones pela identidade do host", async () => {
    const resp = await atenderPorteiro(
      pedido("a.exemplo", "/manifest.webmanifest"),
      ambiente,
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("ok");
    const manifest = await resp.json();
    expect(manifest.name).toBe("Loja A");
    expect(manifest.short_name).toBe("Loja A");
    expect(manifest.theme_color).toBe("#111111");
    expect(manifest.icons).toHaveLength(3);
    expect(
      manifest.icons.every((icone: { src: string }) =>
        icone.src.startsWith(
          "https://projetoaaaaaaaaaaaaa.supabase.co/storage/",
        ),
      ),
    ).toBe(true);
  });

  // Achado 4 da revisão: `/manifest.webmanifest` está DENTRO do matcher
  // (`porteiro.ts:31-35`) — um self-fetch da própria origem para esse
  // MESMO caminho re-invocaria o porteiro, que cairia de novo no ramo do
  // manifest, que self-fetcharia de novo... recursão sem fundo (e, na
  // Vercel Edge, invocação cobrada em loop). `criarFetchDuble` não pegava
  // isto porque respondia `/manifest.webmanifest` direto, sem simular a
  // re-entrada em `atenderPorteiro` — este teste prova a AUSÊNCIA da
  // chamada, não o valor de uma resposta simulada.
  it("NUNCA se autoconsulta em /manifest.webmanifest — o manifest é montado só a partir da ficha", async () => {
    let chamouManifestProprio = false;
    const fetchQueDenunciaSelfFetch: typeof fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/manifest.webmanifest")
        chamouManifestProprio = true;
      return fetchImpl(input as any);
    };
    const resp = await atenderPorteiro(
      pedido("a.exemplo", "/manifest.webmanifest"),
      ambiente,
      deps(fetchQueDenunciaSelfFetch),
    );
    expect(resp.status).toBe(200);
    expect(chamouManifestProprio).toBe(false);
  });
});

describe("atenderPorteiro — publicUrl preserva protocolo e porta (rodada B, item 4)", () => {
  it("http://host:porta continua http://host:porta na ficha, nunca vira https fixo", async () => {
    const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "loja-a.localhost",
      },
    });
    const resp = await atenderPorteiro(
      new Request("http://loja-a.localhost:5555/identidade.json"),
      {
        VITE_SUPABASE_URL: origem,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
      },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
    const ficha = await resp.json();
    expect(ficha.identidade.publicUrl).toBe("http://loja-a.localhost:5555");
  });
});

describe("atenderPorteiro — publicUrl NÃO vem do cache (rodada C, T3c item 4)", () => {
  it("duas requisições ao mesmo hostname em PORTAS diferentes dentro de 60s -> cada uma com o próprio publicUrl", async () => {
    // A chave do cache continua sendo `normalizarHost(url)` (sem porta) —
    // então a SEGUNDA requisição abaixo é um cache HIT da ficha resolvida
    // pela primeira. Se `publicUrl` fosse parte do que fica congelado no
    // cache, a segunda resposta devolveria a porta da PRIMEIRA requisição
    // (5555), nunca a própria (6666). `publicUrl` é recalculado por
    // requisição a partir da `url` atendida, nunca lido do que está
    // guardado em `deps.cache`.
    const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
    let chamadasDeRede = 0;
    const fetchContado: typeof fetch = (async (input, init) => {
      chamadasDeRede++;
      return criarFetchDuble({
        [origem]: {
          linha: linhaFixture("Loja A", "#111111", origem),
          dominioPublico: "loja-a.localhost",
        },
      })(input as any, init as any);
    }) as typeof fetch;
    const cache = new Map<string, EntradaCachePorteiro>();

    const primeira = await atenderPorteiro(
      new Request("http://loja-a.localhost:5555/identidade.json"),
      {
        VITE_SUPABASE_URL: origem,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
      },
      { fetchImpl: fetchContado, cache },
    );
    expect(primeira.status).toBe(200);
    const fichaPrimeira = await primeira.json();
    expect(fichaPrimeira.identidade.publicUrl).toBe(
      "http://loja-a.localhost:5555",
    );
    const chamadasApósPrimeira = chamadasDeRede;
    expect(chamadasApósPrimeira).toBeGreaterThan(0);

    const segunda = await atenderPorteiro(
      new Request("http://loja-a.localhost:6666/identidade.json"),
      {
        VITE_SUPABASE_URL: origem,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
      },
      { fetchImpl: fetchContado, cache },
    );
    expect(segunda.status).toBe(200);
    const fichaSegunda = await segunda.json();
    // O ponto central: porta DIFERENTE, publicUrl DIFERENTE, mesmo servida
    // do cache (nenhuma chamada de rede nova abaixo).
    expect(fichaSegunda.identidade.publicUrl).toBe(
      "http://loja-a.localhost:6666",
    );
    expect(chamadasDeRede).toBe(chamadasApósPrimeira);
  });
});

describe("atenderPorteiro — x-ikcous-caderneta nunca fica silencioso (rodada B, item 1)", () => {
  it("sem as três variáveis da frota -> 'ausente' tanto em 200 quanto em 503", async () => {
    const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
      },
    });
    const respOk = await atenderPorteiro(
      pedido("a.exemplo"),
      {
        VITE_SUPABASE_URL: origem,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
      },
      deps(fetchImpl),
    );
    expect(respOk.status).toBe(200);
    expect(respOk.headers.get("x-ikcous-caderneta")).toBe("ausente");

    const resp503 = await atenderPorteiro(
      pedido("host-sem-loja.exemplo"),
      {},
      deps(criarFetchDuble({})),
    );
    expect(resp503.status).toBe(503);
    expect(resp503.headers.get("x-ikcous-caderneta")).toBe("ausente");
  });

  it("caderneta com hit -> 'hit' na resposta de sucesso", async () => {
    const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
      },
    });
    const cadernetaHit: ResolverLojaNaCaderneta = async () => ({
      tipo: "hit",
      conexao: {
        supabaseUrl: origem,
        publishableKey: "sb_publishable_a",
        origem: "caderneta",
      },
    });
    const resp = await atenderPorteiro(
      pedido("a.exemplo"),
      {
        IKCOUS_FROTA_URL: "https://principal.supabase.co",
        IKCOUS_FROTA_APIKEY: "sb_publishable_principal",
        IKCOUS_FROTA_CHAVE: "segredo",
      },
      deps(fetchImpl, { resolverNaCaderneta: cadernetaHit }),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("hit");
  });
});

describe("lerDominioPublico (via atenderPorteiro) — mesmo prazo e teto de bytes de readPublicStoreIdentity (rodada B, item 5)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("resposta pendurada no domínio público -> 503 banco-indisponivel DENTRO do prazo (10s simulados), nunca pendura o teste", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname !== "/rest/v1/v_store_config")
        throw new Error(`URL não mapeada no teste: ${url.toString()}`);
      if (url.searchParams.get("select") === "dominio_publico") {
        // Simula um transporte que nunca resolve nem observa o `signal` —
        // só o temporizador interno de `lerDominioPublico` pode desatar isto.
        return new Promise<Response>(() => undefined);
      }
      return new Response(
        JSON.stringify([linhaFixture("Loja A", "#111111", origem)]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const respostaPromise = atenderPorteiro(
      pedido("a.exemplo"),
      {
        VITE_SUPABASE_URL: origem,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
      },
      deps(fetchImpl),
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const resp = await respostaPromise;
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
  });

  it("resposta do domínio público maior que o teto (256 KiB) -> 503 banco-indisponivel", async () => {
    const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
    const linhaGigante = JSON.stringify([
      { dominio_publico: "a".repeat(300 * 1024) },
    ]);
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname !== "/rest/v1/v_store_config")
        throw new Error(`URL não mapeada no teste: ${url.toString()}`);
      if (url.searchParams.get("select") === "dominio_publico") {
        return new Response(linhaGigante, {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify([linhaFixture("Loja A", "#111111", origem)]),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as typeof fetch;

    const resp = await atenderPorteiro(
      pedido("a.exemplo"),
      {
        VITE_SUPABASE_URL: origem,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
      },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
  });
});
