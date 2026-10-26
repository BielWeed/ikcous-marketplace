import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — a revalidação da navegação não grava HTML novo no cache
 * VELHO enquanto uma atualização do app está a caminho (caça 7, 26/10/2026).
 *
 * A guarda original olhava só `registration.waiting` (atualização já BAIXADA e
 * esperando). Durante o `installing` (atualização sendo baixada agora) a
 * janela era a mesma: o HTML novo entrava no cache da versão antiga, com os
 * pedaços antigos do app — o ChunkLoadError que a guarda existe para evitar.
 *
 * Mesmo molde de `sw-identidade-navegacao-sem-ficha.test.ts`: `sw.ts` registra
 * os listeners como efeito colateral do import, então o self é falso e a
 * importação é feita dentro de cada teste.
 */

type Listener = (event: unknown) => void;

const ORIGEM = "https://loja.exemplo.com";

function montar(registration: { waiting: unknown; installing?: unknown }) {
  const listeners = new Map<string, Listener[]>();
  const selfFalso = {
    location: { origin: ORIGEM },
    __WB_MANIFEST: [],
    addEventListener(tipo: string, fn: Listener) {
      listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    registration,
    skipWaiting: vi.fn(),
  };
  const put = vi.fn().mockResolvedValue(undefined);
  const cacheFalso = {
    addAll: vi.fn().mockResolvedValue(undefined),
    put,
    match: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const cachesFalso = {
    match: vi.fn().mockResolvedValue(
      new Response("<html>velho</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    ),
    open: vi.fn().mockResolvedValue(cacheFalso),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  vi.stubGlobal("self", selfFalso);
  vi.stubGlobal("caches", cachesFalso);
  vi.stubGlobal(
    "fetch",
    vi.fn(
      async () =>
        new Response("<html>novo</html>", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
    ),
  );
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
  return { listeners, put };
}

async function navegar(listeners: Map<string, Listener[]>) {
  const request = new Request(`${ORIGEM}/pedido`);
  Object.defineProperty(request, "mode", { value: "navigate" });
  const esperas: Promise<unknown>[] = [];
  const respondWith = vi.fn();
  (listeners.get("fetch") ?? [])[0]({
    request,
    respondWith,
    waitUntil: (p: Promise<unknown>) => esperas.push(p),
  });
  await respondWith.mock.calls[0][0];
  await Promise.all(esperas);
  // O put é encadeado em promessas soltas: deixa a fila esvaziar.
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("sw.ts — a revalidação da navegação respeita a atualização a caminho", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("sem atualização pendente, a revalidação grava a página nova (o fluxo de sempre)", async () => {
    const { listeners, put } = montar({ waiting: null, installing: null });
    await import("@/sw/sw");
    await navegar(listeners);
    expect(put).toHaveBeenCalledTimes(1);
  });

  it("atualização ESPERANDO (waiting): não grava HTML novo no cache velho", async () => {
    const { listeners, put } = montar({ waiting: {}, installing: null });
    await import("@/sw/sw");
    await navegar(listeners);
    expect(put).not.toHaveBeenCalled();
  });

  it("atualização INSTALANDO (installing): também não grava HTML novo no cache velho", async () => {
    const { listeners, put } = montar({ waiting: null, installing: {} });
    await import("@/sw/sw");
    await navegar(listeners);
    expect(put).not.toHaveBeenCalled();
  });

  it("registration sem o campo installing (navegador/dublê antigo) continua gravando", async () => {
    const { listeners, put } = montar({ waiting: null });
    await import("@/sw/sw");
    await navegar(listeners);
    expect(put).toHaveBeenCalledTimes(1);
  });
});
