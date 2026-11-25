import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CORPO_MAXIMO,
  PRAZO_MS,
  criarWorker,
  hostPermitido,
  idValido,
  imagemPermitida,
} from "../../src/hospedagem/compartilhamento";
import type {
  AmbienteDaHospedagem,
  HospedagemConfig,
} from "../../src/hospedagem/contrato";

/**
 * `src/hospedagem/compartilhamento.ts` — o worker da prévia do link na
 * Cloudflare. As FRONTEIRAS que o teste vizinho (hospedagem-compartilhamento)
 * deixava soltas, achadas por mutação em 25/11/2026: tamanho máximo do corpo,
 * prazo padrão, curinga de host de imagem, UUID em maiúsculas, ordem das fotos,
 * texto em branco, precedência dos cabeçalhos do documento, HEAD sem corpo e o
 * `Vary` que se soma ao da hospedagem em vez de apagá-lo.
 */

const ID = "3f2b1c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d";
const ORIGEM = "https://abcdefghijklmnopqrst.supabase.co";
const ROBO = { "user-agent": "WhatsApp/2.23.20.0" };
const NAVEGADOR = { "user-agent": "Mozilla/5.0 Chrome/120" };

function config(extra: Partial<HospedagemConfig> = {}): HospedagemConfig {
  return {
    versao: 1,
    publicUrl: "https://loja-exclusiva.invalid",
    storeName: "Loja & Cia",
    conexao: {
      kind: "database",
      origin: ORIGEM,
      key: "sb_publishable_fixture_only",
      keyClass: "publishable",
    },
    hostsDeImagem: ["*.supabase.co", "images.unsplash.com"],
    cabecalhos: { "X-Frame-Options": "DENY" },
    deliveryVersion: "1.26.0+a.b.c",
    ...extra,
  };
}

/** Serviço de arquivos que guarda o pedido recebido e devolve a resposta dada. */
function ambiente(
  resposta: () => Response = () =>
    new Response("<html>app</html>", {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    }),
) {
  const pedidos: Request[] = [];
  const env: AmbienteDaHospedagem = {
    ASSETS: {
      fetch: async (request) => {
        pedidos.push(request);
        return resposta();
      },
    },
  };
  return { env, pedidos };
}

const produtoBase = {
  id: ID,
  nome: "Tênis",
  descricao: "Leve",
  preco_venda: 100,
  imagem_url: "https://abc.supabase.co/storage/v1/object/public/p/1.jpg",
  imagem_urls: null,
};

/** Cada chamada recebe o MESMO JSON, numa resposta nova (corpo de leitura única). */
function fetchDe(lista: unknown, init: ResponseInit = {}) {
  return vi.fn(
    async () => new Response(JSON.stringify(lista), { status: 200, ...init }),
  );
}

async function previa(
  produto: Record<string, unknown>,
  cfg: HospedagemConfig = config(),
) {
  const { env } = ambiente();
  const resposta = await criarWorker(cfg, {
    fetchImpl: fetchDe([{ ...produtoBase, ...produto }]),
  }).fetch(
    new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
      headers: ROBO,
    }),
    env,
  );
  return { resposta, html: await resposta.text() };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("o limite de tamanho e o prazo padrão da leitura ao banco", () => {
  it("as constantes públicas valem 64 KiB e 2,5 s", () => {
    expect(CORPO_MAXIMO).toBe(65536);
    expect(PRAZO_MS).toBe(2500);
  });

  it("sem prazoMs nas opções, os dois pedidos (produto e variações) levam o prazo padrão de 2500 ms", async () => {
    const espia = vi.spyOn(AbortSignal, "timeout");
    const { env } = ambiente();
    await criarWorker(config(), {
      fetchImpl: fetchDe([produtoBase]),
    }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    expect(espia.mock.calls.map((c) => c[0])).toEqual([2500, 2500]);
  });

  /** JSON válido (lista com o produto) preenchido com espaços até `bytes` bytes. */
  function listaComBytes(bytes: number): string {
    const base = JSON.stringify([{ ...produtoBase, nome: "Tenis" }]);
    return base.padEnd(bytes, " ");
  }

  it("corpo de EXATAMENTE 64 KiB ainda vale: a prévia sai com o produto", async () => {
    const { env } = ambiente();
    const impl = vi.fn(async () => new Response(listaComBytes(65536)));
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    expect(r.headers.get("x-ikcous-og")).toBe("produto");
    expect(await r.text()).toContain("<h1>Tenis</h1>");
  });

  it("corpo de 64 KiB + 1 byte é recusado: cai em sem-produto", async () => {
    const { env } = ambiente();
    const impl = vi.fn(async () => new Response(listaComBytes(65537)));
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    expect(r.headers.get("x-ikcous-og")).toBe("sem-produto");
  });

  it("corpo grande demais é CANCELADO na origem, não lido até o fim", async () => {
    const { env } = ambiente();
    let cancelamentos = 0;
    const impl = vi.fn(async () => {
      const grande = new ReadableStream<Uint8Array>({
        start(controle) {
          controle.enqueue(new TextEncoder().encode("x".repeat(70000)));
        },
        cancel() {
          cancelamentos++;
        },
      });
      return new Response(grande, { status: 200 });
    });
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    expect(r.headers.get("x-ikcous-og")).toBe("sem-produto");
    // Uma leitura para o produto e outra para as variações.
    expect(cancelamentos).toBe(2);
  });
});

describe("idValido — o formato do UUID, de ponta a ponta", () => {
  it("UUID em MAIÚSCULAS vale (o id pode chegar copiado em caixa alta)", () => {
    expect(idValido(ID.toUpperCase())).toBe(true);
  });

  it("lixo ANTES do UUID não vale (a regra é ancorada no começo)", () => {
    expect(idValido(`x${ID}`)).toBe(false);
    expect(idValido(` ${ID}`)).toBe(false);
  });
});

describe("hostPermitido — o curinga '*.dominio' e o host exato", () => {
  it("'*.supabase.co' aceita subdomínio e recusa o domínio nu", () => {
    expect(hostPermitido("abc.supabase.co", ["*.supabase.co"])).toBe(true);
    expect(hostPermitido("supabase.co", ["*.supabase.co"])).toBe(false);
  });

  it("'*.supabase.co' recusa o sufixo sem nada na frente (só o ponto)", () => {
    expect(hostPermitido(".supabase.co", ["*.supabase.co"])).toBe(false);
  });

  it("host comprido que NÃO termina no domínio do curinga é recusado", () => {
    expect(
      hostPermitido("um-host-bem-comprido.example.com", ["*.supabase.co"]),
    ).toBe(false);
  });

  it("'*.dominio' só vale com o ponto: 'xsupabase.co' não é subdomínio", () => {
    expect(hostPermitido("xsupabase.co", ["*.supabase.co"])).toBe(false);
  });

  it("entrada que começa com '*' mas sem ponto NÃO é curinga: só compara igual", () => {
    expect(hostPermitido("xfoo.com", ["*foo.com"])).toBe(false);
    expect(hostPermitido("*foo.com", ["*foo.com"])).toBe(true);
  });

  it("host exato não vira 'termina com': 'evil-images.unsplash.com' não é 'images.unsplash.com'", () => {
    expect(
      hostPermitido("evil-images.unsplash.com", ["images.unsplash.com"]),
    ).toBe(false);
    expect(hostPermitido("images.unsplash.com", ["images.unsplash.com"])).toBe(
      true,
    );
  });
});

describe("imagemPermitida — a porta conta como parte do endereço", () => {
  it("imagem da própria loja em OUTRA porta é recusada", () => {
    expect(
      imagemPermitida(
        "https://loja-exclusiva.invalid:8443/x.png",
        config({ hostsDeImagem: [] }),
      ),
    ).toBe(false);
  });

  it("imagem na MESMA porta da loja é aceita", () => {
    expect(
      imagemPermitida(
        "https://loja.invalid:8443/x.png",
        config({ publicUrl: "https://loja.invalid:8443", hostsDeImagem: [] }),
      ),
    ).toBe(true);
  });
});

describe("a prévia (HTML) — texto, fotos e preço nas bordas", () => {
  it("só uma lista vira produto: objeto que imita lista ({length:1,'0':...}) não gera prévia", async () => {
    const { env } = ambiente();
    const impl = vi.fn(
      async () =>
        new Response(JSON.stringify({ length: 1, 0: produtoBase }), {
          status: 200,
        }),
    );
    const r = await criarWorker(config(), { fetchImpl: impl }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    expect(r.headers.get("x-ikcous-og")).toBe("sem-produto");
  });

  it("nome e descrição só de espaços caem nos textos padrão da loja", async () => {
    const { html } = await previa({ nome: "   ", descricao: "   " });
    expect(html).toContain(
      "<title>Produto - Loja &amp; Cia | Loja &amp; Cia</title>",
    );
    expect(html).toContain(
      '<meta name="description" content="Confira os detalhes do produto no Loja &amp; Cia.">',
    );
  });

  it("preço com mais de 2 casas arredonda para centavos: 14,999 vira R$ 15,00", async () => {
    const { html } = await previa({ preco_venda: 14.999 });
    expect(html).toContain("- R$ 15,00 |");
    expect(html).not.toContain("14,999");
  });

  it("a foto de imagem_urls vem ANTES de imagem_url", async () => {
    const { html } = await previa({
      imagem_urls: [
        "https://abc.supabase.co/storage/v1/object/public/p/GALERIA.jpg",
      ],
      imagem_url: "https://abc.supabase.co/storage/v1/object/public/p/CAPA.jpg",
    });
    expect(html).toContain(
      '<meta property="og:image" content="https://abc.supabase.co/storage/v1/object/public/p/GALERIA.jpg">',
    );
  });

  it("endereço da foto com espaços nas pontas sai aparado no og:image", async () => {
    const { html } = await previa({
      imagem_url:
        "  https://abc.supabase.co/storage/v1/object/public/p/1.jpg  ",
    });
    expect(html).toContain(
      '<meta property="og:image" content="https://abc.supabase.co/storage/v1/object/public/p/1.jpg">',
    );
  });

  it("as metas fixas da prévia: documento em pt-BR, tipo 'product' e cartão grande do Twitter", async () => {
    const { html } = await previa({});
    expect(html).toContain('<html lang="pt-BR">');
    expect(html).toContain('<meta property="og:type" content="product">');
    expect(html).toContain(
      '<meta name="twitter:card" content="summary_large_image">',
    );
  });
});

describe("o documento da loja (quem não é robô) e os cabeçalhos da resposta", () => {
  it("o pedido ao serviço de arquivos leva os cabeçalhos do navegador (validador de cache incluído)", async () => {
    const { env, pedidos } = ambiente();
    await criarWorker(config(), { fetchImpl: fetchDe([produtoBase]) }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: {
          ...NAVEGADOR,
          "if-none-match": '"abc"',
          "accept-language": "pt-BR",
        },
      }),
      env,
    );
    expect(pedidos[0].headers.get("if-none-match")).toBe('"abc"');
    expect(pedidos[0].headers.get("accept-language")).toBe("pt-BR");
  });

  it("o que o serviço de arquivos manda SOBREPÕE o cabeçalho semente da configuração", async () => {
    const { env } = ambiente(
      () =>
        new Response("<html>app</html>", {
          status: 200,
          headers: { "cache-control": "no-store" },
        }),
    );
    const r = await criarWorker(
      config({
        cabecalhos: {
          "X-Frame-Options": "DENY",
          "Cache-Control": "public, max-age=31536000",
        },
      }),
      { fetchImpl: fetchDe([produtoBase]) },
    ).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: NAVEGADOR,
      }),
      env,
    );
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.headers.get("x-frame-options")).toBe("DENY");
  });

  it("HEAD de navegador devolve o documento SEM corpo, mesmo que o serviço de arquivos mande um", async () => {
    const { env } = ambiente(
      () =>
        new Response("<html>corpo que não pode sair</html>", { status: 200 }),
    );
    const r = await criarWorker(config(), {
      fetchImpl: fetchDe([produtoBase]),
    }).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        method: "HEAD",
        headers: NAVEGADOR,
      }),
      env,
    );
    expect(r.status).toBe(200);
    expect(await r.text()).toBe("");
  });

  it("o Vary da prévia SOMA ao Vary que a hospedagem já mandava, não o apaga", async () => {
    const { env } = ambiente();
    const r = await criarWorker(
      config({
        cabecalhos: { "X-Frame-Options": "DENY", Vary: "Accept-Encoding" },
      }),
      { fetchImpl: fetchDe([produtoBase]) },
    ).fetch(
      new Request(`https://loja.exemplo/product-detail?id=${ID}`, {
        headers: ROBO,
      }),
      env,
    );
    expect(r.headers.get("x-ikcous-og")).toBe("produto");
    expect(r.headers.get("vary")).toBe(
      "Accept-Encoding, user-agent, sec-fetch-dest, sec-fetch-mode",
    );
  });
});
