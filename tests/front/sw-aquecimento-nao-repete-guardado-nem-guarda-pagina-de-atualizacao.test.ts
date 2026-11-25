import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * src/sw/sw.ts — mensagem `WARM_CACHE` (a página pede ao service worker que
 * baixe e guarde endereços antes de a cliente precisar deles).
 *
 * Três regras que o teste de aquecimento já existente não prendia, achadas
 * tirando cada uma do código e vendo tudo continuar verde:
 *
 *  1. Endereço que JÁ está guardado não é baixado de novo (gastaria a banda da
 *     cliente a cada abertura de vitrine, para guardar a mesma coisa).
 *  2. Só o domínio do Supabase de verdade passa como "Supabase". `falso-
 *     supabase.co` termina em "supabase.co" mas não é um subdomínio dele: a
 *     verificação de que o arquivo é público olha só o caminho, então o host é a
 *     ÚNICA coisa que impede o SW de baixar e guardar o que um domínio alheio
 *     serve no mesmo caminho de storage.
 *  3. Página HTML aquecida enquanto há atualização a caminho (`waiting` ou
 *     `installing`) NÃO entra no cache da versão que ainda manda: ela traria
 *     pedaços de JavaScript que esse cache não tem e a rota guardada abriria
 *     quebrada sem internet. Mesma guarda da navegação (caça de 26/10 e de
 *     24/11/2026), mas ninguém a provava no caminho do aquecimento.
 *
 * `environment: "node"` e import dentro do teste: mesma razão de
 * `sw-fetch.test.ts`.
 */

type Ouvinte = (evento: unknown) => void;
type Chave = string | Request;

const ORIGEM = "https://loja.exemplo.com";
const CACHE_APP = "app-cache-teste-aquece";
const CACHE_IMAGENS = "supabase-images-cache";
const FOTO = "https://exemplo.supabase.co/storage/v1/object/public/fotos/a.jpg";
const PAGINA = `${ORIGEM}/catalogo`;
const HTML_COM_ARQUIVO_DO_PRECACHE =
  '<!doctype html><html><head><script src="/assets/index-abc.js"></script></head></html>';
const HTML_COM_ARQUIVO_FORA_DO_PRECACHE =
  '<!doctype html><html><head><script src="/assets/outro-xyz.js"></script></head></html>';

function paginaHtml(corpo: string): Response {
  return new Response(corpo, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
}

/** Uma gaveta por nome; ler devolve cópia nova, gravar substitui de verdade. */
function criarCaches() {
  const gavetas = new Map<string, Map<string, Response>>();
  const gravacoes: Array<{ nome: string; url: string }> = [];
  const chaveDe = (chave: Chave) =>
    new URL(typeof chave === "string" ? chave : chave.url, ORIGEM).href;
  const gaveta = (nome: string) => {
    let entradas = gavetas.get(nome);
    if (!entradas) {
      entradas = new Map();
      gavetas.set(nome, entradas);
    }
    return entradas;
  };
  const cachesFalso = {
    open: vi.fn(async (nome: string) => ({
      match: async (chave: Chave) => gaveta(nome).get(chaveDe(chave))?.clone(),
      put: async (chave: Chave, resposta: Response) => {
        gravacoes.push({ nome, url: chaveDe(chave) });
        gaveta(nome).set(chaveDe(chave), resposta.clone());
      },
      keys: async () => [...gaveta(nome).keys()].map((url) => new Request(url)),
    })),
    match: vi.fn(async () => undefined),
    keys: vi.fn(async () => []),
    delete: vi.fn(async () => true),
  };
  return {
    cachesFalso,
    gravacoes,
    preencher: (nome: string, chave: Chave, resposta: Response) =>
      gaveta(nome).set(chaveDe(chave), resposta.clone()),
  };
}

async function esperarGravacoes() {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("service worker — aquecimento do cache (WARM_CACHE)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function subir(
    registration: { waiting: unknown; installing: unknown } = {
      waiting: null,
      installing: null,
    },
  ) {
    const ouvintes = new Map<string, Ouvinte[]>();
    const caches = criarCaches();
    const fetchMock = vi.fn<(alvo: RequestInfo | URL) => Promise<Response>>();
    vi.stubGlobal("self", {
      location: { origin: ORIGEM, hostname: new URL(ORIGEM).hostname },
      __WB_MANIFEST: [{ url: "/assets/index-abc.js", revision: null }],
      registration,
      addEventListener: (tipo: string, ouvinte: Ouvinte) =>
        ouvintes.set(tipo, [...(ouvintes.get(tipo) ?? []), ouvinte]),
    });
    vi.stubGlobal("__APP_VERSION__", "teste-aquece");
    vi.stubGlobal("caches", caches.cachesFalso);
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("setInterval", vi.fn());
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("@/sw/sw");
    const [aoReceber] = ouvintes.get("message") ?? [];
    expect(aoReceber).toBeTypeOf("function");
    return {
      ...caches,
      fetchMock,
      aquecer: async (urls: string[]) => {
        aoReceber({ data: { type: "WARM_CACHE", urls } });
        await esperarGravacoes();
        await esperarGravacoes();
      },
    };
  }

  describe("endereço que já está guardado", () => {
    it("do app: não é baixado de novo nem regravado", async () => {
      const sw = await subir();
      const url = `${ORIGEM}/foto.jpg`;
      sw.preencher(CACHE_APP, url, new Response("ja-guardada"));

      await sw.aquecer([url]);

      expect(sw.fetchMock).not.toHaveBeenCalled();
      expect(sw.gravacoes).toEqual([]);
    });

    it("da gaveta de imagens do Supabase: também não", async () => {
      const sw = await subir();
      sw.preencher(CACHE_IMAGENS, FOTO, new Response("ja-guardada"));

      await sw.aquecer([FOTO]);

      expect(sw.fetchMock).not.toHaveBeenCalled();
      expect(sw.gravacoes).toEqual([]);
    });
  });

  describe("domínio que só PARECE ser do Supabase", () => {
    it.each([
      "https://falso-supabase.co/storage/v1/object/public/fotos/a.jpg",
      "https://supabase.co.alheio.example/storage/v1/object/public/fotos/a.jpg",
      "https://exemplo.supabase.co.alheio.example/storage/v1/object/public/fotos/a.jpg",
    ])("não é baixado nem guardado: %s", async (url) => {
      const sw = await subir();
      sw.fetchMock.mockResolvedValue(new Response("imagem-alheia"));

      await sw.aquecer([url]);

      expect(sw.fetchMock).not.toHaveBeenCalled();
      expect(sw.gravacoes).toEqual([]);
    });

    it.each([FOTO, "https://supabase.co/storage/v1/object/public/fotos/a.jpg"])(
      "o Supabase de verdade (%s) é baixado e vai para a gaveta de imagens",
      async (url) => {
        const sw = await subir();
        sw.fetchMock.mockImplementation(async () => new Response("imagem"));

        await sw.aquecer([url]);

        expect(sw.fetchMock).toHaveBeenCalledExactlyOnceWith(url);
        expect(sw.gravacoes).toEqual([{ nome: CACHE_IMAGENS, url }]);
      },
    );
  });

  describe("página HTML aquecida", () => {
    it("sem atualização a caminho e só com arquivos do precache: é guardada", async () => {
      const sw = await subir();
      sw.fetchMock.mockImplementation(async () =>
        paginaHtml(HTML_COM_ARQUIVO_DO_PRECACHE),
      );

      await sw.aquecer([PAGINA]);

      expect(sw.gravacoes).toEqual([{ nome: CACHE_APP, url: PAGINA }]);
    });

    it.each([
      [
        "já baixada e esperando ativar (waiting)",
        { waiting: {}, installing: null },
      ],
      ["sendo baixada agora (installing)", { waiting: null, installing: {} }],
    ])(
      "com atualização %s: a página NÃO é guardada",
      async (_nome, registration) => {
        const sw = await subir(registration);
        sw.fetchMock.mockImplementation(async () =>
          paginaHtml(HTML_COM_ARQUIVO_DO_PRECACHE),
        );

        await sw.aquecer([PAGINA]);

        expect(sw.fetchMock).toHaveBeenCalledTimes(1);
        expect(sw.gravacoes).toEqual([]);
      },
    );

    it("que cita arquivo fora do precache desta versão: NÃO é guardada", async () => {
      const sw = await subir();
      sw.fetchMock.mockImplementation(async () =>
        paginaHtml(HTML_COM_ARQUIVO_FORA_DO_PRECACHE),
      );

      await sw.aquecer([PAGINA]);

      expect(sw.gravacoes).toEqual([]);
    });

    it("com atualização a caminho, imagem aquecida segue sendo guardada (a regra é só de HTML)", async () => {
      const sw = await subir({ waiting: {}, installing: null });
      const url = `${ORIGEM}/foto.jpg`;
      sw.fetchMock.mockImplementation(
        async () =>
          new Response("imagem", {
            status: 200,
            headers: { "content-type": "image/jpeg" },
          }),
      );

      await sw.aquecer([url]);

      expect(sw.gravacoes).toEqual([{ nome: CACHE_APP, url }]);
    });
  });
});
