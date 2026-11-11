// @vitest-environment jsdom
//
// O resumo executivo do painel (faturamento, lucro, custo do estoque, mais
// vendidos) só pode ser buscado ou devolvido a quem é admin. Quem perde o cargo
// com a tela ainda montada (ou qualquer sessão comum) não pode receber o
// retrato que ficou em memória nem disparar a consulta ao banco. Os outros
// testes de `useAnalytics` fixam `isAdmin: true`; este é o único que troca o
// papel e prova a recusa.
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
// O mock de `useAuth` lê esta variável a cada render: trocar o papel entre uma
// montagem e outra é o que simula "perdeu o cargo".
let papelAdmin = true;

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
  useAuth: () => ({ isAdmin: papelAdmin }),
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

const RESUMO = {
  today: { revenue: 10, count: 1, pending: 0, revenueTrend: 0, countTrend: 0 },
  month: { revenue: 99, count: 3, revenueTrend: 0, countTrend: 0 },
  executive: {
    totalRevenue: 12345,
    totalOrders: 7,
    revenueTrend: 0,
    ordersTrend: 0,
    avgTicket: 1763,
    avgTicketTrend: 0,
    activeCustomers: 4,
    activeCustomersTrend: 0,
  },
  revenueHistory: [],
  topProducts: [],
  inventoryAlerts: 0,
};

describe("useAnalytics — resumo executivo só para admin", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let ultimo: Analytics;
  let aviso: MockInstance;

  async function montar({ limparCache }: { limparCache: boolean }) {
    const { useAnalytics, clearAnalyticsCache } = await import(
      "@/hooks/useAnalytics"
    );
    // Só a primeira montagem zera a memória do módulo: a remontagem como
    // não-admin precisa encontrar o resumo já semeado.
    if (limparCache) clearAnalyticsCache();
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

  async function desmontar() {
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
  }

  beforeEach(() => {
    papelAdmin = true;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    mockRpc.mockReset();
    mockGetSession.mockReset();
    mockGetSession.mockResolvedValue({
      data: { session: { access_token: "token-de-teste" } },
    });
    mockRpc.mockResolvedValue({ data: RESUMO, error: null });
    // O desvio de não-admin loga com console.warn de propósito.
    aviso = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });

  afterEach(async () => {
    await act(async () => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("controle: admin busca o resumo no banco e o recebe de volta", async () => {
    await montar({ limparCache: true });

    let devolvido: unknown;
    await act(async () => {
      devolvido = await ultimo.fetchExecutiveSummary(true);
    });

    expect(mockRpc).toHaveBeenCalledTimes(1);
    expect(devolvido).toEqual(RESUMO);
  });

  it("controle: admin com resumo já em memória e fresco o recebe sem nova consulta", async () => {
    await montar({ limparCache: true });
    await act(async () => {
      await ultimo.fetchExecutiveSummary(true);
    });
    mockRpc.mockClear();

    let devolvido: unknown;
    await act(async () => {
      devolvido = await ultimo.fetchExecutiveSummary();
    });

    expect(devolvido).toEqual(RESUMO);
    expect(mockRpc).not.toHaveBeenCalled();
  });

  it("não-admin com o resumo semeado na memória: recebe null e nada é consultado", async () => {
    // Semeia o cache como admin.
    await montar({ limparCache: true });
    await act(async () => {
      await ultimo.fetchExecutiveSummary(true);
    });
    expect(mockRpc).toHaveBeenCalledTimes(1);

    // Perde o cargo com a memória do módulo intacta.
    await desmontar();
    papelAdmin = false;
    await montar({ limparCache: false });
    mockRpc.mockClear();
    mockGetSession.mockClear();
    aviso.mockClear();

    let semForcar: unknown = "nao-chamou";
    let forcando: unknown = "nao-chamou";
    await act(async () => {
      // Sem `forceRefresh` o cache fresco seria devolvido direto, sem banco.
      semForcar = await ultimo.fetchExecutiveSummary();
      // Com `forceRefresh` a RPC sairia com a sessão de um usuário comum.
      forcando = await ultimo.fetchExecutiveSummary(true);
    });

    expect(semForcar).toBeNull();
    expect(forcando).toBeNull();
    expect(mockRpc).not.toHaveBeenCalled();
    expect(mockGetSession).not.toHaveBeenCalled();
    expect(aviso).toHaveBeenCalledWith(expect.stringContaining("not admin"));
  });
});
