import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — sem internet, o app instalado mostra a página "Sem
 * internet" (`public/offline.html`), nunca "Loja em manutenção" (14/10/2026).
 *
 * O DEFEITO MEDIDO: a cliente abre o app instalado sem sinal. A página exata
 * nunca foi guardada (cada página é guardada pelo endereço exato, e o app abre
 * em `/?source=pwa`), o `/index.html` do precache não tem a ficha da loja, e a
 * `/` ainda não foi visitada. O SW caía na resposta 503 "Loja em manutenção" —
 * e a cliente concluía que a loja fechou. `public/offline.html` existia e
 * nenhuma linha do SW a usava.
 *
 * AS DUAS FALHAS SÃO DIFERENTES, e o teste prende a separação:
 *   - a REDE falhou (o `fetch` lança) e nada do cache serve -> página offline;
 *   - a rede RESPONDEU (o porteiro devolveu o 503 de manutenção porque a loja
 *     não tem ficha) -> esse 503 passa como veio. Mostrar "sem internet" com a
 *     internet funcionando e a loja fora do ar de verdade seria mentir.
 *
 * Mesma montagem de `sw-identidade-navegacao-sem-ficha.test.ts`:
 * `environment: "node"`, `self` falso e import do SW dentro de cada teste.
 */

type Listener = (event: unknown) => void;

const MARCADOR_OFFLINE = "<!-- pagina-offline-de-teste -->";

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
    match: vi.fn((chave: string | Request) => {
      const url = typeof chave === "string" ? chave : chave.url;
      // Chave EXATA (caminho + query), como o Cache real: o app instalado abre
      // em `/?source=pwa`, e essa página NÃO é a `/` guardada. Cortar a query
      // aqui faria a rota exata achar a `/` e esconderia a ordem das tentativas.
      const caminho = url.startsWith("http")
        ? new URL(url).pathname + new URL(url).search
        : url;
      return Promise.resolve(porCaminho.get(caminho));
    }),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  return { cachesFalso };
}

function criarFetchEvent(request: Request) {
  return { request, respondWith: vi.fn(), waitUntil: vi.fn() };
}

function navegacao(caminho: string) {
  const request = new Request(`https://loja.exemplo.com${caminho}`, {
    method: "GET",
  });
  Object.defineProperty(request, "mode", { value: "navigate" });
  return request;
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

function paginaOffline() {
  return new Response(
    `<!doctype html><html><head><title>Sem conexão</title></head><body>${MARCADOR_OFFLINE}</body></html>`,
    { status: 200, headers: { "content-type": "text/html" } },
  );
}

describe("src/sw/sw.ts — sem internet mostra a página offline, não 'manutenção'", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importarComGlobaisFalsos(
    porCaminho: Map<string, Response | undefined>,
    fetchMock: ReturnType<typeof vi.fn>,
  ) {
    const { selfFalso, listeners } = criarSelfFalso();
    const { cachesFalso } = criarCachesFalso(porCaminho);

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
    return { fetchListener: fetchListeners[0] };
  }

  const semRede = () =>
    vi.fn().mockRejectedValue(new TypeError("Failed to fetch"));

  async function navegar(
    porCaminho: Map<string, Response | undefined>,
    fetchMock: ReturnType<typeof vi.fn>,
    caminho = "/?source=pwa",
  ): Promise<Response> {
    const { fetchListener } = await importarComGlobaisFalsos(
      porCaminho,
      fetchMock,
    );
    const event = criarFetchEvent(navegacao(caminho));
    fetchListener(event);
    expect(event.respondWith).toHaveBeenCalledTimes(1);
    return event.respondWith.mock.calls[0][0];
  }

  it("sem rede + só o precache (index.html sem ficha, nada visitado) -> página offline com status 200", async () => {
    const resposta = await navegar(
      new Map<string, Response | undefined>([
        ["/index.html", htmlSemFicha()],
        ["/offline.html", paginaOffline()],
      ]),
      semRede(),
    );

    // 200 de propósito: é navegação de documento, e o navegador trata 200 como
    // "a página abriu" (é o padrão da receita oficial de página offline do
    // web.dev/Workbox). O 503 de manutenção existe para outro caso.
    expect(resposta.status).toBe(200);
    expect(resposta.headers.get("x-ikcous-porteiro")).toBeNull();
    expect(await resposta.text()).toContain(MARCADOR_OFFLINE);
  });

  it("sem rede + a '/' já guardada (com ficha) -> abre o app, como antes; a página offline não entra", async () => {
    const resposta = await navegar(
      new Map<string, Response | undefined>([
        ["/index.html", htmlSemFicha()],
        ["/", htmlComFicha()],
        ["/offline.html", paginaOffline()],
      ]),
      semRede(),
    );

    expect(resposta.status).toBe(200);
    const corpo = await resposta.text();
    expect(corpo).toContain('id="ikcous-loja"');
    expect(corpo).not.toContain(MARCADOR_OFFLINE);
  });

  it("sem rede + a página exata já guardada -> abre a página guardada; a página offline não entra", async () => {
    const resposta = await navegar(
      new Map<string, Response | undefined>([
        ["/pedido/123", htmlComFicha()],
        ["/offline.html", paginaOffline()],
      ]),
      semRede(),
      "/pedido/123",
    );

    expect(await resposta.text()).not.toContain(MARCADOR_OFFLINE);
  });

  it("REDE OK + o porteiro respondeu 503 'sem ficha' -> o 503 passa como veio, nunca a página offline", async () => {
    const manutencaoDoServidor = () =>
      new Response("loja em manutencao (porteiro)", {
        status: 503,
        headers: {
          "content-type": "text/html",
          "x-ikcous-porteiro": "sem-ficha",
        },
      });
    const resposta = await navegar(
      new Map<string, Response | undefined>([
        ["/index.html", htmlSemFicha()],
        ["/offline.html", paginaOffline()],
      ]),
      vi.fn().mockResolvedValue(manutencaoDoServidor()),
    );

    expect(resposta.status).toBe(503);
    expect(resposta.headers.get("x-ikcous-porteiro")).toBe("sem-ficha");
    const corpo = await resposta.text();
    expect(corpo).toContain("porteiro");
    expect(corpo).not.toContain(MARCADOR_OFFLINE);
  });

  it("REDE OK + resposta 404 do servidor -> passa como veio, nunca a página offline", async () => {
    const resposta = await navegar(
      new Map<string, Response | undefined>([
        ["/offline.html", paginaOffline()],
      ]),
      vi.fn().mockResolvedValue(new Response("nao achei", { status: 404 })),
    );

    expect(resposta.status).toBe(404);
    expect(await resposta.text()).not.toContain(MARCADOR_OFFLINE);
  });

  it("sem rede + nada serve + nem a página offline está guardada -> último recurso continua sendo o 503 de manutenção", async () => {
    const resposta = await navegar(
      new Map<string, Response | undefined>([["/index.html", htmlSemFicha()]]),
      semRede(),
    );

    expect(resposta.status).toBe(503);
    expect(resposta.headers.get("x-ikcous-porteiro")).toBe(
      "sem-ficha-no-cache",
    );
  });

  it("sem rede + o cache lança ao procurar a página offline -> cai no 503 de manutenção, sem rejeitar", async () => {
    const porCaminho = new Map<string, Response | undefined>([
      ["/index.html", htmlSemFicha()],
    ]);
    const { selfFalso, listeners } = criarSelfFalso();
    const { cachesFalso } = criarCachesFalso(porCaminho);
    const matchOriginal = cachesFalso.match;
    cachesFalso.match = vi.fn((chave: string | Request) => {
      if (chave === "/offline.html") {
        return Promise.reject(new Error("cache corrompido"));
      }
      return matchOriginal(chave);
    });
    vi.stubGlobal("self", selfFalso);
    vi.stubGlobal("caches", cachesFalso);
    vi.stubGlobal("fetch", semRede());
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );
    await import("@/sw/sw");
    const event = criarFetchEvent(navegacao("/?source=pwa"));
    (listeners.get("fetch") ?? [])[0](event);

    const resposta: Response = await event.respondWith.mock.calls[0][0];
    expect(resposta.status).toBe(503);
  });
});

describe("public/offline.html — texto neutro e funciona sob a CSP de produção", () => {
  const html = readFileSync(
    path.resolve(import.meta.dirname, "../../public/offline.html"),
    "utf8",
  );

  it("não carrega a sobra de outro projeto ('SUPERNOVA · v15.0') nem nome de loja", () => {
    expect(html).not.toContain("SUPERNOVA");
    expect(html).not.toContain("v15.0");
    expect(html).not.toContain("IKCOUS");
  });

  it("diz em português simples que está sem internet e que tenta de novo sozinho", () => {
    expect(html).toContain(
      "Sem internet. Confira sua conexão; vamos tentar de novo sozinhos.",
    );
  });

  it("não depende de script em linha: a CSP de produção (vercel.json) só libera 1 hash e bloquearia o <script> e o onclick", () => {
    const vercel = readFileSync(
      path.resolve(import.meta.dirname, "../../vercel.json"),
      "utf8",
    );
    const scriptSrc = /script-src ([^;]*);/.exec(vercel)?.[1] ?? "";
    expect(scriptSrc).not.toContain("'unsafe-inline'");

    // Sem <script> de código (JSON de dados seria outra história) e sem
    // atributo de evento: nada disso roda sob essa CSP.
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(
      /\son(click|load|error)\s*=(?!"this\.hidden=true")/i,
    );
  });

  it("tenta de novo sozinho SEM script: recarga automática por <meta http-equiv=refresh>", () => {
    expect(html).toMatch(
      /<meta\s+http-equiv="refresh"\s+content="\d+"\s*\/?>/i,
    );
  });
});

describe("offline.html está no precache do service worker", () => {
  const texto = readFileSync(
    path.resolve(import.meta.dirname, "../../vite.config.ts"),
    "utf8",
  );

  /** Lê um array de strings literais (`globPatterns: [...]`) do texto. */
  function lerLista(nome: string): string[] {
    const bloco = new RegExp(`${nome}:\\s*\\[([^\\]]*)\\]`).exec(texto)?.[1];
    expect(bloco, `${nome} não achado no vite.config.ts`).toBeTruthy();
    return [...(bloco ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  }

  it("rodando o próprio varredor do Workbox sobre public/ com as listas do vite.config.ts, offline.html entra no manifesto", async () => {
    const { getManifest } = await import("workbox-build");
    const { manifestEntries, warnings } = await getManifest({
      globDirectory: path.resolve(import.meta.dirname, "../../public"),
      globPatterns: lerLista("globPatterns"),
      globIgnores: lerLista("globIgnores"),
    });
    expect(warnings).toEqual([]);
    const urls = manifestEntries.map((e) =>
      typeof e === "string" ? e : e.url,
    );
    expect(urls).toContain("offline.html");
  });
});
