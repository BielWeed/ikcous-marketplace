import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `/version.json` NÃO PODE VIRAR LIXO NO CACHE DO APP INSTALADO — e o aviso de
 * atualização NÃO PODE CONGELAR NA VERSÃO VELHA.
 *
 * O DEFEITO MEDIDO (08/09/2026, navegador real, Cache Storage real): o
 * `useUpdateCheck` busca `/version.json?t=<agora>` a cada 3 minutos e a cada
 * vez que o app volta a ficar visível. Cada busca tem uma URL DIFERENTE, e o
 * catch-all de `sw.ts` grava a resposta POR URL — 20 polls produziram 20
 * entradas distintas no cache `app-cache-<versao>`, sem colapso e sem despejo.
 * São ~20 entradas por hora de app aberto, e elas só somem quando a versão
 * muda (no `activate`). O cache do app instalado cresce sem limite.
 *
 * A ARMADILHA QUE DECIDE O DESENHO: o catch-all termina em
 * `return cachedResponse || fetchPromise` — ele é CACHE-FIRST. O `?t=` não era
 * enfeite: era ele que garantia o cache miss de cada poll. Tirar o carimbo e
 * deixar o SW cachear `/version.json` entregaria a versão VELHA do cache para
 * sempre, e o aviso de atualização PARARIA DE FUNCIONAR — defeito muito pior
 * que o vazamento. Por isso o teste (B) existe: ele é a trava contra o
 * "conserto" que quebra o frescor.
 *
 * A cura: `/version.json` é uma SONDA DE FRESCOR, não um recurso cacheável. O
 * listener de fetch a ignora (return cedo, sem `respondWith`), o navegador
 * busca nativamente, e o hook passa a mandar `cache: "no-store"`.
 *
 * POR QUE `environment: "node"`, POR QUE `globalThis.self` FALSO E POR QUE
 * IMPORTAR DENTRO DE CADA TESTE: mesmas razões do `sw-fetch.test.ts` — está
 * documentado lá, no cabeçalho, e este arquivo segue o mesmo molde.
 *
 * O QUE ESTE TESTE **NÃO** COBRE: nada aqui roda num Service Worker de
 * verdade. Ele exercita o listener real de `src/sw/sw.ts` contra duplos de
 * `caches`/`fetch`; o comportamento do SW ao vivo no navegador não é medido.
 */

type Listener = (event: unknown) => void;

/** O tsconfig do front não carrega os tipos do Node (`types: ["vite/client"]`),
 * e o teste (D) precisa de `process` para escutar rejeição não tratada de
 * verdade. Declarar só o que é usado evita mexer no tsconfig compartilhado. */
type OuvinteDeRejeicao = (motivo: unknown) => void;
declare const process: {
  listeners(evento: "unhandledRejection"): OuvinteDeRejeicao[];
  removeAllListeners(evento: "unhandledRejection"): void;
  on(evento: "unhandledRejection", ouvinte: OuvinteDeRejeicao): void;
  off(evento: "unhandledRejection", ouvinte: OuvinteDeRejeicao): void;
};

/** Resposta de rede falsa. O `sw.ts` só olha `status`, `ok`, `type` e `clone()`. */
type RespostaFalsa = {
  status: number;
  ok: boolean;
  type: string;
  etiqueta: string;
  clone: () => RespostaFalsa;
};

function criarRespostaFalsa(etiqueta: string): RespostaFalsa {
  return {
    status: 200,
    ok: true,
    // `new Response()` do Node nasce com `type: "default"`, e o catch-all só
    // grava respostas "basic"/"cors" — com a resposta nativa nenhum `put`
    // aconteceria e o teste mediria o instrumento, não o produto.
    type: "basic",
    etiqueta,
    clone: () => criarRespostaFalsa(etiqueta),
  };
}

function criarSelfFalso() {
  const listeners = new Map<string, Listener[]>();
  const selfFalso = {
    location: { origin: "https://loja.exemplo.com" },
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

type OpcoesCaches = {
  /** O que `caches.match()` devolve (undefined = nada em cache). */
  respostaEmCache?: RespostaFalsa;
  /** `cache.put()` rejeita, como faria com a cota de disco estourada. */
  putRejeita?: boolean;
};

function criarCachesFalso({ respostaEmCache, putRejeita }: OpcoesCaches = {}) {
  /** Toda URL que chegou a ser gravada no cache, na ordem. */
  const chavesGravadas: string[] = [];
  const cacheFalso = {
    match: vi.fn().mockResolvedValue(respostaEmCache),
    // PROPOSITALMENTE NÃO É `vi.fn`: o espião do Vitest encadeia handlers na
    // promessa devolvida (para alimentar `mock.settledResults`), o que MARCA a
    // rejeição como tratada e faz o teste (D) passar por acaso contra o código
    // defeituoso. Medido em 08/09/2026: com `vi.fn` o (D) nascia verde.
    put: (pedido: Request) => {
      chavesGravadas.push(pedido.url);
      return putRejeita
        ? Promise.reject(new Error("QuotaExceededError"))
        : Promise.resolve(undefined);
    },
    addAll: vi.fn().mockResolvedValue(undefined),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  const cachesFalso = {
    open: vi.fn().mockResolvedValue(cacheFalso),
    match: vi.fn().mockResolvedValue(respostaEmCache),
    keys: vi.fn().mockResolvedValue([]),
    delete: vi.fn().mockResolvedValue(true),
  };
  return { cachesFalso, cacheFalso, chavesGravadas };
}

/** Evento de fetch falso que GUARDA a promessa entregue ao `respondWith`. */
function criarFetchEvent(request: Request) {
  const respostas: Promise<unknown>[] = [];
  return {
    request,
    respondWith: vi.fn((p: Promise<unknown>) => {
      respostas.push(p);
    }),
    waitUntil: vi.fn(),
    respostas,
  };
}

/** Deixa as promessas soltas do SW terminarem (inclusive as macrotarefas). */
async function esperarAsPromessasSoltas(voltas = 4) {
  for (let i = 0; i < voltas; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

const URL_DA_SONDA = "https://loja.exemplo.com/version.json";

describe("src/sw/sw.ts — /version.json é sonda de frescor, não recurso cacheável", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  async function importarComGlobaisFalsos(opcoes: OpcoesCaches = {}) {
    const { selfFalso, listeners } = criarSelfFalso();
    const { cachesFalso, cacheFalso, chavesGravadas } =
      criarCachesFalso(opcoes);
    fetchMock = vi.fn(async () => criarRespostaFalsa("da-rede"));

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

    const fetchListeners = listeners.get("fetch") ?? [];
    expect(fetchListeners.length).toBe(1);
    return {
      fetchListener: fetchListeners[0],
      cacheFalso,
      chavesGravadas,
    };
  }

  // (A) O VAZAMENTO, REPRODUZIDO. 20 polls com carimbos diferentes — os
  // mesmos que o app produz — não podem deixar UMA entrada no cache.
  it("20 polls de /version.json com carimbos diferentes não gravam NADA no cache", async () => {
    const { fetchListener, chavesGravadas } = await importarComGlobaisFalsos();

    const interceptacoes: number[] = [];
    let carimbo = 1_757_000_000_000; // ~08/09/2026, um poll a cada 3 min
    for (let i = 0; i < 20; i++) {
      carimbo += 3 * 60 * 1000;
      const event = criarFetchEvent(
        new Request(`${URL_DA_SONDA}?t=${carimbo}`, { method: "GET" }),
      );
      fetchListener(event);
      interceptacoes.push(event.respondWith.mock.calls.length);
      await Promise.all(event.respostas);
    }
    await esperarAsPromessasSoltas();

    expect({
      gravacoes: chavesGravadas.length,
      chavesDistintas: new Set(chavesGravadas).size,
      interceptacoes: interceptacoes.reduce((a, b) => a + b, 0),
      buscasFeitasPeloSW: fetchMock.mock.calls.length,
    }).toEqual({
      gravacoes: 0,
      chavesDistintas: 0,
      interceptacoes: 0,
      buscasFeitasPeloSW: 0,
    });
  });

  // (B) O FRESCOR, QUE NÃO PODE QUEBRAR. Este é o teste que impede o conserto
  // de criar o defeito pior: sem o `?t=` (que é o que passa a valer), o
  // catch-all cache-first devolveria a versão VELHA do cache para sempre.
  it("com /version.json VELHO no cache, o SW não responde do cache (o app ainda descobre a versão nova)", async () => {
    const versaoVelha = criarRespostaFalsa("1.0.0-VELHA-do-cache");
    const { fetchListener } = await importarComGlobaisFalsos({
      respostaEmCache: versaoVelha,
    });

    const event = criarFetchEvent(new Request(URL_DA_SONDA, { method: "GET" }));
    fetchListener(event);
    const entregue = event.respostas.length
      ? ((await event.respostas[0]) as RespostaFalsa | undefined)
      : null;
    await esperarAsPromessasSoltas();

    expect({
      interceptou: event.respondWith.mock.calls.length,
      versaoEntregue: entregue?.etiqueta ?? null,
    }).toEqual({ interceptou: 0, versaoEntregue: null });
  });

  // (C) CONTROLE. Sem ele, "zero gravações" não prova nada — poderia ser o
  // teste que não está exercitando o listener. Um asset comum continua sendo
  // cacheado e respondido, exatamente como antes.
  it("controle: asset same-origin comum CONTINUA sendo cacheado e respondido", async () => {
    const { fetchListener, chavesGravadas } = await importarComGlobaisFalsos();

    const url = "https://loja.exemplo.com/assets/index-abc123.js";
    const event = criarFetchEvent(new Request(url, { method: "GET" }));
    fetchListener(event);
    const entregue = (await event.respostas[0]) as RespostaFalsa;
    await esperarAsPromessasSoltas();

    expect({
      interceptou: event.respondWith.mock.calls.length,
      entregue: entregue?.etiqueta,
      gravacoes: chavesGravadas,
    }).toEqual({
      interceptou: 1,
      entregue: "da-rede",
      gravacoes: [url],
    });
  });

  // (D) PROMESSA SOLTA. O `try/catch` que envolve o `cache.put` do catch-all é
  // SÍNCRONO: ele não pega rejeição de promessa. Com a cota de disco estourada
  // o `put` rejeita e isso vira unhandled rejection DENTRO do service worker.
  it("cache.put que rejeita (cota cheia) não vira rejeição não tratada, e o asset continua sendo entregue", async () => {
    const { fetchListener } = await importarComGlobaisFalsos({
      putRejeita: true,
    });

    // Capturar a rejeição não tratada de verdade, no nível do processo: os
    // ouvintes do próprio runner saem por um instante e voltam no fim, para
    // que a rejeição desta janela chegue só aqui.
    const ouvintesDoRunner = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const naoTratadas: unknown[] = [];
    const meuOuvinte = (motivo: unknown) => {
      naoTratadas.push(motivo);
    };
    process.on("unhandledRejection", meuOuvinte);

    let entregue: RespostaFalsa | undefined;
    try {
      const event = criarFetchEvent(
        new Request("https://loja.exemplo.com/assets/index-abc123.js", {
          method: "GET",
        }),
      );
      fetchListener(event);
      entregue = (await event.respostas[0]) as RespostaFalsa;
      await esperarAsPromessasSoltas();
    } finally {
      process.off("unhandledRejection", meuOuvinte);
      for (const ouvinte of ouvintesDoRunner) {
        process.on("unhandledRejection", ouvinte);
      }
    }

    expect({
      rejeicoesNaoTratadas: naoTratadas.map((e) => String(e)),
      entregue: entregue?.etiqueta,
    }).toEqual({ rejeicoesNaoTratadas: [], entregue: "da-rede" });
  });

  // (D-bis) O MESMO PADRÃO DE PROMESSA SOLTA existe nos outros três ramos que
  // gravam no cache: navegação sem cópia em cache, revalidação de navegação em
  // segundo plano, e imagem do Supabase Storage.
  it("os outros três ramos que gravam no cache também não deixam rejeição escapar", async () => {
    const cenarios = [
      {
        nome: "navegação sem cópia em cache",
        pedido: () => {
          const r = new Request("https://loja.exemplo.com/", { method: "GET" });
          Object.defineProperty(r, "mode", { value: "navigate" });
          return r;
        },
        temCache: false,
      },
      {
        nome: "navegação com cópia em cache (revalidação de fundo)",
        pedido: () => {
          const r = new Request("https://loja.exemplo.com/", { method: "GET" });
          Object.defineProperty(r, "mode", { value: "navigate" });
          return r;
        },
        temCache: true,
      },
      {
        nome: "imagem do Supabase Storage",
        pedido: () =>
          new Request(
            "https://xyzcompany.supabase.co/storage/v1/object/public/imagens/foo.png",
            { method: "GET" },
          ),
        temCache: false,
      },
    ];

    const ouvintesDoRunner = process.listeners("unhandledRejection");
    process.removeAllListeners("unhandledRejection");
    const naoTratadas: string[] = [];
    const meuOuvinte = (motivo: unknown) => {
      naoTratadas.push(String(motivo));
    };
    process.on("unhandledRejection", meuOuvinte);

    const ramosExercitados: string[] = [];
    try {
      for (const cenario of cenarios) {
        vi.resetModules();
        const { fetchListener, chavesGravadas } =
          await importarComGlobaisFalsos({
            putRejeita: true,
            respostaEmCache: cenario.temCache
              ? criarRespostaFalsa("do-cache")
              : undefined,
          });
        const event = criarFetchEvent(cenario.pedido());
        fetchListener(event);
        await Promise.allSettled(event.respostas);
        await esperarAsPromessasSoltas();
        if (chavesGravadas.length > 0) ramosExercitados.push(cenario.nome);
      }
    } finally {
      process.off("unhandledRejection", meuOuvinte);
      for (const ouvinte of ouvintesDoRunner) {
        process.on("unhandledRejection", ouvinte);
      }
    }

    // `ramosExercitados` é o controle: sem ele, "zero rejeições" poderia ser
    // apenas um teste que nunca chegou a tentar gravar nada.
    expect({
      rejeicoesNaoTratadas: naoTratadas,
      ramosExercitados,
    }).toEqual({
      rejeicoesNaoTratadas: [],
      ramosExercitados: cenarios.map((c) => c.nome),
    });
  });
});
