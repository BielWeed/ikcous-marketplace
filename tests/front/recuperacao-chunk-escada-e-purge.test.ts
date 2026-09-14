// @vitest-environment jsdom
//
// A ESCADA de recuperação (issue #92) — o purge é o ÚLTIMO degrau, não o
// primeiro:
//
//   degraus 1+2 · ciclo NATURAL do service worker (SKIP_WAITING →
//                controllerchange → reload), com reload seco de fallback;
//   degrau 3    · purge SELETIVO, só com rede verificada por conteúdo:
//                desregistrar SWs + apagar SÓ caches `app-cache-*` +
//                location.replace preservando pathname+search.
//
// O que a escada NUNCA faz no caminho de chunk (aceites 4, 5 e 7):
//   · NÃO apaga IndexedDB (o catálogo offline do lojista);
//   · NÃO apaga `ikcous-identidade` nem `supabase-images-cache` (sem elas o
//     fallback offline do sw.ts devolve 503 "Loja em manutenção" para a base
//     instalada — violação do aceite 7 com cara de manutenção);
//   · NÃO navega com `?forceUpdate=` (zero consumidores; jogava fora o
//     `?source=pwa` da base instalada e empilhava histórico — aceite 6).
//
// O deleteDatabase AGUARDADO com prazo (aceite 5) fica provado aqui porque
// mora neste módulo e é consumido pelo purge de versão obrigatória
// (useUpdateCheck) — caminho que DELETA IndexedDB de propósito, e por isso
// não pode pendurar com conexão aberta (onblocked).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  apagarIndexedDBAguardando,
  executarRecuperacaoChunk,
} from "@/lib/recuperacao-chunk";

// Mesmo literal do PRAZO_CICLO_DO_SW_MS no módulo, duplicado de propósito.
const PRAZO_CICLO_DO_SW_MS = 2500;
// Mesmo literal do PRAZO do deleteDatabase no módulo, duplicado de propósito.
const PRAZO_DELETE_DATABASE_MS = 4000;

type Espiao = ReturnType<typeof vi.fn>;

interface RegistroFalso {
  waiting: { postMessage: Espiao } | null;
  unregister: Espiao;
  update: Espiao;
}

function criarRegistroFalso(opcoes?: { comWaiting?: boolean }): RegistroFalso {
  return {
    waiting: opcoes?.comWaiting ? { postMessage: vi.fn() } : null,
    unregister: vi.fn(async () => true),
    update: vi.fn(async () => undefined),
  };
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

function instalarCachesFalsos(nomes: string[]) {
  const apagados: string[] = [];
  const falso = {
    keys: vi.fn(async () => [...nomes]),
    delete: vi.fn(async (nome: string) => {
      apagados.push(nome);
      return true;
    }),
  };
  vi.stubGlobal("caches", falso);
  return apagados;
}

function instalarIndexedDBFalso() {
  const pedido: {
    onsuccess: (() => void) | null;
    onerror: (() => void) | null;
    onblocked: (() => void) | null;
  } = { onsuccess: null, onerror: null, onblocked: null };
  const deleteDatabase = vi.fn(() => pedido);
  vi.stubGlobal("indexedDB", { deleteDatabase });
  return { pedido, deleteDatabase };
}

function instalarSondaDeRede(ok: boolean) {
  const buscar = ok
    ? vi.fn(
        async () =>
          new Response(JSON.stringify({ version: "1.0.0-x" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
      )
    : vi.fn(
        async () =>
          new Response("<html>portal cativo</html>", {
            status: 200,
            headers: { "content-type": "text/html" },
          }),
      );
  vi.stubGlobal("fetch", buscar);
  return buscar;
}

const reloadEspiao = vi.fn();
const replaceEspiao = vi.fn();

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
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a escada — degraus 1+2: ciclo natural do service worker", () => {
  it("sem service worker nenhum: reload seco UMA vez, com motivo nominal de recuperação", async () => {
    const resultado = await executarRecuperacaoChunk({
      dono: true,
      acao: "ciclo-sw",
    });

    expect(resultado).toBe("recarregou");
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("pwa_reload_reason")).toBe(
      "recuperacao-erro-modulo",
    );
  });

  it("com waiting pronto: SKIP_WAITING → controllerchange recarrega; NADA é desregistrado", async () => {
    const registro = criarRegistroFalso({ comWaiting: true });
    const sw = instalarServiceWorkerFalso([registro]);

    const promessa = executarRecuperacaoChunk({
      dono: true,
      acao: "ciclo-sw",
    });
    // getRegistration é async: descarregar as microtarefas antes de
    // procurar o listener de controllerchange.
    await Promise.resolve();
    await Promise.resolve();

    const assinatura = sw.addEventListener.mock.calls.find(
      ([evento]) => evento === "controllerchange",
    );
    expect(assinatura).toBeDefined();
    const aoAssumir = assinatura?.at(1) as () => void;

    // O waiting foi convidado a assumir ANTES de qualquer desregistro.
    expect(registro.waiting?.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });
    expect(registro.unregister).not.toHaveBeenCalled();

    aoAssumir();

    expect(await promessa).toBe("recarregou");
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(registro.unregister).not.toHaveBeenCalled();
  });

  it("waiting que nunca assume: após o prazo, cai no reload seco (sem laço, sem espera infinita)", async () => {
    vi.useFakeTimers();
    const registro = criarRegistroFalso({ comWaiting: true });
    instalarServiceWorkerFalso([registro]);

    const promessa = executarRecuperacaoChunk({
      dono: true,
      acao: "ciclo-sw",
    });
    await vi.advanceTimersByTimeAsync(PRAZO_CICLO_DO_SW_MS + 1);

    expect(await promessa).toBe("recarregou");
    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(registro.unregister).not.toHaveBeenCalled();
  });
});

describe("a escada — degrau 3: purge seletivo, só com rede verificada", () => {
  it("rede verificada: desregistra SW, apaga SÓ app-cache-*, preserva identidade+imagens+IndexedDB e navega com replace", async () => {
    instalarSondaDeRede(true);
    const registro = criarRegistroFalso();
    instalarServiceWorkerFalso([registro]);
    const apagados = instalarCachesFalsos([
      "app-cache-1773003981700",
      "app-cache-1000",
      "ikcous-identidade",
      "supabase-images-cache",
    ]);
    const { deleteDatabase } = instalarIndexedDBFalso();

    const resultado = await executarRecuperacaoChunk({
      dono: true,
      acao: "purge",
    });

    expect(resultado).toBe("purgou");
    expect(registro.unregister).toHaveBeenCalledTimes(1);
    // Só o cache do app de versões antigas morre. Os especiais sobrevivem.
    expect(apagados).toEqual(["app-cache-1773003981700", "app-cache-1000"]);
    // O catálogo offline NUNCA é tocado no caminho de chunk (aceite 4).
    expect(deleteDatabase).not.toHaveBeenCalled();
    // Navegação honesta: replace (não empilha histórico), pathname+search
    // preservados (?source=pwa da base instalada sobrevive), sem param
    // forceUpdate (aceite 6).
    expect(replaceEspiao).toHaveBeenCalledTimes(1);
    expect(replaceEspiao).toHaveBeenCalledWith("/loja?source=pwa");
    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(localStorage.getItem("pwa_reload_reason")).toBe(
      "recuperacao-erro-modulo",
    );
  });

  it("PORTAL CATIVO (200 text/html): NADA é apagado, desregistrado ou navegado", async () => {
    instalarSondaDeRede(false);
    const registro = criarRegistroFalso();
    instalarServiceWorkerFalso([registro]);
    const apagados = instalarCachesFalsos(["app-cache-1", "ikcous-identidade"]);
    const { deleteDatabase } = instalarIndexedDBFalso();

    const resultado = await executarRecuperacaoChunk({
      dono: true,
      acao: "purge",
    });

    expect(resultado).toBe("sem-rede-verificada");
    expect(registro.unregister).not.toHaveBeenCalled();
    expect(apagados).toEqual([]);
    expect(deleteDatabase).not.toHaveBeenCalled();
    expect(replaceEspiao).not.toHaveBeenCalled();
    expect(reloadEspiao).not.toHaveBeenCalled();
  });

  it("decisão de espectador (recusar) e de offline não executam nada", async () => {
    const registro = criarRegistroFalso();
    instalarServiceWorkerFalso([registro]);
    const apagados = instalarCachesFalsos(["app-cache-1"]);

    expect(
      await executarRecuperacaoChunk({ dono: false, acao: "recusar" }),
    ).toBe("recusado");
    expect(
      await executarRecuperacaoChunk({ dono: true, acao: "offline" }),
    ).toBe("recusado");

    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(replaceEspiao).not.toHaveBeenCalled();
    expect(registro.unregister).not.toHaveBeenCalled();
    expect(apagados).toEqual([]);
  });
});

describe("apagarIndexedDBAguardando — o delete do purge OBRIGATÓRIO não pendura (aceite 5)", () => {
  it("onsuccess resolve true", async () => {
    const { pedido } = instalarIndexedDBFalso();

    const promessa = apagarIndexedDBAguardando();
    pedido.onsuccess?.();

    expect(await promessa).toBe(true);
  });

  it("onblocked NÃO vira o novo spinner infinito: resolve pelo prazo", async () => {
    vi.useFakeTimers();
    const { pedido } = instalarIndexedDBFalso();

    const promessa = apagarIndexedDBAguardando();
    pedido.onblocked?.(); // conexão do dataVault segurando o delete
    await vi.advanceTimersByTimeAsync(PRAZO_DELETE_DATABASE_MS + 1);

    expect(await promessa).toBe(false);
  });

  it("onblocked grava laudo em pwa_forensics e segue o fluxo", async () => {
    vi.useFakeTimers();
    const { pedido } = instalarIndexedDBFalso();

    const promessa = apagarIndexedDBAguardando();
    pedido.onblocked?.();
    await vi.advanceTimersByTimeAsync(PRAZO_DELETE_DATABASE_MS + 1);
    await promessa;

    const laudo = JSON.parse(
      localStorage.getItem("pwa_forensics") ?? "[]",
    ) as Array<{ m: string }>;
    expect(
      laudo.some((entrada) => entrada.m === "DATAVAULT_DELETE_BLOQUEADO"),
    ).toBe(true);
  });

  it("onerror resolve false", async () => {
    const { pedido } = instalarIndexedDBFalso();

    const promessa = apagarIndexedDBAguardando();
    pedido.onerror?.();

    expect(await promessa).toBe(false);
  });
});
