import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * src/sw/sw.ts — o que o `activate` apaga quando a versão nova do app assume.
 *
 * Os testes de ativação existentes provam que o app ANTIGO só é apagado com o
 * novo inteiro, mas nenhum conferia o outro lado: QUAIS gavetas sobrevivem. O
 * navegador guarda, no mesmo Cache Storage do app, duas gavetas que NÃO são do
 * app e atravessam as versões de propósito:
 *
 *  - `supabase-images-cache`: as fotos dos produtos. Apagá-la a cada versão
 *    nova (e saem versões toda semana) joga fora o que a cliente viu e deixa a
 *    vitrine em branco quando ela abre a loja sem sinal;
 *  - `ikcous-identidade`: a ficha da loja que o aviso (push) lê para pôr o
 *    ícone e o nome certos. Apagada, o aviso sai com o ícone neutro até a
 *    próxima instalação.
 *
 * Sobra para apagar só o que é cache de versão antiga do app. O precache aqui
 * está vazio de propósito: o cache da versão nova conta como inteiro e o
 * `activate` segue direto para a limpeza.
 *
 * `environment: "node"` e import dentro do teste: mesma razão de
 * `sw-fetch.test.ts`.
 */

type Ouvinte = (evento: {
  waitUntil: (promessa: Promise<unknown>) => void;
}) => void;

const VERSAO = "2.0.0";
const CACHE_DA_VERSAO = `app-cache-${VERSAO}`;

describe("service worker — ativação da versão nova", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function ativarCom(
    gavetasExistentes: string[],
    paginaInicialJaGuardada = false,
  ) {
    const ouvintes = new Map<string, Ouvinte>();
    const apagadas: string[] = [];
    vi.stubGlobal("self", {
      location: {
        origin: "https://loja.exemplo.com",
        hostname: "loja.exemplo.com",
      },
      __WB_MANIFEST: [],
      registration: { waiting: null, installing: null },
      clients: { claim: vi.fn().mockResolvedValue(undefined) },
      addEventListener: (tipo: string, ouvinte: Ouvinte) =>
        ouvintes.set(tipo, ouvinte),
    });
    vi.stubGlobal("__APP_VERSION__", VERSAO);
    fetchMock = vi.fn().mockRejectedValue(new Error("sem rede"));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubGlobal("BroadcastChannel", undefined);
    vi.stubGlobal("setInterval", vi.fn());
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => gavetasExistentes),
      delete: vi.fn(async (nome: string) => {
        apagadas.push(nome);
        return true;
      }),
      match: vi.fn(async () => undefined),
      open: vi.fn(async () => ({
        match: async () =>
          paginaInicialJaGuardada ? new Response("home-guardada") : undefined,
        put: async () => undefined,
        keys: async () => [],
        delete: async () => true,
      })),
    });
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await import("@/sw/sw");
    const aoAtivar = ouvintes.get("activate");
    expect(aoAtivar).toBeTypeOf("function");
    const esperas: Array<Promise<unknown>> = [];
    aoAtivar?.({ waitUntil: (promessa) => esperas.push(promessa) });
    await Promise.all(esperas);
    return apagadas;
  }

  it("apaga só os caches de versões antigas do app", async () => {
    const apagadas = await ativarCom([
      "app-cache-1.0.0",
      "app-cache-1.9.9",
      CACHE_DA_VERSAO,
    ]);

    expect(apagadas.sort()).toEqual(["app-cache-1.0.0", "app-cache-1.9.9"]);
  });

  it("não apaga a gaveta de fotos dos produtos", async () => {
    const apagadas = await ativarCom([
      "app-cache-1.0.0",
      CACHE_DA_VERSAO,
      "supabase-images-cache",
    ]);

    expect(apagadas).toEqual(["app-cache-1.0.0"]);
    expect(apagadas).not.toContain("supabase-images-cache");
  });

  it("não apaga a gaveta da ficha da loja que o aviso lê", async () => {
    const apagadas = await ativarCom([
      "app-cache-1.0.0",
      CACHE_DA_VERSAO,
      "ikcous-identidade",
    ]);

    expect(apagadas).toEqual(["app-cache-1.0.0"]);
    expect(apagadas).not.toContain("ikcous-identidade");
  });

  it("sem nada de versão antiga, não apaga gaveta nenhuma", async () => {
    const apagadas = await ativarCom([
      CACHE_DA_VERSAO,
      "supabase-images-cache",
      "ikcous-identidade",
    ]);

    expect(apagadas).toEqual([]);
  });

  it("página inicial já guardada no cache novo: a ativação não a baixa de novo", async () => {
    await ativarCom([CACHE_DA_VERSAO], true);

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("sem página inicial guardada, a ativação tenta baixá-la (o instalador pode ter falhado)", async () => {
    await ativarCom([CACHE_DA_VERSAO], false);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toBe("/");
  });
});
