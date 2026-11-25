import { respostaManutencao } from "@/hospedagem/porteiro";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `src/sw/sw.ts` — o que apaga a página guardada de uma rota é o PAR
 * "status 503 + cabeçalho `x-ikcous-porteiro` de recusa duradoura", não o
 * cabeçalho sozinho. O arquivo vizinho
 * (`sw-manutencao-503-do-porteiro-apaga-a-pagina-guardada.test.ts`) prova 502,
 * 504, 500 e 503 SEM o cabeçalho; o que faltava é o inverso: o cabeçalho de
 * recusa duradoura vindo com OUTRO status. Quem coloca esse cabeçalho é só o
 * porteiro, e sempre num 503 — se algum dia ele vier num 500, 502 ou 504 (um
 * proxy no meio repassando cabeçalho, uma pane da hospedagem), apagar o app
 * guardado deixaria a cliente sem a vitrine offline por causa de uma pane
 * passageira, que é exatamente o que a regra do par existe para evitar.
 *
 * Mesmo molde do arquivo vizinho: o cache GUARDA de verdade (um Map).
 */

type Listener = (event: unknown) => void;

const ORIGEM = "https://loja.exemplo.com";
const ROTA = `${ORIGEM}/produtos`;
const VITRINE_ANTIGA = "<html>vitrine antiga</html>";

const chave = (alvo: Request | string) =>
  new URL(typeof alvo === "string" ? alvo : alvo.url, ORIGEM).href;

function montar(rede: () => Promise<Response>) {
  const listeners = new Map<string, Listener[]>();
  const guardadas = new Map<string, Response>([
    [ROTA, new Response(VITRINE_ANTIGA, { status: 200 })],
  ]);
  const casar = vi.fn(async (alvo: Request | string) =>
    guardadas.get(chave(alvo))?.clone(),
  );
  const apagar = vi.fn(async (alvo: Request | string) =>
    guardadas.delete(chave(alvo)),
  );
  const cacheFalso = {
    addAll: vi.fn().mockResolvedValue(undefined),
    put: vi.fn(async (alvo: Request | string, resposta: Response) => {
      guardadas.set(chave(alvo), resposta);
    }),
    match: casar,
    keys: vi.fn().mockResolvedValue([]),
    delete: apagar,
  };
  vi.stubGlobal("self", {
    location: { origin: ORIGEM },
    __WB_MANIFEST: [],
    addEventListener(tipo: string, fn: Listener) {
      listeners.set(tipo, [...(listeners.get(tipo) ?? []), fn]);
    },
    clients: { claim: vi.fn().mockResolvedValue(undefined) },
    registration: { waiting: null, installing: null },
    skipWaiting: vi.fn(),
  });
  vi.stubGlobal("caches", {
    match: casar,
    open: vi.fn().mockResolvedValue(cacheFalso),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  });
  vi.stubGlobal("fetch", vi.fn(rede));
  vi.stubGlobal(
    "BroadcastChannel",
    class {
      postMessage() {}
      close() {}
    },
  );
  return { listeners, guardadas, apagar };
}

async function abrir(listeners: Map<string, Listener[]>) {
  const request = new Request(ROTA);
  Object.defineProperty(request, "mode", { value: "navigate" });
  const esperas: Promise<unknown>[] = [];
  const respondWith = vi.fn();
  (listeners.get("fetch") ?? [])[0]({
    request,
    respondWith,
    waitUntil: (p: Promise<unknown>) => esperas.push(p),
  });
  const resposta = (await respondWith.mock.calls[0][0]) as Response;
  await Promise.all(esperas);
  await new Promise((resolve) => setTimeout(resolve, 0));
  return resposta;
}

describe("sw.ts — só o par 503 + marcador de recusa duradoura apaga a página guardada", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([500, 502, 504])(
    "status %i com o cabeçalho de recusa duradoura NÃO apaga a página guardada",
    async (status) => {
      const { listeners, guardadas, apagar } = montar(
        async () =>
          new Response("<html>pane</html>", {
            status,
            headers: { "x-ikcous-porteiro": "sem-loja" },
          }),
      );
      await import("@/sw/sw");

      const resposta = await abrir(listeners);

      expect(await resposta.text()).toBe(VITRINE_ANTIGA);
      expect(apagar).not.toHaveBeenCalled();
      expect(guardadas.has(ROTA)).toBe(true);
    },
  );

  it("o 503 real do porteiro (sem-loja) apaga: o controle do mesmo cenário", async () => {
    const { listeners, guardadas, apagar } = montar(async () =>
      respostaManutencao("sem-loja", "ausente"),
    );
    await import("@/sw/sw");

    await abrir(listeners);

    expect(apagar).toHaveBeenCalledTimes(1);
    expect(guardadas.has(ROTA)).toBe(false);
  });
});
