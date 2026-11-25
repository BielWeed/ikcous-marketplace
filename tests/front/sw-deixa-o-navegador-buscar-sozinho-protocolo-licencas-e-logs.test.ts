import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * src/sw/sw.ts — três pedidos que o service worker tem de DEVOLVER ao navegador
 * (`return` sem `respondWith`), e que nenhum teste vigiava:
 *
 *  - endereço que não é http(s) (`blob:`, extensão do navegador): o `blob:` de
 *    uma foto recém-escolhida tem a MESMA origem da loja, então sem a guarda de
 *    protocolo ele cairia no stale-while-revalidate e o SW tentaria guardá-lo;
 *  - `/THIRD_PARTY_NOTICES.txt`: arquivo estático de licenças, não é página do
 *    app — guardá-lo serviria um texto velho para sempre;
 *  - log/telemetria da hospedagem Vercel (`vercel.app` + `logs` no caminho):
 *    causam erro de clone/stream. A guarda é nos DOIS ao mesmo tempo — hospedagem
 *    Vercel com arquivo normal do app continua guardada (senão a loja hospedada
 *    ali perderia o uso sem internet), e é na origem do próprio SW que a guarda
 *    de origem não ajuda.
 *
 * `environment: "node"` e import dentro de cada teste: mesma razão de
 * `sw-fetch.test.ts`.
 */

type Ouvinte = (evento: unknown) => void;

describe("service worker — pedidos devolvidos ao navegador", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let gavetaAberta: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function subir(origem: string) {
    const ouvintes = new Map<string, Ouvinte[]>();
    const selfFalso = {
      location: { origin: origem, hostname: new URL(origem).hostname },
      __WB_MANIFEST: [],
      addEventListener(tipo: string, fn: Ouvinte) {
        ouvintes.set(tipo, [...(ouvintes.get(tipo) ?? []), fn]);
      },
      clients: { claim: vi.fn().mockResolvedValue(undefined) },
      skipWaiting: vi.fn(),
    };
    const cacheFalso = {
      match: vi.fn().mockResolvedValue(undefined),
      put: vi.fn().mockResolvedValue(undefined),
      addAll: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    };
    gavetaAberta = vi.fn().mockResolvedValue(cacheFalso);
    fetchMock = vi.fn().mockImplementation(async () => new Response("rede"));
    vi.stubGlobal("self", selfFalso);
    vi.stubGlobal("caches", {
      open: gavetaAberta,
      match: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
      },
    );
    await import("@/sw/sw");
    const [aoBuscar] = ouvintes.get("fetch") ?? [];
    expect(aoBuscar).toBeTypeOf("function");
    return (url: string) => {
      const evento = {
        request: new Request(url),
        respondWith: vi.fn(),
        waitUntil: vi.fn(),
      };
      aoBuscar(evento);
      return evento;
    };
  }

  it("`blob:` da própria loja não é interceptado nem guardado", async () => {
    const pedir = await subir("https://loja.exemplo.com");

    const evento = pedir("blob:https://loja.exemplo.com/3f2a9c1e-foto-nova");

    expect(evento.respondWith).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gavetaAberta).not.toHaveBeenCalled();
  });

  it("arquivo de licenças vai direto à rede, sem passar pelo cache do SW", async () => {
    const pedir = await subir("https://loja.exemplo.com");

    const evento = pedir("https://loja.exemplo.com/THIRD_PARTY_NOTICES.txt");

    expect(evento.respondWith).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gavetaAberta).not.toHaveBeenCalled();
  });

  it("loja hospedada na Vercel: log da hospedagem fica com o navegador", async () => {
    const pedir = await subir("https://loja.vercel.app");

    const evento = pedir("https://loja.vercel.app/_vercel/logs/entrada");

    expect(evento.respondWith).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(gavetaAberta).not.toHaveBeenCalled();
  });

  it("loja hospedada na Vercel: arquivo normal do app continua sendo guardado", async () => {
    const pedir = await subir("https://loja.vercel.app");

    const evento = pedir("https://loja.vercel.app/assets/index-abc123.js");

    expect(evento.respondWith).toHaveBeenCalledTimes(1);
  });

  it("arquivo normal do app (mesma origem, outra hospedagem) continua interceptado", async () => {
    const pedir = await subir("https://loja.exemplo.com");

    const evento = pedir("https://loja.exemplo.com/assets/index-abc123.js");

    expect(evento.respondWith).toHaveBeenCalledTimes(1);
  });
});
