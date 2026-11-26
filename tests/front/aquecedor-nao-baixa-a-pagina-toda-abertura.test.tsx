// @vitest-environment jsdom
//
// Plano "primeira visita leve" (T12, 26/11/2026): cada pedido ao endereço da
// loja conta na cota mensal da Vercel (plano grátis: estourar pausa o projeto
// e derruba todas as lojas). Medido na IKCOUS no ar: na SEGUNDA visita o app
// ainda pedia `/` à rede porque `useCacheWarmer` buscava cada rota crítica
// com `cache: "reload"` a CADA abertura, mesmo com a cópia já guardada em
// "warmed-routes".
//
// Duas provas:
// 1. "warmed-routes" já tem as rotas críticas -> abrir o app não faz NENHUM
//    fetch à rede para elas (o aviso WARM_CACHE ao SW continua saindo).
// 2. "warmed-routes" vazio (primeira visita, ou versão nova — o `activate`
//    do SW apaga essa gaveta) -> busca uma vez só e guarda.
//
// Andaime: o mesmo de aquecimento-so-guarda-o-que-tem-consumidor.test.tsx
// (Sonda via useEffect, createRoot + act, requestIdleCallback imediato).
import { act, createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useCacheWarmer } from "@/hooks/useCacheWarmer";

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getAll: () => Promise.resolve([]),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos testes vizinhos deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Node 25 pisa em `localStorage` global antes do jsdom (mesmo contorno do
// teste vizinho do aquecimento). O hook grava o log de forense no FIM do
// aquecimento — é o sinal de que ele terminou.
function storageSimples(): Storage {
  const mapa = new Map<string, string>();
  return {
    getItem: (chave: string) =>
      mapa.has(chave) ? (mapa.get(chave) as string) : null,
    setItem: (chave: string, valor: string) => {
      mapa.set(chave, String(valor));
    },
    removeItem: (chave: string) => {
      mapa.delete(chave);
    },
    clear: () => {
      mapa.clear();
    },
    key: (index: number) => Array.from(mapa.keys()).at(index) ?? null,
    get length() {
      return mapa.size;
    },
  } as Storage;
}

/** Gaveta "warmed-routes" de mentira: guarda por chave, como o Cache Storage. */
function gavetaFalsa(inicial: string[]) {
  const guardadas = new Map<string, Response>(
    inicial.map((url) => [url, new Response("<html></html>")]),
  );
  return {
    guardadas,
    match: vi.fn((url: string) => Promise.resolve(guardadas.get(url))),
    put: vi.fn((url: string, res: Response) => {
      guardadas.set(url, res);
      return Promise.resolve();
    }),
  };
}

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 10 } = {},
) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(
        `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
      );
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    });
  }
}

describe("useCacheWarmer — não baixa a página toda abertura (T12)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let postMessage: ReturnType<typeof vi.fn>;
  let fetchDeRede: ReturnType<typeof vi.fn>;

  function prepararGaveta(inicial: string[]) {
    const gaveta = gavetaFalsa(inicial);
    vi.stubGlobal("caches", {
      open: vi.fn((nome: string) =>
        nome === "warmed-routes"
          ? Promise.resolve(gaveta)
          : Promise.reject(new Error(`gaveta inesperada: ${nome}`)),
      ),
    } as unknown as CacheStorage);
    return gaveta;
  }

  beforeEach(() => {
    postMessage = vi.fn();
    Object.defineProperty(globalThis.navigator, "serviceWorker", {
      value: {
        getRegistration: vi.fn().mockResolvedValue({ active: { postMessage } }),
      },
      configurable: true,
    });
    fetchDeRede = vi
      .fn()
      .mockImplementation(() =>
        Promise.resolve(new Response("<html>nova</html>", { status: 200 })),
      );
    vi.stubGlobal("fetch", fetchDeRede);
    vi.stubGlobal("requestIdleCallback", (cb: IdleRequestCallback) => {
      cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline);
      return 1;
    });
    vi.stubGlobal("cancelIdleCallback", vi.fn());
    vi.stubGlobal("localStorage", storageSimples());

    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(globalThis.navigator, "serviceWorker");
  });

  async function abrirOAppEEsperarOAquecimento() {
    function Sonda() {
      useCacheWarmer();
      return null;
    }
    await act(async () => {
      raiz.render(createElement(Sonda));
    });
    await esperarAte(() => localStorage.getItem("pwa_forensics") !== null);
  }

  it("com '/' já guardada em warmed-routes, não pede nada à rede", async () => {
    const gaveta = prepararGaveta(["/"]);

    await abrirOAppEEsperarOAquecimento();

    // O SW continua avisado (ele confere a própria gaveta antes de buscar).
    expect(postMessage).toHaveBeenCalledWith({
      type: "WARM_CACHE",
      urls: ["/"],
    });
    expect(fetchDeRede).not.toHaveBeenCalled();
    expect(gaveta.put).not.toHaveBeenCalled();
  });

  it("com warmed-routes vazia, busca '/' uma vez só e guarda", async () => {
    const gaveta = prepararGaveta([]);

    await abrirOAppEEsperarOAquecimento();

    expect(fetchDeRede).toHaveBeenCalledTimes(1);
    expect(fetchDeRede.mock.calls[0][0]).toBe(
      new URL("/", window.location.origin).toString(),
    );
    expect(gaveta.put).toHaveBeenCalledTimes(1);
    expect(gaveta.put.mock.calls[0][0]).toBe("/");
    expect(gaveta.guardadas.has("/")).toBe(true);
  });
});
