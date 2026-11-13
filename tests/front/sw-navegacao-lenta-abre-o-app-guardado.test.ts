import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — rede que conecta e não responde não deixa a cliente olhando
 * tela parada quando o app já está guardado no aparelho (13/11/2026).
 *
 * O DEFEITO: a cliente toca num endereço que ainda não visitou
 * (`/?category=Bolsas`). A página exata não está guardada, então o SW ia à rede
 * SEM PRAZO e só olhava o app guardado (`/`) se o `fetch` REJEITASSE. Rede ruim
 * de celular costuma aceitar a conexão e não responder: o `fetch` não rejeita
 * nem responde, e a tela fica parada embora o app esteja no aparelho.
 *
 * A CURA, e o que este teste prende:
 *   - a rede estourou o prazo E existe página guardada útil (a exata, o
 *     `/index.html` COM ficha ou a `/` COM ficha) -> abre o app guardado;
 *   - a rede estourou o prazo e NÃO existe página útil (primeira visita, cache
 *     vazio) -> continua esperando a rede; nunca "sem internet" nem
 *     "manutenção" por causa de lentidão;
 *   - a rede responde dentro do prazo, ou rejeita -> igual a antes;
 *   - a resposta que chega DEPOIS do prazo ainda é guardada para a próxima vez.
 *
 * Mesma montagem de `sw-sem-internet-mostra-pagina-offline.test.ts`:
 * `environment: "node"`, `self` falso e import do SW dentro de cada teste.
 */

type Listener = (event: unknown) => void;

const ORIGEM = "https://loja.exemplo.com";
const MARCADOR_OFFLINE = "<!-- pagina-offline-de-teste -->";
// Maior que o prazo do SW (5 s) com folga, menor que qualquer outro relógio.
const DEPOIS_DO_PRAZO_MS = 6000;

interface EventoDeBusca {
  request: Request;
  respondWith: ReturnType<typeof vi.fn<(resposta: Promise<Response>) => void>>;
  waitUntil: ReturnType<typeof vi.fn<(trabalho: Promise<unknown>) => void>>;
}

function criarSelfFalso() {
  const listeners = new Map<string, Listener[]>();
  const selfFalso = {
    location: { origin: ORIGEM },
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

function criarCachesFalso(porCaminho: Map<string, Response | undefined>) {
  const cacheFalso = {
    addAll: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    match: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const cachesFalso = {
    open: vi.fn().mockResolvedValue(cacheFalso),
    // Chave EXATA (caminho + query), como o Cache real.
    match: vi.fn((chave: string | Request) => {
      const url = typeof chave === "string" ? chave : chave.url;
      const caminho = url.startsWith("http")
        ? new URL(url).pathname + new URL(url).search
        : url;
      return Promise.resolve(porCaminho.get(caminho));
    }),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  return { cachesFalso, cacheFalso };
}

function navegacao(caminho: string) {
  const request = new Request(`${ORIGEM}${caminho}`, { method: "GET" });
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
}

function htmlSemFicha() {
  return new Response("<!doctype html><html><body>app</body></html>", {
    status: 200,
    headers: { "content-type": "text/html" },
  });
}

function htmlComFicha(marca = "app-guardado") {
  return new Response(
    `<!doctype html><html><head><script type="application/json" id="ikcous-loja">{}</script></head><body>${marca}</body></html>`,
    { status: 200, headers: { "content-type": "text/html" } },
  );
}

function paginaOffline() {
  return new Response(
    `<!doctype html><html><body>${MARCADOR_OFFLINE}</body></html>`,
    { status: 200, headers: { "content-type": "text/html" } },
  );
}

/** Rede que aceitou a conexão e nunca responde, mas que o teste pode soltar. */
function redePendurada() {
  let responder: (resposta: Response) => void = () => {};
  let falhar: (erro: Error) => void = () => {};
  const promessa = new Promise<Response>((resolve, reject) => {
    responder = resolve;
    falhar = reject;
  });
  const busca = vi.fn<typeof fetch>(() => promessa);
  return { busca, responder, falhar };
}

describe("src/sw/sw.ts — navegação com rede lenta abre o app guardado", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  async function montar(
    porCaminho: Map<string, Response | undefined>,
    busca: typeof fetch,
  ) {
    const { selfFalso, listeners } = criarSelfFalso();
    const { cachesFalso, cacheFalso } = criarCachesFalso(porCaminho);
    vi.stubGlobal("self", selfFalso);
    vi.stubGlobal("caches", cachesFalso);
    vi.stubGlobal("fetch", busca);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );
    await import("@/sw/sw");
    const [fetchListener] = listeners.get("fetch") ?? [];
    expect(fetchListener).toBeTypeOf("function");
    return { fetchListener, cacheFalso };
  }

  /** Dispara a navegação e devolve a resposta como promessa + se já resolveu. */
  async function navegar(
    porCaminho: Map<string, Response | undefined>,
    busca: typeof fetch,
    caminho = "/?category=Bolsas",
  ) {
    const { fetchListener, cacheFalso } = await montar(porCaminho, busca);
    const event: EventoDeBusca = {
      request: navegacao(caminho),
      respondWith: vi.fn<(resposta: Promise<Response>) => void>(),
      waitUntil: vi.fn<(trabalho: Promise<unknown>) => void>(),
    };
    // O módulo do SW já deixa timers próprios armados ao ser importado: a
    // conta do "timer sobrando" é contra esta linha de base.
    const timersAntes = vi.getTimerCount();
    fetchListener(event);
    expect(event.respondWith).toHaveBeenCalledTimes(1);
    const resposta: Promise<Response> = event.respondWith.mock.calls[0][0];
    const estado = { resolveu: false };
    resposta.then(
      () => {
        estado.resolveu = true;
      },
      () => {
        estado.resolveu = true;
      },
    );
    return { resposta, estado, event, cacheFalso, timersAntes };
  }

  it("rede pendurada + '/' guardada com ficha -> após o prazo abre o app guardado, não a tela parada", async () => {
    const { busca } = redePendurada();
    const { resposta, estado } = await navegar(
      new Map<string, Response | undefined>([
        ["/index.html", htmlSemFicha()],
        ["/", htmlComFicha("shell-da-raiz")],
        ["/offline.html", paginaOffline()],
      ]),
      busca,
    );

    // Antes do prazo a rede ainda tem a vez: nada de abrir o app cedo demais.
    await vi.advanceTimersByTimeAsync(4000);
    expect(estado.resolveu).toBe(false);

    await vi.advanceTimersByTimeAsync(DEPOIS_DO_PRAZO_MS);
    const corpo = await (await resposta).text();
    expect(corpo).toContain("shell-da-raiz");
    expect(corpo).not.toContain(MARCADOR_OFFLINE);
  });

  it("rede pendurada + só o '/index.html' COM ficha -> abre esse app guardado", async () => {
    const { busca } = redePendurada();
    const { resposta } = await navegar(
      new Map<string, Response | undefined>([
        ["/index.html", htmlComFicha("index-com-ficha")],
      ]),
      busca,
    );

    await vi.advanceTimersByTimeAsync(DEPOIS_DO_PRAZO_MS);
    expect(await (await resposta).text()).toContain("index-com-ficha");
  });

  it("rede pendurada + cache SEM página útil (primeira visita) -> segue esperando a rede, sem 'sem internet' nem 'manutenção'", async () => {
    const { busca, responder } = redePendurada();
    const { resposta, estado } = await navegar(
      new Map<string, Response | undefined>([
        // O `/index.html` do precache NÃO tem ficha: não conta como página útil.
        ["/index.html", htmlSemFicha()],
        ["/offline.html", paginaOffline()],
      ]),
      busca,
    );

    await vi.advanceTimersByTimeAsync(DEPOIS_DO_PRAZO_MS * 10);
    expect(estado.resolveu).toBe(false);

    // A rede chega, lenta; é ela que a cliente recebe, como sempre foi.
    responder(
      new Response("pagina-da-rede", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    const final = await resposta;
    expect(final.status).toBe(200);
    expect(await final.text()).toBe("pagina-da-rede");
  });

  it("rede pendurada + sem página útil, e depois a rede CAI -> o desfecho de antes: página 'sem internet'", async () => {
    const { busca, falhar } = redePendurada();
    const { resposta, estado } = await navegar(
      new Map<string, Response | undefined>([
        ["/index.html", htmlSemFicha()],
        ["/offline.html", paginaOffline()],
      ]),
      busca,
    );

    await vi.advanceTimersByTimeAsync(DEPOIS_DO_PRAZO_MS);
    expect(estado.resolveu).toBe(false);

    falhar(new TypeError("Failed to fetch"));
    expect(await (await resposta).text()).toContain(MARCADOR_OFFLINE);
  });

  it("rede pendurada + app guardado: a resposta que chega DEPOIS do prazo ainda é guardada para a próxima vez", async () => {
    const { busca, responder } = redePendurada();
    const { resposta, event, cacheFalso } = await navegar(
      new Map<string, Response | undefined>([["/", htmlComFicha()]]),
      busca,
    );

    await vi.advanceTimersByTimeAsync(DEPOIS_DO_PRAZO_MS);
    await resposta;
    expect(cacheFalso.put).not.toHaveBeenCalled();

    responder(
      new Response("<html>chegou-tarde</html>", {
        status: 200,
        headers: { "content-type": "text/html" },
      }),
    );
    // A rede em segundo plano mantém o worker vivo (`waitUntil`) até acabar.
    const trabalhos = event.waitUntil.mock.calls.map(([t]) => t);
    expect(trabalhos.length).toBeGreaterThan(0);
    await Promise.all(trabalhos);
    await vi.advanceTimersByTimeAsync(0);
    expect(cacheFalso.put).toHaveBeenCalledTimes(1);
  });

  it("rede pendurada + app guardado: a rede que REJEITA depois do prazo não vira erro solto", async () => {
    const { busca, falhar } = redePendurada();
    const { resposta, event } = await navegar(
      new Map<string, Response | undefined>([["/", htmlComFicha()]]),
      busca,
    );
    await vi.advanceTimersByTimeAsync(DEPOIS_DO_PRAZO_MS);
    await resposta;

    falhar(new TypeError("Failed to fetch"));
    // Se o `waitUntil` rejeitasse, o worker registraria erro; tem de resolver.
    const trabalhos = event.waitUntil.mock.calls.map(([t]) => t);
    await expect(Promise.all(trabalhos)).resolves.toBeDefined();
  });

  it("rede RESPONDE dentro do prazo -> a resposta da rede, igual a antes, sem timer sobrando", async () => {
    const busca = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response("pagina-da-rede", {
          status: 200,
          headers: { "content-type": "text/html" },
        }),
      ),
    );
    const { resposta, cacheFalso, timersAntes } = await navegar(
      new Map<string, Response | undefined>([["/", htmlComFicha()]]),
      busca,
    );

    const final = await resposta;
    expect(await final.text()).toBe("pagina-da-rede");
    await vi.advanceTimersByTimeAsync(0);
    expect(cacheFalso.put).toHaveBeenCalledTimes(1);
    // O prazo foi desarmado: nada de olhar o cache depois que a rede respondeu.
    expect(vi.getTimerCount()).toBe(timersAntes);
  });

  it("rede RESPONDE 503 do porteiro dentro do prazo -> passa como veio (nunca o app guardado)", async () => {
    const busca = vi.fn<typeof fetch>(() =>
      Promise.resolve(
        new Response("manutencao-do-porteiro", {
          status: 503,
          headers: { "x-ikcous-porteiro": "sem-ficha" },
        }),
      ),
    );
    const { resposta } = await navegar(
      new Map<string, Response | undefined>([["/", htmlComFicha()]]),
      busca,
    );

    const final = await resposta;
    expect(final.status).toBe(503);
    expect(await final.text()).toBe("manutencao-do-porteiro");
  });

  it("rede REJEITA na hora -> o fallback de sempre: abre a '/' guardada", async () => {
    const busca = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    const { resposta } = await navegar(
      new Map<string, Response | undefined>([
        ["/", htmlComFicha("shell-da-raiz")],
      ]),
      busca,
    );

    expect(await (await resposta).text()).toContain("shell-da-raiz");
  });

  it("rede REJEITA na hora + nada guardado -> página 'sem internet', como antes", async () => {
    const busca = vi.fn<typeof fetch>(() =>
      Promise.reject(new TypeError("Failed to fetch")),
    );
    const { resposta } = await navegar(
      new Map<string, Response | undefined>([
        ["/index.html", htmlSemFicha()],
        ["/offline.html", paginaOffline()],
      ]),
      busca,
    );

    expect(await (await resposta).text()).toContain(MARCADOR_OFFLINE);
  });

  it("página JÁ guardada (ramo do cache primeiro) -> responde na hora do cache, sem prazo nenhum", async () => {
    const { busca } = redePendurada();
    const { resposta } = await navegar(
      new Map<string, Response | undefined>([
        ["/?category=Bolsas", htmlComFicha("pagina-exata")],
      ]),
      busca,
    );

    expect(await (await resposta).text()).toContain("pagina-exata");
  });
});
