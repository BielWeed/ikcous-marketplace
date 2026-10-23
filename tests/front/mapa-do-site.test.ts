// robots.txt e sitemap.xml POR LOJA, montados na borda (defeito
// multiloja-frota-3): o build compartilhado assava UM par de arquivos com o
// endereço e os produtos da loja principal e a Vercel o servia a todas as
// lojas. `src/hospedagem/mapaDoSite.ts` é a versão de borda do gerador do
// build (`scripts/sitemap.mjs`) — sem `node:fs`, e com falha SUAVE (quem chama
// decide o fallback) em vez do `throw` que reprova o build.
//
// O gerador do build é `.mjs` puro (não importa TypeScript) e este módulo é
// TypeScript sem extensão nos imports (o `middleware.ts` da Vercel não tem
// `allowImportingTsExtensions`): os dois não podem ser o MESMO arquivo. A
// defesa contra o desvio é este teste, que roda os dois lados com as mesmas
// entradas e exige saída idêntica, byte a byte.
import { describe, expect, it } from "vitest";

import {
  MAX_PRODUTOS_MAPA,
  PAGINA_MAPA,
  buscarIdsDosProdutos,
  cabecalhosDaConsulta,
  montarConsulta,
  robotsTxt,
  sitemapXml,
  urlDeProduto,
} from "@/hospedagem/mapaDoSite";

// Módulo JS sem declaração de tipos, mesmo padrão de sitemap-seo.test.ts.
// @ts-expect-error Módulo JS nativo sem declaração; confronto com o contrato TypeScript.
import * as build from "../../scripts/sitemap.mjs";

const ORIGEM = "https://loja-exemplo.vercel.app";
const SUPABASE = "https://abcdefghijklmnopqrst.supabase.co";
const CHAVE_PUBLICA = "sb_publishable_somente_teste";
// JWT legado com role=anon (cabeçalho.payload.assinatura) — só para classificar.
const CHAVE_LEGADA = `eyJhbGciOiJIUzI1NiJ9.${btoa(
  JSON.stringify({ role: "anon" }),
)
  .replaceAll("+", "-")
  .replaceAll("/", "_")
  .replaceAll("=", "")}.assinatura`;

describe("paridade com o gerador do build (scripts/sitemap.mjs)", () => {
  const ids = [
    "1181da15-5e04-40aa-8843-8b296634d732",
    "ab c&d<e>f\"g'h", // caracteres que o XML e a URL precisam neutralizar
    "1181da15-5e04-40aa-8843-8b296634d732", // repetido: sai uma vez
    "zzz",
  ];

  it("robots.txt é idêntico, byte a byte", () => {
    expect(robotsTxt(ORIGEM)).toBe(build.robotsTxt(ORIGEM));
    expect(robotsTxt(ORIGEM)).toBe(
      `User-agent: *\nAllow: /\n\nSitemap: ${ORIGEM}/sitemap.xml\n`,
    );
  });

  it("sitemap.xml é idêntico, byte a byte, com e sem produtos", () => {
    expect(sitemapXml(ORIGEM, ids)).toBe(build.sitemapXml(ORIGEM, ids));
    expect(sitemapXml(ORIGEM, [])).toBe(build.sitemapXml(ORIGEM, []));
  });

  it("URL de produto e consulta à vista pública são as mesmas do build", () => {
    for (const id of ids) {
      expect(urlDeProduto(ORIGEM, id)).toBe(build.urlDeProduto(ORIGEM, id));
    }
    expect(montarConsulta(SUPABASE, null)).toBe(
      build.montarConsulta(SUPABASE, null),
    );
    expect(montarConsulta(SUPABASE, "bbb&ccc")).toBe(
      build.montarConsulta(SUPABASE, "bbb&ccc"),
    );
  });

  it("os tetos são os mesmos do build (página e produtos)", () => {
    expect(PAGINA_MAPA).toBe(build.PAGINA);
    expect(MAX_PRODUTOS_MAPA).toBe(build.MAX_PRODUTOS);
  });

  it("cabeçalhos: publishable só em apikey, anon-jwt ganha o Bearer (como no build)", () => {
    const publica = cabecalhosDaConsulta(CHAVE_PUBLICA);
    expect(publica).toEqual(
      build.cabecalhosDaConsulta({
        key: CHAVE_PUBLICA,
        keyClass: "publishable",
      }),
    );
    expect(publica.Authorization).toBeUndefined();
    const legada = cabecalhosDaConsulta(CHAVE_LEGADA);
    expect(legada).toEqual(
      build.cabecalhosDaConsulta({ key: CHAVE_LEGADA, keyClass: "anon-jwt" }),
    );
    expect(legada.Authorization).toBe(`Bearer ${CHAVE_LEGADA}`);
  });

  it("chave que não é pública (nem publishable nem anon) NÃO vira cabeçalho: lança", () => {
    expect(() => cabecalhosDaConsulta("sb_secret_nao_publica")).toThrow();
  });
});

describe("o sitemap de uma loja não carrega nada de outra", () => {
  it("o endereço de cada loja só aparece nos arquivos dela", () => {
    const a = sitemapXml("https://loja-a.exemplo", ["a1"]);
    const b = sitemapXml("https://loja-b.exemplo", ["b1"]);
    expect(a).toContain("https://loja-a.exemplo/product-detail?id=a1");
    expect(a).not.toContain("loja-b.exemplo");
    expect(b).not.toContain("loja-a.exemplo");
    expect(robotsTxt("https://loja-b.exemplo")).not.toContain("loja-a");
  });

  it("origem que não é só scheme://host reprova em vez de gerar Sitemap torto", () => {
    for (const invalida of [
      "loja.exemplo",
      "https://loja.exemplo/",
      "https://loja.exemplo/loja",
      "https://loja.exemplo?x=1",
    ]) {
      expect(() => robotsTxt(invalida)).toThrow(/MAPA_ORIGEM/);
      expect(() => sitemapXml(invalida, [])).toThrow(/MAPA_ORIGEM/);
    }
  });

  it("aceita http com porta (o ensaio local dos hosts roda em http://loja.localhost:<porta>)", () => {
    expect(robotsTxt("http://loja-a.localhost:4310")).toContain(
      "Sitemap: http://loja-a.localhost:4310/sitemap.xml",
    );
  });
});

describe("buscarIdsDosProdutos — a leitura da vista pública da PRÓPRIA loja", () => {
  const conexao = { supabaseUrl: SUPABASE, publishableKey: CHAVE_PUBLICA };
  const json = (corpo: unknown, status = 200) =>
    new Response(typeof corpo === "string" ? corpo : JSON.stringify(corpo), {
      status,
      headers: { "content-type": "application/json" },
    });
  const pagina = (ids: string[]) => json(ids.map((id) => ({ id })));

  // fetch que serve uma lista de páginas em sequência (depois vazio) e
  // registra o que recebeu.
  const fetchPaginado = (paginas: readonly string[][]) => {
    const chamadas: { url: string; init: RequestInit | undefined }[] = [];
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      chamadas.push({ url: String(input), init });
      return pagina(paginas[chamadas.length - 1] ?? []);
    }) as typeof fetch;
    return { fetchImpl, chamadas };
  };

  it("concatena páginas por keyset até uma curta e devolve os ids na ordem", async () => {
    const { fetchImpl, chamadas } = fetchPaginado([["a", "b", "c"], ["d"]]);
    await expect(
      buscarIdsDosProdutos(conexao, { fetchImpl, pagina: 3 }),
    ).resolves.toEqual(["a", "b", "c", "d"]);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[0].url).toBe(
      `${SUPABASE}/rest/v1/vw_produtos_public?select=id&order=id.asc&limit=3`,
    );
    expect(chamadas[1].url).toContain("id=gt.c");
    expect(chamadas[1].url).not.toContain("offset");
  });

  it("catálogo vazio é uma página vazia, sem segunda consulta", async () => {
    const { fetchImpl, chamadas } = fetchPaginado([[]]);
    await expect(buscarIdsDosProdutos(conexao, { fetchImpl })).resolves.toEqual(
      [],
    );
    expect(chamadas).toHaveLength(1);
  });

  it("fala com a chave pública, sem cookie e sem seguir redirecionamento", async () => {
    const { fetchImpl, chamadas } = fetchPaginado([[]]);
    await buscarIdsDosProdutos(conexao, { fetchImpl });
    const init = chamadas[0].init;
    expect(new Headers(init?.headers).get("apikey")).toBe(CHAVE_PUBLICA);
    expect(init?.redirect).toBe("error");
    expect(init?.credentials).toBe("omit");
  });

  it("HTTP de erro vira falha (quem chama decide o fallback)", async () => {
    const fetchImpl = (async () => json({ erro: "x" }, 500)) as typeof fetch;
    await expect(buscarIdsDosProdutos(conexao, { fetchImpl })).rejects.toThrow(
      /MAPA_HTTP_500/,
    );
  });

  it("corpo que não é lista, JSON torto ou item sem id viram falha", async () => {
    for (const corpo of [
      '{"nao":"lista"}',
      "isto nao e json",
      '[{"id":""}]',
      '[{"id":7}]',
      "[null]",
      '[{"semid":true}]',
    ]) {
      const fetchImpl = (async () => json(corpo)) as typeof fetch;
      await expect(
        buscarIdsDosProdutos(conexao, { fetchImpl }),
      ).rejects.toThrow(/MAPA_SHAPE/);
    }
  });

  it("corpo acima do teto falha", async () => {
    const enorme = JSON.stringify([{ id: "x".repeat(600 * 1024) }]);
    const fetchImpl = (async () => json(enorme)) as typeof fetch;
    await expect(buscarIdsDosProdutos(conexao, { fetchImpl })).rejects.toThrow(
      /MAPA_CORPO/,
    );
  });

  it("acima do teto de produtos falha em vez de truncar o sitemap, inclusive com página final curta", async () => {
    const { fetchImpl } = fetchPaginado([
      ["a", "b", "c"],
      ["d", "e"],
    ]);
    await expect(
      buscarIdsDosProdutos(conexao, { fetchImpl, pagina: 3, maxProdutos: 4 }),
    ).rejects.toThrow(/MAPA_LIMITE/);
  });

  it("rede que lança propaga a falha", async () => {
    const fetchImpl = (async () => {
      throw new Error("rede caiu");
    }) as typeof fetch;
    await expect(buscarIdsDosProdutos(conexao, { fetchImpl })).rejects.toThrow(
      /rede caiu/,
    );
  });

  it("fetch que NUNCA resolve não pendura: o prazo total esgota e a falha sai", async () => {
    const fetchImpl = (() => new Promise<Response>(() => {})) as typeof fetch;
    await expect(
      buscarIdsDosProdutos(conexao, { fetchImpl, prazoMs: 30 }),
    ).rejects.toThrow(/MAPA_PRAZO/);
  });

  it("o prazo é do TOTAL, não de cada página (catálogo lento por páginas também esgota)", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      await new Promise((r) => setTimeout(r, 25));
      return pagina(["a", "b"].map((x) => `${x}${n}`));
    }) as typeof fetch;
    await expect(
      buscarIdsDosProdutos(conexao, { fetchImpl, pagina: 2, prazoMs: 60 }),
    ).rejects.toThrow(/MAPA_PRAZO/);
  });

  it("depois do prazo esgotado a leitura PARA: não segue paginando o catálogo em segundo plano", async () => {
    let chamadas = 0;
    const fetchImpl = (async () => {
      chamadas += 1;
      await new Promise((r) => setTimeout(r, 10));
      return pagina([`a${chamadas}`, `b${chamadas}`]);
    }) as typeof fetch;
    await expect(
      buscarIdsDosProdutos(conexao, { fetchImpl, pagina: 2, prazoMs: 35 }),
    ).rejects.toThrow(/MAPA_PRAZO/);
    const noMomentoDaFalha = chamadas;
    await new Promise((r) => setTimeout(r, 120));
    // No máximo UMA consulta já em voo termina; nenhuma nova nasce.
    expect(chamadas).toBeLessThanOrEqual(noMomentoDaFalha + 1);
  });

  it("parâmetros inválidos reprovam antes de qualquer consulta", async () => {
    const { fetchImpl, chamadas } = fetchPaginado([[]]);
    await expect(
      buscarIdsDosProdutos(conexao, { fetchImpl, pagina: 0 }),
    ).rejects.toThrow(/MAPA_PAGINA/);
    await expect(
      buscarIdsDosProdutos(conexao, { fetchImpl, maxProdutos: 0 }),
    ).rejects.toThrow(/MAPA_MAX_PRODUTOS/);
    expect(chamadas).toHaveLength(0);
  });
});
