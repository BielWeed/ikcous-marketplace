import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * src/sw/sw.ts — o listener de "fetch" do Service Worker.
 *
 * POR QUE ESTE TESTE EXISTE: a linha 164 (`if (url.origin !== sw.location.origin)
 * return;`) é o guard de origem que segura o checkout de pé (Fase 3). Sem ele, o
 * catch-all de stale-while-revalidate reemite uma requisição cross-origin como
 * `fetch()` dentro do SW — que é regido pelo `connect-src` da CSP, não pelo
 * `script-src` que libera a tag <script> do SDK do Mercado Pago na página — e o
 * checkout para de carregar. Nada no CI protegia essa linha antes deste arquivo.
 *
 * POR QUE `environment: "node"` (não jsdom, ver vitest.config.ts): `sw.ts` faz
 * `const sw = self as any` e lê `self.__WB_MANIFEST`. No jsdom `self` é o
 * `window` do documento e não dá para substituir; no `node` definimos
 * `globalThis.self` nós mesmos, ANTES do import, e o SW enxerga o nosso duplo.
 *
 * POR QUE IMPORTAR DENTRO DE CADA TESTE: `sw.ts` registra os listeners como
 * efeito colateral do próprio import (`sw.addEventListener("fetch", ...)` na
 * linha 73). Não dá para importar uma vez no topo do arquivo: precisamos montar
 * os globais falsos primeiro e só then `await import(...)`, com
 * `vi.resetModules()` entre um teste e outro para reimportar limpo.
 */

/** Registra os listeners que o `sw.ts` cadastra, por tipo de evento. */
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
    clients: {
      claim: vi.fn().mockResolvedValue(undefined),
    },
    skipWaiting: vi.fn(),
  };
  return { selfFalso, listeners };
}

/** Duplo de `caches` que nunca tem nada em cache e registra as chamadas. */
function criarCachesFalso() {
  const cacheFalso = {
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    addAll: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const cachesFalso = {
    open: vi.fn().mockResolvedValue(cacheFalso),
    match: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  return { cachesFalso, cacheFalso };
}

/** Monta um `event` de fetch falso, do jeito que o listener de sw.ts espera. */
function criarFetchEvent(request: Request) {
  return {
    request,
    respondWith: vi.fn(),
  };
}

describe("src/sw/sw.ts — listener de fetch", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Importa sw.ts com os globais falsos montados e devolve o listener de fetch. */
  async function importarComGlobaisFalsos() {
    const { selfFalso, listeners } = criarSelfFalso();
    const { cachesFalso } = criarCachesFalso();
    fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));

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
    return fetchListeners[0];
  }

  it("NÃO intercepta requisição cross-origin de terceiro (o guard que protege o checkout)", async () => {
    const fetchListener = await importarComGlobaisFalsos();
    const request = new Request("https://sdk.mercadopago.com/js/v2", {
      method: "GET",
    });
    const event = criarFetchEvent(request);

    fetchListener(event);

    expect(event.respondWith).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("intercepta asset estático same-origin (stale-while-revalidate)", async () => {
    const fetchListener = await importarComGlobaisFalsos();
    const request = new Request(
      "https://loja.exemplo.com/assets/index-abc123.js",
      { method: "GET" },
    );
    const event = criarFetchEvent(request);

    fetchListener(event);

    expect(event.respondWith).toHaveBeenCalledTimes(1);
  });

  it("ignora requisição não-GET", async () => {
    const fetchListener = await importarComGlobaisFalsos();
    const request = new Request("https://loja.exemplo.com/qualquer", {
      method: "POST",
    });
    const event = criarFetchEvent(request);

    fetchListener(event);

    expect(event.respondWith).not.toHaveBeenCalled();
  });

  it("continua interceptando imagem do Supabase Storage, mesmo sendo cross-origin", async () => {
    const fetchListener = await importarComGlobaisFalsos();
    const request = new Request(
      "https://xyzcompany.supabase.co/storage/v1/object/public/imagens/foo.png",
      { method: "GET" },
    );
    const event = criarFetchEvent(request);

    fetchListener(event);

    expect(event.respondWith).toHaveBeenCalledTimes(1);
  });

  it("continua interceptando navegação (network-first)", async () => {
    const fetchListener = await importarComGlobaisFalsos();
    const request = new Request("https://loja.exemplo.com/", {
      method: "GET",
    });
    // `Request.mode` é somente leitura e o construtor não aceita "navigate";
    // o listener só olha `event.request.mode`, então sobrescrevemos no objeto.
    Object.defineProperty(request, "mode", { value: "navigate" });
    const event = criarFetchEvent(request);

    fetchListener(event);

    expect(event.respondWith).toHaveBeenCalledTimes(1);
  });
});
