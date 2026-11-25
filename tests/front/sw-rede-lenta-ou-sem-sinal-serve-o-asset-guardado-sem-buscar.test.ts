import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * src/sw/sw.ts — o que o service worker faz com um arquivo do app (JS, CSS,
 * imagem) que JÁ está guardado, conforme a qualidade da rede que a página
 * avisou (`SET_NETWORK_QUALITY`).
 *
 * O aviso é mandado pelo `useNetworkAdaptive` (testado do lado da página), mas
 * ninguém provava o OUTRO lado: o que o SW faz com ele. Com a rede lenta (2g,
 * economia de dados) ou sem sinal, o arquivo guardado sai na hora e o SW NÃO
 * abre uma busca em segundo plano — ela disputaria a banda curta com a tela que
 * a cliente está tentando abrir. Com rede boa, o arquivo guardado também sai na
 * hora, mas a cópia é revalidada para a próxima visita (stale-while-revalidate).
 * Estes casos derrubam o "lenta" e o "sem sinal" tirados da condição e o
 * "volta ao normal" quando a mensagem vem sem qualidade.
 *
 * `environment: "node"` e import dentro do teste: mesma razão de
 * `sw-fetch.test.ts` (o SW registra os ouvintes no próprio import e lê `self`).
 */

type Ouvinte = (evento: unknown) => void;

function montarSelfFalso() {
  const ouvintes = new Map<string, Ouvinte[]>();
  const selfFalso = {
    location: { origin: "https://loja.exemplo.com" },
    __WB_MANIFEST: [],
    addEventListener(tipo: string, fn: Ouvinte) {
      ouvintes.set(tipo, [...(ouvintes.get(tipo) ?? []), fn]);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    skipWaiting: vi.fn(),
  };
  return { selfFalso, ouvintes };
}

function montarCachesFalso(guardado?: string) {
  const cacheFalso = {
    match: vi.fn().mockResolvedValue(undefined),
    put: vi.fn().mockResolvedValue(undefined),
    addAll: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const cachesFalso = {
    open: vi.fn().mockResolvedValue(cacheFalso),
    // Uma Response nova a cada leitura: o corpo só pode ser lido uma vez.
    match: vi
      .fn()
      .mockImplementation(async () =>
        guardado === undefined ? undefined : new Response(guardado),
      ),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  return { cachesFalso, cacheFalso };
}

const ASSET = "https://loja.exemplo.com/assets/index-abc123.js";

describe("service worker — arquivo guardado e qualidade da rede", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Sobe o SW com um arquivo guardado e devolve o que o teste manda e lê. */
  async function subirComArquivoGuardado() {
    const { selfFalso, ouvintes } = montarSelfFalso();
    const { cachesFalso } = montarCachesFalso("copia-guardada");
    fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response("copia-da-rede"));
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
    const [aoReceber] = ouvintes.get("message") ?? [];
    const [aoBuscar] = ouvintes.get("fetch") ?? [];
    expect(aoReceber).toBeTypeOf("function");
    expect(aoBuscar).toBeTypeOf("function");
    return {
      avisarQualidade: (quality?: string) =>
        aoReceber({ data: { type: "SET_NETWORK_QUALITY", quality } }),
      pedir: async (url = ASSET) => {
        const evento = {
          request: new Request(url),
          respondWith: vi.fn(),
          waitUntil: vi.fn(),
        };
        aoBuscar(evento);
        expect(evento.respondWith).toHaveBeenCalledTimes(1);
        const resposta = (await evento.respondWith.mock
          .calls[0][0]) as Response;
        return resposta.text();
      },
    };
  }

  it.each(["slow", "offline"])(
    "com a rede '%s', o arquivo guardado sai na hora e NÃO abre busca em segundo plano",
    async (qualidade) => {
      const sw = await subirComArquivoGuardado();
      sw.avisarQualidade(qualidade);

      expect(await sw.pedir()).toBe("copia-guardada");
      expect(fetchMock).not.toHaveBeenCalled();
    },
  );

  it.each(["fast", "medium"])(
    "com a rede '%s', o arquivo guardado sai na hora E a cópia é revalidada",
    async (qualidade) => {
      const sw = await subirComArquivoGuardado();
      sw.avisarQualidade(qualidade);

      expect(await sw.pedir()).toBe("copia-guardada");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    },
  );

  it("sem aviso nenhum a rede conta como boa: revalida", async () => {
    const sw = await subirComArquivoGuardado();

    expect(await sw.pedir()).toBe("copia-guardada");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("depois de lenta, a mensagem sem qualidade volta ao normal (revalida)", async () => {
    const sw = await subirComArquivoGuardado();
    sw.avisarQualidade("slow");
    await sw.pedir();
    expect(fetchMock).not.toHaveBeenCalled();

    sw.avisarQualidade(undefined);

    expect(await sw.pedir()).toBe("copia-guardada");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("voltar de 'sem sinal' para 'fast' religa a revalidação", async () => {
    const sw = await subirComArquivoGuardado();
    sw.avisarQualidade("offline");
    await sw.pedir();
    expect(fetchMock).not.toHaveBeenCalled();

    sw.avisarQualidade("fast");

    await sw.pedir();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rede lenta mas SEM cópia guardada: o arquivo vem da rede, não fica sem resposta", async () => {
    const { selfFalso, ouvintes } = montarSelfFalso();
    const { cachesFalso } = montarCachesFalso(undefined);
    fetchMock = vi
      .fn()
      .mockImplementation(async () => new Response("copia-da-rede"));
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
    const [aoReceber] = ouvintes.get("message") ?? [];
    const [aoBuscar] = ouvintes.get("fetch") ?? [];
    aoReceber({ data: { type: "SET_NETWORK_QUALITY", quality: "slow" } });
    const evento = {
      request: new Request(ASSET),
      respondWith: vi.fn(),
      waitUntil: vi.fn(),
    };

    aoBuscar(evento);
    const resposta = (await evento.respondWith.mock.calls[0][0]) as Response;

    expect(await resposta.text()).toBe("copia-da-rede");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
