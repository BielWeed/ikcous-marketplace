import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/identidade.json` NÃO PODE SER RESPONDIDO DO CACHE QUANDO A PÁGINA PERGUNTA
 * SE A LOJA SAIU DA MANUTENÇÃO (06/11/2026).
 *
 * O DEFEITO: a tela "Servidor em Manutenção" não sumia sozinha. A correção do
 * app passou a perguntar, de tempos em tempos, `fetch("/identidade.json",
 * { cache: "no-store" })` e a olhar `configuracao.manutencao`. Só que o
 * catch-all de `src/sw/sw.ts` é CACHE-FIRST (`return cachedResponse ||
 * fetchPromise`) e `caches.match()` procura em TODOS os caches da origem,
 * inclusive o `ikcous-identidade`, onde o `install` guardou a ficha daquele
 * dia. A pergunta seria respondida com a ficha VELHA ("manutenção: true") para
 * sempre, e a tela nunca sairia do ar.
 *
 * A cura é a mesma de `/version.json` (ver
 * `sw-version-json-nao-enche-o-cache.test.ts`): o listener devolve o controle
 * ao navegador (`return` sem `respondWith`), que busca na rede.
 *
 * O QUE NÃO MUDA, e este arquivo prende: o `install` do SW continua buscando e
 * guardando a ficha (o listener de `fetch` não vê as buscas do próprio SW), e
 * o `push` continua lendo o cache próprio. Só a PERGUNTA DA PÁGINA muda de
 * caminho.
 *
 * Mesmo molde de `sw-version-json-nao-enche-o-cache.test.ts`: ambiente node,
 * `self` falso, import dentro de cada teste. Nada aqui roda num Service
 * Worker de verdade.
 */

type Listener = (event: unknown) => void;

type RespostaFalsa = {
  status: number;
  ok: boolean;
  type: string;
  etiqueta: string;
  clone: () => RespostaFalsa;
};

function criarRespostaFalsa(etiqueta: string): RespostaFalsa {
  return {
    status: 200,
    ok: true,
    type: "basic",
    etiqueta,
    clone: () => criarRespostaFalsa(etiqueta),
  };
}

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
    registration: { waiting: null, installing: null },
    skipWaiting: vi.fn(),
  };
  return { selfFalso, listeners };
}

function criarCachesFalso(respostaEmCache?: RespostaFalsa) {
  const chavesGravadas: string[] = [];
  const cacheFalso = {
    match: vi.fn().mockResolvedValue(respostaEmCache),
    // O `install` grava a ficha com a CHAVE em texto ("/identidade.json");
    // o catch-all grava com o Request. O duplo aceita as duas formas.
    put: (pedido: Request | string) => {
      chavesGravadas.push(typeof pedido === "string" ? pedido : pedido.url);
      return Promise.resolve(undefined);
    },
    addAll: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const cachesFalso = {
    open: vi.fn().mockResolvedValue(cacheFalso),
    match: vi.fn().mockResolvedValue(respostaEmCache),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  return { cachesFalso, chavesGravadas };
}

function criarFetchEvent(request: Request) {
  const respostas: Promise<unknown>[] = [];
  return {
    request,
    respondWith: vi.fn((p: Promise<unknown>) => {
      respostas.push(p);
    }),
    waitUntil: vi.fn(),
    respostas,
  };
}

async function esperarAsPromessasSoltas(voltas = 4) {
  for (let i = 0; i < voltas; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const URL_DA_FICHA = "https://loja.exemplo.com/identidade.json";

describe("src/sw/sw.ts — /identidade.json perguntado pela página vai direto à rede", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importarComGlobaisFalsos(respostaEmCache?: RespostaFalsa) {
    const { selfFalso, listeners } = criarSelfFalso();
    const { cachesFalso, chavesGravadas } = criarCachesFalso(respostaEmCache);
    const fetchMock = vi.fn(async () => criarRespostaFalsa("da-rede"));

    vi.stubGlobal("self", selfFalso);
    vi.stubGlobal("caches", cachesFalso);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );

    await import("@/sw/sw");

    const fetchListeners = listeners.get("fetch") ?? [];
    expect(fetchListeners.length).toBe(1);
    return { fetchListener: fetchListeners[0], chavesGravadas, fetchMock };
  }

  it("com a ficha VELHA ('manutenção') guardada, o SW não responde do cache nem busca por conta própria", async () => {
    const fichaVelha = criarRespostaFalsa("ficha-velha-do-cache");
    const { fetchListener, chavesGravadas, fetchMock } =
      await importarComGlobaisFalsos(fichaVelha);

    const event = criarFetchEvent(
      new Request(URL_DA_FICHA, {
        method: "GET",
        cache: "no-store",
      }),
    );
    fetchListener(event);
    const entregue = event.respostas.length
      ? ((await event.respostas[0]) as RespostaFalsa | undefined)
      : null;
    await esperarAsPromessasSoltas();

    expect({
      interceptou: event.respondWith.mock.calls.length,
      fichaEntregue: entregue?.etiqueta ?? null,
      gravacoes: chavesGravadas.length,
      buscasFeitasPeloSW: fetchMock.mock.calls.length,
    }).toEqual({
      interceptou: 0,
      fichaEntregue: null,
      gravacoes: 0,
      buscasFeitasPeloSW: 0,
    });
  });

  it("a pergunta repetida a cada ciclo não deixa entrada nova no cache", async () => {
    const { fetchListener, chavesGravadas } = await importarComGlobaisFalsos();

    for (let i = 0; i < 10; i++) {
      const event = criarFetchEvent(
        new Request(URL_DA_FICHA, { method: "GET", cache: "no-store" }),
      );
      fetchListener(event);
      await Promise.all(event.respostas);
    }
    await esperarAsPromessasSoltas();

    expect(chavesGravadas).toEqual([]);
  });

  // CONTROLE. Sem ele, "zero interceptações" poderia ser um teste que nem
  // chega ao listener. Um asset comum segue cacheado e respondido.
  it("controle: asset same-origin comum CONTINUA sendo respondido e cacheado", async () => {
    const { fetchListener, chavesGravadas } = await importarComGlobaisFalsos();

    const url = "https://loja.exemplo.com/assets/index-abc123.js";
    const event = criarFetchEvent(new Request(url, { method: "GET" }));
    fetchListener(event);
    const entregue = (await event.respostas[0]) as RespostaFalsa;
    await esperarAsPromessasSoltas();

    expect({
      interceptou: event.respondWith.mock.calls.length,
      entregue: entregue?.etiqueta,
      gravacoes: chavesGravadas,
    }).toEqual({ interceptou: 1, entregue: "da-rede", gravacoes: [url] });
  });

  // CONTROLE 2. O que o `install` faz com a ficha não pode ter mudado: ele
  // busca a ficha (com `no-store`) e a guarda no cache PRÓPRIO.
  it("controle: o install continua buscando e guardando a ficha no cache próprio", async () => {
    const { selfFalso, listeners } = criarSelfFalso();
    const { cachesFalso, chavesGravadas } = criarCachesFalso();
    const fetchMock = vi.fn(
      async (_endereco: RequestInfo | URL, _opcoes?: RequestInit) =>
        criarRespostaFalsa("ficha-nova"),
    );
    vi.stubGlobal("self", selfFalso);
    vi.stubGlobal("caches", cachesFalso);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );
    await import("@/sw/sw");

    const instalacao = (listeners.get("install") ?? [])[0];
    const esperas: Promise<unknown>[] = [];
    instalacao({
      waitUntil: (p: Promise<unknown>) => {
        esperas.push(p);
      },
    });
    await Promise.allSettled(esperas);
    await esperarAsPromessasSoltas();

    const buscouAFicha = fetchMock.mock.calls.some(
      ([endereco, opcoes]) =>
        endereco === "/identidade.json" &&
        (opcoes as { cache?: string } | undefined)?.cache === "no-store",
    );
    expect(buscouAFicha).toBe(true);
    expect(chavesGravadas.some((c) => c.endsWith("/identidade.json"))).toBe(
      true,
    );
  });
});
