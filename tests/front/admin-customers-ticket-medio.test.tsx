// @vitest-environment jsdom
//
// Auditoria de 20/08/2026, achado 4 — o card "Ticket Médio" da tela de
// Clientes não mostrava ticket médio.
//
// O QUE ESTAVA ERRADO
//   A conta era `global_ltv / total_customers` — receita dividida por
//   CLIENTES. Isso é gasto médio por cliente, não ticket médio, que é
//   receita dividida por PEDIDOS. Com os números reais do banco em
//   20/08/2026 (R$ 450,50 em 11 pedidos, 16 perfis), o card mostrava
//   R$ 28,16 enquanto o Dashboard — na mesma sessão, com o mesmo rótulo
//   "Ticket Médio" — mostrava R$ 40,95. Duas telas do mesmo painel, o mesmo
//   nome, valores diferentes, e nenhuma pista de qual valia.
//
//   Havia um segundo erro embutido na mesma divisão: o numerador soma TODOS
//   os pedidos (inclusive os de convidado, que não têm dono) e o denominador
//   só contava perfis cadastrados. Numerador e denominador falavam de
//   conjuntos diferentes. Dividir receita por pedidos conserta os dois de
//   uma vez, porque aí os dois lados passam a ser "todos os pedidos".
//
// POR QUE ESTE TESTE MONTA A TELA
//   A conta é uma expressão dentro do `useMemo` que constrói os cards. Não dá
//   para exercitá-la sem renderizar, e é justamente no render que ela é
//   ligada ao rótulo — que é a metade do defeito.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { estadoDaRpc } = vi.hoisted(() => ({
  estadoDaRpc: {
    data: [] as unknown[],
    total_count: 0,
    stats: {
      total_customers: 16,
      global_ltv: 450.5,
      global_orders: 11,
      new_customers_30d: 0,
    },
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: estadoDaRpc, error: null }),
    from: () => ({
      select: () => Promise.resolve({ data: [], error: null }),
    }),
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// O cache do admin devolve dados de sessões anteriores e atropelaria o
// cenário de cada teste.
vi.mock("@/utils/admin_cache", () => ({
  cachedCustomersData: null,
  setCachedCustomersData: vi.fn(),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O card mora dentro do AdminKpiCarousel, que usa embla-carousel-react.
// Ele chama `matchMedia`, `ResizeObserver` e `IntersectionObserver` no mount,
// e o jsdom deste projeto não traz nenhum dos três. Sem os dublês o carrossel
// estoura DENTRO do LocalErrorBoundary, os KPIs somem do DOM e o teste fica
// vermelho por ausência de conteúdo — parecendo defeito do valor quando é
// defeito do ambiente. Mesmo padrão de
// `admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx`.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminCustomersView — o card Ticket Médio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    // O jsdom deste ambiente não traz localStorage utilizável, e a tela lê
    // `admin_customers_view_mode` no initializer do estado. Mesmo dublê em
    // Map que `admin-orders-payment-filter.test.tsx` já usa. Sem ele o teste
    // fica vermelho por `localStorage.getItem is not a function` — vermelho
    // pelo motivo errado, que não prova nada sobre o defeito.
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    estadoDaRpc.stats = {
      total_customers: 16,
      global_ltv: 450.5,
      global_orders: 11,
      new_customers_30d: 0,
    };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  async function abrirTela() {
    const { AdminCustomersView } = await import(
      "@/views/admin/AdminCustomersView"
    );
    await act(async () => {
      raiz.render(<AdminCustomersView active={true} onNavigate={vi.fn()} />);
    });
    // O fetch da lista é disparado por um timer de 320 ms dentro da view.
    await act(async () => {
      await esperar(400);
    });
  }

  const texto = () => hospedeiro.textContent ?? "";

  it("divide receita por PEDIDOS, não por clientes", async () => {
    await abrirTela();

    // 450,50 ÷ 11 pedidos = 40,95. O número do Dashboard.
    expect(texto()).toContain("R$ 40,95");
    // 450,50 ÷ 16 clientes = 28,16. O número errado, que não pode voltar.
    expect(texto()).not.toContain("R$ 28,16");
  });

  it("bate com o Dashboard para outro conjunto de números", async () => {
    // Um segundo cenário para o teste não passar por coincidência de um
    // número só: 1.000,00 em 8 pedidos com 40 clientes.
    estadoDaRpc.stats = {
      total_customers: 40,
      global_ltv: 1000,
      global_orders: 8,
      new_customers_30d: 3,
    };
    await abrirTela();

    expect(texto()).toContain("R$ 125,00"); // 1000 ÷ 8
    expect(texto()).not.toContain("R$ 25,00"); // 1000 ÷ 40, o jeito errado
  });

  it("sem nenhum pedido, mostra R$ 0,00 em vez de dividir por zero", async () => {
    estadoDaRpc.stats = {
      total_customers: 5,
      global_ltv: 0,
      global_orders: 0,
      new_customers_30d: 0,
    };
    await abrirTela();

    expect(texto()).toContain("R$ 0,00");
    expect(texto()).not.toMatch(/NaN|Infinity/);
  });

  it("loja com receita e zero pedidos contados não vira Infinity", async () => {
    // Estado incoerente vindo do servidor (receita sem pedido). A tela não
    // pode responder com Infinity nem NaN: prefere não afirmar.
    estadoDaRpc.stats = {
      total_customers: 5,
      global_ltv: 250,
      global_orders: 0,
      new_customers_30d: 0,
    };
    await abrirTela();

    expect(texto()).not.toMatch(/NaN|Infinity|∞/);
  });

  it("o rótulo de apoio descreve a média por pedido, não por cliente", async () => {
    await abrirTela();

    expect(texto()).toMatch(/por pedido/i);
    expect(texto()).not.toMatch(/consumo médio/i);
  });
});
