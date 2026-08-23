// @vitest-environment jsdom
//
// Trilha 4 (#104): hoje `fetchCategoryAnalytics` só loga a falha da RPC no
// console e devolve `null` — o hook não expõe nenhum estado de erro, então
// quem chama (StrategicIntelligenceBlocks) não tem como distinguir "consulta
// quebrou" de "consulta OK, zero linhas". Estes três testes provam que o
// hook passa a expor `categoryError`:
//
//   1. falha da RPC direta (sem cache) seta `categoryError` com uma frase
//      legível para a lojista (a tradução do erro cru é tarefa de
//      use-analytics-erro-cru-do-banco-nao-vaza-no-painel.test.tsx);
//   2. um novo fetch com sucesso limpa o `categoryError` anterior;
//   3. a revalidação em segundo plano (que hoje SILENCIA o erro — só
//      confere `if (data)` e nunca olha o `error` de retorno) também expõe
//      a falha, em vez de descartá-la.
//
// `@/lib/supabase` e `@/hooks/useAuth` são mocados porque useAnalytics.ts os
// importa no topo; sem isso, o teste dispara a leitura de
// VITE_SUPABASE_URL/ANON_KEY (ver tests/front/admin-orders-payment-filter.test.tsx,
// mesmo motivo). `@/lib/dataVault` é mocado para não bater em IndexedDB, que
// o jsdom deste projeto não implementa de verdade.
import { act } from "react";
import { useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockRpc = vi.fn();
const mockGetSession = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      refreshSession: vi.fn().mockResolvedValue({ data: { session: null } }),
    },
  },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true }),
}));

vi.mock("@/lib/dataVault", () => ({
  DataVault: {
    init: vi.fn().mockResolvedValue({
      getById: vi.fn().mockResolvedValue(null),
      put: vi.fn().mockResolvedValue(undefined),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// de tests/front/admin-orders-payment-filter.test.tsx.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function textoDoErro(hospedeiro: HTMLDivElement): string | null {
  return hospedeiro.querySelector('[data-testid="error"]')?.textContent ?? null;
}

describe("useAnalytics — categoryError (#104)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    mockRpc.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token-de-teste" } },
    });
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("expõe categoryError quando a RPC de categoria falha (fetch direto, sem cache)", async () => {
    const { useAnalytics, clearAnalyticsCache } = await import(
      "@/hooks/useAnalytics"
    );
    clearAnalyticsCache();
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: "RPC de categoria quebrada", status: 403 },
    });

    function Harness({
      onReady,
    }: {
      readonly onReady: (
        fn: (a: string, b: string, c: boolean) => Promise<unknown>,
      ) => void;
    }) {
      const { categoryError, fetchCategoryAnalytics } = useAnalytics();
      useEffect(() => {
        onReady(fetchCategoryAnalytics);
      }, [fetchCategoryAnalytics, onReady]);
      return <div data-testid="error">{categoryError ?? "sem-erro"}</div>;
    }

    let fetchFn!: (a: string, b: string, c: boolean) => Promise<unknown>;
    await act(async () => {
      raiz.render(
        <Harness
          onReady={(fn) => {
            fetchFn = fn;
          }}
        />,
      );
    });

    await act(async () => {
      await fetchFn(
        "2020-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        true,
      );
    });

    // O erro deste mock não tem pista de causa (não é sessão, permissão nem
    // rede), então a frase exibida é a genérica honesta da tradução.
    expect(textoDoErro(hospedeiro)).toBe(
      "Não foi possível carregar os dados de categorias agora. Tente atualizar a página; se continuar, tente mais tarde.",
    );
  });

  it("um fetch com sucesso limpa o categoryError de uma falha anterior", async () => {
    const { useAnalytics, clearAnalyticsCache } = await import(
      "@/hooks/useAnalytics"
    );
    clearAnalyticsCache();
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: "RPC de categoria quebrada", status: 403 },
      })
      .mockResolvedValueOnce({
        data: [{ name: "Roupas", value: 100 }],
        error: null,
      });

    function Harness({
      onReady,
    }: {
      readonly onReady: (
        fn: (a: string, b: string, c: boolean) => Promise<unknown>,
      ) => void;
    }) {
      const { categoryError, fetchCategoryAnalytics } = useAnalytics();
      useEffect(() => {
        onReady(fetchCategoryAnalytics);
      }, [fetchCategoryAnalytics, onReady]);
      return <div data-testid="error">{categoryError ?? "sem-erro"}</div>;
    }

    let fetchFn!: (a: string, b: string, c: boolean) => Promise<unknown>;
    await act(async () => {
      raiz.render(
        <Harness
          onReady={(fn) => {
            fetchFn = fn;
          }}
        />,
      );
    });

    await act(async () => {
      await fetchFn(
        "2020-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        true,
      );
    });
    expect(textoDoErro(hospedeiro)).toBe(
      "Não foi possível carregar os dados de categorias agora. Tente atualizar a página; se continuar, tente mais tarde.",
    );

    await act(async () => {
      await fetchFn(
        "2020-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        true,
      );
    });
    expect(textoDoErro(hospedeiro)).toBe("sem-erro");
  });

  it("a revalidação em segundo plano também expõe a falha, em vez de descartá-la", async () => {
    const { useAnalytics, clearAnalyticsCache } = await import(
      "@/hooks/useAnalytics"
    );
    clearAnalyticsCache();
    mockRpc
      .mockResolvedValueOnce({
        data: [{ name: "Roupas", value: 100 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: {
          message: "RPC de categoria quebrada em segundo plano",
          status: 403,
        },
      });

    function Harness({
      onReady,
    }: {
      readonly onReady: (
        fn: (a: string, b: string, c: boolean) => Promise<unknown>,
      ) => void;
    }) {
      const { categoryError, fetchCategoryAnalytics } = useAnalytics();
      useEffect(() => {
        onReady(fetchCategoryAnalytics);
      }, [fetchCategoryAnalytics, onReady]);
      return <div data-testid="error">{categoryError ?? "sem-erro"}</div>;
    }

    let fetchFn!: (a: string, b: string, c: boolean) => Promise<unknown>;
    await act(async () => {
      raiz.render(
        <Harness
          onReady={(fn) => {
            fetchFn = fn;
          }}
        />,
      );
    });

    // Primeiro fetch: sucesso, popula o cache em memória do módulo.
    await act(async () => {
      await fetchFn(
        "2020-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        true,
      );
    });
    expect(textoDoErro(hospedeiro)).toBe("sem-erro");

    // Empurra o relógio para além do throttle de 30s (REVALIDATION_THROTTLE_MS)
    // sem usar fake timers — o segundo RPC não tem retry (status 403 não
    // satisfaz a condição de retry em callRpcWithRetry), então não há
    // setTimeout real pendente para avançar.
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => realNow + 40_000);

    // Segundo fetch: forceRefresh=false, com cache presente e throttle
    // vencido -> cai no ramo de revalidação em segundo plano (fire-and-forget).
    await act(async () => {
      await fetchFn(
        "2020-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        false,
      );
      // Dá tempo real para a IIFE de revalidação em segundo plano (que não é
      // aguardada pelo chamador) drenar suas microtasks.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    expect(textoDoErro(hospedeiro)).toBe(
      "Não foi possível atualizar os dados de categorias agora. Tente atualizar a página; se continuar, tente mais tarde.",
    );
  });
});
