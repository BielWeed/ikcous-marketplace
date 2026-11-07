import { describe, expect, it, vi } from "vitest";
import {
  CORPO_MAXIMO,
  criarWorker,
  escaparHtml,
  idValido,
  imagemPermitida,
  montarConsulta,
} from "../../src/hospedagem/compartilhamento";
import type {
  AmbienteDaHospedagem,
  HospedagemConfig,
} from "../../src/hospedagem/contrato";
import { montarConsultaDeVariacoes } from "../../src/hospedagem/precoDaPrevia";

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ORIGEM = "https://abcdefghijklmnopqrst.supabase.co";
const CHAVE = "sb_publishable_fixture_only";

function config(extra: Partial<HospedagemConfig> = {}): HospedagemConfig {
  return {
    versao: 1,
    publicUrl: "https://loja-exclusiva.invalid",
    storeName: "Loja & Cia",
    conexao: {
      kind: "database",
      origin: ORIGEM,
      key: CHAVE,
      keyClass: "publishable",
    },
    hostsDeImagem: ["*.supabase.co", "images.unsplash.com"],
    cabecalhos: {
      "X-Frame-Options": "DENY",
      "X-Content-Type-Options": "nosniff",
    },
    deliveryVersion: "1.26.0+a.b.c",
    ...extra,
  };
}

function ambiente() {
  const pedidos: Request[] = [];
  const env: AmbienteDaHospedagem = {
    ASSETS: {
      fetch: async (request) => {
        pedidos.push(request);
        return new Response(
          request.method === "HEAD" ? null : "<html>app</html>",
          {
            status: 200,
            headers: {
              "content-type": "text/html; charset=utf-8",
              etag: '"app"',
            },
          },
        );
      },
    },
  };
  return { env, pedidos };
}

const ROBO = { "user-agent": "WhatsApp/2.23.20.0" };
const NAVEGADOR = { "user-agent": "Mozilla/5.0 Chrome/120" };
const produto = {
  id: ID,
  nome: 'Tênis "Aero" <novo>',
  descricao: "Leve & rápido",
  preco_venda: 199.9,
  imagem_url: "https://abc.supabase.co/storage/v1/object/public/p/1.jpg",
  imagem_urls: null,
};

function fetchComProduto(lista: unknown, init?: ResponseInit) {
  const chamadas: { url: string; init: RequestInit | undefined }[] = [];
  const impl = vi.fn(
    async (url: string | URL | Request, chamadaInit?: RequestInit) => {
      chamadas.push({ url: String(url), init: chamadaInit });
      return new Response(JSON.stringify(lista), { status: 200, ...init });
    },
  );
  return { impl, chamadas };
}

describe("funções puras", () => {
  it('escapa & < > " e também a aspa simples', () => {
    expect(escaparHtml(`a&b<c>"d'e`)).toBe("a&amp;b&lt;c&gt;&quot;d&#39;e");
  });
  it("id só em formato UUID", () => {
    expect(idValido(ID)).toBe(true);
    expect(idValido("1 OR 1=1")).toBe(false);
    expect(idValido(null)).toBe(false);
    expect(idValido(`${ID}x`)).toBe(false);
  });
  it("consulta explícita: colunas fechadas, id codificado, limit=1", () => {
    expect(montarConsulta(ORIGEM, ID)).toBe(
      `${ORIGEM}/rest/v1/vw_produtos_public?id=eq.${ID}&select=id,nome,descricao,preco_venda,imagem_url,imagem_urls&limit=1`,
    );
    // id com caractere especial de query (&, =, ,) tem de ir CODIFICADO: sem
    // isto, "1&limit=0,2" injetaria parâmetros extra na consulta ao PostgREST.
    expect(montarConsulta(ORIGEM, "1&limit=0,2")).toBe(
      `${ORIGEM}/rest/v1/vw_produtos_public?id=eq.1%26limit%3D0%2C2&select=id,nome,descricao,preco_venda,imagem_url,imagem_urls&limit=1`,
    );
  });
  it("imagem só https em host permitido ou na própria loja", () => {
    const c = config();
    expect(imagemPermitida("https://abc.supabase.co/x.jpg", c)).toBe(true);
    expect(imagemPermitida("https://loja-exclusiva.invalid/og.png", c)).toBe(
      true,
    );
    expect(imagemPermitida("http://abc.supabase.co/x.jpg", c)).toBe(false);
    expect(imagemPermitida("https://evil.example/x.jpg", c)).toBe(false);
    expect(imagemPermitida("https://supabase.co/x.jpg", c)).toBe(false); // curinga exige subdomínio
    expect(imagemPermitida("não é url", c)).toBe(false);
  });
  it("publicUrl inválido no config nunca lança, só devolve false", () => {
    const c = config({ publicUrl: "isso nao e url" });
    expect(() =>
      imagemPermitida("https://loja-exclusiva.invalid/x.png", c),
    ).not.toThrow();
    expect(imagemPermitida("https://loja-exclusiva.invalid/x.png", c)).toBe(
      false,
    );
  });
});

describe("worker", () => {
  it("fora de /product-detail passa o pedido intacto ao serviço de arquivos, carimbado com x-ikcous-og: passa", async () => {
    const { env, pedidos } = ambiente();
    const { impl } = fetchComProduto([produto]);
    const worker = criarWorker(config(), { fetchImpl: impl });
    const pedido = new Request("https://loja.exemplo/cart?x=1", {
      headers: ROBO,
    });
    const resposta = await worker.fetch(pedido, env);
    expect(pedidos).toHaveLength(1);
    expect(pedidos[0].url).toBe("https://loja.exemplo/cart?x=1");
    expect(impl).not.toHaveBeenCalled();
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("x-ikcous-og")).toBe("passa");
    expect(resposta.headers.get("x-ikcous-delivery")).toBe("1.26.0+a.b.c");
    expect(resposta.headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
    expect(await resposta.text()).toBe("<html>app</html>");
  });

  it("navegador em /product-detail recebe o documento da raiz, URL preservada, x-ikcous-og: passa", async () => {
    const { env, pedidos } = ambiente();
    const { impl } = fetchComProduto([produto]);
    const worker = criarWorker(config(), { fetchImpl: impl });
    const resposta = await worker.fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: NAVEGADOR,
      }),
      env,
    );
    expect(pedidos[0].url).toBe("https://loja.exemplo/");
    expect(resposta.headers.get("x-ikcous-og")).toBe("passa");
    expect(resposta.headers.get("x-ikcous-delivery")).toBe("1.26.0+a.b.c");
    expect(resposta.headers.get("x-frame-options")).toBe("DENY");
    expect(await resposta.text()).toBe("<html>app</html>");
    expect(impl).not.toHaveBeenCalled();
  });

  it.each(["/product-detail", "/product-detail/"])(
    "robô com produto em %s recebe a prévia com cabeçalhos de segurança e no-store",
    async (caminho) => {
      const { env } = ambiente();
      const { impl, chamadas } = fetchComProduto([produto]);
      const worker = criarWorker(config(), { fetchImpl: impl });
      const resposta = await worker.fetch(
        new Request(`https://loja.exemplo${caminho}?id=${ID}`, {
          headers: ROBO,
        }),
        env,
      );
      expect(resposta.status).toBe(200);
      expect(resposta.headers.get("x-ikcous-og")).toBe("produto");
      expect(resposta.headers.get("cache-control")).toBe("no-store");
      expect(resposta.headers.get("x-frame-options")).toBe("DENY");
      expect(resposta.headers.get("content-type")).toBe(
        "text/html; charset=utf-8",
      );
      const html = await resposta.text();
      expect(html).toContain("Tênis &quot;Aero&quot; &lt;novo&gt;");
      expect(html).toContain("Leve &amp; rápido");
      expect(html).toContain("R$ 199,90");
      expect(html).toContain(
        "<title>Tênis &quot;Aero&quot; &lt;novo&gt; | Loja &amp; Cia</title>",
      );
      expect(html).toContain(
        `<meta property="og:url" content="https://loja-exclusiva.invalid/product-detail?id=${ID}">`,
      );
      expect(html).toContain(
        'content="https://abc.supabase.co/storage/v1/object/public/p/1.jpg"',
      );
      expect(html).toContain(
        '<meta property="og:title" content="Tênis &quot;Aero&quot; &lt;novo&gt; - R$ 199,90 | Loja &amp; Cia">',
      );
      expect(html).toContain(
        '<meta name="twitter:title" content="Tênis &quot;Aero&quot; &lt;novo&gt; | Loja &amp; Cia">',
      );
      // Duas leituras: a view do produto e as variações (preço de vitrine).
      expect(chamadas).toHaveLength(2);
      expect(chamadas[0].url).toBe(montarConsulta(ORIGEM, ID));
      expect(chamadas[1].url).toBe(montarConsultaDeVariacoes(ORIGEM, ID));
    },
  );

  it("publishable manda só apikey; anon-jwt manda apikey e Bearer", async () => {
    const { env } = ambiente();
    const a = fetchComProduto([produto]);
    await criarWorker(config(), { fetchImpl: a.impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    const ha = new Headers(a.chamadas[0].init?.headers);
    expect(ha.get("apikey")).toBe(CHAVE);
    expect(ha.get("authorization")).toBeNull();
    expect(ha.get("accept")).toBe("application/json");

    const jwt = "anon.jwt.montado-em-runtime";
    const b = fetchComProduto([produto]);
    await criarWorker(
      config({
        conexao: {
          kind: "database",
          origin: ORIGEM,
          key: jwt,
          keyClass: "anon-jwt",
        },
      }),
      { fetchImpl: b.impl },
    ).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    const hb = new Headers(b.chamadas[0].init?.headers);
    expect(hb.get("apikey")).toBe(jwt);
    expect(hb.get("authorization")).toBe(`Bearer ${jwt}`);
    expect(b.chamadas[0].init?.redirect).toBe("manual");
    expect(b.chamadas[0].init?.signal).toBeInstanceOf(AbortSignal);
  });

  it.each([
    ["lista vazia", () => new Response("[]", { status: 200 })],
    [
      "permission denied 42501",
      () => new Response('{"code":"42501"}', { status: 401 }),
    ],
    [
      "redirecionamento",
      () =>
        new Response(null, { status: 302, headers: { location: "https://x" } }),
    ],
    ["JSON inválido", () => new Response("<html>", { status: 200 })],
    [
      "corpo acima do limite",
      () => new Response(`[${"x".repeat(CORPO_MAXIMO + 1)}]`, { status: 200 }),
    ],
    ["rede caiu", () => Promise.reject(new TypeError("Failed to fetch"))],
  ])(
    "%s → documento da loja com sem-produto, nunca produto",
    async (_, resposta) => {
      const { env, pedidos } = ambiente();
      const impl = vi.fn(async () => resposta());
      const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
        new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
          headers: ROBO,
        }),
        env,
      );
      expect(r.headers.get("x-ikcous-og")).toBe("sem-produto");
      expect(pedidos[0].url).toBe("https://loja.exemplo/");
      expect(await r.text()).toBe("<html>app</html>");
    },
  );

  it("prazo: consulta pendurada é abortada e cai em sem-produto", async () => {
    const { env } = ambiente();
    const impl = vi.fn(
      (_: string | URL | Request, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () =>
            reject(init.signal?.reason),
          );
        }),
    );
    const inicio = Date.now();
    const r = await criarWorker(config(), {
      fetchImpl: impl,
      prazoMs: 30,
    }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    expect(r.headers.get("x-ikcous-og")).toBe("sem-produto");
    expect(Date.now() - inicio).toBeLessThan(2000);
  });

  it("id fora do formato não consulta; sem conexão nunca consulta", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([produto]);
    const r1 = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request("https://loja.exemplo/product-detail?id=1%20OR%201=1", {
        headers: ROBO,
      }),
      env,
    );
    expect(r1.headers.get("x-ikcous-og")).toBe("sem-produto");
    const r2 = await criarWorker(config({ conexao: { kind: "none" } }), {
      fetchImpl: impl,
    }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    expect(r2.headers.get("x-ikcous-og")).toBe("sem-produto");
    expect(impl).not.toHaveBeenCalled();
  });

  it("imagem fora dos hosts permitidos cai no og-image da própria loja", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([
      { ...produto, imagem_url: "https://evil.example/x.jpg" },
    ]);
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    const html = await r.text();
    expect(html).toContain(
      'content="https://loja-exclusiva.invalid/og-image.png"',
    );
    expect(html).not.toContain("evil.example");
  });

  it("produto sem nome e sem imagem usa os textos padrão da loja", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([{ id: ID }]);
    const html = await (
      await criarWorker(config(), { fetchImpl: impl }).fetch(
        new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
          headers: ROBO,
        }),
        env,
      )
    ).text();
    expect(html).toContain("Produto - Loja &amp; Cia");
    expect(html).toContain("Confira os detalhes do produto no Loja &amp; Cia.");
    expect(html).toContain("/og-image.png");
  });

  it("imagem_urls vazio (default) com imagem_url preenchido usa a foto", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([
      { ...produto, imagem_urls: [], imagem_url: produto.imagem_url },
    ]);
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    const html = await r.text();
    expect(html).toContain(
      'content="https://abc.supabase.co/storage/v1/object/public/p/1.jpg"',
    );
  });

  it("preco_venda 0 não aparece no og:title", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([{ ...produto, preco_venda: 0 }]);
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    const html = await r.text();
    expect(html).toContain(
      '<meta property="og:title" content="Tênis &quot;Aero&quot; &lt;novo&gt;  | Loja &amp; Cia">',
    );
    expect(html).not.toContain("R$");
  });

  it("preco_venda 14.9 continua mostrando R$ 14,90 (regressão)", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([{ ...produto, preco_venda: 14.9 }]);
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    expect(await r.text()).toContain("R$ 14,90");
  });

  it.each([
    [999.9, "R$ 999,90"],
    [1299.9, "R$ 1.299,90"],
    [12345.6, "R$ 12.345,60"],
  ])(
    "lote 244: preco_venda %s sai com ponto de milhar (%s)",
    async (preco, esperado) => {
      const { env } = ambiente();
      const { impl } = fetchComProduto([{ ...produto, preco_venda: preco }]);
      const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
        new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
          headers: ROBO,
        }),
        env,
      );
      expect(await r.text()).toContain(esperado);
    },
  );

  it("preco_venda negativo não aparece no og:title", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([{ ...produto, preco_venda: -5 }]);
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    expect(await r.text()).not.toContain("R$");
  });

  it("descrição com Markdown sai limpa e curta em description, og:description, twitter:description e no corpo", async () => {
    const { env } = ambiente();
    const longa = `**Caderno Inteligente**\n* 📖 50 Páginas reposicionáveis\n* ✏️ Acompanha caneta\n\n---\n${"texto bem comprido ".repeat(40)}`;
    const { impl } = fetchComProduto([{ ...produto, descricao: longa }]);
    const html = await (
      await criarWorker(config(), { fetchImpl: impl }).fetch(
        new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
          headers: ROBO,
        }),
        env,
      )
    ).text();
    const descricoes = [
      ...html.matchAll(
        /<meta (?:name|property)="[^"]*description" content="([^"]*)">/g,
      ),
    ].map((m) => m[1]);
    expect(descricoes).toHaveLength(3);
    for (const d of descricoes) {
      expect(d).not.toMatch(/[*#]/);
      expect(d).not.toContain("\n");
      expect(Array.from(d).length).toBeLessThanOrEqual(200);
      expect(
        d.startsWith("Caderno Inteligente 📖 50 Páginas reposicionáveis"),
      ).toBe(true);
      expect(d.endsWith("…")).toBe(true);
    }
    expect(html).toMatch(/<p>Caderno Inteligente [^*#<]*…<\/p>/);
  });

  it("descrição só de Markdown (sem texto de verdade) cai no texto padrão da loja", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([{ ...produto, descricao: "---\n**" }]);
    const html = await (
      await criarWorker(config(), { fetchImpl: impl }).fetch(
        new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
          headers: ROBO,
        }),
        env,
      )
    ).text();
    expect(html).toContain("Confira os detalhes do produto no Loja &amp; Cia.");
  });

  it("descrição com aspas e sinais continua escapada depois do resumo", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([
      { ...produto, descricao: '**Leve** & "rápido" <b>' },
    ]);
    const html = await (
      await criarWorker(config(), { fetchImpl: impl }).fetch(
        new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
          headers: ROBO,
        }),
        env,
      )
    ).text();
    expect(html).toContain(
      'name="description" content="Leve &amp; &quot;rápido&quot; &lt;b&gt;"',
    );
  });

  it("produto sem foto usa og:image:width=1200 e og:image:height=630 (identidade)", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([{ id: ID }]);
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    const html = await r.text();
    expect(html).toContain('<meta property="og:image:width" content="1200">');
    expect(html).toContain('<meta property="og:image:height" content="630">');
  });

  it("produto com foto não declara og:image:width nem og:image:height (o robô mede)", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([produto]);
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    const html = await r.text();
    expect(html).not.toContain("og:image:width");
    expect(html).not.toContain("og:image:height");
  });

  // r46-e: a prévia do link anunciava o preço-base (R$ 50), mas a loja mostra
  // o menor preço entre as opções à venda (R$ 40, "a partir de"). Aqui o dublê
  // responde por ROTA: a view do produto e a tabela das variações.
  describe("preço da prévia = preço de vitrine (menor preço das variações à venda)", () => {
    const variacoes = (...linhas: Record<string, unknown>[]) =>
      linhas.map((l) => ({
        name: "Tamanho",
        active: true,
        stock_increment: 5,
        price_override: null,
        ...l,
      }));

    function fetchPorRota(
      respostaDasVariacoes: () => Response | Promise<Response>,
      baseDoProduto = 50,
    ) {
      const chamadas: string[] = [];
      const impl = vi.fn(async (url: string | URL | Request) => {
        const alvo = String(url);
        chamadas.push(alvo);
        if (alvo.includes("/rest/v1/product_variants"))
          return respostaDasVariacoes();
        return new Response(
          JSON.stringify([{ ...produto, preco_venda: baseDoProduto }]),
          { status: 200 },
        );
      });
      return { impl, chamadas };
    }

    async function ogTitle(impl: typeof fetch) {
      const { env } = ambiente();
      const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
        new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
          headers: ROBO,
        }),
        env,
      );
      expect(r.headers.get("x-ikcous-og")).toBe("produto");
      return (await r.text()).match(
        /<meta property="og:title" content="([^"]*)">/,
      )?.[1];
    }

    it("base 50, P a 40 e G a 90, as duas com estoque -> R$ 40,00 (o que o card e a página mostram)", async () => {
      const { impl, chamadas } = fetchPorRota(
        () =>
          new Response(
            // As duas opções são do mesmo grupo ("Tamanho"): P e G.
            JSON.stringify(
              variacoes({ price_override: 40 }, { price_override: 90 }),
            ),
            { status: 200 },
          ),
      );
      expect(await ogTitle(impl as unknown as typeof fetch)).toBe(
        "Tênis &quot;Aero&quot; &lt;novo&gt; - R$ 40,00 | Loja &amp; Cia",
      );
      // A leitura das variações é a MESMA da página: só as 4 colunas que a
      // regra de preço usa, filtradas pelo produto.
      expect(
        chamadas.some(
          (c) =>
            c ===
            `${ORIGEM}/rest/v1/product_variants?product_id=eq.${ID}&select=name,active,stock_increment,price_override`,
        ),
      ).toBe(true);
    });

    it("variação sem estoque não puxa o preço: G a 90 com estoque e P a 40 esgotada -> R$ 90,00", async () => {
      const { impl } = fetchPorRota(
        () =>
          new Response(
            JSON.stringify(
              variacoes(
                { price_override: 40, stock_increment: 0 },
                { price_override: 90 },
              ),
            ),
            { status: 200 },
          ),
      );
      expect(await ogTitle(impl as unknown as typeof fetch)).toContain(
        "- R$ 90,00 |",
      );
    });

    it("variação sem preço próprio vale o preço-base do produto", async () => {
      const { impl } = fetchPorRota(
        () =>
          new Response(JSON.stringify(variacoes({ price_override: null })), {
            status: 200,
          }),
      );
      expect(await ogTitle(impl as unknown as typeof fetch)).toContain(
        "- R$ 50,00 |",
      );
    });

    it.each([
      ["lista vazia", () => new Response("[]", { status: 200 })],
      [
        "permissão negada",
        () => new Response('{"code":"42501"}', { status: 401 }),
      ],
      ["JSON inválido", () => new Response("<html>", { status: 200 })],
      ["rede caiu", () => Promise.reject(new TypeError("Failed to fetch"))],
      [
        "corpo acima do limite",
        () =>
          new Response(`[${"x".repeat(CORPO_MAXIMO + 1)}]`, { status: 200 }),
      ],
    ])(
      "consulta das variações com %s -> a prévia continua no preço-base, sem quebrar",
      async (_, resposta) => {
        const { impl } = fetchPorRota(resposta);
        expect(await ogTitle(impl as unknown as typeof fetch)).toContain(
          "- R$ 50,00 |",
        );
      },
    );

    it("variações penduradas além do prazo não seguram a prévia: cai no preço-base", async () => {
      const { env } = ambiente();
      const impl = vi.fn(
        (url: string | URL | Request, init?: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            if (!String(url).includes("/rest/v1/product_variants")) {
              resolve(new Response(JSON.stringify([produto]), { status: 200 }));
              return;
            }
            init?.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          }),
      );
      const r = await criarWorker(config(), {
        fetchImpl: impl,
        prazoMs: 30,
      }).fetch(
        new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
          headers: ROBO,
        }),
        env,
      );
      expect(r.headers.get("x-ikcous-og")).toBe("produto");
      expect(await r.text()).toContain("- R$ 199,90 |");
    });
  });

  it("HEAD de robô com produto devolve os cabeçalhos e nenhum corpo", async () => {
    const { env } = ambiente();
    const { impl } = fetchComProduto([produto]);
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        method: "HEAD",
        headers: ROBO,
      }),
      env,
    );
    expect(r.headers.get("x-ikcous-og")).toBe("produto");
    expect(await r.text()).toBe("");
  });
});
