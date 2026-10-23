import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * src/sw/sw.ts — a foto da vitrine tem de ficar guardada para uso offline.
 *
 * O DEFEITO (pwa-performance-3, 23/10/2026): a foto de produto é pedida por
 * `<img>` SEM `crossorigin` (LazyImage). Para o navegador isso é um pedido
 * `mode: "no-cors"`, e `fetch(event.request)` devolve uma resposta OPACA
 * (`status` 0, `type: "opaque"`). O ramo do Storage só guarda `status === 200`,
 * então quase nenhuma foto entrava na gaveta: quem ficava sem sinal depois de
 * navegar via textos e preços, mas a grade em branco, embora o app avisasse
 * "App pronto para uso offline!".
 *
 * O CONSERTO: para `<img>` (destination "image") em modo no-cors, o SW refaz o
 * pedido em modo `cors` sem credenciais — o Storage público responde
 * `Access-Control-Allow-Origin: *` — e guarda essa cópia legível. Falhou de
 * qualquer jeito (rede, CORS, status != 200)? Cai no `fetch(event.request)` de
 * sempre, e a resposta opaca NUNCA vai para a gaveta (cada uma custa ~7 MB de
 * cota no Chrome).
 *
 * Mesmo arnês de sw-nao-guarda-arquivo-privado.test.ts: `environment: "node"`,
 * globais falsos montados ANTES do `await import`, `vi.resetModules()` entre
 * testes (o `sw.ts` registra os listeners no próprio import) e um `caches`
 * falso que GUARDA de verdade, porque a pergunta é "o que sobrou na gaveta".
 */

type Listener = (event: unknown) => void;

const IMAGE_CACHE_NAME = "supabase-images-cache";
const SUPA = "https://xyzcompany.supabase.co";
const FOTO = `${SUPA}/storage/v1/object/public/products/foto.jpg`;
const FOTO_RENDER = `${SUPA}/storage/v1/render/image/public/products/foto.jpg?width=320&resize=contain&quality=75`;
const ASSINADA = `${SUPA}/storage/v1/object/sign/devolucoes/p1/foto.jpg?token=abc`;
// Mesmo valor de MAX_IMAGE_ENTRIES em src/sw/sw.ts.
const TETO = 100;

function criarSelfFalso() {
  const listeners = new Map<string, Listener[]>();
  const selfFalso = {
    location: {
      origin: "https://loja.exemplo.com",
      hostname: "loja.exemplo.com",
    },
    __WB_MANIFEST: [],
    addEventListener(tipo: string, fn: Listener) {
      const atuais = listeners.get(tipo) ?? [];
      atuais.push(fn);
      listeners.set(tipo, atuais);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    registration: { waiting: null },
    skipWaiting: vi.fn(),
  };
  return { selfFalso, listeners };
}

type Entrada = { readonly req: Request; readonly res: Response };

/** `caches` falso que guarda de verdade: Map de URL → {Request, Response}. */
function criarCachesFalso() {
  const gavetas = new Map<string, Map<string, Entrada>>();
  const gravacoes: Array<{ readonly url: string; readonly res: Response }> = [];
  const apagados: string[] = [];
  const chaveDe = (e: string | Request) =>
    new URL(typeof e === "string" ? e : e.url).href;

  function gaveta(nome: string) {
    let g = gavetas.get(nome);
    if (!g) {
      g = new Map();
      gavetas.set(nome, g);
    }
    return g;
  }

  const comportamento = { putFalha: false };

  function criarCache(nome: string) {
    const g = gaveta(nome);
    return {
      match: vi.fn(async (req: string | Request) => g.get(chaveDe(req))?.res),
      put: vi.fn(async (req: string | Request, res: Response) => {
        if (comportamento.putFalha) throw new Error("QuotaExceededError");
        const pedido = typeof req === "string" ? new Request(req) : req;
        gravacoes.push({ url: chaveDe(pedido), res });
        g.set(chaveDe(pedido), { req: pedido, res });
      }),
      addAll: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn(async () => Array.from(g.values()).map((e) => e.req)),
      delete: vi.fn(async (req: string | Request) => {
        apagados.push(chaveDe(req));
        return g.delete(chaveDe(req));
      }),
    };
  }

  const cachesFalso = {
    open: vi.fn(async (nome: string) => criarCache(nome)),
    match: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn(async () => Array.from(gavetas.keys())),
    delete: vi.fn(async (nome: string) => gavetas.delete(nome)),
  };

  return {
    cachesFalso,
    gravacoes,
    apagados,
    comportamento,
    urlsEm: (nome: string) => Array.from(gavetas.get(nome)?.keys() ?? []),
    preencher: (nome: string, urls: string[]) => {
      const g = gaveta(nome);
      for (const u of urls)
        g.set(chaveDe(u), { req: new Request(u), res: new Response("velho") });
    },
  };
}

/** Resposta com o `type` que a rede real daria (o construtor só faz "default"). */
function respostaDeTipo(
  tipo: "cors" | "opaque",
  corpo: string | null,
  status: number,
): Response {
  const r = new Response(status === 0 ? null : corpo, {
    status: status === 0 ? 200 : status,
  });
  Object.defineProperty(r, "type", { value: tipo });
  if (status === 0) Object.defineProperty(r, "status", { value: 0 });
  return r;
}

/** Pedido do jeito que um `<img>` sem `crossorigin` chega ao SW. */
function pedidoDeImg(
  url: string,
  { modo = "no-cors", destino = "image" } = {},
): Request {
  const r = new Request(url, {
    mode: modo as RequestMode,
    headers: { Accept: "image/avif,image/webp,*/*;q=0.8" },
  });
  Object.defineProperty(r, "destination", { value: destino });
  return r;
}

async function esvaziarFila(vezes = 20) {
  for (let i = 0; i < vezes; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("src/sw/sw.ts — fotos do Storage em pedido no-cors (<img> sem crossorigin)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function importarSw() {
    const { selfFalso, listeners } = criarSelfFalso();
    const gaveta = criarCachesFalso();
    // Faz o que o navegador faz: pedido no-cors volta OPACO (status 0);
    // pedido cors volta legível (o Storage público manda ACAO: *).
    const fetchMock = vi.fn(async (alvo: RequestInfo | URL) =>
      (alvo as Request).mode === "no-cors"
        ? respostaDeTipo("opaque", null, 0)
        : respostaDeTipo("cors", "bytes-da-foto", 200),
    );

    vi.stubGlobal("self", selfFalso);
    vi.stubGlobal("caches", gaveta.cachesFalso);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("@/sw/sw");

    const fetchListeners = listeners.get("fetch") ?? [];
    expect(fetchListeners.length).toBe(1);
    return { aoBuscar: fetchListeners[0], fetchMock, ...gaveta };
  }

  function evento(request: Request) {
    return { request, respondWith: vi.fn(), waitUntil: vi.fn() };
  }

  it("<img> no-cors: refaz como cors SEM credenciais, mantém o Accept, devolve a cópia legível e a guarda", async () => {
    const { aoBuscar, fetchMock, gravacoes, urlsEm } = await importarSw();
    const ev = evento(pedidoDeImg(FOTO_RENDER));

    aoBuscar(ev);
    const resposta: Response = await ev.respondWith.mock.calls[0][0];
    await esvaziarFila();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const refeito = fetchMock.mock.calls[0][0] as Request;
    expect(refeito.url).toBe(FOTO_RENDER);
    expect(refeito.mode).toBe("cors");
    expect(refeito.credentials).toBe("omit");
    // O endpoint de render negocia WebP/AVIF pelo Accept do <img>: perdê-lo
    // serviria JPEG/PNG maior para toda a loja.
    expect(refeito.headers.get("accept")).toBe(
      "image/avif,image/webp,*/*;q=0.8",
    );
    expect(resposta.type).toBe("cors");
    expect(await resposta.clone().text()).toBe("bytes-da-foto");
    expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([new URL(FOTO_RENDER).href]);
    expect(gravacoes).toHaveLength(1);
    // (o `clone()` do Node não preserva `type`; no navegador preserva — o que
    // se prova aqui é que o guardado é a cópia legível, com corpo e status 200.)
    expect(gravacoes[0].res.status).toBe(200);
    expect(await gravacoes[0].res.text()).toBe("bytes-da-foto");
  });

  it("o objetivo: com a foto já guardada, a segunda abertura SEM rede ainda mostra a foto", async () => {
    const { aoBuscar, fetchMock } = await importarSw();
    const primeira = evento(pedidoDeImg(FOTO));
    aoBuscar(primeira);
    await primeira.respondWith.mock.calls[0][0];
    await esvaziarFila();

    // Sem sinal: toda tentativa de rede rejeita.
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    const offline = evento(pedidoDeImg(FOTO));
    aoBuscar(offline);
    const resposta: Response = await offline.respondWith.mock.calls[0][0];
    await esvaziarFila();

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe("bytes-da-foto");
  });

  it("a versão cors falha (rede/CORS): cai no fetch ORIGINAL, devolve o que ele der e NÃO guarda a opaca", async () => {
    const { aoBuscar, fetchMock, gravacoes, urlsEm } = await importarSw();
    const opaca = respostaDeTipo("opaque", null, 0);
    fetchMock
      .mockImplementationOnce(async () => {
        throw new TypeError("CORS preflight failed");
      })
      .mockImplementationOnce(async () => opaca);
    const pedido = pedidoDeImg(FOTO);
    const ev = evento(pedido);

    aoBuscar(ev);
    const resposta: Response = await ev.respondWith.mock.calls[0][0];
    await esvaziarFila();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1][0]).toBe(pedido); // o pedido original, intacto
    expect(resposta).toBe(opaca); // comportamento de antes, nunca pior
    expect(gravacoes).toEqual([]);
    expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([]);
  });

  it.each([
    [404, "não encontrada"],
    [403, "proibida (render sem transformação ligada)"],
    [500, "erro do servidor"],
    [206, "parcial"],
  ])(
    "a versão cors volta %i (%s): não guarda e cai no fetch original",
    async (status) => {
      const { aoBuscar, fetchMock, gravacoes } = await importarSw();
      const fallback = respostaDeTipo("opaque", null, 0);
      fetchMock
        .mockImplementationOnce(async () => respostaDeTipo("cors", "x", status))
        .mockImplementationOnce(async () => fallback);
      const pedido = pedidoDeImg(FOTO);
      const ev = evento(pedido);

      aoBuscar(ev);
      const resposta: Response = await ev.respondWith.mock.calls[0][0];
      await esvaziarFila();

      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][0]).toBe(pedido);
      expect(resposta).toBe(fallback);
      expect(gravacoes).toEqual([]);
    },
  );

  it("opaca (status 0) NUNCA entra na gaveta, nem se a versão cors e o fallback derem opaca", async () => {
    const { aoBuscar, fetchMock, gravacoes, urlsEm } = await importarSw();
    fetchMock.mockImplementation(async () => respostaDeTipo("opaque", null, 0));
    const ev = evento(pedidoDeImg(FOTO));

    aoBuscar(ev);
    await ev.respondWith.mock.calls[0][0];
    await esvaziarFila();

    expect(gravacoes).toEqual([]);
    expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([]);
  });

  it("cors e fallback falham sem nada guardado: o erro de rede continua chegando à página (como antes)", async () => {
    const { aoBuscar, fetchMock } = await importarSw();
    fetchMock.mockImplementation(async () => {
      throw new TypeError("Failed to fetch");
    });
    const ev = evento(pedidoDeImg(FOTO));

    aoBuscar(ev);

    await expect(ev.respondWith.mock.calls[0][0]).rejects.toThrow(
      "Failed to fetch",
    );
    await esvaziarFila();
  });

  it("pedido cors (crossorigin / telas do admin): fluxo de antes, UM fetch com o próprio pedido", async () => {
    const { aoBuscar, fetchMock, urlsEm } = await importarSw();
    const pedido = pedidoDeImg(FOTO, { modo: "cors" });
    const ev = evento(pedido);

    aoBuscar(ev);
    await ev.respondWith.mock.calls[0][0];
    await esvaziarFila();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe(pedido);
    expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([new URL(FOTO).href]);
  });

  it.each(["", "video", "audio", "script", "fetch"])(
    "no-cors com destination %j (não é <img>): fluxo de antes, UM fetch com o próprio pedido",
    async (destino) => {
      const { aoBuscar, fetchMock } = await importarSw();
      const pedido = pedidoDeImg(FOTO, { destino });
      const ev = evento(pedido);

      aoBuscar(ev);
      await ev.respondWith.mock.calls[0][0];
      await esvaziarFila();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(pedido);
    },
  );

  it("no-cors de endereço NÃO público (assinado) continua fora: sem respondWith, sem fetch, sem gaveta", async () => {
    const { aoBuscar, fetchMock, cachesFalso, urlsEm } = await importarSw();
    const ev = evento(pedidoDeImg(ASSINADA));

    aoBuscar(ev);
    await esvaziarFila();

    expect(ev.respondWith).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(cachesFalso.open).not.toHaveBeenCalledWith(IMAGE_CACHE_NAME);
    expect(urlsEm(IMAGE_CACHE_NAME)).toEqual([]);
  });

  it("no-cors público COM Authorization também continua fora", async () => {
    const { aoBuscar, fetchMock } = await importarSw();
    const pedido = new Request(FOTO, {
      mode: "no-cors",
      headers: { Authorization: "Bearer token-do-cliente" },
    });
    // Em no-cors o navegador nem aceita esse header; o duplo de Node aceita —
    // a guarda do SW tem de valer mesmo assim.
    Object.defineProperty(pedido, "destination", { value: "image" });
    const ev = evento(pedido);

    aoBuscar(ev);
    await esvaziarFila();

    expect(ev.respondWith).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("teto: com a gaveta cheia (100), a foto nova entra e a mais ANTIGA sai — a gaveta nunca passa de 100", async () => {
    const { aoBuscar, preencher, urlsEm, apagados } = await importarSw();
    const antigas = Array.from(
      { length: TETO },
      (_, i) => `${SUPA}/storage/v1/object/public/products/antiga-${i}.jpg`,
    );
    preencher(IMAGE_CACHE_NAME, antigas);
    const ev = evento(pedidoDeImg(FOTO));

    aoBuscar(ev);
    await ev.respondWith.mock.calls[0][0];
    await esvaziarFila();

    const guardadas = urlsEm(IMAGE_CACHE_NAME);
    expect(guardadas).toHaveLength(TETO);
    expect(guardadas).toContain(new URL(FOTO).href);
    expect(apagados).toEqual([new URL(antigas[0]).href]);
    expect(guardadas).not.toContain(new URL(antigas[0]).href);
  });

  it("disco/cota cheia no put: a foto ainda chega à página e nada vira rejeição solta", async () => {
    const { aoBuscar, comportamento } = await importarSw();
    comportamento.putFalha = true;
    const rejeicoes: unknown[] = [];
    const aoRejeitar = (e: unknown) => rejeicoes.push(e);
    process.on("unhandledRejection", aoRejeitar);
    const ev = evento(pedidoDeImg(FOTO));

    aoBuscar(ev);
    const resposta: Response = await ev.respondWith.mock.calls[0][0];
    await esvaziarFila();
    process.off("unhandledRejection", aoRejeitar);

    expect(resposta.status).toBe(200);
    expect(rejeicoes).toEqual([]);
  });
});
