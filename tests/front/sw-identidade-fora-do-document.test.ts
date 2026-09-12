import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

/**
 * `src/sw/sw.ts` — a ficha da loja SEM `document` (etapa 2 da escala,
 * 11/09/2026, brief `20260911-brief-escala-etapa2-site-por-host.md`, tarefa T2).
 *
 * POR QUE ESTE TESTE EXISTE: com um único build compartilhado por toda a
 * frota, o service worker deixa de ter um `__STORE_IDENTITY__` por loja — ele
 * roda fora do `<head>` e não tem `document`. A ficha da loja (marca +
 * conexão) só chega até ele pelo mesmo caminho JSON puro que o porteiro serve
 * em `/identidade.json` (`CAMINHO_IDENTIDADE_JSON`, `src/config/fichaDaLojaContract.ts`).
 * Este arquivo prova três coisas que o brief exige: (1) o `install` busca essa
 * ficha e a guarda num cache PRÓPRIO sem derrubar a instalação se a busca
 * falhar; (2) o `activate` NÃO apaga esse cache junto com os antigos; (3) o
 * `push` prefere o ícone da ficha em cache e só cai no ícone NEUTRO do build
 * (`/icons/heart-96x96.png`, ADENDO A.8/B.5, 11/09/2026 — nunca mais o
 * `buildIdentity` da principal) quando não há ficha.
 *
 * POR QUE `environment: "node"`, `globalThis.self` FALSO E IMPORTAR DENTRO DE
 * CADA TESTE: mesmas razões documentadas em `tests/front/sw-fetch.test.ts` —
 * `sw.ts` faz `const sw = self as any` e registra os listeners como efeito
 * colateral do próprio import.
 */

type Listener = (event: unknown) => void;

function criarSelfFalso() {
  const listeners = new Map<string, Listener[]>();
  const selfFalso = {
    location: {
      origin: "https://loja.exemplo.com",
      hostname: "loja.exemplo.com",
    },
    __WB_MANIFEST: [],
    addEventListener(tipo: string, fn: Listener) {
      const atuais = listeners.get(tipo) ?? [];
      atuais.push(fn);
      listeners.set(tipo, atuais);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    registration: {
      waiting: null,
      showNotification: vi.fn().mockResolvedValue(undefined),
    },
    skipWaiting: vi.fn(),
  };
  return { selfFalso, listeners };
}

const IDENTIDADE_CACHE_NAME = "ikcous-identidade";

type OpcoesCaches = {
  /** O que `caches.open(IDENTIDADE_CACHE_NAME).match()` devolve — a ficha
   * guardada no `install`, lida pelo cache PRÓPRIO (não o top-level). */
  respostaEmCache?: unknown;
  /** Nomes de cache que já existem quando o `activate` roda. */
  cachesExistentes?: string[];
};

function criarCachesFalso({
  respostaEmCache,
  cachesExistentes = [],
}: OpcoesCaches = {}) {
  const aberturas: string[] = [];
  const gravacoesPorCache = new Map<string, string[]>();
  const cachesDeletados: string[] = [];

  function criarCache(nome: string) {
    return {
      addAll: vi.fn().mockResolvedValue(undefined),
      put: vi.fn((chave: string | Request) => {
        const url = typeof chave === "string" ? chave : chave.url;
        const atuais = gravacoesPorCache.get(nome) ?? [];
        atuais.push(url);
        gravacoesPorCache.set(nome, atuais);
        return Promise.resolve(undefined);
      }),
      match: vi
        .fn()
        .mockResolvedValue(
          nome === IDENTIDADE_CACHE_NAME ? respostaEmCache : undefined,
        ),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    };
  }

  const cachesFalso = {
    open: vi.fn((nome: string) => {
      aberturas.push(nome);
      return Promise.resolve(criarCache(nome));
    }),
    match: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue(cachesExistentes),
    delete: vi.fn((nome: string) => {
      cachesDeletados.push(nome);
      return Promise.resolve(true);
    }),
  };
  return { cachesFalso, aberturas, gravacoesPorCache, cachesDeletados };
}

const IDENTIDADE_JSON_URL = "/identidade.json";

describe("src/sw/sw.ts — a ficha da loja sem document", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importarComGlobaisFalsos(opcoesCaches: OpcoesCaches = {}) {
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Aurora", "aurora"));
    const { selfFalso, listeners } = criarSelfFalso();
    const { cachesFalso, aberturas, gravacoesPorCache, cachesDeletados } =
      criarCachesFalso(opcoesCaches);
    const fetchMock = vi.fn();

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

    return {
      selfFalso,
      listeners,
      fetchMock,
      aberturas,
      gravacoesPorCache,
      cachesDeletados,
    };
  }

  it("install: busca /identidade.json com cache:no-store e guarda num cache próprio", async () => {
    const { listeners, fetchMock, aberturas, gravacoesPorCache } =
      await importarComGlobaisFalsos();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === IDENTIDADE_JSON_URL) {
        return { ok: true, status: 200 };
      }
      return { ok: true, status: 200 };
    });
    const waitUntil = vi.fn();
    const installListener = listeners.get("install")![0];

    installListener({ waitUntil });
    // As duas promessas do install (precache + busca da ficha) são passadas
    // ao waitUntil antes de qualquer await — esperamos as duas resolverem.
    await Promise.all(waitUntil.mock.calls.map((call) => call[0]));

    expect(
      fetchMock.mock.calls.some(
        ([url, init]) =>
          url === IDENTIDADE_JSON_URL &&
          (init as RequestInit | undefined)?.cache === "no-store",
      ),
    ).toBe(true);
    expect(aberturas).toContain("ikcous-identidade");
    expect(gravacoesPorCache.get("ikcous-identidade")).toEqual([
      IDENTIDADE_JSON_URL,
    ]);
  });

  it("install: busca de /identidade.json que falha NÃO impede a instalação", async () => {
    const { listeners, fetchMock } = await importarComGlobaisFalsos();
    fetchMock.mockImplementation(async (url: string) => {
      if (url === IDENTIDADE_JSON_URL) {
        throw new Error("porteiro fora do ar");
      }
      return { ok: true, status: 200 };
    });
    const waitUntil = vi.fn();
    const installListener = listeners.get("install")![0];

    installListener({ waitUntil });

    // Nenhuma das promessas passadas ao waitUntil pode rejeitar — é isso que
    // prova que a falha da ficha não derruba o `install`.
    await expect(
      Promise.all(waitUntil.mock.calls.map((call) => call[0])),
    ).resolves.toBeDefined();
  });

  it("activate: o cache ikcous-identidade NÃO entra na lista de purga", async () => {
    const { listeners, cachesDeletados } = await importarComGlobaisFalsos({
      cachesExistentes: [
        "app-cache-velho",
        "ikcous-identidade",
        "supabase-images-cache",
      ],
    });
    const waitUntil = vi.fn();
    const activateListener = listeners.get("activate")![0];

    activateListener({ waitUntil });
    await Promise.all(waitUntil.mock.calls.map((call) => call[0]));

    expect(cachesDeletados).toEqual(["app-cache-velho"]);
  });

  it("push: com a ficha em cache, o ícone vem de FichaDaLoja.identidade.localUrls.icon_192 (não do assado)", async () => {
    const respostaFicha = {
      json: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        // Mesmo host do `self.location.hostname` do fixture (`loja.exemplo.com`)
        // — resolverIconeDaLoja (T2b) só aceita a ficha em cache quando o host
        // bate; ficha de OUTRA loja no mesmo cache compartilhado não pode vazar
        // ícone (teste de host diferente, mais abaixo).
        host: "loja.exemplo.com",
        identidade: {
          identity: criarBuildIdentity("DaFicha", "da-ficha").identity,
          localUrls: criarBuildIdentity("DaFicha", "da-ficha").localUrls,
          publicUrl: "https://loja-da-ficha.exemplo",
          identityRevision: "b".repeat(64),
        },
        conexao: {
          supabaseUrl: "https://ficha.supabase.co",
          publishableKey: "sb_publishable_ficha",
        },
      }),
    };
    const { listeners, selfFalso } = await importarComGlobaisFalsos({
      respostaEmCache: respostaFicha,
    });
    const pushListener = listeners.get("push")![0];
    const waitUntil = vi.fn();

    pushListener({
      data: { json: () => ({ title: "Aviso", body: "Mensagem" }) },
      waitUntil,
    });
    await Promise.all(waitUntil.mock.calls.map((call) => call[0]));

    // Ícone do ASSADO (buildIdentity fixture "Aurora") teria sido
    // /identity/aurora/icon-192.png — asserção pela DIFERENÇA, provando que
    // o valor veio da FICHA, não do build.
    expect(selfFalso.registration.showNotification).toHaveBeenCalledWith(
      "Aviso",
      expect.objectContaining({
        icon: "/identity/da-ficha/icon-192.png",
        badge: "/identity/da-ficha/icon-192.png",
      }),
    );
  });

  it("push: ficha em cache com host DIFERENTE do self.location.hostname → ícone neutro (nunca o da principal)", async () => {
    const respostaFicha = {
      json: vi.fn().mockResolvedValue({
        schemaVersion: 1,
        // Cache PRÓPRIO é compartilhado pelo build único; uma ficha de OUTRA
        // loja pode ficar ali (ex.: SW antigo que não foi limpo). Sem o
        // confronto de host, o ícone da loja errada apareceria na notificação.
        host: "outra-loja.exemplo",
        identidade: {
          identity: criarBuildIdentity("DaFicha", "da-ficha").identity,
          localUrls: criarBuildIdentity("DaFicha", "da-ficha").localUrls,
          publicUrl: "https://outra-loja.exemplo",
          identityRevision: "b".repeat(64),
        },
        conexao: {
          supabaseUrl: "https://ficha.supabase.co",
          publishableKey: "sb_publishable_ficha",
        },
      }),
    };
    const { listeners, selfFalso } = await importarComGlobaisFalsos({
      respostaEmCache: respostaFicha,
    });
    const pushListener = listeners.get("push")![0];
    const waitUntil = vi.fn();

    pushListener({
      data: { json: () => ({ title: "Aviso", body: "Mensagem" }) },
      waitUntil,
    });
    await Promise.all(waitUntil.mock.calls.map((call) => call[0]));

    // ADENDO A.8/B.5 (11/09/2026): o último recurso deixou de ser o ícone
    // assado da PRINCIPAL (`buildIdentity`) — agora é o ícone NEUTRO do
    // build (`/icons/heart-96x96.png`), nunca `/identity/aurora/...` (a
    // fixture "Aurora" simula a principal). A divergência de host descarta a
    // ficha inteira e cai no mesmo fallback do cache vazio.
    expect(selfFalso.registration.showNotification).toHaveBeenCalledWith(
      "Aviso",
      expect.objectContaining({
        icon: "/icons/heart-96x96.png",
        badge: "/icons/heart-96x96.png",
      }),
    );
  });

  it("push: sem ficha em cache, o ícone cai no NEUTRO do build (nunca o assado da principal)", async () => {
    const { listeners, selfFalso } = await importarComGlobaisFalsos({
      respostaEmCache: undefined,
    });
    const pushListener = listeners.get("push")![0];
    const waitUntil = vi.fn();

    pushListener({
      data: { json: () => ({ title: "Aviso", body: "Mensagem" }) },
      waitUntil,
    });
    await Promise.all(waitUntil.mock.calls.map((call) => call[0]));

    expect(selfFalso.registration.showNotification).toHaveBeenCalledWith(
      "Aviso",
      expect.objectContaining({
        icon: "/icons/heart-96x96.png",
        badge: "/icons/heart-96x96.png",
      }),
    );
  });
});
