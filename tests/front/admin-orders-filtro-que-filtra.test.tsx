// @vitest-environment jsdom
//
// A tela de Pedidos abria em "Todos Ativos" — um filtro que, apesar do nome,
// não filtra NADA (manda `p_status: "all"`). Medido em 20/08/2026: 83
// pedidos, 72 cancelados (86,7%); tirando cancelado e entregue sobram 8 (uma
// página). Aprovado pelo Gabriel:
//
//   1. o primeiro botão passa a se chamar "Em Aberto" e manda "open"
//      (a exclusão de cancelled/delivered é feita pela consulta do banco —
//      esta tela só manda a string, sem decidir nada disso aqui);
//   2. "Em Aberto" é o padrão ao abrir a tela;
//   3. entra um botão "Todos" no FIM da fileira, mandando "all" — a saída
//      honesta para ver tudo;
//   4. a CHAVE do localStorage muda (`admin_orders_filter_v2`) para que quem
//      já tinha "all" salvo da versão antiga não fique preso nele.
//
// Mesmo padrão de mock de admin-orders-payment-filter.test.tsx: `@/lib/
// supabase` mocado porque AdminOrdersView.tsx importa `supabase` no topo
// (fetch de pedido avulso por deep link) — sem o mock, só IMPORTAR o módulo
// já dispara a leitura de env vars ausentes em src/lib/env.ts.
//
// `loadOrders` é espionado (não apenas `vi.fn()` mudo) porque o que decide o
// que o banco devolve é o VALOR mandado como `statusFilter` — o hook real
// (useOrders.ts:385) repassa esse valor direto como `p_status`, sem
// alteração nenhuma. Testar só o botão aceso provaria a cor do botão, não o
// que a tela pede ao banco.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// A-3 (laudo varredura 01/09): AdminOrdersView passou a ler o nome da loja
// (config.storeName) para o recibo impresso — mock mínimo do contexto, mesmo
// padrão de admin-coupons-view-expirado.test.tsx. Sem ele o useStore lança
// 'must be used within a StoreProvider' em toda montagem da view.
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
}));

let mockOrders: Order[] = [];
let mockTotalOrders = 0;
let mockLoadOrders: ReturnType<typeof vi.fn>;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: mockOrders,
    loadOrders: mockLoadOrders,
    updateOrderStatus: vi.fn(),
    totalOrders: mockTotalOrders,
    isLoaded: true,
    loading: false,
  }),
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// embla-carousel-react (usado pelo AdminKpiCarousel, que só monta quando
// active=true) usa ResizeObserver/IntersectionObserver e chama
// `window.matchMedia` no mount — ausentes no jsdom deste projeto. Mesmo
// padrão de admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx.
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

/** Espera até `condicao()` ficar verdadeira, testando a cada `passoMs` — sem
 * `@testing-library/react` (não instalado neste projeto). Mesmo helper de
 * admin-orders-total-concluido-e-aviso-pago-cancelado.test.tsx. */
async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 2000, passoMs = 20 } = {},
) {
  await act(async () => {
    const inicio = Date.now();
    while (!condicao()) {
      if (Date.now() - inicio > timeoutMs) {
        throw new Error(
          `esperarAte: condição não ficou verdadeira em ${timeoutMs}ms`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, passoMs));
    }
  });
}

function botaoComTexto(hospedeiro: HTMLElement, texto: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === texto,
  );
}

/** 3º argumento posicional de `loadOrders` na última chamada — é o valor que
 * `useOrders.ts:385` repassa como `p_status`, sem alteração. */
function ultimoStatusFilterEnviado() {
  const chamadas = mockLoadOrders.mock.calls;
  const ultima = chamadas.at(-1);
  return ultima?.[2];
}

describe("AdminOrdersView — o filtro que abre a tela filtra de verdade", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    // jsdom deste ambiente não traz localStorage utilizável — dublê em Map
    // que LÊ e ESCREVE de verdade (não um stub que devolve null), porque
    // este teste depende do valor gravado sobrevivendo entre chamadas.
    armazem = new Map<string, string>();
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

    mockLoadOrders = vi.fn();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.resetModules();
    mockOrders = [];
    mockTotalOrders = 0;
  });

  it("abre com o filtro 'open' e manda esse valor para a busca (não só o botão aceso)", async () => {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    expect(ultimoStatusFilterEnviado()).toBe("open");
  });

  it("o botão aceso ao abrir é 'Em Aberto'", async () => {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    const emAberto = botaoComTexto(hospedeiro, "Em Aberto");
    expect(emAberto).toBeTruthy();
    expect(emAberto!.className).toContain("bg-admin-gold");
  });

  it("com a CHAVE ANTIGA 'admin_orders_filter' gravada como 'all', a tela ainda abre em 'Em Aberto' (armadilha do localStorage)", async () => {
    armazem.set("admin_orders_filter", JSON.stringify("all"));

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });

    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    const emAberto = botaoComTexto(hospedeiro, "Em Aberto");
    expect(emAberto!.className).toContain("bg-admin-gold");
    expect(ultimoStatusFilterEnviado()).toBe("open");
  });

  it("clicar em 'Todos' manda 'all' para a busca", async () => {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    const botaoTodos = botaoComTexto(hospedeiro, "Todos");
    expect(botaoTodos).toBeTruthy();

    await act(async () => {
      botaoTodos!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await esperarAte(() => ultimoStatusFilterEnviado() === "all");

    expect(ultimoStatusFilterEnviado()).toBe("all");
    expect(botaoTodos!.className).toContain("bg-admin-gold");
  });

  it("clicar num status individual (Cancelado) continua mandando aquele status", async () => {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    const botaoCancelado = botaoComTexto(hospedeiro, "Cancelado");
    expect(botaoCancelado).toBeTruthy();

    await act(async () => {
      botaoCancelado!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await esperarAte(() => ultimoStatusFilterEnviado() === "cancelled");

    expect(ultimoStatusFilterEnviado()).toBe("cancelled");
  });

  it("trocar de filtro volta para a página 0", async () => {
    armazem.set("admin_orders_current_page", JSON.stringify(3));

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    const botaoTodos = botaoComTexto(hospedeiro, "Todos");

    await act(async () => {
      botaoTodos!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await esperarAte(() => armazem.get("admin_orders_current_page") === "0");

    expect(armazem.get("admin_orders_current_page")).toBe("0");
  });
});

// Achado da revisão de contexto limpo (BLOQUEOU): o padrão da tela virou "Em
// Aberto" — um resultado já FILTRADO — e a busca é ANDada com o filtro no
// servidor. Lista vazia deixou de significar "loja sem pedido nenhum": pode
// ser só que nada bate com o filtro/busca/período aplicado agora. Medido
// contra o banco real: 75 dos 83 pedidos produzem lista vazia se buscados
// pelo número na tela padrão ("Em Aberto") — e a redação antiga mandava a
// lojista desistir de um pedido que existe.
describe("AdminOrdersView — o estado vazio não mente quando há filtro estreitando", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;

  beforeEach(() => {
    armazem = new Map<string, string>();
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

    mockLoadOrders = vi.fn();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.resetModules();
    mockOrders = [];
    mockTotalOrders = 0;
  });

  it("filtro padrão 'Em Aberto' + busca que não casa + lista vazia → NÃO diz que a loja não tem pedidos, aponta 'Todos'", async () => {
    armazem.set(
      "admin_orders_search_query",
      JSON.stringify("PEDIDO-INEXISTENTE"),
    );

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    expect(hospedeiro.textContent).not.toContain("Ainda não tem nenhum pedido");
    expect(hospedeiro.textContent).toContain(
      "Nenhum pedido corresponde ao que está sendo mostrado agora",
    );
    expect(hospedeiro.textContent).toContain("Todos");
  });

  it("filtro 'Todos' + busca que não casa + lista vazia → a busca sozinha já é estreitamento, mensagem nova (não a absoluta)", async () => {
    armazem.set("admin_orders_filter_v2", JSON.stringify("all"));
    armazem.set(
      "admin_orders_search_query",
      JSON.stringify("PEDIDO-INEXISTENTE"),
    );

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    expect(hospedeiro.textContent).not.toContain("Ainda não tem nenhum pedido");
    expect(hospedeiro.textContent).toContain(
      "Nenhum pedido corresponde ao que está sendo mostrado agora",
    );
  });

  it("filtro 'Todos' + só o PERÍODO preenchido + lista vazia → o período sozinho já é estreitamento, mensagem nova (não a absoluta)", async () => {
    // A terceira perna da condição do estado vazio (`dateRange.start ||
    // dateRange.end`) não tinha teste nenhum: apagá-la não derrubava nada, e
    // uma condição viva que ninguém guarda apodrece na primeira refatoração.
    // Só `start`, de propósito — o servidor testa `p_start_date` e
    // `p_end_date` em cláusulas separadas, então UM dos dois já estreita.
    armazem.set("admin_orders_filter_v2", JSON.stringify("all"));
    armazem.set(
      "admin_orders_date_range",
      JSON.stringify({ start: "2026-01-01", end: "" }),
    );

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    expect(hospedeiro.textContent).not.toContain("Ainda não tem nenhum pedido");
    expect(hospedeiro.textContent).toContain(
      "Nenhum pedido corresponde ao que está sendo mostrado agora",
    );
  });

  it("filtro 'Todos', sem busca, sem período, lista vazia → aqui a mensagem absoluta é verdade e continua aparecendo", async () => {
    armazem.set("admin_orders_filter_v2", JSON.stringify("all"));

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    expect(hospedeiro.textContent).toContain("Ainda não tem nenhum pedido");
    expect(hospedeiro.textContent).not.toContain(
      "Nenhum pedido corresponde ao que está sendo mostrado agora",
    );
  });

  it("paymentFilter ativo continua com a redação dele, sem regredir para nenhuma das outras duas", async () => {
    armazem.set("admin_orders_payment_filter", JSON.stringify("aguardando"));

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");

    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await esperarAte(() => mockLoadOrders.mock.calls.length > 0);

    expect(hospedeiro.textContent).toContain(
      "Nenhum pedido com esse filtro de pagamento",
    );
    expect(hospedeiro.textContent).not.toContain("Ainda não tem nenhum pedido");
    expect(hospedeiro.textContent).not.toContain(
      "Nenhum pedido corresponde ao que está sendo mostrado agora",
    );
  });
});
