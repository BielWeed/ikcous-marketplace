/* eslint-disable security/detect-non-literal-fs-filename -- Only isolated mkdtemp kits and repository-owned public/ seed files are read. */
// SEO (issue #117): robots.txt versionado com Sitemap absoluto e sitemap.xml
// com uma URL por produto ativo.
//
// Este arquivo confronta o gerador JS do build (scripts/sitemap.mjs) com a
// fonte TypeScript da URL canônica de produto (src/hospedagem/compartilhamento.ts):
// o Google indexa a URL que vem do sitemap e os bots de prévia seguem a og:url
// que o worker de compartilhamento devolve — divergência entre os dois lados é
// duas URLs canônicas para a mesma página, e é exatamente o tipo de defeito
// que revisão de diff não pega (cada arquivo parece certo sozinho).
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  cabecalhosDaConsulta as cabecalhosDoCompartilhamento,
  montarHtml,
} from "../../src/hospedagem/compartilhamento";
import type {
  ConexaoDaHospedagem,
  HospedagemConfig,
} from "../../src/hospedagem/contrato";

// Módulo JS sem declaração de tipos, mesmo padrão de hospedagem-rotas.test.ts.
// @ts-expect-error Módulo JS nativo sem declaração; confronto com o contrato TypeScript.
import * as sitemap from "../../scripts/sitemap.mjs";

const ORIGIN = "https://abcdefghijklmnopqrst.supabase.co";
const PUBLIC_URL = "https://loja-exclusiva.invalid";

const conexaoPublishable: ConexaoDaHospedagem = {
  kind: "database",
  origin: ORIGIN,
  key: "sb_publishable_somente_teste",
  keyClass: "publishable",
};
const conexaoAnonJwt: ConexaoDaHospedagem = {
  kind: "database",
  origin: ORIGIN,
  key: "eyJhbGciOiJIUzI1NiJ9.fixture",
  keyClass: "anon-jwt",
};

function configDaLoja(publicUrl: string): HospedagemConfig {
  return {
    versao: 1,
    publicUrl,
    storeName: "Loja Ensaio",
    conexao: { kind: "none" },
    hostsDeImagem: [],
    cabecalhos: {},
    deliveryVersion: "teste",
  };
}

describe("URL canônica de produto", () => {
  const produto = {
    nome: "Camiseta",
    descricao: "Algodão penteado",
    preco_venda: 49.9,
    imagem_url: null,
    imagem_urls: [],
  };

  // og:url do HTML do worker é a fonte da verdade da URL canônica; o sitemap
  // é o espelho. Extrair do HTML (e não chamar a função interna) para o
  // confronto valer também para a montagem de verdade. O valor do atributo
  // vem escapado para HTML (o escaparHtml do TS converte ' em &#39;, que o
  // encodeURIComponent não toca): quem LÊ um atributo decodifica entidades,
  // então o confronto compara a URL semântica, não a representação.
  const decodificarEntidades = (valor: string) =>
    valor
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'");
  const ogUrl = (publicUrl: string, id: string) => {
    const html = montarHtml(produto, id, configDaLoja(publicUrl));
    return decodificarEntidades(
      html.match(/property="og:url" content="([^"]+)"/)![1],
    );
  };

  it("urlDeProduto é a og:url do compartilhamento, com id codificado", () => {
    for (const id of [
      "11111111-1111-1111-1111-111111111111",
      "a&b<c>\"d'e f",
    ]) {
      expect(sitemap.urlDeProduto(PUBLIC_URL, id)).toBe(ogUrl(PUBLIC_URL, id));
    }
  });

  it('a URL não carrega & < > " crus — encodeURIComponent é a defesa', () => {
    const url = sitemap.urlDeProduto(PUBLIC_URL, `a&b<c>"d`);
    for (const proibido of ["&", "<", ">", '"'])
      expect(url).not.toContain(proibido);
  });

  it("controle negativo: caminho errado derruba o confronto", () => {
    const id = "11111111-1111-1111-1111-111111111111";
    expect(
      sitemap
        .urlDeProduto(PUBLIC_URL, id)
        .replace("/product-detail", "/produto"),
    ).not.toBe(ogUrl(PUBLIC_URL, id));
  });
});

describe("robots.txt da loja", () => {
  it("conteúdo exato: liberado para todos, Sitemap absoluto, fim de linha único", () => {
    expect(sitemap.robotsTxt(PUBLIC_URL)).toBe(
      `User-agent: *\nAllow: /\n\nSitemap: ${PUBLIC_URL}/sitemap.xml\n`,
    );
  });

  it("publicUrl inválido reprova em vez de gerar Sitemap torto", () => {
    for (const inválido of [
      "http://loja.invalid", // sem HTTPS
      "https://loja.invalid/", // barra final
      "https://loja.invalid/loja", // caminho
      "loja.invalid", // não é URL
    ]) {
      expect(() => sitemap.robotsTxt(inválido)).toThrow(/SITEMAP_PUBLIC_URL/);
    }
  });
});

describe("sitemap.xml da loja", () => {
  // O retrato das 4 entradas estáticas é o do public/sitemap.xml versionado
  // (lastmod 2024-03-21, changefreq daily): a issue não pediu política de SEO
  // nova, então o gerador preserva o que já foi publicado e só reescreve a
  // origem para a publicUrl da loja que está sendo construída.
  const estatico = (origem: string) =>
    `  <url>\n    <loc>${origem}/</loc>\n    <lastmod>2024-03-21</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>1.0</priority>\n  </url>\n` +
    `  <url>\n    <loc>${origem}/?view=cart</loc>\n    <lastmod>2024-03-21</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n` +
    `  <url>\n    <loc>${origem}/?view=favorites</loc>\n    <lastmod>2024-03-21</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n` +
    `  <url>\n    <loc>${origem}/?view=orders</loc>\n    <lastmod>2024-03-21</lastmod>\n    <changefreq>daily</changefreq>\n    <priority>0.8</priority>\n  </url>\n`;

  const entradaDeProduto = (origem: string, id: string) =>
    `  <url>\n    <loc>${sitemap.urlDeProduto(origem, id)}</loc>\n  </url>\n`;

  it("sem produtos: declaração, urlset e as 4 entradas do retrato, nada mais", () => {
    expect(sitemap.sitemapXml(PUBLIC_URL, [])).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${estatico(PUBLIC_URL)}</urlset>\n`,
    );
  });

  it("uma <url> por produto, só com <loc> — sem inventar lastmod nem prioridade", () => {
    const xml = sitemap.sitemapXml(PUBLIC_URL, ["id-1", "id-2"]);
    expect(xml).toBe(
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${estatico(PUBLIC_URL)}${entradaDeProduto(PUBLIC_URL, "id-1")}${entradaDeProduto(PUBLIC_URL, "id-2")}</urlset>\n`,
    );
    // A entrada de produto não pode carregar metadados que ninguém decidiu:
    // lastmod/changefreq/priority são política de SEO, e a issue #117 não
    // define nenhuma para produto.
    const blocoDoProduto = xml.split(
      "  <url>\n    <loc>https://loja-exclusiva.invalid/product-detail",
    )[1];
    expect(blocoDoProduto?.split("  </url>")[0]).not.toMatch(
      /<(lastmod|changefreq|priority)>/,
    );
  });

  it("id repetido entra uma vez, na ordem da primeira ocorrência", () => {
    const xml = sitemap.sitemapXml(PUBLIC_URL, ["id-1", "id-2", "id-1"]);
    expect(
      xml
        .match(/<loc>[^<]+<\/loc>/g)
        ?.filter((l: string) => l.includes("product-detail")),
    ).toHaveLength(2);
    expect(xml.indexOf("id-1")).toBeLessThan(xml.indexOf("id-2"));
  });

  it("publicUrl inválido reprova (mesma guarda do robots)", () => {
    expect(() => sitemap.sitemapXml("https://loja.invalid/", ["id-1"])).toThrow(
      /SITEMAP_PUBLIC_URL/,
    );
  });
});

describe("consulta à vw_produtos_public", () => {
  it("primeira página pede só o id, ordenado, com teto de página", () => {
    expect(sitemap.montarConsulta(ORIGIN, null)).toBe(
      `${ORIGIN}/rest/v1/vw_produtos_public?select=id&order=id.asc&limit=1000`,
    );
  });

  it("página seguinte pagina por keyset (id=gt.), sem offset", () => {
    expect(sitemap.montarConsulta(ORIGIN, "bbbbbbbb")).toBe(
      `${ORIGIN}/rest/v1/vw_produtos_public?select=id&order=id.asc&limit=1000&id=gt.bbbbbbbb`,
    );
  });

  it("cabeçalhos são o espelho do compartilhamento para as duas classes de chave", () => {
    const comoObjeto = (h: Headers) =>
      Object.fromEntries([...h.entries()].sort());
    for (const conexao of [conexaoPublishable, conexaoAnonJwt]) {
      expect(
        comoObjeto(new Headers(sitemap.cabecalhosDaConsulta(conexao))),
      ).toEqual(comoObjeto(cabecalhosDoCompartilhamento(conexao)));
    }
  });

  it("publishable vai só em apikey; anon-jwt ganha o Bearer", () => {
    const publica = new Headers(
      sitemap.cabecalhosDaConsulta(conexaoPublishable),
    );
    expect(publica.get("apikey")).toBe(conexaoPublishable.key);
    expect(publica.get("Authorization")).toBeNull();
    const legada = new Headers(sitemap.cabecalhosDaConsulta(conexaoAnonJwt));
    expect(legada.get("apikey")).toBe(conexaoAnonJwt.key);
    expect(legada.get("Authorization")).toBe(`Bearer ${conexaoAnonJwt.key}`);
  });
});

describe("buscarIdsDeProdutos", () => {
  const resposta = (corpo: string) =>
    new Response(corpo, { headers: { "content-type": "application/json" } });
  const pagina = (ids: string[]) =>
    resposta(JSON.stringify(ids.map((id) => ({ id }))));

  // fetch que serve uma lista de páginas em sequência (depois vazio) e
  // registra o que recebeu, para as asserções de paginação.
  const fetchPaginado = (paginas: readonly string[][]) => {
    const chamadas: { url: string; headers: Headers }[] = [];
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      chamadas.push({
        url: String(input),
        headers: new Headers(init?.headers),
      });
      return pagina(paginas[chamadas.length - 1] ?? []);
    };
    return { fetchImpl, chamadas };
  };

  it("concatena páginas até uma curta e devolve os ids na ordem", async () => {
    const { fetchImpl, chamadas } = fetchPaginado([["a", "b", "c"], ["d"]]);
    await expect(
      sitemap.buscarIdsDeProdutos(conexaoPublishable, {
        fetchImpl,
        pagina: 3,
      }),
    ).resolves.toEqual(["a", "b", "c", "d"]);
    expect(chamadas).toHaveLength(2);
    expect(chamadas[1].url).toContain("id=gt.c");
  });

  it("catálogo vazio é uma página vazia, sem segunda consulta", async () => {
    const { fetchImpl, chamadas } = fetchPaginado([[]]);
    await expect(
      sitemap.buscarIdsDeProdutos(conexaoPublishable, { fetchImpl }),
    ).resolves.toEqual([]);
    expect(chamadas).toHaveLength(1);
  });

  it("consulta com a chave pública da loja e sem redirecionamento", async () => {
    const { fetchImpl, chamadas } = fetchPaginado([[]]);
    await sitemap.buscarIdsDeProdutos(conexaoPublishable, { fetchImpl });
    expect(chamadas[0].headers.get("apikey")).toBe(conexaoPublishable.key);
  });

  it("HTTP de erro reprova o build — sitemap furado não sai em silêncio", async () => {
    const fetchImpl = async () => new Response("boom", { status: 503 });
    await expect(
      sitemap.buscarIdsDeProdutos(conexaoPublishable, { fetchImpl }),
    ).rejects.toThrow(/SITEMAP_HTTP_503/);
  });

  it("corpo que não é lista, ou item sem id, reprova", async () => {
    const objeto = async () => resposta('{"id": "a"}');
    await expect(
      sitemap.buscarIdsDeProdutos(conexaoPublishable, { fetchImpl: objeto }),
    ).rejects.toThrow(/SITEMAP_SHAPE/);
    const itemTorto = async () => resposta('[{"uuid": "a"}]');
    await expect(
      sitemap.buscarIdsDeProdutos(conexaoPublishable, { fetchImpl: itemTorto }),
    ).rejects.toThrow(/SITEMAP_SHAPE/);
  });

  it("corpo acima do teto reprova antes do JSON.parse", async () => {
    const gigante = async () => resposta(`[${" ".repeat(600 * 1024)}]`);
    await expect(
      sitemap.buscarIdsDeProdutos(conexaoPublishable, { fetchImpl: gigante }),
    ).rejects.toThrow(/SITEMAP_CORPO/);
  });

  it("acima do teto de produtos reprova em vez de truncar o sitemap", async () => {
    const { fetchImpl } = fetchPaginado([
      ["a", "b"],
      ["c", "d"],
    ]);
    await expect(
      sitemap.buscarIdsDeProdutos(conexaoPublishable, {
        fetchImpl,
        pagina: 2,
        maxProdutos: 3,
      }),
    ).rejects.toThrow(/SITEMAP_LIMITE/);
  });

  it("timeout PROPAGA: aqui falhar calado publicaria sitemap velho (o oposto do consultarProduto)", async () => {
    // O fetch de verdade rejeita quando o signal aborta; o dublê tem que
    // fazer o mesmo, senão o teste mede o mock e não o prazo.
    const nuncaResponde: typeof fetch = (_input, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () =>
          reject((init.signal as AbortSignal).reason),
        );
      });
    await expect(
      sitemap.buscarIdsDeProdutos(conexaoPublishable, {
        fetchImpl: nuncaResponde,
        prazoMs: 5,
      }),
    ).rejects.toThrow();
  });

  it("conexão de fixture não consulta nada", async () => {
    const redeProibida = () => {
      throw new Error("network forbidden");
    };
    await expect(
      sitemap.buscarIdsDeProdutos(
        { kind: "none" },
        { fetchImpl: redeProibida },
      ),
    ).rejects.toThrow(/SITEMAP_CONNECTION/);
  });
});

describe("gerarSitemap no outDir", () => {
  const deliveryDe = (conexao: unknown, publicUrl = PUBLIC_URL) => ({
    snapshot: { publicUrl },
    connection: conexao,
  });

  it("fixture não sai para a rede e não escreve arquivo", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sitemap-fixture-"));
    const escritaProibida = async (
      _destino: unknown,
      _dados: unknown,
    ): Promise<void> => {
      throw new Error("write forbidden");
    };
    await expect(
      sitemap.gerarSitemap(dir, deliveryDe({ kind: "fixture-none" }), {
        fetchImpl: escritaProibida as unknown as typeof fetch,
      }),
    ).resolves.toEqual([]);
    expect(await readdir(dir)).toEqual([]);
  });

  it("database escreve robots.txt e sitemap.xml com a URL da loja e dos produtos", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sitemap-database-"));
    const paginas = [
      ["11111111-1111-1111-1111-111111111111"],
      ["22222222-2222-2222-2222-222222222222"],
    ];
    const resposta = (ids: string[]) =>
      new Response(JSON.stringify(ids.map((id) => ({ id }))), {
        headers: { "content-type": "application/json" },
      });
    let chamadas = 0;
    const fetchImpl = async () => resposta(paginas[chamadas++] ?? []);
    const escritos = await sitemap.gerarSitemap(
      dir,
      deliveryDe(conexaoPublishable),
      // pagina: 1 força as duas páginas cheias + a terceira vazia, provando
      // que o gerador pagina dentro do outDir também.
      { fetchImpl, pagina: 1 },
    );
    expect(escritos).toEqual(["robots.txt", "sitemap.xml"]);
    expect(await readFile(path.join(dir, "robots.txt"), "utf8")).toBe(
      sitemap.robotsTxt(PUBLIC_URL),
    );
    const xml = await readFile(path.join(dir, "sitemap.xml"), "utf8");
    expect(xml).toContain(
      `<loc>${PUBLIC_URL}/product-detail?id=11111111-1111-1111-1111-111111111111</loc>`,
    );
    expect(xml).toContain(
      `<loc>${PUBLIC_URL}/product-detail?id=22222222-2222-2222-2222-222222222222</loc>`,
    );
    expect(xml).toBe(sitemap.sitemapXml(PUBLIC_URL, paginas.flat()));
  });

  it("publicUrl inválido reprova sem deixar arquivo para trás", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "sitemap-invalido-"));
    const resposta = () =>
      new Response("[]", { headers: { "content-type": "application/json" } });
    await expect(
      sitemap.gerarSitemap(
        dir,
        deliveryDe(conexaoPublishable, "https://loja/"),
        {
          fetchImpl: resposta,
        },
      ),
    ).rejects.toThrow(/SITEMAP_PUBLIC_URL/);
    expect(await readdir(dir)).toEqual([]);
  });
});

describe("sementes versionadas em public/ (critérios 1 e 2 da issue #117)", () => {
  const caminhoDaSemente = (nome: string) =>
    fileURLToPath(new URL(`../../public/${nome}`, import.meta.url));

  it("public/robots.txt existe e é exatamente o que o gerador produz para a própria origem declarada", async () => {
    const conteudo = await readFile(caminhoDaSemente("robots.txt"), "utf8");
    // A origem sai do PRÓPRIO arquivo: o teste casa o formato com qualquer
    // loja e ainda prova que a diretiva Sitemap é absoluta — o defeito que
    // abriu a issue era exatamente um "Sitemap: /sitemap.xml" relativo.
    const origem = conteudo.match(
      /^Sitemap: (https:\/\/[^/\s]+)\/sitemap\.xml$/m,
    );
    expect(origem).not.toBeNull();
    expect(conteudo).toBe(sitemap.robotsTxt(origem![1]));
  });

  it("public/sitemap.xml é byte a byte o gerador sobre a própria origem e os próprios produtos", async () => {
    const conteudo = await readFile(caminhoDaSemente("sitemap.xml"), "utf8");
    const origem = conteudo.match(/<loc>(https:\/\/[^/\s]+)\/<\/loc>/);
    expect(origem).not.toBeNull();
    const ids = [
      ...conteudo.matchAll(/<loc>[^<]*\/product-detail\?id=([^<]+)<\/loc>/g),
    ].map((m) => decodeURIComponent(m[1]));
    // Uma URL por produto ativo é o critério 2: o semente precisa nascer com
    // pelo menos um produto, senão o teste casa vazio com vazio.
    expect(ids.length).toBeGreaterThan(0);
    expect(conteudo).toBe(sitemap.sitemapXml(origem![1], ids));
  });
});
