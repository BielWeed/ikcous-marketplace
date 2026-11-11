// @vitest-environment jsdom
//
// Clientes do painel: o lojista digita "Maria" enquanto a primeira consulta
// (a lista inteira) ainda voa. Se a resposta ANTIGA chegar depois da nova, ela
// não pode escrever por cima: nem na tela, nem no total, nem nas estatísticas,
// nem no cache de módulo (que a próxima abertura da tela mostra na hora). O
// aviso de falha e o "carregando" também pertencem só à consulta mais nova.
// As duas respostas são promessas controladas, resolvidas em ordem inversa.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import {
  type Customer,
  cachedCustomersData,
  limparCachesDeAdmin,
} from "@/utils/admin_cache";
import type { AdminCustomersView as TipoClientes } from "@/views/admin/AdminCustomersView";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
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

type Resposta = {
  data: unknown;
  error: unknown;
};

// `totalDaLoja` difere entre as respostas de propósito: se a resposta velha
// vazasse para o cache, as estatísticas (e não só a lista) denunciariam.
function sucesso(
  clientes: Customer[],
  total: number,
  totalDaLoja: number,
): Resposta {
  return {
    data: {
      data: clientes,
      total_count: total,
      stats: {
        total_customers: totalDaLoja,
        global_ltv: 1200,
        global_orders: 24,
        new_customers_30d: 0,
      },
    },
    error: null,
  };
}

const falha: Resposta = { data: null, error: { message: "Falha simulada" } };

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

describe("Clientes — resposta velha não sobrescreve a busca nova", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
    vi.mocked(toast.error).mockClear();
    limparCachesDeAdmin();
    vi.useFakeTimers();
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

  function montar() {
    return act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
  }

  // Consulta A (busca vazia) sai ao abrir a tela e fica em voo; "Maria" sai
  // como consulta B, também em voo. Devolve as duas respostas nas mãos do teste.
  async function abrirEBuscarMaria() {
    const a = pendente();
    const b = pendente();
    rpc.mockImplementationOnce(() => a.promessa);
    rpc.mockImplementationOnce(() => b.promessa);

    await montar();
    await avancar(320);
    expect(rpc).toHaveBeenCalledTimes(1);

    const campo =
      hospedeiro.querySelector<HTMLInputElement>("#customers-search");
    const atribuir = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!campo || !atribuir) throw new Error("Campo de busca não encontrado");
    await act(async () => {
      atribuir.call(campo, "Maria");
      campo.dispatchEvent(new Event("input", { bubbles: true }));
    });
    // O campo tem 300 ms de debounce; a consulta espera outros 320 ms.
    await avancar(300);
    await avancar(320);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]).toEqual(
      expect.objectContaining({ p_search: "" }),
    );
    expect(rpc.mock.calls[1][1]).toEqual(
      expect.objectContaining({ p_search: "Maria" }),
    );
    return { a, b };
  }

  const respostaA = () => sucesso([cliente("joao", "João Silva")], 24, 24);
  const respostaB = () => sucesso([cliente("maria", "Maria Souza")], 1, 7);

  function listaEstaCarregando() {
    return (
      hospedeiro.querySelector("[aria-busy]")?.getAttribute("aria-busy") ===
      "true"
    );
  }

  it("B chega primeiro e A depois: a tela, o total e o cache ficam com Maria", async () => {
    const { a, b } = await abrirEBuscarMaria();

    await act(async () => b.resolver(respostaB()));
    expect(hospedeiro.textContent).toContain("Maria Souza");
    expect(listaEstaCarregando()).toBe(false);

    await act(async () => a.resolver(respostaA()));

    expect(hospedeiro.textContent).toContain("Maria Souza");
    expect(hospedeiro.textContent).not.toContain("João Silva");
    expect(
      hospedeiro.querySelector('[data-testid="paginacao-admin"]')?.textContent,
    ).toContain("Exibindo 1 - 1 de 1");
    expect(listaEstaCarregando()).toBe(false);
    expect(cachedCustomersData?.customers.map((c) => c.id)).toEqual(["maria"]);
    expect(cachedCustomersData?.total).toBe(1);
    expect(cachedCustomersData?.stats.total_customers).toBe(7);
  });

  it("reabrir a tela mostra Maria do cache, nunca João", async () => {
    const { a, b } = await abrirEBuscarMaria();
    await act(async () => b.resolver(respostaB()));
    await act(async () => a.resolver(respostaA()));

    await act(async () => raiz.render(null));
    await montar();

    expect(hospedeiro.textContent).toContain("Maria Souza");
    expect(hospedeiro.textContent).not.toContain("João Silva");
  });

  it("A chega antes de B, que ainda voa: nada de A aparece e a tela segue carregando", async () => {
    const { a, b } = await abrirEBuscarMaria();

    await act(async () => a.resolver(respostaA()));

    expect(hospedeiro.textContent).not.toContain("João Silva");
    expect(cachedCustomersData).toBeNull();
    expect(listaEstaCarregando()).toBe(true);

    await act(async () => b.resolver(respostaB()));

    expect(hospedeiro.textContent).toContain("Maria Souza");
    expect(hospedeiro.textContent).not.toContain("João Silva");
    expect(listaEstaCarregando()).toBe(false);
    expect(cachedCustomersData?.customers.map((c) => c.id)).toEqual(["maria"]);
  });

  it("A falha depois de B carregar: sem alerta, sem toast e Maria continua na tela", async () => {
    const { a, b } = await abrirEBuscarMaria();
    await act(async () => b.resolver(respostaB()));

    await act(async () => a.resolver(falha));

    expect(toast.error).not.toHaveBeenCalled();
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(hospedeiro.textContent).not.toContain(
      "Não conseguimos carregar os clientes",
    );
    expect(hospedeiro.textContent).toContain("Maria Souza");
    expect(listaEstaCarregando()).toBe(false);
  });

  it("controle: sem consulta nova no meio, a falha da consulta atual acende o alerta e o toast", async () => {
    const a = pendente();
    rpc.mockImplementationOnce(() => a.promessa);
    await montar();
    await avancar(320);

    await act(async () => a.resolver(falha));

    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não conseguimos carregar os clientes agora.",
    );
  });
});
