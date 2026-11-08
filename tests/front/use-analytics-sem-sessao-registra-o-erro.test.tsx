// @vitest-environment jsdom
//
// `fetchExecutiveSummary` e `fetchCategoryAnalytics` conferem a sessão antes de
// chamar o banco. Sem sessão, só faziam `console.warn` e devolviam `null`: nenhum
// erro chegava na tela, que então afirmava "Nenhuma categoria registrou
// faturamento" / "Nenhum dado disponível no período" (ou mostrava números velhos
// sem aviso). Agora os dois desvios registram o erro como os outros ramos do mesmo
// hook, e o aviso com "Tentar de novo" aparece. Com sessão, nada muda.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type MockInstance,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type Analytics = ReturnType<
  typeof import("@/hooks/useAnalytics")["useAnalytics"]
>;

const INICIO = "2020-01-01T00:00:00.000Z";
const FIM = "2026-01-01T00:00:00.000Z";

describe("useAnalytics — sem sessão no cliente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ultimo: Analytics;
  let aviso: MockInstance;

  async function montar() {
    const { useAnalytics, clearAnalyticsCache } = await import(
      "@/hooks/useAnalytics"
    );
    clearAnalyticsCache();
    function Sonda() {
      const lido = useAnalytics();
      useEffect(() => {
        ultimo = lido;
      });
      return null;
    }
    await act(async () => {
      raiz.render(<Sonda />);
    });
  }

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    mockRpc.mockReset();
    mockGetSession.mockReset();
    // O desvio loga com console.warn de propósito; o teste não quer o ruído.
    aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("resumo executivo: sem sessão devolve null E registra o erro para a tela", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await montar();
    expect(ultimo.error).toBeNull();

    let devolvido: unknown;
    await act(async () => {
      devolvido = await ultimo.fetchExecutiveSummary(true);
    });

    expect(devolvido).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled(); // não chamou o banco
    expect(aviso).toHaveBeenCalled(); // o aviso de console continua
    expect(ultimo.error).toContain("carregar o resumo do painel");
  });

  it("categorias: sem sessão devolve null E registra o erro para a tela", async () => {
    mockGetSession.mockResolvedValue({ data: { session: null } });
    await montar();
    expect(ultimo.categoryError).toBeNull();

    let devolvido: unknown;
    await act(async () => {
      devolvido = await ultimo.fetchCategoryAnalytics(INICIO, FIM, true);
    });

    expect(devolvido).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(ultimo.categoryError).toContain("carregar os dados de categorias");
  });

  it("controle: com sessão e consulta boa, nenhum dos dois erros aparece", async () => {
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token-de-teste" } },
    });
    mockRpc.mockResolvedValue({ data: [], error: null });
    await montar();

    await act(async () => {
      await ultimo.fetchExecutiveSummary(true);
      await ultimo.fetchCategoryAnalytics(INICIO, FIM, true);
    });

    expect(mockRpc).toHaveBeenCalled();
    expect(ultimo.error).toBeNull();
    expect(ultimo.categoryError).toBeNull();
  });
});
