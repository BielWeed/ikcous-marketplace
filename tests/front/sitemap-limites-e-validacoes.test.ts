/* eslint-disable security/detect-non-literal-fs-filename -- teste: os caminhos são de pastas temporárias criadas pelo próprio teste, nunca de entrada externa. */
import { mkdtempSync, rmSync } from "node:fs";
// Limites e validações de scripts/sitemap.mjs que os testes vizinhos
// (sitemap-seo.test.ts, mapa-do-site.test.ts) deixavam passar — achados por
// mutação (trocar `>` por `>=`, `<` por `<=`, `?.` por `.`, `??` por `||`).
//
// O gerador roda no BUILD de cada loja e FALHA O BUILD (em vez de truncar o
// sitemap) quando o catálogo foge do esperado. Os tetos são o contrato:
//   - corpo de uma página do PostgREST: até 512 KiB INCLUSIVE;
//   - produtos: até `maxProdutos` INCLUSIVE, mesmo na última página (curta);
//   - tamanho de página e teto de produtos: inteiros >= 1 (0 NÃO vale, e `0` não
//     pode virar o valor padrão por `||`);
//   - a conexão precisa ser `database` e o publicUrl precisa ser a raiz https.
import fs from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
// Módulo JS sem declaração de tipos, mesmo padrão de sitemap-seo.test.ts.
// @ts-expect-error Módulo JS nativo sem declaração; testado pelo contrato de runtime.
import * as sitemap from "../../scripts/sitemap.mjs";

const CONEXAO = {
  kind: "database",
  origin: "https://abc.supabase.co",
  key: "chave-de-teste",
  keyClass: "publishable",
};

/** fetch falso que devolve as páginas na ordem, como texto. */
function paginas(...corpos: string[]) {
  const chamadas: string[] = [];
  const fetchImpl = vi.fn(async (url: string) => {
    chamadas.push(url);
    const corpo = corpos[chamadas.length - 1] ?? "[]";
    return { ok: true, status: 200, text: async () => corpo } as Response;
  });
  return { fetchImpl, chamadas };
}

const lista = (...ids: string[]) => JSON.stringify(ids.map((id) => ({ id })));

afterEach(() => {
  vi.restoreAllMocks();
});

describe("constantes públicas do gerador", () => {
  it("prazo, página e teto de produtos são os documentados", () => {
    expect(sitemap.PRAZO_MS).toBe(20000);
    expect(sitemap.PAGINA).toBe(1000);
    expect(sitemap.MAX_PRODUTOS).toBe(10000);
  });
});

describe("publicUrlValido", () => {
  it("aceita só a raiz https, sem barra final", () => {
    expect(sitemap.publicUrlValido("https://loja.exemplo.com")).toBe(
      "https://loja.exemplo.com",
    );
  });

  it.each([
    ["http (sem TLS)", "http://loja.exemplo.com"],
    ["barra final", "https://loja.exemplo.com/"],
    ["subcaminho", "https://loja.exemplo.com/sub"],
    ["query", "https://loja.exemplo.com?a=1"],
    ["fragmento", "https://loja.exemplo.com#x"],
    ["relativo", "/sitemap.xml"],
    ["vazio", ""],
  ])("recusa %s com o texto do erro", (_nome, valor) => {
    expect(() => sitemap.publicUrlValido(valor)).toThrow(
      `SITEMAP_PUBLIC_URL (${valor})`,
    );
  });

  it.each([[undefined], [null], [42], [{}]])(
    "recusa valor que não é texto (%s)",
    (valor) => {
      expect(() => sitemap.publicUrlValido(valor)).toThrow(
        /^SITEMAP_PUBLIC_URL/,
      );
    },
  );
});

describe("buscarIdsDeProdutos — validações das opções", () => {
  it("exige conexão do tipo database (ausente, nula ou de outro tipo)", async () => {
    for (const conexao of [undefined, null, { kind: "fixture" }, {}]) {
      await expect(
        sitemap.buscarIdsDeProdutos(conexao as never),
      ).rejects.toThrow("SITEMAP_CONNECTION");
    }
  });

  it.each([[0], [-1], [1.5], [Number.NaN], ["10"]])(
    "tamanho de página %s é recusado (zero NÃO vira o padrão)",
    async (pagina) => {
      const { fetchImpl } = paginas("[]");
      await expect(
        sitemap.buscarIdsDeProdutos(CONEXAO, { fetchImpl, pagina } as never),
      ).rejects.toThrow(`SITEMAP_PAGINA (${pagina})`);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it.each([[0], [-1], [2.5], [Number.NaN]])(
    "teto de produtos %s é recusado (zero NÃO vira o padrão)",
    async (maxProdutos) => {
      const { fetchImpl } = paginas("[]");
      await expect(
        sitemap.buscarIdsDeProdutos(CONEXAO, {
          fetchImpl,
          maxProdutos,
        } as never),
      ).rejects.toThrow(`SITEMAP_MAX_PRODUTOS (${maxProdutos})`);
      expect(fetchImpl).not.toHaveBeenCalled();
    },
  );

  it("página de 1 e teto de 1 são válidos (o mínimo aceito)", async () => {
    const { fetchImpl } = paginas(lista("p1"), "[]");
    await expect(
      sitemap.buscarIdsDeProdutos(CONEXAO, {
        fetchImpl,
        pagina: 1,
        maxProdutos: 1,
      }),
    ).resolves.toEqual(["p1"]);
  });
});

describe("buscarIdsDeProdutos — tetos", () => {
  it("até o teto de produtos INCLUSIVE passa; um a mais reprova", async () => {
    const ok = paginas(lista("a", "b"));
    await expect(
      sitemap.buscarIdsDeProdutos(CONEXAO, {
        fetchImpl: ok.fetchImpl,
        maxProdutos: 2,
        pagina: 5,
      }),
    ).resolves.toEqual(["a", "b"]);

    const estoura = paginas(lista("a", "b", "c"));
    await expect(
      sitemap.buscarIdsDeProdutos(CONEXAO, {
        fetchImpl: estoura.fetchImpl,
        maxProdutos: 2,
        pagina: 5,
      }),
    ).rejects.toThrow("SITEMAP_LIMITE");
  });

  it("o teto vale no ACUMULADO de várias páginas, e a página final curta também conta", async () => {
    const { fetchImpl } = paginas(lista("a", "b"), lista("c"));
    await expect(
      sitemap.buscarIdsDeProdutos(CONEXAO, {
        fetchImpl,
        pagina: 2,
        maxProdutos: 2,
      }),
    ).rejects.toThrow("SITEMAP_LIMITE");
  });

  it("corpo de EXATAMENTE 512 KiB passa; um caractere a mais reprova", async () => {
    const base = lista("a");
    const exato = base + " ".repeat(512 * 1024 - base.length);
    expect(exato.length).toBe(524288);
    const ok = paginas(exato);
    await expect(
      sitemap.buscarIdsDeProdutos(CONEXAO, { fetchImpl: ok.fetchImpl }),
    ).resolves.toEqual(["a"]);

    const grande = paginas(`${exato} `);
    await expect(
      sitemap.buscarIdsDeProdutos(CONEXAO, { fetchImpl: grande.fetchImpl }),
    ).rejects.toThrow("SITEMAP_CORPO");
  });
});

describe("buscarIdsDeProdutos — forma da resposta", () => {
  it.each([
    ["não é JSON", "isto nao e json"],
    ["objeto no lugar da lista", '{"id":"a"}'],
    ["item nulo", "[null]"],
    ["item texto", '["a"]'],
    ["item número", "[5]"],
    ["id numérico", '[{"id":5}]'],
    ["id vazio", '[{"id":""}]'],
    ["sem id", "[{}]"],
  ])("%s = SITEMAP_SHAPE", async (_nome, corpo) => {
    const { fetchImpl } = paginas(corpo);
    await expect(
      sitemap.buscarIdsDeProdutos(CONEXAO, { fetchImpl }),
    ).rejects.toThrow("SITEMAP_SHAPE");
  });

  it("HTTP de erro vira SITEMAP_HTTP_<status>", async () => {
    const fetchImpl = vi.fn(
      async () =>
        ({ ok: false, status: 503, text: async () => "" }) as Response,
    );
    await expect(
      sitemap.buscarIdsDeProdutos(CONEXAO, { fetchImpl }),
    ).rejects.toThrow("SITEMAP_HTTP_503");
  });

  it("pagina com keyset: a 2ª chamada continua do último id, e a última página curta encerra", async () => {
    const { fetchImpl, chamadas } = paginas(lista("a", "b"), lista("c"));
    const ids = await sitemap.buscarIdsDeProdutos(CONEXAO, {
      fetchImpl,
      pagina: 2,
    });
    expect(ids).toEqual(["a", "b", "c"]);
    expect(chamadas).toEqual([
      "https://abc.supabase.co/rest/v1/vw_produtos_public?select=id&order=id.asc&limit=2",
      "https://abc.supabase.co/rest/v1/vw_produtos_public?select=id&order=id.asc&limit=2&id=gt.b",
    ]);
  });
});

describe("buscarIdsDeProdutos — prazo da requisição", () => {
  it("o prazo informado vira o AbortSignal da chamada (0 NÃO é trocado pelo padrão de 20 s)", async () => {
    let sinal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      sinal = init.signal as AbortSignal;
      return { ok: true, status: 200, text: async () => "[]" } as Response;
    });
    await sitemap.buscarIdsDeProdutos(CONEXAO, { fetchImpl, prazoMs: 0 });
    await new Promise((r) => setTimeout(r, 30));
    expect(sinal?.aborted).toBe(true);

    await sitemap.buscarIdsDeProdutos(CONEXAO, { fetchImpl });
    await new Promise((r) => setTimeout(r, 30));
    expect(sinal?.aborted).toBe(false);
  });
});

describe("gerarSitemap", () => {
  const entrega = (publicUrl: string | undefined) => ({
    connection: CONEXAO,
    snapshot: publicUrl === undefined ? undefined : { publicUrl },
  });

  it("sem entrega, sem conexão ou com conexão que não é database: não escreve nada e devolve lista vazia", async () => {
    for (const delivery of [
      undefined,
      {},
      { connection: undefined },
      { connection: { kind: "fixture" } },
    ]) {
      await expect(
        sitemap.gerarSitemap("/nao/existe", delivery as never),
      ).resolves.toEqual([]);
    }
  });

  it("entrega de banco sem snapshot/publicUrl reprova com SITEMAP_PUBLIC_URL (não cai em TypeError)", async () => {
    await expect(
      sitemap.gerarSitemap("/nao/existe", entrega(undefined) as never),
    ).rejects.toThrow("SITEMAP_PUBLIC_URL (undefined)");
  });

  it("escreve robots.txt e sitemap.xml, na ordem, com o catálogo e o publicUrl", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "h36-sitemap-"));
    try {
      const { fetchImpl } = paginas(lista("p1", "p2"));
      const nomes = await sitemap.gerarSitemap(
        pasta,
        entrega("https://loja.exemplo.com") as never,
        { fetchImpl },
      );
      expect(nomes).toEqual(["robots.txt", "sitemap.xml"]);
      expect(Object.isFrozen(nomes)).toBe(false);
      expect(await fs.readFile(join(pasta, "robots.txt"), "utf8")).toBe(
        "User-agent: *\nAllow: /\n\nSitemap: https://loja.exemplo.com/sitemap.xml\n",
      );
      const xml = await fs.readFile(join(pasta, "sitemap.xml"), "utf8");
      expect(xml).toContain("<loc>https://loja.exemplo.com/</loc>");
      expect(xml).toContain(
        "<loc>https://loja.exemplo.com/product-detail?id=p1</loc>",
      );
      expect(xml).toContain(
        "<loc>https://loja.exemplo.com/product-detail?id=p2</loc>",
      );
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it("se a releitura do arquivo gravado difere do que foi escrito, o build reprova nomeando o arquivo", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "h36-sitemap-"));
    try {
      const { fetchImpl } = paginas(lista("p1"));
      vi.spyOn(fs, "readFile").mockResolvedValue("conteudo diferente" as never);
      await expect(
        sitemap.gerarSitemap(
          pasta,
          entrega("https://loja.exemplo.com") as never,
          {
            fetchImpl,
          },
        ),
      ).rejects.toThrow("SITEMAP_WRITE_MISMATCH robots.txt");
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });

  it("repassa as opções (teto de produtos) para a busca", async () => {
    const pasta = mkdtempSync(join(tmpdir(), "h36-sitemap-"));
    try {
      const { fetchImpl } = paginas(lista("a", "b"));
      await expect(
        sitemap.gerarSitemap(
          pasta,
          entrega("https://loja.exemplo.com") as never,
          {
            fetchImpl,
            maxProdutos: 1,
          },
        ),
      ).rejects.toThrow("SITEMAP_LIMITE");
    } finally {
      rmSync(pasta, { recursive: true, force: true });
    }
  });
});
