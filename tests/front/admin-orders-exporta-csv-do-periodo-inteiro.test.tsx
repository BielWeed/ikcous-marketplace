// @vitest-environment jsdom
// Hook e tela reais: reduzir a exportação à página deve perder 3 dos 15 pedidos.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), erro: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: true }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true, updateConfig: vi.fn() }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
  clearAnalyticsCache: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { error: mocks.erro, success: vi.fn(), info: vi.fn() },
}));

import { useOrders } from "@/hooks/useOrders";
import { AdminOrdersView } from "@/views/admin/AdminOrdersView";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

type Argumentos = Record<string, string | number>;
type Resposta = {
  data: { data: ReturnType<typeof pedido>[]; total_count: number } | null;
  error: Error | null;
};
function pedido(numero: number, pagamento = "aguardando") {
  return {
    id: `pedido-${String(numero).padStart(6, "0")}`,
    customer_name: `Cliente ${numero}`,
    customer_data: { whatsapp: "11999999999" },
    items: [],
    total: 100,
    status: "pending",
    payment_status: pagamento,
    payment_method: "pix",
    created_at: "2026-09-01T12:00:00.000Z",
    updated_at: "2026-09-01T12:00:00.000Z",
  };
}
function resposta(
  pedidos: ReturnType<typeof pedido>[],
  total = pedidos.length,
): Resposta {
  return { data: { data: pedidos, total_count: total }, error: null };
}
function consulta(resultado: Promise<Resposta>) {
  return Object.assign(resultado, { abortSignal: () => resultado });
}

let hook: ReturnType<typeof useOrders>;
function AlvoHook() {
  const atual = useOrders(true, true);
  useEffect(() => {
    hook = atual;
  });
  return null;
}

describe("CSV de todos os pedidos do filtro", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let textoCsv: string;
  let baixar: ReturnType<typeof vi.spyOn>;
  let exportacao: (args: Argumentos) => Promise<Resposta>;

  function chamadasExportacao() {
    return mocks.rpc.mock.calls.filter(
      ([nome, args]) =>
        nome === "get_admin_orders_paged" && args.p_page_size === 100,
    );
  }
  function botao() {
    // Desde 12/09/2026 o botão é compacto: o texto VISÍVEL é só "CSV" e o
    // rótulo por extenso vive no nome acessível (aria-label). Procurar pelo
    // nome acessível é o que continua descrevendo o que o lojista ouve/lê.
    const encontrado = Array.from(hospedeiro.querySelectorAll("button")).find(
      (item) =>
        /Exportar CSV|Gerando CSV/.test(item.getAttribute("aria-label") || ""),
    );
    expect(encontrado).toBeDefined();
    return encontrado!;
  }
  async function montarTela() {
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    // Espera o botão ficar clicável em vez de um prazo fixo: com 400ms fixos o
    // teste falhava 4 em 6 vezes mesmo no código original (medido em
    // 12/09/2026) — a tela ainda carregava, o botão nascia desabilitado e o
    // clique não exportava.
    const limite = Date.now() + 5000;
    for (;;) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const pronto = Array.from(hospedeiro.querySelectorAll("button")).find(
        (item) =>
          /Exportar CSV/.test(item.getAttribute("aria-label") || "") &&
          !item.disabled,
      );
      if (pronto || Date.now() > limite) break;
    }
  }

  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.erro.mockClear();
    armazem = new Map();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => armazem.set(chave, valor),
      removeItem: (chave: string) => armazem.delete(chave),
    });
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
    textoCsv = "";
    const BlobOriginal = globalThis.Blob;
    vi.stubGlobal(
      "Blob",
      class extends BlobOriginal {
        constructor(partes: BlobPart[], opcoes?: BlobPropertyBag) {
          super(partes, opcoes);
          textoCsv = partes.join("");
        }
      },
    );
    vi.stubGlobal(
      "URL",
      Object.assign(class extends URL {}, {
        createObjectURL: vi.fn(() => "blob:csv"),
        revokeObjectURL: vi.fn(),
      }),
    );
    baixar = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
    exportacao = async (args) => {
      const inicio = args.p_page === 0 ? 1 : 13;
      const quantidade = args.p_page === 0 ? 12 : 3;
      return resposta(
        Array.from({ length: quantidade }, (_, i) =>
          pedido(inicio + i, String(args.p_payment_status)),
        ),
        15,
      );
    };
    mocks.rpc.mockImplementation((nome: string, args: Argumentos) => {
      if (nome !== "get_admin_orders_paged" || args.p_page_size === 200)
        return consulta(Promise.resolve(resposta([])));
      if (args.p_page_size === 100) return consulta(exportacao(args));
      return consulta(
        Promise.resolve(
          resposta(
            Array.from({ length: 12 }, (_, i) =>
              pedido(i + 1, String(args.p_payment_status)),
            ),
            15,
          ),
        ),
      );
    });
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
    vi.unstubAllGlobals();
  });

  it.each([
    {
      status: "pending",
      busca: "Ana",
      inicio: "2026-09-01",
      fim: "2026-09-08",
      pagamento: "aguardando",
    },
    {
      status: "delivered",
      busca: "José",
      inicio: "2026-08-01",
      fim: "2026-08-31",
      pagamento: "pago",
    },
  ])(
    "baixa 15 linhas e percorre duas páginas com filtro $status e datas ativas",
    async ({ status, busca, inicio, fim, pagamento }) => {
      armazem.set("admin_orders_filter_v2", JSON.stringify(status));
      armazem.set("admin_orders_search_query", JSON.stringify(busca));
      armazem.set(
        "admin_orders_date_range",
        JSON.stringify({ start: inicio, end: fim }),
      );
      armazem.set("admin_orders_payment_filter", JSON.stringify(pagamento));
      await montarTela();
      await act(async () => {
        botao().click();
      });
      expect(textoCsv.split("\r\n").slice(1)).toHaveLength(15);
      expect(textoCsv).toContain("#000015");
      expect(baixar).toHaveBeenCalledTimes(1);
      expect(chamadasExportacao().map(([, args]) => args)).toEqual(
        [0, 1].map((pagina) => ({
          p_page: pagina,
          p_page_size: 100,
          p_status: status,
          p_search: busca,
          p_start_date: inicio,
          p_end_date: fim,
          p_payment_status: pagamento,
        })),
      );
    },
  );

  it("mantém o botão desabilitado enquanto gera e não baixa arquivo se a segunda página falhar", async () => {
    let liberar!: (valor: Resposta) => void;
    exportacao = (args) =>
      args.p_page === 0
        ? Promise.resolve(
            resposta(
              Array.from({ length: 12 }, (_, i) => pedido(i + 1)),
              15,
            ),
          )
        : new Promise((resolve) => {
            liberar = resolve;
          });
    await montarTela();
    await act(async () => {
      botao().click();
      botao().click();
    });
    expect(botao().getAttribute("aria-label")).toBe("Gerando CSV...");
    expect(botao().disabled).toBe(true);
    expect(baixar).not.toHaveBeenCalled();
    expect(chamadasExportacao()).toHaveLength(2);
    await act(async () => {
      liberar({ data: null, error: new Error("RPC indisponível") });
    });
    expect(mocks.erro).toHaveBeenCalledWith(
      "Não foi possível gerar o CSV. Tente de novo.",
    );
    expect(baixar).not.toHaveBeenCalled();
    expect(botao().disabled).toBe(false);
  });

  it("preserva página, total e loading da tela depois de buscar o filtro inteiro", async () => {
    await act(async () => {
      raiz.render(<AlvoHook />);
    });
    await act(async () => {
      await hook.loadOrders(1, 12, "pending");
    });
    const antes = {
      orders: hook.orders,
      total: hook.totalOrders,
      loading: hook.loading,
    };
    await act(async () => {
      const todos = await hook.buscarPedidosDoFiltroParaExportar({
        statusFilter: "pending",
      });
      expect(todos).toHaveLength(15);
      expect(todos[14].customer.name).toBe("Cliente 15");
    });
    expect(hook.orders).toBe(antes.orders);
    expect(hook.totalOrders).toBe(antes.total);
    expect(hook.loading).toBe(antes.loading);
    await act(async () => {
      raiz.render(<AlvoHook key="nova-instancia" />);
    });
    expect(hook.orders).toBe(antes.orders);
    expect(hook.totalOrders).toBe(antes.total);
  });

  it.each([
    {
      nome: "teto de 5000 pedidos",
      corpo: resposta([pedido(1)], 5001),
      mensagem: /5000/,
    },
    {
      nome: "página vazia antes do total",
      corpo: resposta([], 15),
      mensagem: /complet|incomplet/i,
    },
    {
      nome: "erro da RPC",
      corpo: { data: null, error: new Error("RPC indisponível") },
      mensagem: /RPC indisponível/,
    },
  ])(
    "recusa $nome sem produzir resultado parcial",
    async ({ corpo, mensagem }) => {
      exportacao = async () => corpo;
      await act(async () => {
        raiz.render(<AlvoHook />);
      });
      await expect(hook.buscarPedidosDoFiltroParaExportar({})).rejects.toThrow(
        mensagem,
      );
      expect(chamadasExportacao()).toHaveLength(1);
    },
  );

  it("devolve lista vazia quando o filtro não tem pedidos", async () => {
    exportacao = async () => resposta([]);
    await act(async () => {
      raiz.render(<AlvoHook />);
    });
    await expect(hook.buscarPedidosDoFiltroParaExportar({})).resolves.toEqual(
      [],
    );
  });

  it("recusa pedido repetido entre páginas em vez de completar o total com duplicatas", async () => {
    exportacao = async () => resposta([pedido(1)], 2);
    await act(async () => {
      raiz.render(<AlvoHook />);
    });
    await expect(hook.buscarPedidosDoFiltroParaExportar({})).rejects.toThrow(
      /complet/i,
    );
  });

  it("interrompe se o total mudar entre as páginas", async () => {
    exportacao = async (args) =>
      resposta([pedido(Number(args.p_page) + 1)], args.p_page === 0 ? 2 : 3);
    await act(async () => {
      raiz.render(<AlvoHook />);
    });
    await expect(hook.buscarPedidosDoFiltroParaExportar({})).rejects.toThrow(
      /complet/i,
    );
    expect(chamadasExportacao()).toHaveLength(2);
  });

  it("aceita exatamente 5000 pedidos", async () => {
    exportacao = async (args) =>
      resposta(
        Array.from({ length: 100 }, (_, i) =>
          pedido(Number(args.p_page) * 100 + i + 1),
        ),
        5000,
      );
    await act(async () => {
      raiz.render(<AlvoHook />);
    });
    await expect(
      hook.buscarPedidosDoFiltroParaExportar({}),
    ).resolves.toHaveLength(5000);
    expect(chamadasExportacao()).toHaveLength(50);
  });

  it("interrompe após 50 páginas quando a RPC nunca completa a contagem", async () => {
    exportacao = async (args) =>
      resposta([pedido(Number(args.p_page) + 1)], 5000);
    await act(async () => {
      raiz.render(<AlvoHook />);
    });
    await expect(hook.buscarPedidosDoFiltroParaExportar({})).rejects.toThrow(
      /incompleta/i,
    );
    expect(chamadasExportacao()).toHaveLength(50);
  });
});
