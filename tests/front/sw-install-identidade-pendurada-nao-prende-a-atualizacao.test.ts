import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { criarBuildIdentity } from "./fixtures/build-identity";

/**
 * `src/sw/sw.ts` — o `install` não pode ficar preso numa busca pendurada.
 *
 * O `install` tem dois `waitUntil`: o do precache (que já tem prazo) e o da
 * ficha da loja (`/identidade.json`). Se a conexão conectar e nunca
 * responder nessa segunda busca, o `waitUntil` nunca resolve e o service
 * worker novo fica "instalando" para sempre: a pessoa segue na versão velha
 * mesmo com o pacote novo já baixado. O `.catch` só ajudava quando a busca
 * falhava de verdade. Agora a busca tem o mesmo prazo dos vizinhos
 * (`PRAZO_DA_REDE_NO_SW_MS`, 5 s): estourou, cai no `.catch`, só loga e o
 * `install` termina.
 *
 * `environment: "node"`, `self` falso e `import` dentro de cada teste: mesmas
 * razões de `sw-identidade-fora-do-document.test.ts` (o `sw.ts` registra os
 * listeners como efeito colateral do import).
 */

type Listener = (event: unknown) => void;

const IDENTIDADE_JSON_URL = "/identidade.json";
const IDENTIDADE_CACHE_NAME = "ikcous-identidade";
/** Mesmo valor de `PRAZO_DA_REDE_NO_SW_MS` em `sw.ts` (não é exportado). */
const PRAZO_MS = 5000;

describe("src/sw/sw.ts — install com a ficha da loja pendurada", () => {
  const prazoNativoOriginal = AbortSignal.timeout;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
  });

  afterEach(() => {
    AbortSignal.timeout = prazoNativoOriginal;
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  /** O prazo nativo usa o relógio de verdade; aqui ele anda no de mentira. */
  function sinalNoRelogioDeMentira(nativo: boolean) {
    if (nativo) {
      AbortSignal.timeout = (ms: number) => {
        const controle = new AbortController();
        setTimeout(() => controle.abort(), ms);
        return controle.signal;
      };
    } else {
      (AbortSignal as { timeout?: unknown }).timeout = undefined;
    }
  }

  /** Como o `fetch` do navegador: o pedido cai quando o sinal aborta. */
  function cancelavel(sinal: AbortSignal | undefined) {
    return new Promise<never>((_, rejeitar) =>
      // Sem sinal não há como cancelar: o pedido fica pendurado de verdade.
      sinal?.addEventListener("abort", () =>
        rejeitar(new DOMException("aborted", "AbortError")),
      ),
    );
  }

  async function importar(
    respostaDaIdentidade: (init: RequestInit | undefined) => Promise<unknown>,
  ) {
    vi.stubGlobal("__STORE_IDENTITY__", criarBuildIdentity("Aurora", "aurora"));
    const listeners = new Map<string, Listener[]>();
    vi.stubGlobal("self", {
      location: {
        origin: "https://loja.exemplo.com",
        hostname: "loja.exemplo.com",
      },
      __WB_MANIFEST: [],
      addEventListener(tipo: string, fn: Listener) {
        listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
      },
      clients: { claim: vi.fn().mockResolvedValue(undefined) },
      registration: {
        waiting: null,
        showNotification: vi.fn().mockResolvedValue(undefined),
      },
      skipWaiting: vi.fn(),
    });

    const gravacoes = new Map<string, string[]>();
    vi.stubGlobal("caches", {
      open: vi.fn((nome: string) =>
        Promise.resolve({
          addAll: vi.fn().mockResolvedValue(undefined),
          put: vi.fn((chave: string | Request) => {
            const url = typeof chave === "string" ? chave : chave.url;
            gravacoes.set(nome, [...(gravacoes.get(nome) ?? []), url]);
            return Promise.resolve(undefined);
          }),
          match: vi.fn().mockResolvedValue(undefined),
          keys: vi.fn().mockResolvedValue([]),
          delete: vi.fn().mockResolvedValue(true),
        }),
      ),
      match: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn().mockResolvedValue([]),
      delete: vi.fn().mockResolvedValue(true),
    });

    const chamadasDaIdentidade: Array<RequestInit | undefined> = [];
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url === IDENTIDADE_JSON_URL) {
        chamadasDaIdentidade.push(init);
        return respostaDaIdentidade(init);
      }
      // A página inicial do `install`: resposta que não vale guardar.
      return Promise.resolve({ ok: false, status: 404 });
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

    /** Dispara o `install` e devolve se TODAS as promessas do `waitUntil`
     * já terminaram (resolvendo ou rejeitando). */
    function instalar() {
      const waitUntil = vi.fn();
      listeners.get("install")![0]({ waitUntil });
      expect(waitUntil).toHaveBeenCalledTimes(2);
      const estado = { terminou: false, rejeitou: false };
      Promise.all(waitUntil.mock.calls.map((c) => c[0])).then(
        () => {
          estado.terminou = true;
        },
        () => {
          estado.terminou = true;
          estado.rejeitou = true;
        },
      );
      return estado;
    }

    return { instalar, gravacoes, chamadasDaIdentidade };
  }

  describe.each([
    ["com AbortSignal.timeout", true],
    ["sem AbortSignal.timeout (iOS 15)", false],
  ])("busca da ficha que nunca responde (%s)", (_nome, nativo) => {
    it("o install termina depois do prazo e nada é gravado no cache da ficha", async () => {
      sinalNoRelogioDeMentira(nativo);
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const { instalar, gravacoes } = await importar((init) =>
        cancelavel(init?.signal as AbortSignal | undefined),
      );

      const estado = instalar();
      await vi.advanceTimersByTimeAsync(1000);
      // Prova que a busca estava mesmo pendurada: dentro do prazo, o install
      // continua esperando (não é um resultado trivial).
      expect(estado.terminou).toBe(false);

      await vi.advanceTimersByTimeAsync(PRAZO_MS);
      expect(estado.terminou).toBe(true);
      expect(estado.rejeitou).toBe(false);
      expect(gravacoes.get(IDENTIDADE_CACHE_NAME)).toBeUndefined();
      // O erro por prazo só é logado, como qualquer falha da ficha.
      expect(warn).toHaveBeenCalledWith(
        "[SW] Falha ao buscar a ficha da loja no install:",
        expect.objectContaining({ name: "AbortError" }),
      );
    });
  });

  it("a busca da ficha leva um AbortSignal (prazo) e continua com no-store", async () => {
    sinalNoRelogioDeMentira(true);
    const { instalar, chamadasDaIdentidade } = await importar(() =>
      Promise.resolve({ ok: true, status: 200 }),
    );

    instalar();
    await vi.advanceTimersByTimeAsync(10);

    expect(chamadasDaIdentidade).toHaveLength(1);
    expect(chamadasDaIdentidade[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(chamadasDaIdentidade[0]?.cache).toBe("no-store");
  });

  it("resposta ok dentro do prazo: grava a ficha como sempre", async () => {
    sinalNoRelogioDeMentira(true);
    const { instalar, gravacoes } = await importar(() =>
      Promise.resolve({ ok: true, status: 200 }),
    );

    const estado = instalar();
    await vi.advanceTimersByTimeAsync(10);

    expect(estado.terminou).toBe(true);
    expect(gravacoes.get(IDENTIDADE_CACHE_NAME)).toEqual([IDENTIDADE_JSON_URL]);
  });

  it("resposta que não é ok: não grava, e o install termina", async () => {
    sinalNoRelogioDeMentira(true);
    const { instalar, gravacoes } = await importar(() =>
      Promise.resolve({ ok: false, status: 503 }),
    );

    const estado = instalar();
    await vi.advanceTimersByTimeAsync(10);

    expect(estado.terminou).toBe(true);
    expect(estado.rejeitou).toBe(false);
    expect(gravacoes.get(IDENTIDADE_CACHE_NAME)).toBeUndefined();
  });

  it("falha imediata da busca: não quebra o install", async () => {
    sinalNoRelogioDeMentira(true);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { instalar, gravacoes } = await importar(() =>
      Promise.reject(new Error("porteiro fora do ar")),
    );

    const estado = instalar();
    await vi.advanceTimersByTimeAsync(10);

    expect(estado.terminou).toBe(true);
    expect(estado.rejeitou).toBe(false);
    expect(gravacoes.get(IDENTIDADE_CACHE_NAME)).toBeUndefined();
  });
});
