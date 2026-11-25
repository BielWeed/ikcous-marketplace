import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — duas frentes que nenhum teste vizinho segurava (caça por
 * mutação, 25/11/2026):
 *
 *  1. O PULSO (`HEARTBEAT_PING` -> `HEARTBEAT_ACK`): é o que o `pwa-sentinel`
 *     espera a cada 30 s; sem a resposta, depois de 5 min ele desregistra o
 *     service worker e recarrega o app da cliente. Trocar o texto do ack, o
 *     canal ou a condição passava sem nenhum teste reclamar.
 *  2. O catch-all de ASSETS da própria origem: só entra no cache resposta 200
 *     de tipo `basic`/`cors`; 404, 500, 206 e tipos estranhos não. E quando a
 *     rede cai com o arquivo já guardado, a cliente recebe o guardado SEM
 *     deixar uma promessa rejeitada solta dentro do service worker.
 */

type Listener = (evento: unknown) => void;

const ORIGEM = "https://loja.exemplo.com";
const VERSAO = "9.9.9";
const CACHE_APP = `app-cache-${VERSAO}`;
const CACHE_IMAGENS = "supabase-images-cache";
const FOTO = "https://exemplo.supabase.co/storage/v1/object/public/fotos/a.jpg";

// O `type` de uma Response nasce do construtor e vale "default"; para simular
// basic/cors/opaque é preciso forçá-lo. `clone()` NÃO herda a propriedade
// forçada, e o service worker confere o tipo na CÓPIA que ele guarda — por isso
// o clone também é refeito com o mesmo tipo (senão o teste mediria "default").
function comTipo(resposta: Response, tipo: ResponseType): Response {
  Object.defineProperty(resposta, "type", { value: tipo });
  const clonar = resposta.clone.bind(resposta);
  Object.defineProperty(resposta, "clone", {
    value: () => comTipo(clonar(), tipo),
  });
  return resposta;
}

/** Cache Storage em memória: gaveta -> (URL inteira -> resposta). */
function criarCaches() {
  const gavetas = new Map<string, Map<string, Response>>();
  const chaveDe = (chave: string | Request) =>
    new URL(typeof chave === "string" ? chave : chave.url, ORIGEM).href;
  const gaveta = (nome: string) => {
    let g = gavetas.get(nome);
    if (!g) {
      g = new Map();
      gavetas.set(nome, g);
    }
    return g;
  };
  const cachesFalso = {
    open: vi.fn(async (nome: string) => ({
      match: async (chave: string | Request) =>
        gaveta(nome).get(chaveDe(chave))?.clone(),
      put: async (chave: string | Request, resposta: Response) => {
        gaveta(nome).set(chaveDe(chave), resposta.clone());
      },
      keys: async () => [...gaveta(nome).keys()].map((u) => new Request(u)),
      delete: async (chave: string | Request) =>
        gaveta(nome).delete(chaveDe(chave)),
    })),
    match: vi.fn(async (chave: string | Request) => {
      for (const g of gavetas.values()) {
        const achada = g.get(chaveDe(chave));
        if (achada) return achada.clone();
      }
      return undefined;
    }),
    keys: vi.fn(async () => [...gavetas.keys()]),
    delete: vi.fn(async (nome: string) => gavetas.delete(nome)),
  };
  return {
    cachesFalso,
    nomes: () => [...gavetas.keys()],
    tamanho: (nome: string) => gaveta(nome).size,
    chaves: (nome: string) => [...gaveta(nome).keys()],
    guardada: (nome: string, chave: string) => gaveta(nome).has(chaveDe(chave)),
    preencher: (nome: string, chave: string, resposta: Response) =>
      gaveta(nome).set(chaveDe(chave), resposta),
  };
}

/** BroadcastChannel que guarda quem foi criado e o que cada um enviou. */
function criarCanais() {
  const canais: { nome: string; enviadas: unknown[]; fechado: boolean }[] = [];
  class CanalFalso {
    private registro: { nome: string; enviadas: unknown[]; fechado: boolean };
    constructor(nome: string) {
      this.registro = { nome, enviadas: [], fechado: false };
      canais.push(this.registro);
    }
    postMessage(dado: unknown) {
      this.registro.enviadas.push(dado);
    }
    close() {
      this.registro.fechado = true;
    }
  }
  return { canais, CanalFalso };
}

async function importarSw(opcoes: { semBroadcastChannel?: boolean } = {}) {
  vi.resetModules();
  const listeners = new Map<string, Listener[]>();
  const caches = criarCaches();
  const { canais, CanalFalso } = criarCanais();
  const fetchMock = vi.fn<(alvo: Request | string) => Promise<Response>>();
  const selfFalso = {
    location: { origin: ORIGEM, hostname: new URL(ORIGEM).hostname },
    __WB_MANIFEST: [],
    registration: {
      waiting: null,
      installing: null,
      showNotification: vi.fn(async () => {}),
    },
    addEventListener: (tipo: string, listener: Listener) =>
      listeners.set(tipo, [...(listeners.get(tipo) ?? []), listener]),
    skipWaiting: vi.fn(),
  };
  vi.stubGlobal("self", selfFalso);
  vi.stubGlobal("__APP_VERSION__", VERSAO);
  vi.stubGlobal("caches", caches.cachesFalso);
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal(
    "BroadcastChannel",
    opcoes.semBroadcastChannel ? undefined : CanalFalso,
  );
  vi.stubGlobal("setInterval", vi.fn());
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  await import("@/sw/sw");

  function emitir(tipo: string, evento: unknown) {
    const registrados = listeners.get(tipo) ?? [];
    expect(registrados).toHaveLength(1);
    registrados[0](evento);
  }
  function pedir(url: string) {
    const respondWith = vi.fn<(resposta: Promise<Response>) => void>();
    emitir("fetch", {
      request: new Request(url),
      respondWith,
      waitUntil: () => {},
    });
    return respondWith;
  }
  return { caches, canais, fetchMock, emitir, pedir, selfFalso };
}

async function proximoTurno() {
  await new Promise((resolve) => setTimeout(resolve, 5));
}

const naoTratadas: unknown[] = [];
const registrarRejeicao = (motivo: unknown) => {
  naoTratadas.push(motivo);
};

beforeEach(() => {
  naoTratadas.length = 0;
  process.on("unhandledRejection", registrarRejeicao);
});

afterEach(() => {
  process.off("unhandledRejection", registrarRejeicao);
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("src/sw/sw.ts — o pulso do service worker (HEARTBEAT_PING)", () => {
  it("o ping de uma aba é respondido pela PRÓPRIA aba com HEARTBEAT_ACK", async () => {
    const { emitir, canais } = await importarSw();
    const postMessage = vi.fn();

    emitir("message", { data: "HEARTBEAT_PING", source: { postMessage } });

    expect(postMessage).toHaveBeenCalledTimes(1);
    expect(postMessage).toHaveBeenCalledWith("HEARTBEAT_ACK");
    // Com a aba na linha, ninguém mais é acordado pelo canal.
    expect(canais.every((c) => c.enviadas.length === 0)).toBe(true);
  });

  it("ping sem aba de origem é respondido no canal 'sw-heartbeat'", async () => {
    const { emitir, canais } = await importarSw();

    emitir("message", { data: "HEARTBEAT_PING", source: null });

    const heartbeat = canais.filter((c) => c.nome === "sw-heartbeat");
    expect(heartbeat).toHaveLength(1);
    expect(heartbeat[0].enviadas).toEqual(["HEARTBEAT_ACK"]);
  });

  it("mensagem que não é o ping não gera ack nenhum", async () => {
    const { emitir, canais } = await importarSw();
    const postMessage = vi.fn();

    emitir("message", { data: "OUTRA_COISA", source: { postMessage } });
    emitir("message", {
      data: { type: "HEARTBEAT_PING" },
      source: { postMessage },
    });
    emitir("message", { data: "heartbeat_ping", source: { postMessage } });

    expect(postMessage).not.toHaveBeenCalled();
    expect(canais.every((c) => c.enviadas.length === 0)).toBe(true);
  });
});

describe("src/sw/sw.ts — asset da própria origem só entra no cache quando é uma resposta boa", () => {
  const ASSET = `${ORIGEM}/assets/app-ABC.js`;

  it.each([404, 500, 206, 304])(
    "resposta com status %s não é guardada",
    async (status) => {
      const { pedir, fetchMock, caches } = await importarSw();
      fetchMock.mockResolvedValue(
        comTipo(
          new Response(status === 304 ? null : "corpo", { status }),
          "basic",
        ),
      );

      const respondWith = pedir(ASSET);
      await respondWith.mock.calls[0][0];
      await proximoTurno();

      expect(caches.guardada(CACHE_APP, ASSET)).toBe(false);
    },
  );

  it.each(["basic", "cors"] as const)(
    "200 do tipo %s é guardado",
    async (tipo) => {
      const { pedir, fetchMock, caches } = await importarSw();
      fetchMock.mockResolvedValue(
        comTipo(new Response("js", { status: 200 }), tipo),
      );

      const respondWith = pedir(ASSET);
      await respondWith.mock.calls[0][0];
      await proximoTurno();

      expect(caches.guardada(CACHE_APP, ASSET)).toBe(true);
    },
  );

  it.each(["opaque", "opaqueredirect", "error", "default"] as const)(
    "200 de tipo %s (nem basic nem cors) não é guardado",
    async (tipo) => {
      const { pedir, fetchMock, caches } = await importarSw();
      fetchMock.mockResolvedValue(
        comTipo(new Response("js", { status: 200 }), tipo),
      );

      const respondWith = pedir(ASSET);
      await respondWith.mock.calls[0][0];
      await proximoTurno();

      expect(caches.guardada(CACHE_APP, ASSET)).toBe(false);
    },
  );

  it("rede caiu e o arquivo está guardado: entrega o guardado e não deixa promessa rejeitada solta", async () => {
    const { pedir, fetchMock, caches } = await importarSw();
    caches.preencher(CACHE_APP, ASSET, new Response("js guardado"));
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const respondWith = pedir(ASSET);
    const resposta = await respondWith.mock.calls[0][0];
    await proximoTurno();

    expect(await resposta.text()).toBe("js guardado");
    expect(naoTratadas).toEqual([]);
  });

  it("rede caiu e o arquivo NÃO está guardado: o erro chega ao navegador (sem resposta falsa)", async () => {
    const { pedir, fetchMock } = await importarSw();
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const respondWith = pedir(ASSET);

    await expect(respondWith.mock.calls[0][0]).rejects.toThrow(
      "Failed to fetch",
    );
  });
});

describe("src/sw/sw.ts — foto pública do Storage guardada e a rede caiu", () => {
  it("entrega a foto guardada e não deixa promessa rejeitada solta", async () => {
    const { pedir, fetchMock, caches } = await importarSw();
    caches.preencher(CACHE_IMAGENS, FOTO, new Response("foto guardada"));
    fetchMock.mockRejectedValue(new TypeError("Failed to fetch"));

    const respondWith = pedir(FOTO);
    const resposta = await respondWith.mock.calls[0][0];
    await proximoTurno();

    expect(await resposta.text()).toBe("foto guardada");
    expect(naoTratadas).toEqual([]);
  });
});

describe("src/sw/sw.ts — limpar tudo a pedido (MANUAL_PURGE)", () => {
  it("apaga TODAS as gavetas (app, fotos, ficha, versões velhas), avisa PURGE_COMPLETE e fecha o canal", async () => {
    const { emitir, canais, caches } = await importarSw();
    caches.preencher(CACHE_APP, `${ORIGEM}/a.js`, new Response("a"));
    caches.preencher(CACHE_IMAGENS, FOTO, new Response("f"));
    caches.preencher(
      "ikcous-identidade",
      `${ORIGEM}/identidade.json`,
      new Response("{}"),
    );
    caches.preencher(
      "app-cache-0.0.1",
      `${ORIGEM}/velho.js`,
      new Response("v"),
    );

    emitir("message", { data: { type: "MANUAL_PURGE" } });
    await proximoTurno();

    expect(caches.nomes()).toEqual([]);
    const aviso = canais.filter((c) => c.nome === "sw-messages");
    expect(aviso).toHaveLength(1);
    expect(aviso[0].enviadas).toEqual([{ type: "PURGE_COMPLETE" }]);
    expect(aviso[0].fechado).toBe(true);
  });

  it("sem BroadcastChannel (Safari antigo) a limpeza acontece e nada rejeita", async () => {
    const { emitir, caches } = await importarSw({ semBroadcastChannel: true });
    caches.preencher(CACHE_APP, `${ORIGEM}/a.js`, new Response("a"));

    emitir("message", { data: { type: "MANUAL_PURGE" } });
    await proximoTurno();

    expect(caches.nomes()).toEqual([]);
    expect(naoTratadas).toEqual([]);
  });

  it("sem o ping, sem pulso: com BroadcastChannel ausente o ping sem aba não quebra", async () => {
    const { emitir } = await importarSw({ semBroadcastChannel: true });

    expect(() =>
      emitir("message", { data: "HEARTBEAT_PING", source: null }),
    ).not.toThrow();
  });
});

describe("src/sw/sw.ts — aquecimento (WARM_CACHE) de foto pública respeita o teto da gaveta", () => {
  it("com a gaveta cheia (100), a foto aquecida entra e a mais ANTIGA sai", async () => {
    const { emitir, fetchMock, caches } = await importarSw();
    const antigas = Array.from(
      { length: 100 },
      (_, i) =>
        `https://exemplo.supabase.co/storage/v1/object/public/fotos/antiga-${i}.jpg`,
    );
    for (const url of antigas)
      caches.preencher(CACHE_IMAGENS, url, new Response("x"));
    fetchMock.mockResolvedValue(new Response("foto nova", { status: 200 }));

    emitir("message", { data: { type: "WARM_CACHE", urls: [FOTO] } });
    await proximoTurno();

    expect(caches.tamanho(CACHE_IMAGENS)).toBe(100);
    expect(caches.guardada(CACHE_IMAGENS, FOTO)).toBe(true);
    expect(caches.guardada(CACHE_IMAGENS, antigas[0])).toBe(false);
    expect(caches.guardada(CACHE_IMAGENS, antigas[1])).toBe(true);
  });

  it("mensagem WARM_CACHE sem lista de endereços não quebra o service worker", async () => {
    const { emitir } = await importarSw();

    expect(() =>
      emitir("message", { data: { type: "WARM_CACHE" } }),
    ).not.toThrow();
    await proximoTurno();

    expect(naoTratadas).toEqual([]);
  });
});

describe("src/sw/sw.ts — o aviso (push) espera a ficha nova por 1500 ms, no máximo", () => {
  it("o pedido da ficha renovada leva prazo de EXATAMENTE 1500 ms", async () => {
    const espia = vi.spyOn(AbortSignal, "timeout");
    const { emitir, fetchMock, selfFalso } = await importarSw();
    fetchMock.mockResolvedValue(
      new Response("nao encontrado", { status: 404 }),
    );
    const esperas: Promise<unknown>[] = [];

    emitir("push", {
      data: { json: () => ({ title: "Pedido novo" }), text: () => "" },
      waitUntil: (p: Promise<unknown>) => esperas.push(p),
    });
    await Promise.all(esperas);

    expect(espia.mock.calls.map((c) => c[0])).toEqual([1500]);
    expect(selfFalso.registration.showNotification).toHaveBeenCalledTimes(1);
  });
});

describe("src/sw/sw.ts — foto do Storage refeita em modo cors só vale se voltar do tipo cors", () => {
  function pedidoDeImg(url: string): Request {
    const r = new Request(url, { mode: "no-cors" });
    Object.defineProperty(r, "destination", { value: "image" });
    return r;
  }

  it("a via cors devolve 200 mas de outro tipo: descarta e usa o pedido original (a mesma foto, de antes)", async () => {
    const { emitir, fetchMock } = await importarSw();
    const original = new Response("foto-do-pedido-original", { status: 200 });
    fetchMock
      .mockResolvedValueOnce(
        comTipo(
          new Response("via-cors-sem-tipo-cors", { status: 200 }),
          "basic",
        ),
      )
      .mockResolvedValueOnce(original);
    const respondWith = vi.fn<(resposta: Promise<Response>) => void>();

    emitir("fetch", {
      request: pedidoDeImg(FOTO),
      respondWith,
      waitUntil: () => {},
    });
    const resposta = await respondWith.mock.calls[0][0];
    await proximoTurno();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await resposta.text()).toBe("foto-do-pedido-original");
  });
});

describe("src/sw/sw.ts — logout: a gaveta de fotos joga fora o que não se sabe de onde veio", () => {
  it("chave guardada com endereço que não é uma URL é APAGADA; a foto pública continua lá", async () => {
    const { emitir, caches } = await importarSw();
    const publica = new Request(FOTO);
    const semEndereco = { url: "isto-nao-e-uma-url", headers: new Headers() };
    const apagadas: unknown[] = [];
    caches.cachesFalso.open.mockImplementation(
      async () =>
        ({
          keys: async () => [semEndereco, publica],
          delete: async (chave: unknown) => {
            apagadas.push(chave);
            return true;
          },
        }) as never,
    );
    const esperas: Promise<unknown>[] = [];

    emitir("message", {
      data: { type: "PURGAR_ARQUIVOS_PRIVADOS" },
      waitUntil: (p: Promise<unknown>) => esperas.push(p),
    });
    await Promise.all(esperas);

    expect(apagadas).toEqual([semEndereco]);
    expect(naoTratadas).toEqual([]);
  });
});
