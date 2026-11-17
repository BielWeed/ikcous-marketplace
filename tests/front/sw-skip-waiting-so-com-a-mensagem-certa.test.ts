import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * src/sw/sw.ts — o receptor REAL da mensagem `SKIP_WAITING`.
 *
 * Quem pede a troca de versão (a página, a sentinela, a "Tentar de novo" da aba
 * que falhou) manda `{ type: "SKIP_WAITING" }` ao service worker que está
 * esperando, e é a linha `sw.skipWaiting()` do listener `message` que o faz
 * assumir. Os testes do outro lado (recarga-de-aba-que-falhou-ciclo-do-sw,
 * recuperacao-chunk-*) usam um `postMessage` FALSO que já dispara o
 * `controllerchange` sozinho: eles provam que a página manda a mensagem, nunca
 * que o service worker a obedece. Sem esta linha a atualização fica esperando
 * para sempre e a cliente continua na versão velha, sem erro nenhum à vista.
 *
 * Os casos que doem: a mensagem certa chama `skipWaiting` UMA vez; o `install`
 * NÃO o chama por conta própria (a troca é pedida, nunca automática); e mensagem
 * de outro tipo, com o tipo escrito diferente, só a string, vazia ou sem dados
 * NÃO ativa versão nenhuma.
 *
 * Mesmo arnês de sw-nao-guarda-arquivo-privado.test.ts: `environment: "node"`,
 * globais falsos montados ANTES do `await import` e `vi.resetModules()` entre
 * testes (o `sw.ts` registra os listeners no próprio import).
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
    registration: { waiting: null },
    skipWaiting: vi.fn(),
  };
  return { selfFalso, listeners };
}

describe("src/sw/sw.ts — a mensagem SKIP_WAITING ativa a versão nova", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  async function importarSw() {
    const { selfFalso, listeners } = criarSelfFalso();
    const cachesFalso = {
      open: vi.fn(async () => ({
        match: vi.fn(async () => undefined),
        put: vi.fn(async () => undefined),
        addAll: vi.fn().mockResolvedValue(undefined),
        keys: vi.fn(async () => []),
        delete: vi.fn(async () => true),
      })),
      match: vi.fn().mockResolvedValue(undefined),
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
    };
    const fetchMock = vi.fn(async () => new Response("x", { status: 200 }));

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
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});

    await import("@/sw/sw");

    const mensagens = listeners.get("message") ?? [];
    expect(mensagens.length).toBe(1);
    return { aoReceber: mensagens[0], selfFalso, listeners };
  }

  it("{ type: 'SKIP_WAITING' } chama skipWaiting UMA vez", async () => {
    const { aoReceber, selfFalso } = await importarSw();

    aoReceber({ data: { type: "SKIP_WAITING" } });

    expect(selfFalso.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("a mensagem certa não precisa de source nem de waitUntil (a página só faz postMessage)", async () => {
    const { aoReceber, selfFalso } = await importarSw();

    // Sem `source`, sem `waitUntil`: o evento mínimo que o navegador entrega.
    expect(() =>
      aoReceber({ data: { type: "SKIP_WAITING" }, source: null }),
    ).not.toThrow();

    expect(selfFalso.skipWaiting).toHaveBeenCalledTimes(1);
  });

  it("nada chama skipWaiting por conta própria: nem o import, nem o install, nem o activate", async () => {
    const { listeners, selfFalso } = await importarSw();

    // O `install` real busca a ficha e guarda o precache: aqui só importa o
    // que ele NÃO faz. Falha dentro dele não é o assunto deste teste.
    const waitUntilInstall = vi.fn();
    listeners.get("install")?.[0]({ waitUntil: waitUntilInstall });
    await Promise.allSettled(waitUntilInstall.mock.calls.map((c) => c[0]));
    const waitUntilActivate = vi.fn();
    listeners.get("activate")?.[0]({ waitUntil: waitUntilActivate });
    await Promise.allSettled(waitUntilActivate.mock.calls.map((c) => c[0]));

    expect(selfFalso.skipWaiting).not.toHaveBeenCalled();
  });

  it.each([
    ["tipo desconhecido", { type: "PURGAR_TUDO_QUE_EU_QUISER" }],
    ["tipo escrito em minúsculas", { type: "skip_waiting" }],
    ["tipo com espaço sobrando", { type: "SKIP_WAITING " }],
    ["tipo parecido", { type: "SKIP_WAITING_NOW" }],
    ["tipo vazio", { type: "" }],
    ["tipo nulo", { type: null }],
    ["objeto sem tipo", {}],
    ["só a string (o tipo vai dentro do objeto)", "SKIP_WAITING"],
    ["o ping de saúde", "HEARTBEAT_PING"],
    ["número", 1],
    ["nulo", null],
    ["indefinido", undefined],
  ])("%s: NÃO chama skipWaiting", async (_nome, data) => {
    const { aoReceber, selfFalso } = await importarSw();

    expect(() => aoReceber({ data })).not.toThrow();

    expect(selfFalso.skipWaiting).not.toHaveBeenCalled();
  });

  it("outras mensagens reais (aquecimento, qualidade de rede, purga) não ativam a versão nova", async () => {
    const { aoReceber, selfFalso } = await importarSw();

    aoReceber({ data: { type: "WARM_CACHE", urls: [] } });
    aoReceber({ data: { type: "SET_NETWORK_QUALITY", quality: "slow" } });
    aoReceber({
      data: { type: "PURGAR_ARQUIVOS_PRIVADOS" },
      waitUntil: vi.fn(),
    });

    expect(selfFalso.skipWaiting).not.toHaveBeenCalled();
  });

  it("a mensagem certa depois de lixo ainda funciona (mensagem estranha não trava o receptor)", async () => {
    const { aoReceber, selfFalso } = await importarSw();

    aoReceber({ data: null });
    aoReceber({ data: { type: "skip_waiting" } });
    aoReceber({ data: { type: "SKIP_WAITING" } });

    expect(selfFalso.skipWaiting).toHaveBeenCalledTimes(1);
  });
});
