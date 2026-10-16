// @vitest-environment jsdom
// Sem o aviso e a chave da consulta, a falha mostra vazio ou outra busca.
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

import type { Customer } from "@/utils/admin_cache";
import type { AdminCustomersView as TipoClientes } from "@/views/admin/AdminCustomersView";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
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

function cliente(id: string, nome: string): Customer {
  return {
    id,
    full_name: nome,
    email: `${id}@example.com`,
    phone: null,
    role: "customer",
    created_at: "2026-10-01T12:00:00Z",
    orders_count: 1,
    total_spent: 50,
  };
}

function sucesso(clientes: Customer[], total = clientes.length) {
  return {
    data: {
      data: clientes,
      total_count: total,
      stats: {
        total_customers: 24,
        global_ltv: 1200,
        global_orders: 24,
        new_customers_30d: 0,
      },
    },
    error: null,
  };
}

const falha = { data: null, error: { message: "Falha simulada" } };
let AdminCustomersView: typeof TipoClientes;

beforeAll(async () => {
  ({ AdminCustomersView } = await import("@/views/admin/AdminCustomersView"));
}, 60_000);

describe("Clientes — falha de leitura não vira vazio nem resultado de outra consulta", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    rpc.mockReset();
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
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function avancar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
  }

  async function abrirTela() {
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    await avancar(320);
  }

  function botao(rotulo: string) {
    const encontrado = Array.from(hospedeiro.querySelectorAll("button")).find(
      (item) => item.textContent?.trim() === rotulo,
    );
    if (!encontrado) throw new Error(`Botão não encontrado: ${rotulo}`);
    return encontrado;
  }

  async function clicar(rotulo: string) {
    await act(async () => botao(rotulo).click());
  }

  async function buscarMaria() {
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
    return campo;
  }

  function esperarFalhaSemResultadoAntigo() {
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não conseguimos carregar os clientes agora.",
    );
    expect(botao("Tentar de novo").disabled).toBe(false);
    expect(hospedeiro.textContent).not.toContain("Nenhum cliente retornado");
    expect(hospedeiro.textContent).not.toContain("João Silva");
    expect(
      hospedeiro.querySelector('[data-testid="paginacao-admin"]'),
    ).toBeNull();
  }

  it("na primeira leitura com falha, oferece nova tentativa sem afirmar que não há clientes", async () => {
    rpc.mockResolvedValueOnce(falha);

    await abrirTela();

    esperarFalhaSemResultadoAntigo();
  });

  it.each(["compact", "detailed"] as const)(
    "busca Maria falha após carregar a lista: oculta clientes e total anteriores no modo %s",
    async (modo) => {
      vi.stubGlobal("localStorage", {
        getItem: (chave: string) =>
          chave === "admin_customers_view_mode" ? modo : null,
        setItem: () => {},
        removeItem: () => {},
      });
      rpc.mockResolvedValueOnce(sucesso([cliente("joao", "João Silva")], 24));
      rpc.mockResolvedValueOnce(falha);
      await abrirTela();
      expect(hospedeiro.textContent).toContain("João Silva");
      expect(
        hospedeiro.querySelector('[data-testid="paginacao-admin"]'),
      ).not.toBeNull();

      const campo = await buscarMaria();

      expect(campo.value).toBe("Maria");
      esperarFalhaSemResultadoAntigo();
    },
  );

  it("Tentar de novo repete a busca e remove o aviso quando ela carrega", async () => {
    rpc.mockResolvedValueOnce(sucesso([cliente("joao", "João Silva")], 24));
    rpc.mockResolvedValueOnce(falha);
    await abrirTela();
    const campo = await buscarMaria();
    esperarFalhaSemResultadoAntigo();
    let concluir: (resposta: ReturnType<typeof sucesso>) => void = () => {
      throw new Error("Nova tentativa ainda não foi iniciada");
    };
    rpc.mockImplementationOnce(
      () =>
        new Promise<ReturnType<typeof sucesso>>((resolve) => {
          concluir = resolve;
        }),
    );

    await clicar("Tentar de novo");
    expect(botao("Tentar de novo").disabled).toBe(true);
    expect(hospedeiro.querySelector('[role="alert"]')).not.toBeNull();
    await act(async () => concluir(sucesso([cliente("maria", "Maria Souza")])));

    expect(campo.value).toBe("Maria");
    expect(hospedeiro.textContent).toContain("Maria Souza");
    expect(hospedeiro.textContent).not.toContain("João Silva");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Nenhum cliente retornado");
    expect(
      hospedeiro.querySelector('[data-testid="paginacao-admin"]')?.textContent,
    ).toContain("Exibindo 1 - 1 de 1");
    expect(rpc).toHaveBeenLastCalledWith(
      "get_admin_customers_paged",
      expect.objectContaining({ p_search: "Maria", p_page: 0 }),
    );
  });

  it.each(["Próximo", "Alfabética"])(
    "falha ao mudar %s não reapresenta a consulta anterior",
    async (rotulo) => {
      rpc.mockResolvedValueOnce(sucesso([cliente("joao", "João Silva")], 24));
      rpc.mockResolvedValueOnce(falha);
      await abrirTela();

      await clicar(rotulo);
      await avancar(320);

      esperarFalhaSemResultadoAntigo();
    },
  );

  it("leitura bem-sucedida sem clientes continua mostrando o estado vazio", async () => {
    rpc.mockResolvedValueOnce(sucesso([]));

    await abrirTela();

    expect(hospedeiro.textContent).toContain("Nenhum cliente retornado");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
    expect(hospedeiro.textContent).not.toContain("Tentar de novo");
  });
});
