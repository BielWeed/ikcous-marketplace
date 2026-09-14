// @vitest-environment jsdom
//
// Os TRÊS canais convergentes e a subordinação do sentinela (issue #92,
// aceite 1).
//
// Hoje o listener de 'error' vive num chunk LAZY (PWAUpdateGate via
// React.lazy em App.tsx): no boot inicial ele não existe, e se o chunk que
// falhar for o dele próprio, o mecanismo que deveria recuperá-lo nem acorda.
// Pior: 'unhandledrejection' — a forma canônica do Vite para import()
// dinâmico FORA do render — não é escutado por NINGUÉM.
//
// O conserto: `instalarCanaisDeErroChunk()` registra 'error' e
// 'unhandledrejection' UMA única vez no main.tsx (chunk inicial, nunca
// lazy), ambos decidindo pela MESMA chave sincrona do boundary — quem chega
// segundo vira no-op. O sentinela deixa de ser porta paralela: pede recarga
// pela mesma chave e tenta o waiting ANTES de desregistrar ninguém.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_RECUPERACAO_CHUNK,
  instalarCanaisDeErroChunk,
} from "@/lib/recuperacao-chunk";
import { recuperarPulsoPerdido } from "@/pwa-sentinel";

// Mesmo literal da VERSÃO de fallback do módulo, duplicado de propósito.
const VERSAO_FALLBACK_DO_APP = "0.0.0-dev";

const reloadEspiao = vi.fn();
const replaceEspiao = vi.fn();

interface RegistroFalso {
  waiting: { postMessage: ReturnType<typeof vi.fn> } | null;
  unregister: ReturnType<typeof vi.fn>;
}

function instalarServiceWorkerFalso(registros: RegistroFalso[]) {
  const falso = {
    getRegistrations: vi.fn(async () => registros),
    getRegistration: vi.fn(async () => registros.at(0)),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    controller: null,
  };
  Object.defineProperty(navigator, "serviceWorker", {
    configurable: true,
    value: falso,
  });
  return falso;
}

function instalarSondaDeRede(ok: boolean) {
  vi.stubGlobal(
    "fetch",
    ok
      ? vi.fn(
          async () =>
            new Response(JSON.stringify({ version: "1.0.0-x" }), {
              status: 200,
              headers: { "content-type": "application/json" },
            }),
        )
      : vi.fn(
          async () =>
            new Response("<html>portal</html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
        ),
  );
}

function despacharErro(mensagem: string) {
  window.dispatchEvent(new ErrorEvent("error", { message: mensagem }));
}

function despacharRejeicao(reason: unknown) {
  // jsdom não tem construtor de PromiseRejectionEvent para dispatch manual:
  // um Event com `reason` anexado é o mesmo contrato que o listener lê.
  const evento = new Event("unhandledrejection") as Event & {
    reason?: unknown;
    promise?: Promise<unknown>;
  };
  evento.reason = reason;
  evento.promise = Promise.reject(reason).catch(() => {});
  window.dispatchEvent(evento);
}

/** A execução da decisão é async e passa por Response.json()/caches — que
 * resolvem em MACROTASK do runtime, não em microtarefa. Dois ticks de
 * setTimeout drenam tudo pendurado. */
async function drenarTarefas() {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  reloadEspiao.mockClear();
  replaceEspiao.mockClear();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      pathname: "/loja",
      search: "?source=pwa",
      reload: reloadEspiao,
      replace: replaceEspiao,
    },
  });
  vi.stubGlobal(
    "localStorage",
    (() => {
      const armazem = new Map<string, string>();
      return {
        getItem: (chave: string) => armazem.get(chave) ?? null,
        setItem: (chave: string, valor: string) => {
          armazem.set(chave, String(valor));
        },
        removeItem: (chave: string) => {
          armazem.delete(chave);
        },
        clear: () => {
          armazem.clear();
        },
      };
    })(),
  );
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("instalarCanaisDeErroChunk — dois canais globais, uma chave", () => {
  it("evento 'error' de chunk engaja a recuperação (reload seco, sem SW) UMA vez", async () => {
    const desinstalar = instalarCanaisDeErroChunk();

    despacharErro("Loading chunk 7 failed");
    await drenarTarefas();

    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(
      JSON.parse(
        localStorage.getItem(CHAVE_RECUPERACAO_CHUNK) ?? "null",
      ) as unknown,
    ).toEqual({
      versao: VERSAO_FALLBACK_DO_APP,
      count: 1,
      lastAt: expect.any(Number),
    });

    desinstalar();
  });

  it("SEGUNDO canal com o mesmo erro é no-op — a corrida entre boundary e listener acabou", async () => {
    const desinstalar = instalarCanaisDeErroChunk();

    despacharErro("Failed to fetch dynamically imported module: /a.js");
    await drenarTarefas();
    expect(reloadEspiao).toHaveBeenCalledTimes(1);

    // O MESMO erro atravessando o outro canal (boundary já capturou, ou o
    // evento 'error' chegou junto com a rejeição) não engaja de novo.
    despacharRejeicao(
      new Error("Failed to fetch dynamically imported module: /a.js"),
    );
    await drenarTarefas();

    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    desinstalar();
  });

  it("'unhandledrejection' com reason Error de chunk engaja — o canal que não existia", async () => {
    // 2º degrau já consumido há 20s: a rejeição engaja o PURGE (degrau 3),
    // com rede verificada → navegação por replace.
    localStorage.setItem(
      CHAVE_RECUPERACAO_CHUNK,
      JSON.stringify({
        versao: VERSAO_FALLBACK_DO_APP,
        count: 1,
        lastAt: Date.now() - 20000,
      }),
    );
    instalarSondaDeRede(true);
    instalarServiceWorkerFalso([]);
    vi.stubGlobal("caches", {
      keys: vi.fn(async () => []),
      delete: vi.fn(async () => true),
    });
    const desinstalar = instalarCanaisDeErroChunk();

    despacharRejeicao(
      new TypeError("Failed to fetch dynamically imported module: /tela.js"),
    );
    await drenarTarefas();

    expect(replaceEspiao).toHaveBeenCalledTimes(1);
    desinstalar();
  });

  it("erro que NÃO é de chunk não consome a guarda e não recarrega", () => {
    const desinstalar = instalarCanaisDeErroChunk();

    despacharErro("Cannot read properties of undefined (reading 'map')");
    despacharRejeicao(new Error("Request failed with status 500"));

    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK)).toBeNull();
    desinstalar();
  });

  it("o desinstalador devolvido remove os dois listeners", () => {
    const desinstalar = instalarCanaisDeErroChunk();
    desinstalar();

    despacharErro("Loading chunk 1 failed");

    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(localStorage.getItem(CHAVE_RECUPERACAO_CHUNK)).toBeNull();
  });
});

describe("recuperarPulsoPerdido — o sentinela subordinado à chave única", () => {
  function criarRegistro(comWaiting: boolean): RegistroFalso {
    return {
      waiting: comWaiting ? { postMessage: vi.fn() } : null,
      unregister: vi.fn(async () => true),
    };
  }

  it("com waiting pronto: SKIP_WAITING e NENHUM desregistro; reload só quando o novo assume", async () => {
    const registro = criarRegistro(true);
    const sw = instalarServiceWorkerFalso([registro]);

    const promessa = recuperarPulsoPerdido([
      registro as unknown as ServiceWorkerRegistration,
    ]);
    // getRegistration é async: descarregar as microtarefas antes de
    // procurar o listener de controllerchange.
    await Promise.resolve();
    await Promise.resolve();

    const assinatura = sw.addEventListener.mock.calls.find(
      ([evento]) => evento === "controllerchange",
    );
    expect(assinatura).toBeDefined();
    expect(registro.waiting?.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });

    (assinatura?.at(1) as () => void)();
    await promessa;

    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("pwa_reload_reason")).toBe(
      "recuperacao-sentinela",
    );
    expect(registro.unregister).not.toHaveBeenCalled();
  });

  it("sem waiting: desregistra e recarrega (o último recurso de sempre)", async () => {
    const registro = criarRegistro(false);
    instalarServiceWorkerFalso([registro]);

    await recuperarPulsoPerdido([
      registro as unknown as ServiceWorkerRegistration,
    ]);

    expect(registro.unregister).toHaveBeenCalledTimes(1);
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
  });

  it("recuperação de chunk engajada há 5s: o sentinela NÃO atira por cima (aceite 1)", async () => {
    localStorage.setItem(
      CHAVE_RECUPERACAO_CHUNK,
      JSON.stringify({
        versao: VERSAO_FALLBACK_DO_APP,
        count: 1,
        lastAt: Date.now() - 5000,
      }),
    );
    const registro = criarRegistro(true);
    instalarServiceWorkerFalso([registro]);

    await recuperarPulsoPerdido([
      registro as unknown as ServiceWorkerRegistration,
    ]);

    expect(registro.unregister).not.toHaveBeenCalled();
    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(registro.waiting?.postMessage).not.toHaveBeenCalled();
  });
});
