// @vitest-environment jsdom
//
// O boundary na INTEGRAÇÃO com o módulo único (issue #92): ele é a porta de
// UI e o primeiro capturador — a decisão mora em
// @/lib/recuperacao-chunk (testada em arquivo próprio). Aqui se prova o que
// os aceites pedem do CONJUNTO:
//
//   a) 1º chunk error com internet e sem SW → degrau 1: reload seco
//      automático UMA vez, chave de recuperação count=1;
//   b) 2º erro na mesma janela → espectador: nenhum reload automático, e a
//      tela ganha botão depois do prazo — nunca spinner infinito (aceite 2);
//   c) purge nomeado com portal cativo (200 text/html) → NADA apagado ou
//      desregistrado, e a tela vira a honesta de offline (aceites 3 e 7);
//   d) purge nomeado com rede verificada → desregistra SW, apaga SÓ
//      app-cache-*, preserva ikcous-identidade, supabase-images-cache e
//      TODO IndexedDB, navega com location.replace preservando
//      pathname+search, sem forceUpdate (aceites 1, 3, 4, 5 e 6).
//
// Mesmo contorno dos testes irmãos: storages substituíveis e window.location
// trocado por cópia com reload/replace espiáveis.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GlobalErrorBoundary } from "@/components/ui/custom/GlobalErrorBoundary";

// Mesmo literal da VERSÃO de fallback de @/lib/recuperacao-chunk,
// duplicado de propósito.
const VERSAO_FALLBACK_DO_APP = "0.0.0-dev";
// Mesmo literal de PRAZO_SAIDA_CHUNK_MS no boundary, duplicado de propósito.
const PRAZO_SAIDA_CHUNK_MS = 4000;

const CHAVE_RECUPERACAO_CHUNK = "pwa_chunk_recovery";

function BombaChunk(): never {
  throw new Error(
    "Failed to fetch dynamically imported module: http://x/assets/Admin-abc.js",
  );
}

function criarStorage(): Storage {
  const armazem = new Map<string, string>();
  const store = {} as Record<string, unknown>;

  function metodo(nome: string, fn: (...args: never[]) => unknown) {
    Object.defineProperty(store, nome, {
      value: fn,
      enumerable: false,
      configurable: true,
      writable: true,
    });
  }

  metodo("getItem", ((chave: string) =>
    armazem.has(chave) ? armazem.get(chave)! : null) as never);
  metodo("setItem", ((chave: string, valor: string) => {
    armazem.set(chave, String(valor));
    Object.defineProperty(store, chave, {
      value: String(valor),
      enumerable: true,
      configurable: true,
      writable: true,
    });
  }) as never);
  metodo("removeItem", ((chave: string) => {
    armazem.delete(chave);
    Reflect.deleteProperty(store, chave);
  }) as never);
  metodo("clear", (() => {
    for (const chave of armazem.keys()) Reflect.deleteProperty(store, chave);
    armazem.clear();
  }) as never);
  Object.defineProperty(store, "length", {
    get: () => armazem.size,
    enumerable: false,
    configurable: true,
  });

  return store as unknown as Storage;
}

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

function instalarCachesFalsos(nomes: string[]) {
  const apagados: string[] = [];
  vi.stubGlobal("caches", {
    keys: vi.fn(async () => [...nomes]),
    delete: vi.fn(async (nome: string) => {
      apagados.push(nome);
      return true;
    }),
  });
  return apagados;
}

function instalarIndexedDBFalso() {
  const deleteDatabase = vi.fn(() => ({
    onsuccess: null,
    onerror: null,
    onblocked: null,
  }));
  vi.stubGlobal("indexedDB", { deleteDatabase });
  return deleteDatabase;
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
            new Response("<html>portal cativo</html>", {
              status: 200,
              headers: { "content-type": "text/html" },
            }),
        ),
  );
}

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;
let onLineOriginal: boolean;

const reloadEspiao = vi.fn();
const replaceEspiao = vi.fn();

beforeEach(() => {
  vi.stubGlobal("localStorage", criarStorage());
  vi.stubGlobal("sessionStorage", criarStorage());
  reloadEspiao.mockClear();
  replaceEspiao.mockClear();
  onLineOriginal = navigator.onLine;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: {
      ...window.location,
      pathname: "/loja",
      search: "?source=pwa",
      reload: reloadEspiao,
      replace: replaceEspiao,
    },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => {
    raiz.unmount();
  });
  hospedeiro.remove();
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => onLineOriginal,
  });
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function definirOnLine(valor: boolean) {
  Object.defineProperty(navigator, "onLine", {
    configurable: true,
    get: () => valor,
  });
}

function botaoPorTexto(texto: string): HTMLButtonElement | undefined {
  return [...hospedeiro.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

async function descarregarMicrotarefas() {
  await act(async () => {
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

function montarBomba() {
  return act(async () => {
    raiz.render(
      <GlobalErrorBoundary>
        <BombaChunk />
      </GlobalErrorBoundary>,
    );
  });
}

describe("GlobalErrorBoundary — a escada do mecanismo único, ponta a ponta", () => {
  it("a) 1º chunk error com internet e sem SW: reload seco automático 1x e chave count=1", async () => {
    definirOnLine(true);
    await montarBomba();
    await descarregarMicrotarefas();

    expect(reloadEspiao).toHaveBeenCalledTimes(1);
    expect(replaceEspiao).not.toHaveBeenCalled();
    const estado = JSON.parse(
      localStorage.getItem(CHAVE_RECUPERACAO_CHUNK) ?? "null",
    ) as { count: number } | null;
    expect(estado?.count).toBe(1);
  });

  it("b) segundo erro na MESMA janela é espectador: nenhum reload automático, botão depois do prazo", async () => {
    vi.useFakeTimers();
    definirOnLine(true);
    localStorage.setItem(
      CHAVE_RECUPERACAO_CHUNK,
      JSON.stringify({
        versao: VERSAO_FALLBACK_DO_APP,
        count: 1,
        lastAt: Date.now(),
      }),
    );

    await montarBomba();
    await descarregarMicrotarefas();

    expect(reloadEspiao).not.toHaveBeenCalled();
    expect(botaoPorTexto("Recarregar a página")).toBeUndefined();

    act(() => {
      vi.advanceTimersByTime(PRAZO_SAIDA_CHUNK_MS);
    });

    // Spinner infinito não: a espera vira escolha (aceite 2).
    expect(botaoPorTexto("Recarregar a página")).toBeDefined();
    expect(reloadEspiao).not.toHaveBeenCalled();
  });

  it("c) purge nomeado com PORTAL CATIVO: nada é apagado e a tela vira a honesta de offline", async () => {
    definirOnLine(true);
    instalarSondaDeRede(false);
    const registro: RegistroFalso = {
      waiting: null,
      unregister: vi.fn(async () => true),
    };
    instalarServiceWorkerFalso([registro]);
    const apagados = instalarCachesFalsos(["app-cache-1", "ikcous-identidade"]);
    instalarIndexedDBFalso();
    localStorage.setItem(
      CHAVE_RECUPERACAO_CHUNK,
      JSON.stringify({
        versao: VERSAO_FALLBACK_DO_APP,
        count: 1,
        lastAt: Date.now() - 20000,
      }),
    );

    await montarBomba();
    await descarregarMicrotarefas();

    // Nada foi destruído (aceite 3: purge só com rede verificada).
    expect(registro.unregister).not.toHaveBeenCalled();
    expect(apagados).toEqual([]);
    expect(replaceEspiao).not.toHaveBeenCalled();
    expect(reloadEspiao).not.toHaveBeenCalled();
    // E a UI conta a verdade em vez da mentira "Instalando uma nova versão".
    expect(hospedeiro.textContent).toContain("Você está sem internet");
    expect(hospedeiro.textContent).not.toContain("Atualizando o Aplicativo");
    expect(botaoPorTexto("Tentar novamente")).toBeDefined();
  });

  it("d) purge nomeado com rede verificada: só app-cache-* morre; IndexedDB, identidade e imagens sobrevivem; replace preserva o endereço", async () => {
    definirOnLine(true);
    instalarSondaDeRede(true);
    const registro: RegistroFalso = {
      waiting: null,
      unregister: vi.fn(async () => true),
    };
    instalarServiceWorkerFalso([registro]);
    const apagados = instalarCachesFalsos([
      "app-cache-1773003981700",
      "ikcous-identidade",
      "supabase-images-cache",
    ]);
    const deleteDatabase = instalarIndexedDBFalso();
    localStorage.setItem(
      CHAVE_RECUPERACAO_CHUNK,
      JSON.stringify({
        versao: VERSAO_FALLBACK_DO_APP,
        count: 1,
        lastAt: Date.now() - 20000,
      }),
    );

    await montarBomba();
    await descarregarMicrotarefas();

    expect(registro.unregister).toHaveBeenCalledTimes(1);
    expect(apagados).toEqual(["app-cache-1773003981700"]);
    // O catálogo offline nunca é tocado no caminho de chunk (aceites 4 e 7).
    expect(deleteDatabase).not.toHaveBeenCalled();
    // Aceite 6: replace (sem empilhar histórico), ?source=pwa preservado,
    // sem ?forceUpdate (nenhum consumidor).
    expect(replaceEspiao).toHaveBeenCalledTimes(1);
    expect(replaceEspiao).toHaveBeenCalledWith("/loja?source=pwa");
    expect(reloadEspiao).not.toHaveBeenCalled();
  });
});
