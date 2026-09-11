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
      expect(chamadas).toHaveLength(1);
      expect(chamadas[0].url).toBe(montarConsulta(ORIGEM, ID));
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
