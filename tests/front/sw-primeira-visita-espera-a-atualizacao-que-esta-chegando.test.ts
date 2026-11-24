import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — com uma atualização do app a caminho (`waiting` ou
 * `installing`), nada de HTML novo entra no cache da versão que ainda manda.
 *
 * A guarda já existia só na REVALIDAÇÃO de página que já estava guardada. Duas
 * outras escritas ficavam de fora: a rota aberta pela PRIMEIRA vez e o
 * aquecimento (`WARM_CACHE`) de `/`. As duas gravavam o HTML da versão nova no
 * cache da versão velha; sem internet, a rota abria com pedaços de JavaScript
 * que só existem na versão nova — erro de carregamento.
 *
 * O aquecimento também pulava a conferência que o `install` faz (o HTML só
 * pode citar arquivos que o precache tem): sem ela, HTML de um deploy mais
 * novo ainda não detectado (nem `waiting`, nem `installing`) entrava igual.
 *
 * Só a ESCRITA no cache é pulada: a resposta ao cliente continua a da rede, e
 * a estratégia de imagens (inclusive Supabase) não muda.
 *
 * Mesmo molde de `sw-so-guarda-respostas-validas-e-aquece-host-permitido`:
 * `sw.ts` registra os listeners como efeito colateral do import, então o self
 * é falso e a importação é feita dentro de cada teste.
 */

type Listener = (evento: unknown) => void;
type Registro = { waiting: unknown; installing?: unknown };

const ORIGEM = "https://loja.exemplo.com";
const CACHE_APP = "app-cache-v1-teste";
const CACHE_IMAGENS = "supabase-images-cache";
const ROTA = `${ORIGEM}/pedidos`;
const FOTO = "https://exemplo.supabase.co/storage/v1/object/public/fotos/a.jpg";
const FOTO_DA_LOJA = `${ORIGEM}/foto.jpg`;
const HTML_DA_V2 = `<html><script type="module" src="/assets/index-v2.js"></script></html>`;
const HTML_SO_COM_O_PRECACHE = `<html><script type="module" src="/assets/index-v1.js"></script></html>`;

function htmlDaRede(corpo: string) {
  return new Response(corpo, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

function criarCaches() {
  const gavetas = new Map<string, Map<string, Response>>();
  const gravacoes: Array<{ nome: string; url: string }> = [];
  const chaveDe = (chave: string | Request) =>
    new URL(typeof chave === "string" ? chave : chave.url, ORIGEM).href;
  function gaveta(nome: string) {
    let entradas = gavetas.get(nome);
    if (!entradas) {
      entradas = new Map();
      gavetas.set(nome, entradas);
    }
    return entradas;
  }
  const ler = (nome: string, chave: string | Request) =>
    gaveta(nome).get(chaveDe(chave))?.clone();
  const cachesFalso = {
    open: vi.fn(async (nome: string) => ({
      match: async (chave: string | Request) => ler(nome, chave),
      put: async (chave: string | Request, resposta: Response) => {
        const url = chaveDe(chave);
        gravacoes.push({ nome, url });
        gaveta(nome).set(url, resposta.clone());
      },
      keys: async () => [...gaveta(nome).keys()].map((url) => new Request(url)),
    })),
    match: vi.fn(async (chave: string | Request) => {
      for (const nome of gavetas.keys()) {
        const resposta = ler(nome, chave);
        if (resposta) return resposta;
      }
      return undefined;
    }),
  };
  return { cachesFalso, gravacoes, ler };
}

// Os puts de navegação e o WARM_CACHE não devolvem suas promessas ao evento:
// alguns turnos de event loop deixam os encadeamentos já resolvidos terminarem.
async function concluirGravacoes() {
  for (let i = 0; i < 3; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

async function importarSw(
  registration: Registro,
  precache: Array<{ url: string }> = [],
) {
  const listeners = new Map<string, Listener[]>();
  const cache = criarCaches();
  const fetchMock = vi.fn<(alvo: RequestInfo | URL) => Promise<Response>>();
  vi.stubGlobal("self", {
    location: { origin: ORIGEM, hostname: new URL(ORIGEM).hostname },
    __WB_MANIFEST: precache,
    registration,
    addEventListener: (tipo: string, listener: Listener) =>
      listeners.set(tipo, [...(listeners.get(tipo) ?? []), listener]),
  });
  vi.stubGlobal("__APP_VERSION__", "v1-teste");
  vi.stubGlobal("caches", cache.cachesFalso);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("BroadcastChannel", undefined);
  vi.stubGlobal("setInterval", vi.fn());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await import("@/sw/sw");

  function emitir(tipo: string, evento: unknown) {
    const registrados = listeners.get(tipo) ?? [];
    expect(registrados).toHaveLength(1);
    registrados[0](evento);
  }
  async function navegar() {
    const request = new Request(ROTA);
    Object.defineProperty(request, "mode", { value: "navigate" });
    const esperas: Promise<unknown>[] = [];
    const respondWith = vi.fn<(resposta: Promise<Response>) => void>();
    emitir("fetch", {
      request,
      respondWith,
      waitUntil: (promessa: Promise<unknown>) => esperas.push(promessa),
    });
    expect(respondWith).toHaveBeenCalledTimes(1);
    const resposta = await respondWith.mock.calls[0][0];
    await Promise.all(esperas);
    await concluirGravacoes();
    return resposta;
  }
  async function aquecer(urls: string[]) {
    emitir("message", { data: { type: "WARM_CACHE", urls } });
    await concluirGravacoes();
  }
  return { ...cache, fetchMock, navegar, aquecer };
}

beforeEach(() => {
  vi.resetModules();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("primeira visita a uma rota — não grava HTML novo no cache velho", () => {
  it("sem atualização a caminho, grava a rota (o fluxo de sempre)", async () => {
    const { fetchMock, gravacoes, navegar } = await importarSw({
      waiting: null,
      installing: null,
    });
    fetchMock.mockResolvedValue(htmlDaRede(HTML_DA_V2));

    expect(await (await navegar()).text()).toBe(HTML_DA_V2);

    expect(gravacoes).toEqual([{ nome: CACHE_APP, url: ROTA }]);
  });

  it("registration sem o campo installing (dublê antigo) continua gravando", async () => {
    const { fetchMock, gravacoes, navegar } = await importarSw({
      waiting: null,
    });
    fetchMock.mockResolvedValue(htmlDaRede(HTML_DA_V2));

    await navegar();

    expect(gravacoes).toEqual([{ nome: CACHE_APP, url: ROTA }]);
  });

  it.each([
    ["waiting", { waiting: {}, installing: null }],
    ["installing", { waiting: null, installing: {} }],
    ["waiting e installing juntos", { waiting: {}, installing: {} }],
  ])(
    "atualização %s: não grava, e a cliente recebe o HTML da rede",
    async (_nome, registration) => {
      const { fetchMock, gravacoes, ler, navegar } =
        await importarSw(registration);
      fetchMock.mockResolvedValue(htmlDaRede(HTML_DA_V2));

      const resposta = await navegar();

      expect(resposta.status).toBe(200);
      expect(await resposta.text()).toBe(HTML_DA_V2);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(gravacoes).toEqual([]);
      expect(ler(CACHE_APP, ROTA)).toBeUndefined();
    },
  );

  it("a atualização que termina de ativar libera a gravação (estado lido a cada pedido)", async () => {
    const registration: Registro = { waiting: {}, installing: null };
    const { fetchMock, gravacoes, navegar } = await importarSw(registration);
    fetchMock.mockImplementation(async () => htmlDaRede(HTML_DA_V2));

    await navegar();
    expect(gravacoes).toEqual([]);

    registration.waiting = null;
    await navegar();
    expect(gravacoes).toEqual([{ nome: CACHE_APP, url: ROTA }]);
  });
});

describe("aquecimento (WARM_CACHE) — HTML novo não entra no cache velho", () => {
  it("aquecimento normal: grava a página que só usa arquivos do precache", async () => {
    const { aquecer, fetchMock, gravacoes } = await importarSw(
      { waiting: null, installing: null },
      [{ url: "/assets/index-v1.js" }],
    );
    fetchMock.mockResolvedValue(htmlDaRede(HTML_SO_COM_O_PRECACHE));

    await aquecer(["/"]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(gravacoes).toEqual([{ nome: CACHE_APP, url: `${ORIGEM}/` }]);
  });

  it.each([
    ["waiting", { waiting: {}, installing: null }],
    ["installing", { waiting: null, installing: {} }],
  ])(
    "atualização %s: a página aquecida não é gravada",
    async (_nome, registration) => {
      const { aquecer, fetchMock, gravacoes, ler } = await importarSw(
        registration,
        [{ url: "/assets/index-v1.js" }],
      );
      fetchMock.mockResolvedValue(htmlDaRede(HTML_SO_COM_O_PRECACHE));

      await aquecer(["/"]);

      expect(gravacoes).toEqual([]);
      expect(ler(CACHE_APP, "/")).toBeUndefined();
    },
  );

  it("sem atualização detectada, HTML que cita arquivo FORA do precache não é gravado", async () => {
    // Deploy novo ainda não notado pelo navegador: nem waiting, nem installing.
    const { aquecer, fetchMock, gravacoes, ler } = await importarSw(
      { waiting: null, installing: null },
      [{ url: "/assets/index-v1.js" }],
    );
    fetchMock.mockResolvedValue(htmlDaRede(HTML_DA_V2));

    await aquecer(["/"]);

    expect(gravacoes).toEqual([]);
    expect(ler(CACHE_APP, "/")).toBeUndefined();
  });

  it("imagem da própria loja continua sendo gravada mesmo com atualização a caminho", async () => {
    const { aquecer, fetchMock, gravacoes } = await importarSw({
      waiting: {},
      installing: null,
    });
    fetchMock.mockResolvedValue(
      new Response("bytes-da-foto", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );

    await aquecer([FOTO_DA_LOJA]);

    expect(gravacoes).toEqual([{ nome: CACHE_APP, url: FOTO_DA_LOJA }]);
  });

  it("foto pública do Supabase continua na gaveta de imagens com atualização a caminho", async () => {
    const { aquecer, fetchMock, gravacoes } = await importarSw({
      waiting: null,
      installing: {},
    });
    fetchMock.mockResolvedValue(
      new Response("bytes-da-foto", {
        status: 200,
        headers: { "content-type": "image/jpeg" },
      }),
    );

    await aquecer([FOTO]);

    expect(gravacoes).toEqual([{ nome: CACHE_IMAGENS, url: FOTO }]);
  });
});
