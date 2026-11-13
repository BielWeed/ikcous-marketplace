// @vitest-environment jsdom
//
// Defeito: "Novos (30 dias)" vem do servidor (`NOW() - INTERVAL '30 days'`) e a
// tela de Clientes só relia por abertura, busca, página, volta da rede ou
// foco. Com o painel aberto de 23h59 a 00h01 (São Paulo), o cartão seguia com
// a janela de ontem. Agora a virada do dia relê a página atual — em silêncio:
// a lista continua na tela enquanto a leitura nova não chega.
// Relógio falso cruzando a meia-noite de São Paulo (UTC−3: 03:00Z).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import { type Customer, limparCachesDeAdmin } from "@/utils/admin_cache";
import type { AdminCustomersView as TipoClientes } from "@/views/admin/AdminCustomersView";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn<() => void>(), error: vi.fn<() => void>() },
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));

class ObservadorMudo {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const ANTES_DA_MEIA_NOITE = "2026-11-13T02:59:50Z"; // 12/11, 23:59:50 em SP
const DEPOIS_DA_MEIA_NOITE = "2026-11-13T03:00:10Z"; // 13/11, 00:00:10 em SP

function cliente(id: string, nome: string): Customer {
  return {
    id,
    full_name: nome,
    email: `${id}@fixture.invalid`,
    phone: null,
    role: "customer",
    created_at: "2026-10-01T12:00:00Z",
    orders_count: 1,
    total_spent: 50,
  };
}

type Resposta = { data: unknown; error: unknown };

function sucesso(novos30d: number): Resposta {
  return {
    data: {
      data: [cliente("joao", "João Silva")],
      total_count: 1,
      stats: {
        total_customers: 1,
        global_ltv: 50,
        global_orders: 1,
        new_customers_30d: novos30d,
      },
    },
    error: null,
  };
}

function pendente() {
  let resolver: (resposta: Resposta) => void = () => {};
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

let AdminCustomersView: typeof TipoClientes;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
}, 60_000);

describe("Clientes — acompanha a virada do dia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    rpc.mockResolvedValue(sucesso(3));
    limparCachesDeAdmin();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(ANTES_DA_MEIA_NOITE));
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.stubGlobal("localStorage", {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    });
    vi.stubGlobal("ResizeObserver", ObservadorMudo);
    vi.stubGlobal("IntersectionObserver", ObservadorMudo);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    limparCachesDeAdmin();
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function montar(ativa: boolean) {
    await act(async () => {
      raiz.render(<AdminCustomersView active={ativa} onNavigate={vi.fn()} />);
    });
  }

  const leituras = () => rpc.mock.calls.length;

  it("com a tela aberta na virada do dia, a página atual é lida de novo", async () => {
    await montar(true);
    await avancar(400);
    expect(leituras()).toBe(1);

    await avancar(12_000); // o temporizador da meia-noite dispara aos ~11 s
    await avancar(400); // a leitura espera os 320 ms de agrupamento

    expect(leituras()).toBe(2);
    expect(rpc.mock.calls[1][0]).toBe("get_admin_customers_paged");
  });

  it("a releitura da virada não apaga a lista da tela enquanto não chega", async () => {
    await montar(true);
    await avancar(400);
    expect(hospedeiro.textContent).toContain("João Silva");

    const segunda = pendente();
    rpc.mockImplementationOnce(() => segunda.promessa);
    await avancar(12_000);
    await avancar(400);

    expect(leituras()).toBe(2);
    expect(hospedeiro.textContent).toContain("João Silva");
  });

  it("controle: sem virada de dia, o foco não relê a lista", async () => {
    await montar(true);
    await avancar(400);
    await act(async () => {
      vi.setSystemTime(new Date("2026-11-13T02:59:55Z"));
      window.dispatchEvent(new Event("focus"));
    });
    await avancar(1_000);
    expect(leituras()).toBe(1);
  });

  it("tela inativa não consulta, nem na virada do dia", async () => {
    await montar(false);
    await avancar(400);
    expect(leituras()).toBe(0);
    // Nem o relógio da virada fica armado escondida.
    expect(vi.getTimerCount()).toBe(0);
    await avancar(12_000);
    await avancar(400);
    expect(leituras()).toBe(0);
  });

  it("tela que fica ativa já no dia seguinte lê UMA vez só (sem rajada)", async () => {
    await montar(false);
    await act(async () => {
      vi.setSystemTime(new Date(DEPOIS_DA_MEIA_NOITE));
    });
    await montar(true);
    await avancar(1_000);
    expect(leituras()).toBe(1);
  });
});
