// @vitest-environment jsdom
// Prova de consumidor: listener -> decisão -> execução REAIS; apenas bordas
// sintéticas. Não simula duas abas físicas, reload infinito ou perda de dados.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Modulo = typeof import("@/lib/recuperacao-chunk");
type Canal = "error" | "unhandledrejection";

function criarStorage(): Storage {
  const mapa = new Map<string, string>();
  return {
    get length() {
      return mapa.size;
    },
    key: (indice) => [...mapa.keys()].at(indice) ?? null,
    getItem: (chave) => mapa.get(chave) ?? null,
    setItem: (chave, valor) => {
      mapa.set(chave, String(valor));
    },
    removeItem: (chave) => {
      mapa.delete(chave);
    },
    clear: () => {
      mapa.clear();
    },
  };
}

// Mecanismo já usado na prova de decisão: cada módulo captura a versão no
// import; as duas referências continuam vivas sobre o MESMO Map de storage.
async function carregarVersao(versao: string) {
  conferirIsolamento();
  vi.resetModules();
  vi.stubGlobal("__APP_VERSION__", versao);
  return await import("@/lib/recuperacao-chunk");
}

function criarBordas() {
  const local = criarStorage();
  const sessao = criarStorage();
  const endereco = {
    pathname: "/loja",
    search: "?source=pwa",
    reload: vi.fn(),
    replace: vi.fn(),
  };
  const eventosSW = new EventTarget();
  let registrado = true;
  const postMessage = vi.fn(() => {
    registro.waiting = null;
    eventosSW.dispatchEvent(new Event("controllerchange"));
  });
  const registro = {
    waiting: null as { postMessage: typeof postMessage } | null,
    update: vi.fn(async () => {
      registro.waiting = { postMessage };
    }),
    unregister: vi.fn(async () => {
      registrado = false;
      return true;
    }),
  };
  const sw = {
    getRegistration: vi.fn(async () => (registrado ? registro : undefined)),
    getRegistrations: vi.fn(async () => (registrado ? [registro] : [])),
    addEventListener: vi.fn((nome: string, ouvinte: EventListener) => {
      eventosSW.addEventListener(nome, ouvinte);
    }),
    removeEventListener: vi.fn((nome: string, ouvinte: EventListener) => {
      eventosSW.removeEventListener(nome, ouvinte);
    }),
    controller: null,
  };
  // O cache apagado e o registro desinstalado NÃO renascem entre eventos.
  // Uma segunda limpeza pode alcançar keys/getRegistrations sem apagar de novo.
  const nomes = new Set([
    "app-cache-prova",
    "ikcous-identidade",
    "supabase-images-cache",
  ]);
  const cache = {
    keys: vi.fn(async () => [...nomes]),
    delete: vi.fn(async (nome: string) => nomes.delete(nome)),
  };
  const buscar = vi.fn(
    async () =>
      new Response(JSON.stringify({ version: "0.0.0-servidor-ficticio" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  const banco = { deleteDatabase: vi.fn() };
  const navegador = { onLine: true, serviceWorker: sw };
  vi.stubGlobal("localStorage", local);
  vi.stubGlobal("sessionStorage", sessao);
  vi.stubGlobal("navigator", navegador);
  vi.stubGlobal("caches", cache);
  vi.stubGlobal("indexedDB", banco);
  vi.stubGlobal("fetch", buscar);
  Object.defineProperty(window, "location", {
    configurable: true,
    value: endereco,
  });
  return {
    local,
    sessao,
    endereco,
    sw,
    registro,
    postMessage,
    cache,
    nomes,
    buscar,
    banco,
    navegador,
  };
}

let bordas: ReturnType<typeof criarBordas>;
let locationAnterior: PropertyDescriptor | undefined;
let desinstalar: (() => void) | undefined;
let escapes: string[];

beforeEach(() => {
  escapes = [];
  locationAnterior = Object.getOwnPropertyDescriptor(window, "location");
  vi.useFakeTimers();
  bordas = criarBordas();
});

afterEach(() => {
  desinstalar?.();
  desinstalar = undefined;
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.resetModules();
  if (locationAnterior)
    Object.defineProperty(window, "location", locationAnterior);
  // Fora de qualquer catch da fonte: divergência nunca some como fail-closed.
  expect(
    escapes,
    "nenhuma borda pode escapar para implementação anterior",
  ).toEqual([]);
});

function conferirIsolamento() {
  for (const [nome, esperado] of [
    ["localStorage", bordas.local],
    ["sessionStorage", bordas.sessao],
    ["navigator", bordas.navegador],
    ["caches", bordas.cache],
    ["fetch", bordas.buscar],
    ["indexedDB", bordas.banco],
    ["location", bordas.endereco],
  ] as const) {
    if (
      Reflect.get(globalThis, nome) !== esperado ||
      Reflect.get(window, nome) !== esperado
    ) {
      escapes.push(nome);
    }
  }
  if (
    window.location.reload !== bordas.endereco.reload ||
    window.location.replace !== bordas.endereco.replace
  ) {
    escapes.push("navegacao");
  }
  expect(escapes, "isolamento obrigatório ANTES de importar/despachar").toEqual(
    [],
  );
}

function contarBordas() {
  return {
    consultaCiclo: bordas.sw.getRegistration.mock.calls.length,
    update: bordas.registro.update.mock.calls.length,
    skipWaiting: bordas.postMessage.mock.calls.length,
    reload: bordas.endereco.reload.mock.calls.length,
    sonda: bordas.buscar.mock.calls.length,
    consultaLimpezaSW: bordas.sw.getRegistrations.mock.calls.length,
    unregister: bordas.registro.unregister.mock.calls.length,
    consultaLimpezaCache: bordas.cache.keys.mock.calls.length,
    deleteCache: bordas.cache.delete.mock.calls.length,
    replace: bordas.endereco.replace.mock.calls.length,
  };
}

async function despachar(
  modulo: Modulo,
  agora: number,
  canal: Canal,
  mensagem = "Loading chunk 7 failed",
) {
  conferirIsolamento();
  vi.setSystemTime(agora);
  const antes = contarBordas();
  // Só um módulo escuta por evento: instalar/desinstalar é a API REAL.
  desinstalar = modulo.instalarCanaisDeErroChunk();
  try {
    if (canal === "error") {
      window.dispatchEvent(new ErrorEvent("error", { message: mensagem }));
    } else {
      const evento = new Event("unhandledrejection");
      Object.defineProperty(evento, "reason", { value: new Error(mensagem) });
      window.dispatchEvent(evento);
    }
    // Drena a execução real (void no listener), inclusive Response.json(),
    // sem avançar Date.now para fora da sequência prescrita.
    await vi.advanceTimersByTimeAsync(0);
    expect(Date.now()).toBe(agora);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    desinstalar();
    desinstalar = undefined;
  }
  const depois = contarBordas();
  return Object.fromEntries(
    Object.entries(depois).map(([chave, valor]) => [
      chave,
      valor - antes[chave as keyof typeof antes],
    ]),
  ) as ReturnType<typeof contarBordas>;
}

function conferirPreservados() {
  expect([...bordas.nomes]).toEqual([
    "ikcous-identidade",
    "supabase-images-cache",
  ]);
  expect(bordas.banco.deleteDatabase).not.toHaveBeenCalled();
  expect(bordas.cache.delete.mock.calls).toEqual([["app-cache-prova"]]);
  expect(
    bordas.endereco.replace.mock.calls.every(
      ([url]) => url === "/loja?source=pwa",
    ),
  ).toBe(true);
}

describe("consumidores reais sobre duas versões e storage compartilhado", () => {
  for (const canal of ["error", "unhandledrejection"] as const) {
    it(`PROVA RED: ${canal} não devolve a A o ciclo e a limpeza já consumidos após B`, async () => {
      const a = await carregarVersao("0.0.0-prova-a");
      const b = await carregarVersao("0.0.0-prova-b");
      expect(a.instalarCanaisDeErroChunk).not.toBe(b.instalarCanaisDeErroChunk);
      expect(bordas.local.length).toBe(0);
      const a1000 = await despachar(a, 1000, canal);
      const a17000 = await despachar(a, 17000, canal);
      const b17001 = await despachar(b, 17001, canal);
      const a17002 = await despachar(a, 17002, canal);
      const a33002 = await despachar(a, 33002, canal);
      console.info(
        "PROVA consumidor",
        JSON.stringify({ canal, a1000, a17000, b17001, a17002, a33002 }),
      );

      // Pré-condições observadas nas BORDAS, não decisões fabricadas.
      expect(a1000).toMatchObject({
        update: 1,
        skipWaiting: 1,
        reload: 1,
        sonda: 0,
      });
      expect(a17000).toMatchObject({
        sonda: 1,
        unregister: 1,
        deleteCache: 1,
        replace: 1,
      });
      expect(b17001).toMatchObject({ reload: 1, sonda: 0, replace: 0 });
      conferirPreservados();

      // Contrato: B tem orçamento próprio, mas não devolve os dois degraus
      // gastos por A. Não fixa formato/chaves do storage nem o defeito atual.
      expect
        .soft(a17002, "A esgotada não deve iniciar outro ciclo/reload após B")
        .toEqual(
          Object.fromEntries(Object.keys(a17002).map((chave) => [chave, 0])),
        );
      expect
        .soft(
          a33002,
          "A esgotada não deve repetir sonda/limpeza/navegação após B",
        )
        .toEqual(
          Object.fromEntries(Object.keys(a33002).map((chave) => [chave, 0])),
        );
    });
  }

  it("controle: mesma versão sem B respeita os dois degraus em todos os instantes", async () => {
    const a = await carregarVersao("0.0.0-prova-a");
    for (const agora of [1000, 17000, 17001, 17002, 33002]) {
      await despachar(a, agora, "error");
    }
    expect(contarBordas()).toEqual({
      consultaCiclo: 2,
      update: 1,
      skipWaiting: 1,
      reload: 1,
      sonda: 1,
      consultaLimpezaSW: 1,
      unregister: 1,
      consultaLimpezaCache: 1,
      deleteCache: 1,
      replace: 1,
    });
    conferirPreservados();
  });

  for (const canal of ["error", "unhandledrejection"] as const) {
    it(`controle: ${canal} incompatível não alcança nenhuma borda de recuperação`, async () => {
      const a = await carregarVersao("0.0.0-prova-a");
      const b = await carregarVersao("0.0.0-prova-b");
      for (const [modulo, agora] of [
        [a, 1000],
        [a, 17000],
        [b, 17001],
        [a, 17002],
        [a, 33002],
      ] as const) {
        const efeitos = await despachar(
          modulo,
          agora,
          canal,
          "Erro de validação fictício",
        );
        expect(Object.values(efeitos)).toEqual(
          Object.keys(efeitos).map(() => 0),
        );
      }
      expect(bordas.local.length).toBe(0);
      expect(bordas.banco.deleteDatabase).not.toHaveBeenCalled();
    });
  }
});
