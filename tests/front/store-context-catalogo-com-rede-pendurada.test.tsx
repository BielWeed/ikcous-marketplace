// @vitest-environment jsdom
//
// PRIMEIRA visita com a rede PENDURADA (conecta e não responde, sem erro): a
// leitura do catálogo não tinha prazo, então `loadingProducts` ficava `true`
// para sempre -- esqueleto eterno na vitrine, e o "Tentar de novo" ficava
// desligado ("Tentando...") porque `fetchProducts` nunca terminava. Agora cada
// página do catálogo tem prazo: estourou, vira falha (`catalogoErro`), o
// esqueleto sai, as tentativas automáticas agendam e `fetchProducts` termina.
//
// Render de verdade do StoreProvider, mesmo molde de
// store-context-catalogo-com-rede-falhando-avisa.test.tsx.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StoreProvider, useStore } from "@/contexts/StoreContext";

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: false, loading: false, user: null }),
}));

vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));

const rede = vi.hoisted(() => ({
  // Respostas das próximas consultas públicas de produtos, uma por consulta.
  // Fila vazia = a consulta pendura para sempre (rede pendurada).
  fila: [] as (() => unknown)[],
  consultas: 0,
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockImplementation(async () => ({
      getById: vi.fn().mockResolvedValue(null),
      getAll: vi.fn().mockResolvedValue([]),
      put: vi.fn().mockResolvedValue(undefined),
      replaceAll: vi.fn().mockResolvedValue(undefined),
      setLastSync: vi.fn().mockResolvedValue(undefined),
      clear: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

vi.mock("@/lib/realtimeSyncEngine", () => ({
  RealtimeSyncEngine: {
    start: vi.fn(() => () => {}),
    onSync: vi.fn(() => () => {}),
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn(), loading: vi.fn() },
}));

function construtorEncadeavel(resultado: () => unknown): unknown {
  const alvo: any = () => construtorEncadeavel(resultado);
  return new Proxy(alvo, {
    get(_t, prop) {
      if (prop === "then") {
        return (
          resolve: (v: unknown) => void,
          rejeitar: (e: unknown) => void,
        ) => Promise.resolve(resultado()).then(resolve, rejeitar);
      }
      return () => construtorEncadeavel(resultado);
    },
    apply() {
      return construtorEncadeavel(resultado);
    },
  });
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "vw_produtos_public") {
        return construtorEncadeavel(() => {
          rede.consultas += 1;
          const proxima = rede.fila.shift();
          // Fila vazia: a rede pendurou -- nunca responde.
          return proxima ? proxima() : new Promise(() => {});
        });
      }
      return construtorEncadeavel(() => ({ data: [], error: null }));
    },
    rpc: () => construtorEncadeavel(() => ({ data: null, error: null })),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Retrato = {
  products: { id: string }[];
  loadingProducts: boolean;
  catalogoErro: boolean | undefined;
  fetchProducts: () => Promise<void>;
};

// Mais que o prazo de uma página do catálogo (25 s), menos que a primeira
// nova tentativa automática (prazo + 2 s).
const DEPOIS_DO_PRAZO_MS = 26_000;

function produtoDoBanco(id: string) {
  return { id, nome: `Produto ${id}`, preco_venda: 10, estoque: 5 };
}

describe("StoreContext — rede pendurada na leitura do catálogo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let retrato: { atual: Retrato | null };

  function Espiao() {
    const { products, loadingProducts, fetchProducts, ...resto } = useStore();
    const catalogoErro = (resto as { catalogoErro?: boolean }).catalogoErro;
    useEffect(() => {
      retrato.atual = {
        products: products as { id: string }[],
        loadingProducts,
        catalogoErro,
        fetchProducts,
      };
    });
    return null;
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function montar() {
    await act(async () => {
      raiz.render(
        <StoreProvider>
          <Espiao />
        </StoreProvider>,
      );
    });
    await avancar(50);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
    rede.fila = [];
    rede.consultas = 0;
    retrato = { atual: null };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("primeira visita com a rede pendurada: esqueleto no começo, e passado o prazo o aviso de falha aparece e o esqueleto sai", async () => {
    await montar();
    expect(retrato.atual?.loadingProducts).toBe(true);
    expect(retrato.atual?.catalogoErro).toBe(false);

    await avancar(DEPOIS_DO_PRAZO_MS);

    expect(retrato.atual?.loadingProducts).toBe(false);
    expect(retrato.atual?.catalogoErro).toBe(true);
    expect(retrato.atual?.products).toEqual([]);
  });

  it("'Tentar de novo' com a rede pendurada TERMINA depois do prazo (o botão da vitrine volta a ligar)", async () => {
    await montar();
    await avancar(DEPOIS_DO_PRAZO_MS);
    expect(rede.consultas).toBe(1);

    let terminou = false;
    await act(async () => {
      void retrato.atual?.fetchProducts().then(() => {
        terminou = true;
      });
    });
    await avancar(1000);
    expect(terminou).toBe(false);

    await avancar(DEPOIS_DO_PRAZO_MS);
    expect(terminou).toBe(true);
    expect(retrato.atual?.loadingProducts).toBe(false);
    expect(retrato.atual?.catalogoErro).toBe(true);
  });

  it("depois do prazo estourado, a nova tentativa automática pega a rede de volta e a loja aparece", async () => {
    await montar();
    // A 1ª consulta já pendurou; a 2ª (automática, 2 s depois do prazo) responde.
    rede.fila = [
      () => Promise.resolve({ data: [produtoDoBanco("p1")], error: null }),
    ];
    await avancar(DEPOIS_DO_PRAZO_MS + 3000);

    expect(retrato.atual?.products.map((p) => p.id)).toEqual(["p1"]);
    expect(retrato.atual?.catalogoErro).toBe(false);
    expect(retrato.atual?.loadingProducts).toBe(false);
  });

  it("segunda página pendurada: o catálogo NÃO fica pela metade, vira falha depois do prazo", async () => {
    const cheia = Array.from({ length: 200 }, (_, i) =>
      produtoDoBanco(`c${i}`),
    );
    rede.fila = [() => Promise.resolve({ data: cheia, error: null })];
    await montar();
    expect(retrato.atual?.loadingProducts).toBe(true);

    await avancar(DEPOIS_DO_PRAZO_MS);

    expect(rede.consultas).toBe(2);
    expect(retrato.atual?.loadingProducts).toBe(false);
    expect(retrato.atual?.catalogoErro).toBe(true);
    expect(retrato.atual?.products).toEqual([]);
  });

  it("rede lenta que responde dentro do prazo: a loja aparece sem aviso de falha", async () => {
    rede.fila = [
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve({ data: [produtoDoBanco("p1")], error: null }),
            8000,
          );
        }),
    ];
    await montar();
    expect(retrato.atual?.loadingProducts).toBe(true);

    await avancar(8500);

    expect(retrato.atual?.products.map((p) => p.id)).toEqual(["p1"]);
    expect(retrato.atual?.catalogoErro).toBe(false);
    expect(retrato.atual?.loadingProducts).toBe(false);
  });
});
