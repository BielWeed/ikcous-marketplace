// Fluxo ponta a ponta de `atenderPorteiro`, com `fetch` dublê (nunca rede de
// verdade) — os testes obrigatórios (1)-(6) do brief T3. O teste (7) mora em
// `porteiro-ficha.test.ts`/`porteiro-injecao-html.test.ts`, e o (8) é o
// `deno test` sobre `middleware.ts` (colado no relatório da tarefa).
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  SELECT_CONFIGURACAO_PUBLICA,
  atenderPorteiro,
} from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  DependenciasPorteiro,
  EntradaCachePorteiro,
  ResolverLojaNaCaderneta,
} from "@/hospedagem/porteiro";

/** SÓ para o teste do item (d) da correção da variável mais curta da Vercel
 * (12/09/2026): representa o ambiente REAL que a Vercel injeta, que
 * continua trazendo `VERCEL_PROJECT_PRODUCTION_URL` mesmo depois de
 * `AmbientePorteiro` parar de declarar esse campo — o env de verdade do
 * fluxo, nunca só um parâmetro artificial de teste. */
type AmbienteComVariavelAntigaDaVercel = AmbientePorteiro & {
  readonly VERCEL_PROJECT_PRODUCTION_URL?: string;
};

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

interface ConfiguracaoFake {
  readonly mpPublicKey?: string | null;
  readonly vapidPublicKey?: string | null;
  readonly pagamentoOnline?: boolean;
  readonly manutencao?: boolean;
}

interface BancoFake {
  readonly linha: ReturnType<typeof linhaFixture>;
  readonly dominioPublico: string | null;
  readonly configuracao?: ConfiguracaoFake;
}

function linhaConfiguracaoPublica(banco: BancoFake): Record<string, unknown> {
  const cfg = banco.configuracao ?? {};
  return {
    dominio_publico: banco.dominioPublico,
    mp_public_key: cfg.mpPublicKey ?? null,
    vapid_public_key: cfg.vapidPublicKey ?? null,
    pagamento_online: cfg.pagamentoOnline ?? false,
    manutencao: cfg.manutencao ?? false,
  };
}

function criarFetchDuble(
  bancos: Record<string, BancoFake>,
  opcoes: { bancoIndisponivel?: string[]; omitirColuna?: string } = {},
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
      if (select === SELECT_CONFIGURACAO_PUBLICA) {
        const linha = linhaConfiguracaoPublica(banco);
        if (opcoes.omitirColuna) delete linha[opcoes.omitirColuna];
        return new Response(JSON.stringify([linha]), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
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

  it("VERCEL_ENV=preview, host de deploy, banco concorda com IKCOUS_DOMINIO_PRINCIPAL -> ok", async () => {
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
        IKCOUS_DOMINIO_PRINCIPAL: "a.exemplo",
      },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
  });

  it("mesmo cenário com VERCEL_ENV=production -> 308 para o dominio_publico, nunca a página (produção não ganha o relaxamento de preview; o alias cai na regra do encaminhamento, 11/09/2026)", async () => {
    // Par de variável ÚNICA com o teste acima: mesmo host, mesmo banco,
    // só VERCEL_ENV muda (revisão Opus, menor M3).
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
        VERCEL_ENV: "production",
        IKCOUS_DOMINIO_PRINCIPAL: "a.exemplo",
      },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(308);
    expect(resp.headers.get("location")).toBe("https://a.exemplo/");
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("encaminha");
  });

  // Item (d) da correção da variável mais curta da Vercel (12/09/2026,
  // medido na prévia do PR #545 com `savycollection.vercel.app`): prova
  // pelo FLUXO REAL (`atenderPorteiro`/`AmbientePorteiro`, nunca só pelos
  // parâmetros de `decidirConcordancia`) que a variável ANTIGA da Vercel
  // (`VERCEL_PROJECT_PRODUCTION_URL`, "o domínio de produção MAIS CURTO do
  // projeto" — que um projeto multi-loja pode devolver como o nome de
  // QUALQUER loja, não necessariamente a principal) deixou de ser lida.
  // `AmbienteComVariavelAntigaDaVercel` representa o env de verdade que a
  // Vercel injeta — que continua trazendo essa chave mesmo depois de
  // `AmbientePorteiro` parar de declará-la — para matar o mutante "o código
  // ainda lê a variável antiga".
  it("preview: VERCEL_PROJECT_PRODUCTION_URL (variável antiga da Vercel) bate com dominio_publico, mas SEM IKCOUS_DOMINIO_PRINCIPAL -> discorda (a variável antiga não é mais lida)", async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
      },
    });
    const ambienteComVariavelAntiga: AmbienteComVariavelAntigaDaVercel = {
      ...ambienteBase,
      VERCEL_ENV: "preview",
      VERCEL_PROJECT_PRODUCTION_URL: "a.exemplo",
    };
    const resp = await atenderPorteiro(
      pedido("loja-a-git-branch-x.vercel.app"),
      ambienteComVariavelAntiga,
      deps(fetchImpl),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("discorda");
  });

  // Achado 1 da rodada de correção (revisor Opus): `IKCOUS_DOMINIO_PRINCIPAL`
  // é digitada à mão no painel da Vercel — sem `cleanEnvVar`, um `\n` colado
  // (comum ao copiar/colar) faria TODA prévia responder 503, mesmo com o
  // valor "certo" por baixo.
  it("preview: IKCOUS_DOMINIO_PRINCIPAL com \\n colado (copiar/colar no painel da Vercel) -> ok, limpo antes da comparação", async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "ickous-marketplace.vercel.app",
      },
    });
    const resp = await atenderPorteiro(
      pedido("loja-a-git-branch-x.vercel.app"),
      {
        ...ambienteBase,
        VERCEL_ENV: "preview",
        IKCOUS_DOMINIO_PRINCIPAL: "ickous-marketplace.vercel.app\n",
      },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
  });

  it("preview: IKCOUS_DOMINIO_PRINCIPAL só de espaços -> 503 discorda (limpo vira vazio, vazio nunca conta como presente)", async () => {
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
        IKCOUS_DOMINIO_PRINCIPAL: "   ",
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
      if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA) {
        // Simula um transporte que nunca resolve nem observa o `signal` —
        // só o temporizador interno de `lerConfiguracaoPublica` pode
        // desatar isto.
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
      {
        dominio_publico: "a".repeat(300 * 1024),
        mp_public_key: null,
        vapid_public_key: null,
        pagamento_online: false,
        manutencao: false,
      },
    ]);
    const fetchImpl: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname !== "/rest/v1/v_store_config")
        throw new Error(`URL não mapeada no teste: ${url.toString()}`);
      if (url.searchParams.get("select") === SELECT_CONFIGURACAO_PUBLICA) {
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

describe("atenderPorteiro — configuração pública: select exato, coluna ausente, e a ficha carrega a configuração (T3, etapa 3)", () => {
  const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
  const ambiente: AmbientePorteiro = {
    VITE_SUPABASE_URL: origem,
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
  };

  it("teste obrigatório (a): o select pede EXATAMENTE as 5 colunas, nem mais nem menos", async () => {
    const selectsPedidos: string[] = [];
    const fetchQueRegistraSelect: typeof fetch = async (input) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/rest/v1/v_store_config") {
        const select = url.searchParams.get("select");
        if (select) selectsPedidos.push(select);
      }
      return criarFetchDuble({
        [origem]: {
          linha: linhaFixture("Loja A", "#111111", origem),
          dominioPublico: "a.exemplo",
        },
      })(input as any);
    };
    const resp = await atenderPorteiro(
      pedido("a.exemplo"),
      ambiente,
      deps(fetchQueRegistraSelect),
    );
    expect(resp.status).toBe(200);
    expect(selectsPedidos).toContain(SELECT_CONFIGURACAO_PUBLICA);
    expect(SELECT_CONFIGURACAO_PUBLICA.split(",").sort()).toEqual(
      [
        "dominio_publico",
        "mp_public_key",
        "vapid_public_key",
        "pagamento_online",
        "manutencao",
      ].sort(),
    );
  });

  it("teste obrigatório (b): linha sem mp_public_key (view antiga, migration não aplicada) -> 503 banco-indisponivel, no-store", async () => {
    const fetchImpl = criarFetchDuble(
      {
        [origem]: {
          linha: linhaFixture("Loja A", "#111111", origem),
          dominioPublico: "a.exemplo",
        },
      },
      { omitirColuna: "mp_public_key" },
    );
    const resp = await atenderPorteiro(
      pedido("a.exemplo"),
      ambiente,
      deps(fetchImpl),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
    expect(resp.headers.get("cache-control")).toBe("no-store");
  });

  it("teste obrigatório (b2): linha sem mp_public_key, mas com cache de 5 min -> 200 com a ficha velha (crítica do lote item 8: o stale-if-error cobre a migration atrasada, é isso que obriga 20261150 a ir ANTES do release — ADENDO A.7)", async () => {
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

    relogio = 5 * 60 * 1000; // 5 min depois: fora do fresco (60s), dentro do stale (1h)
    const fetchSemColuna = criarFetchDuble(
      {
        [origem]: {
          linha: linhaFixture("Loja A", "#111111", origem),
          dominioPublico: "a.exemplo",
        },
      },
      { omitirColuna: "mp_public_key" },
    );
    const segunda = await atenderPorteiro(pedido("a.exemplo"), ambiente, {
      fetchImpl: fetchSemColuna,
      cache,
      agora: () => relogio,
    });
    expect(segunda.status).toBe(200);
    const html = await segunda.text();
    expect(html).toContain("Loja A");
  });

  it("teste obrigatório (c): a ficha carrega `configuracao` idêntica à linha do banco — null e booleanos preservados", async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
        configuracao: {
          mpPublicKey: "APP_USR-1234",
          vapidPublicKey: null,
          pagamentoOnline: true,
          manutencao: false,
        },
      },
    });
    const resp = await atenderPorteiro(
      pedido("a.exemplo", "/identidade.json"),
      ambiente,
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
    const ficha = await resp.json();
    expect(ficha.schemaVersion).toBe(2);
    expect(ficha.configuracao).toEqual({
      mpPublicKey: "APP_USR-1234",
      vapidPublicKey: null,
      pagamentoOnline: true,
      manutencao: false,
    });
  });

  it("configuração toda desligada (null/false) — mesmo formato preservado", async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
      },
    });
    const resp = await atenderPorteiro(
      pedido("a.exemplo", "/identidade.json"),
      ambiente,
      deps(fetchImpl),
    );
    const ficha = await resp.json();
    expect(ficha.configuracao).toEqual({
      mpPublicKey: null,
      vapidPublicKey: null,
      pagamentoOnline: false,
      manutencao: false,
    });
  });

  // ADENDO A.5 ("falha por campo, não por loja"): `mp_public_key = ''` no
  // banco não pode fechar a loja INTEIRA. Sem a normalização em
  // `lerColunaChavePublicaOuNull` (porteiro.ts), o porteiro montaria a
  // ficha com `mpPublicKey: ''`, e `configuracaoValida`
  // (`src/config/fichaDaLoja.ts`, exige `length > 0`) reprovaria a ficha
  // inteira — `lerFichaDaLoja` lançaria `IDENTITY_FICHA_INVALID` e o app
  // inteiro cairia em manutenção por uma chave vazia, quando o combinado é
  // só desligar o pagamento (`pagamentoOnline` continua o que o banco diz,
  // sem relação com a normalização da chave).
  it('mp_public_key = "" no banco -> 200 com ficha válida e configuracao.mpPublicKey === null (pagamentoOnline continua o que o banco diz)', async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
        configuracao: {
          mpPublicKey: "",
          pagamentoOnline: true,
        },
      },
    });
    const resp = await atenderPorteiro(
      pedido("a.exemplo", "/identidade.json"),
      ambiente,
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
    const ficha = await resp.json();
    expect(ficha.configuracao).toEqual({
      mpPublicKey: null,
      vapidPublicKey: null,
      pagamentoOnline: true,
      manutencao: false,
    });
  });

  it('vapid_public_key = "   " (só espaços) no banco -> 200 com ficha válida e configuracao.vapidPublicKey === null', async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja A", "#111111", origem),
        dominioPublico: "a.exemplo",
        configuracao: {
          vapidPublicKey: "   ",
        },
      },
    });
    const resp = await atenderPorteiro(
      pedido("a.exemplo", "/identidade.json"),
      ambiente,
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
    const ficha = await resp.json();
    expect(ficha.configuracao).toEqual({
      mpPublicKey: null,
      vapidPublicKey: null,
      pagamentoOnline: false,
      manutencao: false,
    });
  });
});

describe("atenderPorteiro — caderneta CONFIGURADA: miss e chave anômala fecham NA HORA, erro de RPC herda o stale-if-error (ADENDO A.3 + ADENDO B.1, testes obrigatórios d/e/f)", () => {
  const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
  // O ambiente do PRÓPRIO PROJETO também está presente (como estaria na
  // Vercel de verdade, já que a principal SEMPRE tem VITE_SUPABASE_*) — é
  // isso que prova que miss/erro/chave-anômala NÃO caem nele quando a
  // frota está configurada: se caísse, este ambiente devolveria 200 com a
  // ficha da PRINCIPAL, nunca 503.
  const ambienteComFrotaEProjeto: AmbientePorteiro = {
    VITE_SUPABASE_URL: origem,
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
    IKCOUS_FROTA_URL: "https://principal.supabase.co",
    IKCOUS_FROTA_APIKEY: "sb_publishable_principal",
    IKCOUS_FROTA_CHAVE: "segredo",
  };
  const fetchImpl = criarFetchDuble({
    [origem]: {
      linha: linhaFixture("Loja Principal", "#111111", origem),
      dominioPublico: "a.exemplo",
    },
  });

  it("teste obrigatório (d): caderneta MISS -> 503 sem-loja, x-ikcous-caderneta: miss, NUNCA 308, NUNCA o banco do projeto", async () => {
    const cadernetaMiss: ResolverLojaNaCaderneta = async () => ({
      tipo: "miss",
    });
    const resp = await atenderPorteiro(
      pedido("host-desconhecido.exemplo"),
      ambienteComFrotaEProjeto,
      deps(fetchImpl, { resolverNaCaderneta: cadernetaMiss }),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("miss");
    const corpo = await resp.text();
    expect(corpo).not.toContain("Loja Principal");
  });

  // ADENDO B.1 (crítica do lote item 1, revisor Opus de T3): a versão A.3
  // ao pé da letra tratava `erro` (RPC da caderneta fora do ar) igual a
  // `miss` — mas a caderneta É o banco da PRINCIPAL, então isso derrubaria
  // TODAS as lojas 60s depois de uma queda simples dela. Os três testes
  // abaixo substituem o antigo teste obrigatório (e): `erro` de RPC NUNCA
  // vira `DecisaoPorteiro` — herda o stale-if-error igual a qualquer outra
  // falha de rede do porteiro.
  it("teste obrigatório (e1): caderneta ERRO com cache QUENTE (5 min, dentro da 1h de stale) -> 200 com a ficha antiga, x-ikcous-caderneta: erro (a loja conhecida sobrevive à queda da caderneta)", async () => {
    let relogio = 0;
    let chamadas = 0;
    const cadernetaOraHitOraErro: ResolverLojaNaCaderneta = async () => {
      chamadas += 1;
      if (chamadas === 1) {
        return {
          tipo: "hit",
          conexao: {
            supabaseUrl: origem,
            publishableKey: "sb_publishable_a",
            origem: "caderneta",
          },
        };
      }
      return { tipo: "erro" };
    };
    const cache = new Map<string, EntradaCachePorteiro>();
    const primeira = await atenderPorteiro(
      pedido("a.exemplo"),
      ambienteComFrotaEProjeto,
      {
        fetchImpl,
        cache,
        agora: () => relogio,
        resolverNaCaderneta: cadernetaOraHitOraErro,
      },
    );
    expect(primeira.status).toBe(200);
    expect(primeira.headers.get("x-ikcous-caderneta")).toBe("hit");

    relogio = 5 * 60 * 1000; // 5 min depois: fora do fresco (60s), dentro do stale (1h)
    const segunda = await atenderPorteiro(
      pedido("a.exemplo"),
      ambienteComFrotaEProjeto,
      {
        fetchImpl,
        cache,
        agora: () => relogio,
        resolverNaCaderneta: cadernetaOraHitOraErro,
      },
    );
    expect(segunda.status).toBe(200);
    expect(segunda.headers.get("x-ikcous-caderneta")).toBe("erro");
    const html = await segunda.text();
    expect(html).toContain("Loja Principal");
  });

  it("teste obrigatório (e2): caderneta ERRO sem cache quente -> 503 banco-indisponivel, x-ikcous-caderneta: erro (NUNCA sem-loja, NUNCA o banco do projeto)", async () => {
    const cadernetaErro: ResolverLojaNaCaderneta = async () => ({
      tipo: "erro",
    });
    const resp = await atenderPorteiro(
      pedido("a.exemplo"),
      ambienteComFrotaEProjeto,
      deps(fetchImpl, { resolverNaCaderneta: cadernetaErro }),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("banco-indisponivel");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("erro");
    const corpo = await resp.text();
    expect(corpo).not.toContain("Loja Principal");
  });

  it("teste obrigatório (e3): chave anômala devolvida pela caderneta (hit com papel que não é publishable/anon) -> 503 sem-loja, x-ikcous-caderneta: erro, NUNCA 308, NUNCA o banco do projeto (resposta anômala é DECISÃO, não falha de rede — fecha NA HORA, diferente de e1/e2)", async () => {
    const cadernetaChaveAnomala: ResolverLojaNaCaderneta = async () => ({
      tipo: "hit",
      conexao: {
        supabaseUrl: "https://frota-com-bug.supabase.co",
        publishableKey: "chave-service-role-nao-publica",
        origem: "caderneta",
      },
    });
    const resp = await atenderPorteiro(
      pedido("host-desconhecido.exemplo"),
      ambienteComFrotaEProjeto,
      deps(fetchImpl, { resolverNaCaderneta: cadernetaChaveAnomala }),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("erro");
    const corpo = await resp.text();
    expect(corpo).not.toContain("Loja Principal");
  });

  it("teste obrigatório (f): SEM as três variáveis da frota (ausente) -> cai no ambiente do projeto, como hoje", async () => {
    const resp = await atenderPorteiro(
      pedido("a.exemplo"),
      {
        VITE_SUPABASE_URL: origem,
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
      },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("ausente");
    const html = await resp.text();
    expect(html).toContain("Loja Principal");
  });
});
