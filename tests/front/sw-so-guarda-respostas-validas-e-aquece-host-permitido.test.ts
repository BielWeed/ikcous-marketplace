import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (evento: unknown) => void;
type Chave = string | Request;

const ORIGEM = "https://loja.exemplo.com";
const CACHE_APP = "app-cache-teste-guardas";
const CACHE_IMAGENS = "supabase-images-cache";
const PAGINA = `${ORIGEM}/catalogo?origem=pwa`;
const FOTO = "https://exemplo.supabase.co/storage/v1/object/public/fotos/a.jpg";
const STATUS_RECUSADOS = [404, 500, 0, 204];

/** O construtor não permite status 0; o clone também preserva a opacidade. */
function respostaDaRede(status: number): Response {
  if (status !== 0)
    return new Response(status === 204 ? null : `rede-${status}`, { status });
  const resposta = new Response(null);
  Object.defineProperties(resposta, {
    status: { value: 0 },
    ok: { value: false },
    type: { value: "opaque" },
    clone: { value: () => respostaDaRede(0) },
  });
  return resposta;
}

/** Map por gaveta e URL inteira: ler devolve clone, gravar substitui de verdade. */
function criarCaches() {
  const gavetas = new Map<string, Map<string, Response>>();
  const gravacoes: Array<{ nome: string; url: string; status: number }> = [];
  const chaveDe = (chave: Chave) =>
    new URL(typeof chave === "string" ? chave : chave.url, ORIGEM).href;
  function gaveta(nome: string) {
    let entradas = gavetas.get(nome);
    if (!entradas) {
      entradas = new Map();
      gavetas.set(nome, entradas);
    }
    return entradas;
  }
  function ler(nome: string, chave: Chave) {
    return gaveta(nome).get(chaveDe(chave))?.clone();
  }
  const cachesFalso = {
    open: vi.fn(async (nome: string) => ({
      match: async (chave: Chave) => ler(nome, chave),
      put: async (chave: Chave, resposta: Response) => {
        const url = chaveDe(chave);
        gravacoes.push({ nome, url, status: resposta.status });
        gaveta(nome).set(url, resposta.clone());
      },
      keys: async () => [...gaveta(nome).keys()].map((url) => new Request(url)),
    })),
    match: vi.fn(async (chave: Chave) => {
      for (const nome of gavetas.keys()) {
        const resposta = ler(nome, chave);
        if (resposta) return resposta;
      }
      return undefined;
    }),
  };
  return {
    cachesFalso,
    gravacoes,
    ler,
    preencher: (nome: string, chave: Chave, resposta: Response) =>
      gaveta(nome).set(chaveDe(chave), resposta.clone()),
  };
}

// Os puts de navegação e o WARM_CACHE não retornam suas promessas ao evento.
// Um turno de event loop deixa os encadeamentos já resolvidos terminarem.
async function concluirGravacoes() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

async function importarSw() {
  const listeners = new Map<string, Listener[]>();
  const cache = criarCaches();
  const fetchMock = vi.fn<(alvo: RequestInfo | URL) => Promise<Response>>();
  vi.stubGlobal("self", {
    location: { origin: ORIGEM, hostname: new URL(ORIGEM).hostname },
    __WB_MANIFEST: [],
    registration: { waiting: null, installing: null },
    addEventListener: (tipo: string, listener: Listener) =>
      listeners.set(tipo, [...(listeners.get(tipo) ?? []), listener]),
  });
  vi.stubGlobal("__APP_VERSION__", "teste-guardas");
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
    const request = new Request(PAGINA);
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

describe("navegação — erro de rede não vira a próxima página guardada", () => {
  it.each(STATUS_RECUSADOS)(
    "revalidação com status %i não sobrescreve a página boa",
    async (status) => {
      const { preencher, ler, gravacoes, fetchMock, navegar } =
        await importarSw();
      preencher(CACHE_APP, PAGINA, new Response("pagina-boa"));
      fetchMock.mockResolvedValue(respostaDaRede(status));

      const resposta = await navegar();

      expect(await resposta.text()).toBe("pagina-boa");
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect((fetchMock.mock.calls[0][0] as Request).url).toBe(PAGINA);
      expect(gravacoes).toEqual([]);
      expect(await ler(CACHE_APP, PAGINA)?.text()).toBe("pagina-boa");
    },
  );

  it("revalidação 200 troca a página guardada, mas entrega a anterior nesta visita", async () => {
    const { preencher, ler, gravacoes, fetchMock, navegar } =
      await importarSw();
    preencher(CACHE_APP, PAGINA, new Response("pagina-boa"));
    fetchMock.mockResolvedValue(respostaDaRede(200));

    expect(await (await navegar()).text()).toBe("pagina-boa");

    expect(gravacoes).toEqual([{ nome: CACHE_APP, url: PAGINA, status: 200 }]);
    expect(await ler(CACHE_APP, PAGINA)?.text()).toBe("rede-200");
  });

  it.each(STATUS_RECUSADOS)(
    "primeira navegação com status %i entrega a resposta sem guardá-la",
    async (status) => {
      const { ler, gravacoes, fetchMock, navegar } = await importarSw();
      const rede = respostaDaRede(status);
      fetchMock.mockResolvedValue(rede);

      expect(await navegar()).toBe(rede);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(gravacoes).toEqual([]);
      expect(ler(CACHE_APP, PAGINA)).toBeUndefined();
    },
  );

  it("primeira navegação 200 guarda a resposta para a próxima visita", async () => {
    const { ler, gravacoes, fetchMock, navegar } = await importarSw();
    fetchMock.mockResolvedValue(respostaDaRede(200));

    expect((await navegar()).status).toBe(200);

    expect(gravacoes).toEqual([{ nome: CACHE_APP, url: PAGINA, status: 200 }]);
    expect(await ler(CACHE_APP, PAGINA)?.text()).toBe("rede-200");
  });
});

describe("sem rede — a reserva offline precisa ser uma resposta ok", () => {
  it.each([404, 500, 0])(
    "offline.html guardada com status %i é recusada, não apresentada como tela",
    async (status) => {
      const { preencher, cachesFalso, fetchMock, navegar } = await importarSw();
      preencher(CACHE_APP, "/offline.html", respostaDaRede(status));
      fetchMock.mockRejectedValue(new TypeError("sem rede"));

      const resposta = await navegar();

      expect(cachesFalso.match).toHaveBeenCalledWith("/offline.html");
      expect(resposta.status).toBe(503);
      expect(resposta.headers.get("x-ikcous-porteiro")).toBe(
        "sem-ficha-no-cache",
      );
      expect(await resposta.text()).toContain("Loja em manutenção");
    },
  );

  it("offline.html 200 é entregue quando não há rede nem página com ficha", async () => {
    const { preencher, fetchMock, navegar } = await importarSw();
    preencher(CACHE_APP, "/offline.html", new Response("reserva-offline"));
    fetchMock.mockRejectedValue(new TypeError("sem rede"));

    const resposta = await navegar();

    expect(resposta.status).toBe(200);
    expect(await resposta.text()).toBe("reserva-offline");
  });
});

describe("aquecimento — só hosts permitidos e respostas 200 entram no cache", () => {
  it.each([
    "https://alheio.example/foto.jpg",
    "https://images.unsplash.com.alheio.example/foto.jpg",
    "https://falso-supabase.co/foto.jpg",
  ])("não faz fetch nem grava URL de host alheio: %s", async (url) => {
    const { aquecer, fetchMock, gravacoes, ler } = await importarSw();
    fetchMock.mockResolvedValue(respostaDaRede(200));

    await aquecer([url]);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(gravacoes).toEqual([]);
    expect(ler(CACHE_APP, url)).toBeUndefined();
    expect(ler(CACHE_IMAGENS, url)).toBeUndefined();
  });

  it.each([
    [`${ORIGEM}/foto.jpg`, CACHE_APP],
    ["https://images.unsplash.com/foto.jpg", CACHE_APP],
    ["https://placehold.co/200x200", CACHE_APP],
    [FOTO, CACHE_IMAGENS],
  ])(
    "host permitido %s é buscado e guardado na gaveta certa",
    async (url, nome) => {
      const { aquecer, fetchMock, gravacoes, ler } = await importarSw();
      fetchMock.mockResolvedValue(respostaDaRede(200));

      await aquecer([url]);

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url);
      expect(gravacoes).toEqual([{ nome, url, status: 200 }]);
      expect(await ler(nome, url)?.text()).toBe("rede-200");
    },
  );

  describe.each([
    [`${ORIGEM}/foto.jpg`, CACHE_APP],
    [FOTO, CACHE_IMAGENS],
  ])("resposta de %s para %s", (url, nome) => {
    it.each(STATUS_RECUSADOS)("status %i não é guardado", async (status) => {
      const { aquecer, fetchMock, gravacoes, ler } = await importarSw();
      fetchMock.mockResolvedValue(respostaDaRede(status));

      await aquecer([url]);

      expect(fetchMock).toHaveBeenCalledExactlyOnceWith(url);
      expect(gravacoes).toEqual([]);
      expect(ler(nome, url)).toBeUndefined();
    });
  });
});
