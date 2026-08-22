// @vitest-environment jsdom
//
// O erro CRU do banco/rede não pode chegar à tela do painel.
//
// O DEFEITO: os quatro catch de useAnalytics exibiam `err.message || fallback`
// — o `||` só mostrava a frase em português QUANDO NÃO HAVIA mensagem nenhuma.
// Como o banco quase sempre manda texto, a lojista lia coisas como
// "permission denied for table analytics_summary" ou "JWT expired" no lugar
// do resumo executivo e da análise por categoria, sem saber se o problema era
// a conexão, a sessão dela ou a loja.
//
// COMO A CORREÇÃO DECIDE A FRASE (mensagemParaLojista, em useAnalytics.ts):
// cada ramo só nomeia uma causa quando dá para DISTINGUIR essa causa de todas
// as outras que caem no mesmo ponto. JWT/PGRST301 → sessão (entrar de novo é
// a ação certa: o refresh automático de callRpcWithRetry já tentou e falhou);
// 42501/"permission denied"/RLS → permissão (pedir para confirmar a conta de
// admin é verdadeiro até quando a causa é configuração de servidor, que
// nenhum login resolve); textos canônicos de fetch falhado → rede. Todo o
// resto (função RPC removida, 5xx, timeout, erro sem mensagem) fica na
// genérica honesta, que dita "atualize a página". O texto original SEMPRE
// segue vivo no console.error — provado em cada teste de falha abaixo.
//
// POR QUE PELO HOOK DE VERDADE (render React + jsdom) e não por função
// isolada: quem exibia o texto cru eram os fechamentos dentro de
// useAnalytics(); é ELE que é exercitado aqui, com o cliente Supabase dublê
// logo abaixo — mesmo precedente de use-analytics-category-error.test.tsx e
// use-reviews-erro-do-banco-nao-vaza-na-tela.test.tsx. Com qualquer uma das
// linhas antigas de volta, estes testes CAEM.

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

import { type ReactElement, act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAnalyticsCache, useAnalytics } from "@/hooks/useAnalytics";

type FetchResumo = (forceRefresh?: boolean) => Promise<unknown>;
type FetchCategoria = (
  start: string,
  end: string,
  forceRefresh?: boolean,
) => Promise<unknown>;

function SondaResumo({
  aoCapturar,
}: {
  readonly aoCapturar: (fn: FetchResumo) => void;
}) {
  const { error, fetchExecutiveSummary, stats } = useAnalytics();
  useEffect(() => {
    aoCapturar(fetchExecutiveSummary);
  }, [fetchExecutiveSummary, aoCapturar]);
  return (
    <div>
      <div data-testid="error">{error ?? "sem-erro"}</div>
      <pre data-testid="stats">{stats ? JSON.stringify(stats) : ""}</pre>
    </div>
  );
}

function SondaCategoria({
  aoCapturar,
}: {
  readonly aoCapturar: (fn: FetchCategoria) => void;
}) {
  const { categoryError, fetchCategoryAnalytics } = useAnalytics();
  useEffect(() => {
    aoCapturar(fetchCategoryAnalytics);
  }, [fetchCategoryAnalytics, aoCapturar]);
  return <div data-testid="category-error">{categoryError ?? "sem-erro"}</div>;
}

describe("useAnalytics — o erro cru do banco não vaza para a tela do painel", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Estrutura mínima do espião, sem depender dos genéricos internos do vitest.
  let consolaErro: {
    mock: { calls: Array<unknown[]> };
    mockRestore: () => void;
  };

  beforeEach(() => {
    // O cache de módulo (cachedStats/cachedCategoryData e seus relógios)
    // sobrevive entre testes: limpar é o que garante que todo it comece
    // pelo caminho de carga direta.
    clearAnalyticsCache();
    // O console.error com o erro completo é o diagnóstico que TEM de
    // sobreviver; o espião o captura sem sujar a saída do teste.
    consolaErro = vi
      .spyOn(console, "error")
      .mockImplementation(() => {}) as typeof consolaErro;
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
    consolaErro.mockRestore();
    vi.restoreAllMocks();
  });

  /** O que está escrito na sonda (o que a pessoa leria na tela). */
  const textoNaTela = (id: string): string =>
    hospedeiro.querySelector(`[data-testid="${id}"]`)?.textContent ?? "";

  /** Tudo que passou pelo console.error durante o teste, serializado.
   *
   * As contrabarras do escape de JSON saem fora: só elas diferenciariam
   * `table \"analytics_summary\"` (serializado) de
   * `table "analytics_summary"` (o texto real do banco), e a prova aqui é do
   * TEXTO, não da pontuação.
   */
  const textoDoConsole = (): string =>
    consolaErro.mock.calls
      .map((chamada) =>
        chamada
          .map((parte) => {
            if (typeof parte === "string") return parte;
            if (parte instanceof Error)
              return `${parte.name}: ${parte.message}`;
            try {
              return JSON.stringify(parte);
            } catch {
              return String(parte);
            }
          })
          .join(" "),
      )
      .join("\n")
      .replaceAll("\\", "");

  const montar = async (sonda: ReactElement): Promise<void> => {
    await act(async () => {
      raiz.render(sonda);
    });
  };

  it("resumo executivo: recusa do banco com nome de tabela não chega à lojista — frase de permissão na tela, texto cru só no console", async () => {
    const MENSAGEM_CRUA = "permission denied for table analytics_summary";
    mockRpc.mockResolvedValue({
      data: null,
      error: { message: MENSAGEM_CRUA, status: 403 },
    });

    let fetchFn!: FetchResumo;
    await montar(
      <SondaResumo
        aoCapturar={(fn) => {
          fetchFn = fn;
        }}
      />,
    );

    let retorno: unknown;
    await act(async () => {
      retorno = await fetchFn(true);
    });

    expect(retorno).toBeNull();
    // O QUE A PESSOA LÊ: causa nomeada com ação que é verdadeira tanto quando
    // a sessão veio errada quanto quando o problema é configuração de acesso
    // no servidor (que nenhum login resolve).
    expect(textoNaTela("error")).toBe(
      "Sem permissão para acessar estes dados agora. Confirme que você entrou com a conta de administradora da loja.",
    );
    for (const fragmentoProibido of [
      "analytics_summary",
      "permission denied",
      "table",
      "error fetching",
    ]) {
      expect(textoNaTela("error").toLowerCase()).not.toContain(
        fragmentoProibido.toLowerCase(),
      );
    }

    // A PROVA DUPLA PEDIDA: o texto cru chegou INTEIRO ao console.error…
    expect(textoDoConsole()).toContain(MENSAGEM_CRUA);
    // …ENQUANTO não apareceu na mensagem exibida.
    expect(textoNaTela("error")).not.toContain(MENSAGEM_CRUA);
  });

  it("resumo executivo: caminho de sucesso intacto — dado devolvido, exposto no estado e sem erro", async () => {
    const dadoOk = { executive: { totalRevenue: 123, totalOrders: 7 } };
    mockRpc.mockResolvedValue({ data: dadoOk, error: null });

    let fetchFn!: FetchResumo;
    await montar(
      <SondaResumo
        aoCapturar={(fn) => {
          fetchFn = fn;
        }}
      />,
    );

    let retorno: unknown;
    await act(async () => {
      retorno = await fetchFn(true);
    });

    expect(retorno).toEqual(dadoOk);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(textoNaTela("error")).toBe("sem-erro");
    expect(textoNaTela("stats")).toContain('"totalRevenue":123');
  });

  it("resumo executivo: sessão expirada é nomeada e manda entrar de novo, sem citar token", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST301", message: "JWT expired", status: 401 },
    });

    let fetchFn!: FetchResumo;
    await montar(
      <SondaResumo
        aoCapturar={(fn) => {
          fetchFn = fn;
        }}
      />,
    );

    await act(async () => {
      await fetchFn(true);
    });

    expect(textoNaTela("error")).toBe(
      "Sua sessão expirou. Entre novamente com sua conta e tente de novo.",
    );
    const tela = textoNaTela("error").toLowerCase();
    expect(tela).not.toContain("jwt");
    expect(tela).not.toContain("token");
    // Diagnóstico preservado no console.
    expect(textoDoConsole()).toContain("JWT expired");
  });

  // callRpcWithRetry tenta de novo 3 vezes com esperas reais (~3,5 s), fiel
  // ao comportamento de produção — por isso este teste tem teto próprio.
  it(
    "resumo executivo: rede caída aponta para a internet, sem jargão de fetch",
    { timeout: 20000 },
    async () => {
      // Erro de rede real: o cliente Supabase NÃO lança sozinho, mas a
      // requisição debaixo dele rejeita com TypeError quando não há conexão.
      mockRpc.mockRejectedValue(new TypeError("Failed to fetch"));

      let fetchFn!: FetchResumo;
      await montar(
        <SondaResumo
          aoCapturar={(fn) => {
            fetchFn = fn;
          }}
        />,
      );

      await act(async () => {
        await fetchFn(true);
      });

      expect(textoNaTela("error")).toBe(
        "Sem conexão com o servidor. Verifique sua internet e tente de novo.",
      );
      const tela = textoNaTela("error").toLowerCase();
      expect(tela).not.toContain("fetch");
      expect(tela).not.toContain("network");

      // O texto original do TypeError sobreviveu no console.error…
      expect(textoDoConsole()).toContain("Failed to fetch");
      // …enquanto ficou fora da tela.
      expect(textoNaTela("error")).not.toContain("Failed to fetch");
    },
  );

  it("categorias: recusa desconhecida do banco vira frase genérica honesta — coluna e relação ficam fora da tela", async () => {
    const MENSAGEM_CRUA =
      'null value in column "name" of relation "categories" violates not-null constraint';
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "23502", message: MENSAGEM_CRUA, status: 400 },
    });

    let fetchFn!: FetchCategoria;
    await montar(
      <SondaCategoria
        aoCapturar={(fn) => {
          fetchFn = fn;
        }}
      />,
    );

    await act(async () => {
      await fetchFn(
        "2020-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        true,
      );
    });

    // Sem pista confiável de causa (este erro não é sessão, permissão nem
    // rede), a frase tem de ser verdadeira para TODAS as causas possíveis —
    // genérica, ditando a ação que costuma resolver.
    expect(textoNaTela("category-error")).toBe(
      "Não foi possível carregar os dados de categorias agora. Tente atualizar a página; se continuar, tente mais tarde.",
    );
    for (const fragmentoProibido of [
      "null value",
      "column",
      "relation",
      "violates",
      "categories",
    ]) {
      expect(textoNaTela("category-error")).not.toContain(fragmentoProibido);
    }

    expect(textoDoConsole()).toContain(MENSAGEM_CRUA);
    expect(textoNaTela("category-error")).not.toContain(MENSAGEM_CRUA);
  });

  it("categorias: a revalidação em segundo plano também traduz o erro cru", async () => {
    const MENSAGEM_CRUA = 'relation "category_rollup_diaria" does not exist';
    mockRpc
      .mockResolvedValueOnce({
        data: [{ name: "Roupas", value: 100 }],
        error: null,
      })
      .mockResolvedValueOnce({
        data: null,
        error: { message: MENSAGEM_CRUA, status: 404 },
      });

    let fetchFn!: FetchCategoria;
    await montar(
      <SondaCategoria
        aoCapturar={(fn) => {
          fetchFn = fn;
        }}
      />,
    );

    // Primeiro fetch: sucesso, popula o cache em memória do módulo.
    await act(async () => {
      await fetchFn(
        "2020-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        true,
      );
    });
    expect(textoNaTela("category-error")).toBe("sem-erro");

    // Empurra o relógio para além do throttle de 30s (REVALIDATION_THROTTLE_MS)
    // sem fake timers — status 404 não satisfaz a condição de retry em
    // callRpcWithRetry, então não há setTimeout real pendente para avançar.
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockImplementation(() => realNow + 40_000);

    // Segundo fetch: forceRefresh=false, com cache presente e throttle vencido
    // -> cai no ramo de revalidação em segundo plano (fire-and-forget).
    await act(async () => {
      await fetchFn(
        "2020-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        false,
      );
      // Dá tempo real para a IIFE de revalidação drenar suas microtasks.
      await new Promise((resolve) => setTimeout(resolve, 20));
    });

    // O verbo "atualizar" prova que a frase saiu do ramo do segundo plano —
    // é o único dos quatro pontos que o usa.
    expect(textoNaTela("category-error")).toBe(
      "Não foi possível atualizar os dados de categorias agora. Tente atualizar a página; se continuar, tente mais tarde.",
    );
    expect(textoNaTela("category-error")).not.toContain(
      "category_rollup_diaria",
    );
    expect(textoNaTela("category-error")).not.toContain("relation");
    expect(textoDoConsole()).toContain(MENSAGEM_CRUA);
  });

  it("categorias: caminho de sucesso intacto — dado devolvido e erro limpo", async () => {
    const dadoOk = [{ name: "Roupas", value: 100 }];
    mockRpc.mockResolvedValue({ data: dadoOk, error: null });

    let fetchFn!: FetchCategoria;
    await montar(
      <SondaCategoria
        aoCapturar={(fn) => {
          fetchFn = fn;
        }}
      />,
    );

    let retorno: unknown;
    await act(async () => {
      retorno = await fetchFn(
        "2020-01-01T00:00:00.000Z",
        "2026-01-01T00:00:00.000Z",
        true,
      );
    });

    expect(retorno).toEqual(dadoOk);
    expect(textoNaTela("category-error")).toBe("sem-erro");
  });
});
