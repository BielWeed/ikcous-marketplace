// L8 (26/11/2026, lote 2, tarefas 2.2 e 2.3) — a loja ADORMECIDA ou
// ENCERRADA tem página própria, servida pelo porteiro SEM tocar o banco da
// loja (decisão do sócio D2: o texto fala com a CLIENTE da loja).
//
//   adormecida -> 503, `retry-after: 3600`, "<Nome> está fechada no momento."
//   encerrada  -> 410,                      "<Nome> não está mais no ar."
//
// Linha pequena "É a dona desta loja? Fale com a IKCOUS para reabrir", com
// link SÓ quando `IKCOUS_LINK_ACORDAR` existe e é `https:`. Sem script, sem
// marca da loja (só o nome, que vem da caderneta e é escapado).
//
// O que mais dói aqui é o porteiro tocar o banco de uma loja que não paga
// mais (ou servir a vitrine velha dela). Por isso TODO teste passa um
// `fetchImpl` espião que lança se for chamado: a página não pode depender de
// nenhum pedido de rede além da caderneta (que aqui é injetada).
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CACHE_FORA_DO_AR_MS,
  atenderPorteiro,
  obterFichaValidada,
  respostaForaDoAr,
} from "@/hospedagem/porteiro";
import type {
  AmbientePorteiro,
  DependenciasPorteiro,
  EntradaCacheForaDoAr,
  EntradaCachePorteiro,
  ResolverLojaNaCaderneta,
  ResultadoCaderneta,
} from "@/hospedagem/porteiro";
import middleware from "../../middleware";

const REF = "abcdefghijklmnopqrst";
const ORIGEM_DA_LOJA = `https://${REF}.supabase.co`;

const AMBIENTE: AmbientePorteiro = {
  IKCOUS_FROTA_URL: "https://principal.supabase.co",
  IKCOUS_FROTA_APIKEY: "sb_publishable_principal",
  IKCOUS_FROTA_CHAVE: "segredo-de-teste",
};

/** Espião que FALHA o teste se for chamado (a página não usa rede). */
function fetchProibido() {
  return vi.fn(async (input: RequestInfo | URL) => {
    throw new Error(
      `o porteiro pediu à rede numa loja fora do ar: ${String(input instanceof Request ? input.url : input)}`,
    );
  });
}

function cadernetaForaDoAr(
  estado: "adormecida" | "encerrada",
  nome = "Loja Bela",
) {
  return vi.fn<ResolverLojaNaCaderneta>(async () => ({
    tipo: "fora-do-ar",
    estado,
    ref: REF,
    nome,
  }));
}

function deps(
  fetchImpl: typeof fetch,
  resolverNaCaderneta: ResolverLojaNaCaderneta,
  extra: Partial<DependenciasPorteiro> = {},
): DependenciasPorteiro {
  return {
    fetchImpl,
    resolverNaCaderneta,
    cache: new Map<string, EntradaCachePorteiro>(),
    ...extra,
  };
}

const pedido = (caminho = "/", init: RequestInit = {}) =>
  new Request(`https://loja-bela.exemplo${caminho}`, init);

/** O botão "Tentar de novo" da loja adormecida: um link para a própria página
 * (href vazio), como o da página de manutenção — recarrega sem script. */
const BOTAO_TENTAR_DE_NOVO = /<a [^>]*href=""[^>]*>\s*Tentar de novo\s*<\/a>/;
/** O mesmo, global: para contar e para tirar todos (`match`/`replace`). */
const TODOS_OS_BOTOES = /<a [^>]*href=""[^>]*>\s*Tentar de novo\s*<\/a>/g;

/** A página sem o botão "Tentar de novo": o que sobra de `<a` é o link de
 * acordar (o único que depende de `IKCOUS_LINK_ACORDAR`). */
const semOBotao = (html: string) => html.replace(TODOS_OS_BOTOES, "");

describe("porteiro — loja ADORMECIDA: 503 próprio, sem tocar o banco da loja", () => {
  it("texto, status e cabeçalhos exatos; fetch e contador NUNCA chamados", async () => {
    const fetchImpl = fetchProibido();
    const contarEntrada = vi.fn();
    const resp = await atenderPorteiro(
      pedido("/", {
        headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" },
      }),
      AMBIENTE,
      deps(
        fetchImpl as unknown as typeof fetch,
        cadernetaForaDoAr("adormecida"),
        {
          contarEntrada,
        },
      ),
    );

    expect(resp.status).toBe(503);
    expect(resp.headers.get("retry-after")).toBe("3600");
    expect(resp.headers.get("cache-control")).toBe("no-store");
    expect(resp.headers.get("content-type")).toBe("text/html; charset=utf-8");
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("adormecida");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("hit");
    expect(resp.headers.get("x-ikcous-estado")).toBe("adormecida");
    expect(resp.headers.get("x-ikcous-ref")).toBe(REF);
    expect(resp.headers.get("x-ikcous-caderneta-versao")).toBeNull();
    const html = await resp.text();
    expect(html).toContain("Loja Bela está fechada no momento.");
    expect(html).toContain("É a dona desta loja?");
    expect(html).toContain("Fale com a IKCOUS para reabrir");
    expect(html).not.toContain("<script");
    expect(semOBotao(html)).not.toContain("<a");
    expect(html).not.toContain("supabase.co");
    expect(html).not.toContain(REF);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(contarEntrada).not.toHaveBeenCalled();
  });

  it("vale para documento, /identidade.json, manifest, robots, sitemap, rota interna e HEAD — sempre a mesma página, nunca a rede", async () => {
    const fetchImpl = fetchProibido();
    for (const [caminho, metodo] of [
      ["/", "GET"],
      ["/identidade.json", "GET"],
      ["/manifest.webmanifest", "GET"],
      ["/robots.txt", "GET"],
      ["/sitemap.xml", "GET"],
      ["/produto/123", "GET"],
      ["/", "HEAD"],
    ] as const) {
      const resp = await atenderPorteiro(
        pedido(caminho, { method: metodo }),
        AMBIENTE,
        deps(
          fetchImpl as unknown as typeof fetch,
          cadernetaForaDoAr("adormecida"),
        ),
      );
      expect(resp.status, caminho).toBe(503);
      expect(resp.headers.get("x-ikcous-porteiro"), caminho).toBe("adormecida");
    }
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

describe("porteiro — loja ENCERRADA: 410 próprio", () => {
  it("texto, status e cabeçalhos exatos; sem retry-after; fetch e contador NUNCA chamados", async () => {
    const fetchImpl = fetchProibido();
    const contarEntrada = vi.fn();
    const resp = await atenderPorteiro(
      pedido("/"),
      AMBIENTE,
      deps(
        fetchImpl as unknown as typeof fetch,
        cadernetaForaDoAr("encerrada"),
        {
          contarEntrada,
        },
      ),
    );
    expect(resp.status).toBe(410);
    expect(resp.headers.get("retry-after")).toBeNull();
    expect(resp.headers.get("cache-control")).toBe("no-store");
    expect(resp.headers.get("x-ikcous-porteiro")).toBe("encerrada");
    expect(resp.headers.get("x-ikcous-caderneta")).toBe("hit");
    expect(resp.headers.get("x-ikcous-estado")).toBe("encerrada");
    expect(resp.headers.get("x-ikcous-ref")).toBe(REF);
    const html = await resp.text();
    expect(html).toContain("Loja Bela não está mais no ar.");
    expect(html).not.toContain("está fechada no momento");
    expect(html).toContain("É a dona desta loja?");
    expect(html).not.toContain("<script");
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(contarEntrada).not.toHaveBeenCalled();
  });
});

describe("porteiro — o link 'Fale com a IKCOUS' só existe com IKCOUS_LINK_ACORDAR https:", () => {
  it.each([
    ["ausente", undefined],
    ["vazio", ""],
    ["javascript:", "javascript:alert(1)"],
    ["http: (sem TLS)", "http://ikcous.exemplo/acordar"],
    ["data:", "data:text/html,<b>x</b>"],
    ["lixo que não é URL", "não é um endereço"],
  ])("%s -> sem <a>", async (_nome, valor) => {
    const html = await respostaForaDoAr(
      { estado: "adormecida", nome: "Loja Bela", ref: REF },
      "hit",
      valor,
    ).text();
    expect(semOBotao(html)).not.toContain("<a");
    expect(html).not.toContain("javascript");
    expect(html).toContain("Fale com a IKCOUS para reabrir");
  });

  it("https: -> <a href> com o endereço escapado, nas duas páginas", async () => {
    for (const estado of ["adormecida", "encerrada"] as const) {
      const html = await respostaForaDoAr(
        { estado, nome: "Loja Bela", ref: REF },
        "hit",
        'https://wa.me/5511999999999?text=Oi&x="y"',
      ).text();
      expect(html).toContain(
        '<a href="https://wa.me/5511999999999?text=Oi&amp;x=%22y%22">Fale com a IKCOUS para reabrir</a>',
      );
    }
  });

  it("a variável chega do AMBIENTE do porteiro até a página", async () => {
    const resp = await atenderPorteiro(
      pedido("/"),
      { ...AMBIENTE, IKCOUS_LINK_ACORDAR: "https://ikcous.exemplo/reabrir" },
      deps(
        fetchProibido() as unknown as typeof fetch,
        cadernetaForaDoAr("adormecida"),
      ),
    );
    expect(await resp.text()).toContain(
      '<a href="https://ikcous.exemplo/reabrir">',
    );
  });
});

describe("porteiro — o nome da loja vem da caderneta e é ESCAPADO", () => {
  it("nome com HTML/aspas/& não injeta nada", async () => {
    const nome = `<script>alert("x")</script> & 'Cia' <img src=x onerror=y>`;
    for (const estado of ["adormecida", "encerrada"] as const) {
      const html = await respostaForaDoAr(
        { estado, nome, ref: REF },
        "hit",
        undefined,
      ).text();
      expect(html).not.toContain("<script");
      expect(html).not.toContain("<img");
      expect(html).toContain(
        "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;Cia&#39; &lt;img src=x onerror=y&gt;",
      );
    }
  });

  it("nome vazio ou só espaços -> 'Esta loja' (nunca uma frase sem sujeito)", async () => {
    const html = await respostaForaDoAr(
      { estado: "adormecida", nome: "   ", ref: REF },
      "hit",
      undefined,
    ).text();
    expect(html).toContain("Esta loja está fechada no momento.");
  });
});

// A loja adormecida volta quando a conta acerta. No iPhone com o app
// instalado não há barra nem "puxar para atualizar": sem botão nem recarga, a
// cliente ficava presa nesta página até matar o app. Mesmo jeito da página de
// manutenção (`pagina-de-manutencao-viewport-refresh-e-botao.test.ts`): link
// para a própria página + `<meta http-equiv="refresh">`, SEM script (a CSP de
// produção só libera 1 hash em script-src). Recarga a cada 15 min: a loja não
// volta em instantes, e 15 min é mais cedo que o `retry-after` de 1 h sem
// martelar o porteiro. A ENCERRADA não volta: nem botão, nem recarga.
describe("porteiro — loja ADORMECIDA tem 'Tentar de novo' e recarga de 15 min; ENCERRADA não", () => {
  const RECARGA = /<meta http-equiv="refresh" content="(\d+)"\s*\/?>/;
  const TODAS_AS_RECARGAS = /<meta http-equiv="refresh" content="\d+"\s*\/?>/g;

  it("adormecida: botão para a própria página e recarga a cada 900 s, sem script nem atributo de evento", async () => {
    const html = await respostaForaDoAr(
      { estado: "adormecida", nome: "Loja Bela", ref: REF },
      "hit",
      undefined,
    ).text();
    expect(html).toMatch(BOTAO_TENTAR_DE_NOVO);
    expect(html.match(TODOS_OS_BOTOES)).toHaveLength(1);
    expect(html.match(RECARGA)?.[1]).toBe("900");
    expect(html.match(TODAS_AS_RECARGAS)).toHaveLength(1);
    expect(html).toContain("Loja Bela está fechada no momento.");
    expect(html).not.toContain("<script");
    expect(html).not.toMatch(/\son[a-z]+\s*=/i);
  });

  it("adormecida pelo porteiro inteiro (documento): o botão e a recarga chegam à cliente", async () => {
    const resp = await atenderPorteiro(
      pedido("/produto/123", {
        headers: { "sec-fetch-dest": "document", "sec-fetch-mode": "navigate" },
      }),
      AMBIENTE,
      deps(
        fetchProibido() as unknown as typeof fetch,
        cadernetaForaDoAr("adormecida"),
      ),
    );
    expect(resp.status).toBe(503);
    const html = await resp.text();
    expect(html).toMatch(BOTAO_TENTAR_DE_NOVO);
    expect(html.match(RECARGA)?.[1]).toBe("900");
  });

  it("adormecida COM o link de acordar: os dois convivem e o de acordar continua sendo o único com endereço", async () => {
    const html = await respostaForaDoAr(
      { estado: "adormecida", nome: "Loja Bela", ref: REF },
      "hit",
      "https://ikcous.exemplo/reabrir",
    ).text();
    expect(html).toMatch(BOTAO_TENTAR_DE_NOVO);
    expect(semOBotao(html).match(/<a /g)).toHaveLength(1);
    expect(semOBotao(html)).toContain(
      '<a href="https://ikcous.exemplo/reabrir">Fale com a IKCOUS para reabrir</a>',
    );
  });

  it("encerrada: nem botão, nem recarga, nem link para a própria página", async () => {
    for (const link of [undefined, "https://ikcous.exemplo/reabrir"]) {
      const html = await respostaForaDoAr(
        { estado: "encerrada", nome: "Loja Bela", ref: REF },
        "hit",
        link,
      ).text();
      expect(html).not.toContain("Tentar de novo");
      expect(html).not.toContain('href=""');
      expect(html).not.toMatch(/http-equiv="refresh"/i);
      expect(html).toContain("Loja Bela não está mais no ar.");
    }
  });
});

describe("porteiro — decisão fora-do-ar guardada por 60 s (2.3)", () => {
  it("dentro de 60 s a caderneta NÃO é perguntada de novo; depois de 60 s, é", async () => {
    let agora = 1_000_000;
    const caderneta = cadernetaForaDoAr("adormecida");
    const cacheForaDoAr = new Map<string, EntradaCacheForaDoAr>();
    const d = deps(fetchProibido() as unknown as typeof fetch, caderneta, {
      cacheForaDoAr,
      agora: () => agora,
    });
    expect((await atenderPorteiro(pedido("/"), AMBIENTE, d)).status).toBe(503);
    agora += CACHE_FORA_DO_AR_MS - 1;
    const doCache = await atenderPorteiro(pedido("/a"), AMBIENTE, d);
    expect(doCache.status).toBe(503);
    expect(doCache.headers.get("x-ikcous-ref")).toBe(REF);
    expect(caderneta).toHaveBeenCalledTimes(1);
    agora += 1;
    await atenderPorteiro(pedido("/"), AMBIENTE, d);
    expect(caderneta).toHaveBeenCalledTimes(2);
    expect(CACHE_FORA_DO_AR_MS).toBe(60_000);
  });

  it("a loja que ACORDA volta no máximo 60 s depois (a decisão guardada vence e some)", async () => {
    let agora = 5_000_000;
    let estado: "adormecida" | "ativa" = "adormecida";
    const cacheForaDoAr = new Map<string, EntradaCacheForaDoAr>();
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(
      async (): Promise<ResultadoCaderneta> =>
        estado === "adormecida"
          ? { tipo: "fora-do-ar", estado, ref: REF, nome: "Loja Bela" }
          : { tipo: "miss" },
    );
    const d = deps(fetchProibido() as unknown as typeof fetch, caderneta, {
      cacheForaDoAr,
      agora: () => agora,
    });
    expect((await atenderPorteiro(pedido("/"), AMBIENTE, d)).status).toBe(503);
    estado = "ativa";
    agora += CACHE_FORA_DO_AR_MS;
    const depois = await atenderPorteiro(pedido("/"), AMBIENTE, d);
    // `miss` aqui só para não precisar montar uma loja inteira: o que se
    // prova é que a caderneta foi perguntada de novo e a decisão velha saiu.
    expect(depois.headers.get("x-ikcous-porteiro")).toBe("sem-loja");
  });

  // A loja ATIVA de ponta a ponta (hit -> ficha) está nos porteiro-*.test.ts
  // existentes; aqui o caminho mais curto que NÃO é fora-do-ar (miss).
  it("decisão que não é fora-do-ar nunca grava no cache de fora-do-ar", async () => {
    const cacheForaDoAr = new Map<string, EntradaCacheForaDoAr>();
    const caderneta = vi.fn<ResolverLojaNaCaderneta>(async () => ({
      tipo: "miss",
    }));
    await atenderPorteiro(
      pedido("/"),
      AMBIENTE,
      deps(fetchProibido() as unknown as typeof fetch, caderneta, {
        cacheForaDoAr,
      }),
    );
    expect(cacheForaDoAr.size).toBe(0);
  });

  it("a ficha ANTIGA da loja (de quando estava ativa) é descartada: uma falha da caderneta depois NÃO serve a vitrine velha", async () => {
    let agora = 9_000_000;
    let resposta: ResultadoCaderneta = {
      tipo: "fora-do-ar",
      estado: "adormecida",
      ref: REF,
      nome: "Loja Bela",
    };
    const cache = new Map<string, EntradaCachePorteiro>();
    // Ficha de 70 s atrás (vencida para o fresco, viva para o stale-if-error).
    cache.set("loja-bela.exemplo", {
      ficha: { host: "loja-bela.exemplo" } as EntradaCachePorteiro["ficha"],
      quando: agora - 70_000,
      caderneta: "hit",
    });
    const fetchImpl = fetchProibido();
    const d = deps(
      fetchImpl as unknown as typeof fetch,
      vi.fn<ResolverLojaNaCaderneta>(async () => resposta),
      { cache, cacheForaDoAr: new Map(), agora: () => agora },
    );
    expect((await atenderPorteiro(pedido("/"), AMBIENTE, d)).status).toBe(503);
    expect(cache.has("loja-bela.exemplo")).toBe(false);

    resposta = { tipo: "erro" };
    agora += CACHE_FORA_DO_AR_MS;
    const r = await obterFichaValidada(pedido("/"), AMBIENTE, d);
    expect(r.tipo).toBe("manutencao");
    if (r.tipo !== "manutencao") throw new Error("inalcançável");
    expect(r.resposta.headers.get("x-ikcous-porteiro")).toBe(
      "banco-indisponivel",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});

// Prova pela BORDA REAL (`middleware()`, com o `resolverNaCaderneta` de
// verdade): o ÚNICO pedido de rede é a RPC da caderneta. Nenhum pedido ao
// banco da loja, nem pelo documento nem pelo ramo do robô de prévia.
describe("middleware — loja fora do ar: o único pedido é à caderneta (documento e robô)", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it.each([
    ["documento", "adormecida", "https://loja-dormindo-mw.exemplo/", {}, 503],
    [
      "robô em /product-detail",
      "encerrada",
      "https://loja-encerrada-mw.exemplo/product-detail?id=9",
      { "user-agent": "WhatsApp/2.23" },
      410,
    ],
  ] as const)(
    "%s (%s) -> página própria; fetch só para resolver_loja_com_estado",
    async (_nome, estado, endereco, cabecalhos, status) => {
      vi.stubEnv("IKCOUS_FROTA_URL", "https://principal.supabase.co");
      vi.stubEnv("IKCOUS_FROTA_APIKEY", "sb_publishable_principal");
      vi.stubEnv("IKCOUS_FROTA_CHAVE", "segredo-de-teste");
      const pedidos: string[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (input: RequestInfo | URL) => {
          const url = new URL(
            input instanceof Request ? input.url : String(input),
          );
          pedidos.push(url.toString());
          if (url.pathname === "/rest/v1/rpc/resolver_loja_com_estado")
            return new Response(
              JSON.stringify([
                {
                  id: "loja",
                  nome: "Loja Bela",
                  dominio_publico: new URL(endereco).hostname,
                  project_ref: REF,
                  supabase_url: null,
                  publishable_key: null,
                  estado,
                },
              ]),
              { status: 200, headers: { "content-type": "application/json" } },
            );
          throw new Error(`pedido proibido: ${url.toString()}`);
        }),
      );

      const resp = await middleware(
        new Request(endereco, { headers: cabecalhos }),
      );

      expect(resp.status).toBe(status);
      expect(resp.headers.get("x-ikcous-porteiro")).toBe(estado);
      expect(resp.headers.get("x-ikcous-og")).toBeNull();
      expect(pedidos).toEqual([
        "https://principal.supabase.co/rest/v1/rpc/resolver_loja_com_estado",
      ]);
      expect(pedidos.some((p) => p.startsWith(ORIGEM_DA_LOJA))).toBe(false);
    },
  );
});
