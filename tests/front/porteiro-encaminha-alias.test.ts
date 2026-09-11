// T3d (encaminhamento de aliases *.vercel.app em produção, 11/09/2026): o
// porteiro passa a responder 308 para o `dominio_publico` da própria loja,
// em vez de 503 discorda, quando as quatro condições do brief
// (`20260911-brief-aliases-vercel-encaminham.md`) valem ao mesmo tempo.
// Mesmo estilo de dublê de `fetch` de `porteiro-fluxo.test.ts` (nunca rede
// de verdade).
import { describe, expect, it } from "vitest";

import { atenderPorteiro } from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  DependenciasPorteiro,
  EntradaCachePorteiro,
} from "@/hospedagem/porteiro";

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

function linhaFixture(nome: string, primary: string, origin: string) {
  const header = asset("header", 64, 64);
  return {
    store_name: nome,
    store_city: null,
    store_state: null,
    logo_url: `${origin}/storage/v1/object/public/branding/${header.path}`,
    primary_color: primary,
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

interface BancoFake {
  readonly linha: ReturnType<typeof linhaFixture>;
  readonly dominioPublico: string | null;
}

function criarFetchDuble(bancos: Record<string, BancoFake>): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.pathname === "/index.html")
      return new Response(
        "<!DOCTYPE html><html><head></head><body></body></html>",
        {
          status: 200,
          headers: { "content-type": "text/html; charset=utf-8" },
        },
      );
    if (url.pathname === "/rest/v1/v_store_config") {
      const banco = bancos[url.origin];
      if (!banco) return new Response("erro", { status: 500 });
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

function pedido(url: string, init: RequestInit = {}): Request {
  return new Request(url, init);
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

describe("atenderPorteiro — alias *.vercel.app em produção encaminha (308) para o dominio_publico", () => {
  const origem = "https://projetoaaaaaaaaaaaaa.supabase.co";
  const ambienteBase: AmbientePorteiro = {
    VITE_SUPABASE_URL: origem,
    VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_a",
  };
  const HOST_ALIAS = "ickous-marketplace-git-main-abc.vercel.app";
  const DOMINIO_PUBLICO = "ickous-marketplace.vercel.app";

  it("produção + alias + dominio_publico diferente -> 308 para o mesmo caminho e query no dominio_publico", async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja Principal", "#111111", origem),
        dominioPublico: DOMINIO_PUBLICO,
      },
    });
    const resp = await atenderPorteiro(
      pedido(`https://${HOST_ALIAS}/product-detail?id=7&x=1`),
      { ...ambienteBase, VERCEL_ENV: "production" },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(308);
    expect(resp.headers.get("location")).toBe(
      `https://${DOMINIO_PUBLICO}/product-detail?id=7&x=1`,
    );
    expect(resp.headers.get("cache-control")).toBe("no-store");
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("encaminha");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("ausente");
    const corpo = await resp.text();
    expect(corpo).toBe("");
  });

  it("mesmo pedido com VERCEL_ENV=preview -> 503 discorda (inalterado)", async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja Principal", "#111111", origem),
        dominioPublico: DOMINIO_PUBLICO,
      },
    });
    const resp = await atenderPorteiro(
      pedido(`https://${HOST_ALIAS}/product-detail?id=7&x=1`),
      { ...ambienteBase, VERCEL_ENV: "preview" },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(503);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("discorda");
  });

  it("mesmo host, mas dominio_publico igual ao host -> 200 com a ficha (sem redirect)", async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja Principal", "#111111", origem),
        dominioPublico: HOST_ALIAS,
      },
    });
    const resp = await atenderPorteiro(
      pedido(`https://${HOST_ALIAS}/product-detail?id=7&x=1`),
      { ...ambienteBase, VERCEL_ENV: "production" },
      deps(fetchImpl),
    );
    expect(resp.status).toBe(200);
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("ok");
  });

  it("o cache NÃO recebe entrada para o host encaminhado", async () => {
    const fetchImpl = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja Principal", "#111111", origem),
        dominioPublico: DOMINIO_PUBLICO,
      },
    });
    const cache = new Map<string, EntradaCachePorteiro>();
    const resp = await atenderPorteiro(
      pedido(`https://${HOST_ALIAS}/product-detail?id=7&x=1`),
      { ...ambienteBase, VERCEL_ENV: "production" },
      { fetchImpl, cache },
    );
    expect(resp.status).toBe(308);
    expect(cache.size).toBe(0);
    expect(cache.get(HOST_ALIAS.toLowerCase())).toBeUndefined();
  });

  it("ficha em cache STALE (fora dos 60s, dentro da 1h) NÃO vence o encaminhamento: dominio_publico mudou no banco -> 308, nunca a ficha velha", async () => {
    // Revisão Opus, menor M2: o `if (DecisaoEncaminhamento)` em
    // `obterFichaValidada` tem de vir ANTES do stale-if-error. Se alguém o
    // mover para depois, um host que já teve ficha em cache serviria a
    // página antiga (200) por até 1h em vez do 308.
    const cache = new Map<string, EntradaCachePorteiro>();
    let relogio = 0;
    const agora = () => relogio;
    // t=0: o host É o dominio_publico -> 200, popula o cache.
    const fetchAntes = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja Principal", "#111111", origem),
        dominioPublico: HOST_ALIAS,
      },
    });
    const primeira = await atenderPorteiro(
      pedido(`https://${HOST_ALIAS}/`),
      { ...ambienteBase, VERCEL_ENV: "production" },
      { fetchImpl: fetchAntes, cache, agora },
    );
    expect(primeira.status).toBe(200);
    expect(cache.size).toBe(1);
    // t=120s: cache fora do fresco (60s) e dentro do stale (1h); o banco
    // agora declara OUTRO dominio_publico.
    relogio = 120_000;
    const fetchDepois = criarFetchDuble({
      [origem]: {
        linha: linhaFixture("Loja Principal", "#111111", origem),
        dominioPublico: DOMINIO_PUBLICO,
      },
    });
    const segunda = await atenderPorteiro(
      pedido(`https://${HOST_ALIAS}/product-detail?id=7`),
      { ...ambienteBase, VERCEL_ENV: "production" },
      { fetchImpl: fetchDepois, cache, agora },
    );
    expect(segunda.status).toBe(308);
    expect(segunda.headers.get("location")).toBe(
      `https://${DOMINIO_PUBLICO}/product-detail?id=7`,
    );
    expect(segunda.headers.get("x-ikcous-porteiro")).toBe("encaminha");
  });
});
