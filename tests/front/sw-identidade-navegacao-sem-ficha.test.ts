import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — o fallback de navegação NUNCA devolve HTML sem ficha
 * (etapa 2 da escala, 11/09/2026, brief `20260911-brief-escala-etapa2-site-por-host.md`,
 * tarefa T2, RODADA 2 — achado [DERRUBA] do crítico Opus, bloqueio do revisor).
 *
 * POR QUE ESTE TESTE EXISTE: o `install` precacheia `/index.html` CRU
 * (`cache.addAll(urls)`, código pré-existente — `vite.config.ts` não exclui
 * `html` do `globPatterns`). Esse HTML é o assado do build "idêntico para
 * todas" (fixture da etapa 2): SEM `<script id="ikcous-loja">`. Antes desta
 * correção, o fallback de navegação (rota nunca visitada + rede fora do ar)
 * servia esse HTML sem checar — abrindo o app no assado de ninguém em vez de
 * "em manutenção", violando a invariante que o próprio brief declara como o
 * bem maior da etapa ("na dúvida, em manutenção").
 *
 * Cenário: usuário navega para uma rota nunca visitada (`/pedido/123`) com a
 * rede fora do ar. `caches.match(event.request)` erra (nunca visitada).
 * `fetch` falha. No catch, `caches.match(event.request)` erra de novo.
 * `caches.match("/index.html")` acerta — mas devolve o HTML SEM ficha. O SW
 * tem de recusar esse HTML e devolver "em manutenção" (503), nunca abrir a
 * loja com o assado compartilhado.
 *
 * POR QUE `environment: "node"`, `globalThis.self` FALSO E IMPORTAR DENTRO DE
 * CADA TESTE: mesmas razões de `tests/front/sw-fetch.test.ts` — `sw.ts` faz
 * `const sw = self as any` e registra os listeners como efeito colateral do
 * próprio import.
 */

type Listener = (event: unknown) => void;

function criarSelfFalso() {
  const listeners = new Map<string, Listener[]>();
  const selfFalso = {
    location: { origin: "https://loja.exemplo.com" },
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

/** Duplo de `caches` cujo `match` de nível-topo devolve uma resposta
 * diferente por CHAVE (URL string ou `Request`), do jeito que o fallback de
 * navegação em sw.ts consulta `event.request`, depois `/index.html`, depois
 * `/` em sequência. */
function criarCachesFalso(porChave: Map<string, Response | undefined>) {
  const cacheFalso = {
    addAll: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const cachesFalso = {
    open: vi.fn().mockResolvedValue(cacheFalso),
    match: vi.fn((chave: string | Request) => {
      const url = typeof chave === "string" ? chave : chave.url;
      // A chave da rota exata chega como Request completo
      // ("https://loja.exemplo.com/pedido/123"); normalizamos para o
      // caminho, que é como o teste registra as respostas do mapa.
      const caminho = url.startsWith("http") ? new URL(url).pathname : url;
      return Promise.resolve(porChave.get(caminho));
    }),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  return { cachesFalso, cacheFalso };
}

function criarFetchEvent(request: Request) {
  return {
    request,
    respondWith: vi.fn(),
    waitUntil: vi.fn(),
  };
}

function htmlSemFicha() {
  return new Response("<!doctype html><html><body>app</body></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

function htmlComFicha() {
  return new Response(
    '<!doctype html><html><head><script type="application/json" id="ikcous-loja">{}</script></head><body>app</body></html>',
    { status: 200, headers: { "content-type": "text/html" } },
  );
}

describe("src/sw/sw.ts — fallback de navegação nunca devolve HTML sem ficha", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importarComGlobaisFalsos(
    porChave: Map<string, Response | undefined>,
  ) {
    const { selfFalso, listeners } = criarSelfFalso();
    const { cachesFalso } = criarCachesFalso(porChave);
    const fetchMock = vi.fn().mockRejectedValue(new Error("rede fora do ar"));

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
    return { fetchListener: fetchListeners[0], selfFalso };
  }

  it("rota nunca visitada + rede fora do ar + /index.html precacheado SEM ficha -> 503 em manutenção, nunca o HTML cru", async () => {
    const porChave = new Map<string, Response | undefined>([
      ["/pedido/123", undefined], // nunca visitada
      ["/index.html", htmlSemFicha()], // o assado precacheado no install
      ["/", undefined],
    ]);
    const { fetchListener } = await importarComGlobaisFalsos(porChave);
    const request = new Request("https://loja.exemplo.com/pedido/123", {
      method: "GET",
    });
    Object.defineProperty(request, "mode", { value: "navigate" });
    const event = criarFetchEvent(request);

    fetchListener(event);

    expect(event.respondWith).toHaveBeenCalledTimes(1);
    const resposta: Response = await event.respondWith.mock.calls[0][0];

    expect(resposta.status).toBe(503);
    expect(resposta.headers.get("x-ikcous-porteiro")).toBeTruthy();
    const corpo = await resposta.text();
    // Nenhum byte do HTML cru (sem ficha) chega ao visitante.
    expect(corpo).not.toContain("<body>app</body>");
  });

  it("mesmo cenário, mas /index.html precacheado COM ficha -> serve o HTML (comportamento preservado)", async () => {
    const porChave = new Map<string, Response | undefined>([
      ["/pedido/123", undefined],
      ["/index.html", htmlComFicha()],
      ["/", undefined],
    ]);
    const { fetchListener } = await importarComGlobaisFalsos(porChave);
    const request = new Request("https://loja.exemplo.com/pedido/123", {
      method: "GET",
    });
    Object.defineProperty(request, "mode", { value: "navigate" });
    const event = criarFetchEvent(request);

    fetchListener(event);

    const resposta: Response = await event.respondWith.mock.calls[0][0];

    expect(resposta.status).toBe(200);
    const corpo = await resposta.text();
    expect(corpo).toContain('id="ikcous-loja"');
  });

  it("rota já em cache (resposta real, já passada pelo porteiro) continua servida direto, sem checagem de ficha", async () => {
    const porChave = new Map<string, Response | undefined>([
      ["/pedido/123", htmlSemFicha()], // resposta cacheada da PRÓPRIA rota
    ]);
    const { fetchListener } = await importarComGlobaisFalsos(porChave);
    const request = new Request("https://loja.exemplo.com/pedido/123", {
      method: "GET",
    });
    Object.defineProperty(request, "mode", { value: "navigate" });
    const event = criarFetchEvent(request);

    fetchListener(event);

    const resposta: Response = await event.respondWith.mock.calls[0][0];

    // Este é o ramo de CACHE PRIMEIRO (linha ~197), não o de fallback — a
    // resposta cacheada da própria rota é sempre uma resposta de rede real
    // (já passada pelo porteiro), então não passa pela checagem de ficha.
    expect(resposta.status).toBe(200);
  });
});
