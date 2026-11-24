// @vitest-environment jsdom
//
// O resumo do painel (`get_admin_analytics_v2`) sai por `callRpcWithRetry`, e
// nenhum teste segurava o que ele promete (achado por mutação em 24/11/2026):
//  - erro de SERVIDOR (500), tempo esgotado (408) e erro sem status (a rede
//    caiu) são tentados de novo, com espera de 0,5 s, depois 1 s, depois 2 s
//    (no máximo 4 tentativas, 3,5 s de espera no total);
//  - erro do PEDIDO (400) não é repetido: repetir não muda a resposta;
//  - sessão vencida (401) renova a sessão e repete UMA vez, na hora;
//  - o erro que traz SÓ o código (PGRST301 = sessão, 42501 = permissão) ou SÓ o
//    texto de segurança por linha (RLS) vira a frase certa na tela, não a genérica;
//  - o resumo guardado vale por 30 s: dentro do prazo (inclusive no segundo
//    exato) serve o que tem sem ir ao banco; depois dele relê em segundo plano.
const mockRpc = vi.fn();
const mockGetSession = vi.fn();
const mockRefreshSession = vi.fn();

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => mockRpc(...args),
    auth: {
      getSession: (...args: unknown[]) => mockGetSession(...args),
      refreshSession: (...args: unknown[]) => mockRefreshSession(...args),
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { clearAnalyticsCache, useAnalytics } from "@/hooks/useAnalytics";

type FetchResumo = (forceRefresh?: boolean) => Promise<unknown>;

function Sonda({
  aoCapturar,
}: Readonly<{ aoCapturar: (fn: FetchResumo) => void }>) {
  const { fetchExecutiveSummary, error } = useAnalytics();
  useEffect(() => {
    aoCapturar(fetchExecutiveSummary);
  }, [fetchExecutiveSummary, aoCapturar]);
  return <p data-testid="erro">{error ?? ""}</p>;
}

const DADOS = { marcador: "resumo-ok" };
const erro500 = { data: null, error: { status: 500, message: "boom" } };
const sucesso = { data: DADOS, error: null };

describe("useAnalytics: tentar de novo e cache de 30 s do resumo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let buscar!: FetchResumo;

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-11-24T15:00:00Z"));
    clearAnalyticsCache();
    vi.spyOn(console, "error").mockImplementation(() => {});
    mockRpc.mockReset();
    mockGetSession.mockReset();
    mockRefreshSession.mockReset();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token-de-teste" } },
    });
    mockRefreshSession.mockResolvedValue({ data: { session: null } });
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <Sonda
          aoCapturar={(fn) => {
            buscar = fn;
          }}
        />,
      );
    });
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  /** Dispara a busca e devolve um marcador do que ela devolveu. */
  async function disparar(forcar = true) {
    const estado: { pronto: boolean; valor?: unknown } = { pronto: false };
    await act(async () => {
      void buscar(forcar).then((valor) => {
        estado.pronto = true;
        estado.valor = valor;
      });
      await vi.advanceTimersByTimeAsync(0);
    });
    return estado;
  }

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  it("erro 500 é tentado de novo (0,5 s e 1 s de espera) e a terceira tentativa traz o resumo", async () => {
    mockRpc
      .mockResolvedValueOnce(erro500)
      .mockResolvedValueOnce(erro500)
      .mockResolvedValueOnce(sucesso);
    const busca = await disparar();
    expect(mockRpc).toHaveBeenCalledTimes(1);
    await avancar(1500);
    expect(mockRpc).toHaveBeenCalledTimes(3);
    expect(busca.valor).toEqual(DADOS);
  });

  it("a espera cresce: 0,5 s antes da 2ª tentativa e 1 s antes da 3ª (não 0,5 s de novo)", async () => {
    mockRpc
      .mockResolvedValueOnce(erro500)
      .mockResolvedValueOnce(erro500)
      .mockResolvedValueOnce(sucesso);
    await disparar();
    await avancar(499);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    await avancar(1);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    await avancar(999);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    await avancar(1);
    expect(mockRpc).toHaveBeenCalledTimes(3);
  });

  it("tempo esgotado (408) é tentado de novo", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: { status: 408, message: "t" },
      })
      .mockResolvedValueOnce(sucesso);
    const busca = await disparar();
    await avancar(500);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(busca.valor).toEqual(DADOS);
  });

  it("erro sem status (a rede caiu) é tentado de novo", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: { message: "Failed to fetch" },
      })
      .mockResolvedValueOnce(sucesso);
    const busca = await disparar();
    await avancar(500);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(busca.valor).toEqual(DADOS);
  });

  it("erro do pedido (400) NÃO é repetido", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { status: 400, message: "pedido ruim" },
    });
    const busca = await disparar();
    await avancar(10_000);
    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(busca.pronto).toBe(true);
    expect(busca.valor).toBeNull();
  });

  it("servidor que não melhora: 4 tentativas no total, e desiste aos 3,5 s", async () => {
    mockRpc.mockResolvedValue(erro500);
    const busca = await disparar();
    await avancar(3500);
    expect(mockRpc).toHaveBeenCalledTimes(4);
    expect(busca.pronto).toBe(true);
    expect(busca.valor).toBeNull();
  });

  it("401 (sessão vencida) renova a sessão e repete na hora, sem esperar", async () => {
    mockRpc
      .mockResolvedValueOnce({
        data: null,
        error: { status: 401, message: "nao autorizado" },
      })
      .mockResolvedValueOnce(sucesso);
    mockRefreshSession.mockResolvedValue({
      data: { session: { access_token: "novo" } },
    });
    const busca = await disparar();
    expect(mockRefreshSession).toHaveBeenCalledTimes(1);
    expect(mockRpc).toHaveBeenCalledTimes(2);
    expect(busca.valor).toEqual(DADOS);
  });

  const frase = () =>
    hospedeiro.querySelector('[data-testid="erro"]')?.textContent ?? "";

  it("erro só com o código PGRST301 (sem o texto JWT) diz que a sessão expirou", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "PGRST301", status: 400, message: "token invalido" },
    });
    await disparar();
    expect(frase()).toContain("Sua sessão expirou");
  });

  it("erro só com o código 42501 diz que falta permissão", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: { code: "42501", status: 403, message: "negado" },
    });
    await disparar();
    expect(frase()).toContain("Sem permissão para acessar estes dados agora.");
  });

  it("erro de segurança por linha (RLS), sem código, diz que falta permissão", async () => {
    mockRpc.mockResolvedValue({
      data: null,
      error: {
        status: 403,
        message: 'new row violates row-level security policy for table "x"',
      },
    });
    await disparar();
    expect(frase()).toContain("Sem permissão para acessar estes dados agora.");
  });

  it("o resumo guardado vale por 30 s: dentro do prazo (até o segundo exato) não vai ao banco", async () => {
    mockRpc.mockResolvedValue(sucesso);
    await disparar(true);
    expect(mockRpc).toHaveBeenCalledTimes(1);

    await avancar(29_999);
    const dentro = await disparar(false);
    expect(dentro.valor).toEqual(DADOS);
    expect(mockRpc).toHaveBeenCalledTimes(1);

    await avancar(1); // exatamente 30 s depois da leitura
    await disparar(false);
    expect(mockRpc).toHaveBeenCalledTimes(1);

    await avancar(1); // passou dos 30 s: entrega o guardado e relê em segundo plano
    const depois = await disparar(false);
    expect(depois.valor).toEqual(DADOS);
    expect(mockRpc).toHaveBeenCalledTimes(2);
  });
});
