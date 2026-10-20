// @vitest-environment jsdom
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { listar, resumo, recarregarNumeros } = vi.hoisted(() => ({
  listar: vi.fn(),
  resumo: vi.fn(),
  recarregarNumeros: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string, parametros: Record<string, unknown>) => ({
      abortSignal: () =>
        nome === "get_admin_orders_cancelados_recentes"
          ? Promise.resolve({ data: { data: [], total_count: 0 }, error: null })
          : listar(nome, parametros),
    }),
    from: () => ({
      select: () => Promise.resolve({ count: 0, error: null }),
    }),
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  clearAnalyticsCache: vi.fn(),
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: resumo }),
}));
vi.mock("@/hooks/useNumerosDosPedidos", () => ({
  useNumerosDosPedidos: () => ({
    paraPreparar: null,
    aguardandoPagamento: null,
    aCaminho: null,
    abertosComPagamentoAConferir: null,
    pedirRecarga: recarregarNumeros,
  }),
}));
vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));
vi.mock("@/hooks/useEstornosEmCursoDosPedidos", () => ({
  useEstornosEmCursoDosPedidos: () => ({ porPedido: new Map() }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/components/admin/orders/AdminOrderCard", () => ({
  AdminOrderCard: ({ order }: { order: Order }) => (
    <article>{order.customer.name}</article>
  ),
  AdminOrderCardSkeleton: () => <div>Carregando pedidos</div>,
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const pedido = {
  id: "pedido-1",
  customer_name: "Ana da lista de pedidos",
  status: "pending",
  total: 100,
  created_at: "2026-10-16T10:00:00.000Z",
  updated_at: "2026-10-16T10:00:00.000Z",
};
const falha = { data: null, error: { message: "Falha de conexão" } };
const sucesso = {
  data: { data: [pedido], total_count: 1 },
  error: null,
};

describe("Pedidos — falha de leitura não vira lista vazia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    listar.mockReset();
    localStorage.clear();
    vi.stubGlobal("ResizeObserver", ObservadorStub);
    vi.stubGlobal("IntersectionObserver", ObservadorStub);
    vi.stubGlobal("matchMedia", (media: string) => ({
      matches: false,
      media,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  async function abrir() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView active={true} onNavigate={vi.fn()} />);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
  }

  function botao(texto: string) {
    const encontrado = Array.from(
      (
        document.querySelector('[role="dialog"]') ?? document.body
      ).querySelectorAll("button"),
    ).find((elemento) => elemento.textContent?.trim() === texto);
    expect(encontrado).toBeDefined();
    return encontrado!;
  }

  function conferirFalha() {
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toContain(
      "Não conseguimos carregar os pedidos agora.",
    );
    expect(botao("Tentar de novo")).toBeDefined();
    expect(hospedeiro.textContent).not.toMatch(
      /Nenhum pedido|Seus pedidos vão aparecer aqui/,
    );
  }

  it("primeira leitura falha: avisa e oferece tentar de novo sem afirmar vazio", async () => {
    listar.mockResolvedValue(falha);
    await abrir();
    conferirFalha();
  });

  it("tentar de novo repete a consulta e o sucesso retira o aviso", async () => {
    listar.mockResolvedValueOnce(falha).mockResolvedValue(sucesso);
    await abrir();
    conferirFalha();
    const parametros = listar.mock.calls[0]?.[1];
    await act(async () => botao("Tentar de novo").click());
    expect(listar).toHaveBeenLastCalledWith(
      "get_admin_orders_paged",
      parametros,
    );
    expect(hospedeiro.querySelector("article")?.textContent).toContain(
      pedido.customer_name,
    );
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });

  it("releitura que falha mantém os pedidos e mostra o aviso acima deles", async () => {
    listar.mockResolvedValueOnce(sucesso).mockResolvedValue(falha);
    await abrir();
    expect(hospedeiro.querySelector("article")?.textContent).toContain(
      pedido.customer_name,
    );
    await act(async () =>
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Filtros e ferramentas"]',
        )!
        .click(),
    );
    await act(async () => botao("Abrir filtros").click());
    await act(async () => botao("Todos").click());
    await act(async () => botao("Fechar").click());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    conferirFalha();
    const alerta = hospedeiro.querySelector('[role="alert"]')!;
    const card = hospedeiro.querySelector("article")!;
    expect(card.textContent).toContain(pedido.customer_name);
    expect(
      alerta.compareDocumentPosition(card) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  it("leitura válida realmente vazia mantém o estado vazio", async () => {
    listar.mockResolvedValue({
      data: { data: [], total_count: 0 },
      error: null,
    });
    await abrir();
    expect(hospedeiro.textContent).toContain("Seus pedidos vão aparecer aqui");
    expect(hospedeiro.querySelector('[role="alert"]')).toBeNull();
  });
});
