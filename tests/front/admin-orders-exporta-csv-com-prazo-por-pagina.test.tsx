// @vitest-environment jsdom
//
// Exportar CSV de pedidos lia o filtro de 100 em 100 sem prazo: com a internet
// "pendurada" (conecta e não responde) a RPC nunca voltava e o botão ficava em
// "Gerando CSV..." para sempre. Agora cada página tem prazo de 20 s
// (`aguardarComPrazo`); estourou, a exportação para com um erro de conexão
// lenta (nenhum arquivo parcial) e o botão se solta.
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
import { ehConsultaSemResposta } from "@/lib/prazo-da-requisicao";
import { AdminOrdersView } from "@/views/admin/AdminOrdersView";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MENSAGEM_LENTA = "A conexão está lenta. Tente exportar de novo.";

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
function pedido(numero: number) {
  return {
    id: `pedido-${String(numero).padStart(6, "0")}`,
    customer_name: `Cliente ${numero}`,
    customer_data: { whatsapp: "11999999999" },
    items: [],
    total: 100,
    status: "pending",
    payment_status: "aguardando",
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
const nuncaResponde = () => new Promise<Resposta>(() => {});
const responde = (atrasoMs: number, corpo: Resposta) =>
  new Promise<Resposta>((resolve) =>
    setTimeout(() => resolve(corpo), atrasoMs),
  );

let hook: ReturnType<typeof useOrders>;
function AlvoHook() {
  const atual = useOrders(true, true);
  useEffect(() => {
    hook = atual;
  });
  return null;
}

describe("CSV de pedidos: prazo por página da exportação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let exportacao: (args: Argumentos) => Promise<Resposta>;
  let baixar: ReturnType<typeof vi.spyOn>;

  function chamadasExportacao() {
    return mocks.rpc.mock.calls.filter(
      ([nome, args]) =>
        nome === "get_admin_orders_paged" && args.p_page_size === 100,
    );
  }

  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.erro.mockClear();
    vi.stubGlobal("ResizeObserver", ObserverStub);
    vi.stubGlobal("IntersectionObserver", ObserverStub);
    vi.stubGlobal("matchMedia", () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
      addListener() {},
      removeListener() {},
    }));
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
    exportacao = async () => resposta([]);
    mocks.rpc.mockImplementation((nome: string, args: Argumentos) => {
      if (nome !== "get_admin_orders_paged" || args.p_page_size === 200)
        return consulta(Promise.resolve(resposta([])));
      if (args.p_page_size === 100) return consulta(exportacao(args));
      // A lista da tela (12 por página): 15 no filtro, para o botão ligar.
      return consulta(
        Promise.resolve(
          resposta(
            Array.from({ length: 12 }, (_, i) => pedido(i + 1)),
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
    vi.useRealTimers();
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function montarHook() {
    await act(async () => {
      raiz.render(<AlvoHook />);
    });
  }

  it("página que nunca responde: rejeita só aos 20 s, com erro de conexão lenta", async () => {
    await montarHook();
    exportacao = nuncaResponde;
    vi.useFakeTimers();

    let resultado: unknown = "pendente";
    const promessa = hook.buscarPedidosDoFiltroParaExportar({}).then(
      (v) => {
        resultado = v;
      },
      (e) => {
        resultado = e;
      },
    );

    await vi.advanceTimersByTimeAsync(19_999);
    expect(resultado).toBe("pendente");

    await vi.advanceTimersByTimeAsync(1);
    await promessa;
    expect(ehConsultaSemResposta(resultado)).toBe(true);
    expect((resultado as Error).message).toBe(MENSAGEM_LENTA);
    expect(chamadasExportacao()).toHaveLength(1);
  });

  it("a segunda página trava: nada de resultado parcial e o laço para ali", async () => {
    await montarHook();
    exportacao = (args) =>
      args.p_page === 0
        ? Promise.resolve(
            resposta(
              Array.from({ length: 12 }, (_, i) => pedido(i + 1)),
              15,
            ),
          )
        : nuncaResponde();
    vi.useFakeTimers();

    const rejeitou = expect(
      hook.buscarPedidosDoFiltroParaExportar({}),
    ).rejects.toMatchObject({ code: "CONSULTA_SEM_RESPOSTA" });
    await vi.advanceTimersByTimeAsync(20_000);
    await rejeitou;
    expect(chamadasExportacao()).toHaveLength(2);
  });

  it("o prazo é POR PÁGINA: duas páginas de 15 s cada (30 s no total) ainda exportam", async () => {
    await montarHook();
    exportacao = (args) =>
      responde(
        15_000,
        args.p_page === 0
          ? resposta(
              Array.from({ length: 12 }, (_, i) => pedido(i + 1)),
              15,
            )
          : resposta(
              Array.from({ length: 3 }, (_, i) => pedido(i + 13)),
              15,
            ),
      );
    vi.useFakeTimers();

    const pronto = hook.buscarPedidosDoFiltroParaExportar({});
    await vi.advanceTimersByTimeAsync(30_000);
    await expect(pronto).resolves.toHaveLength(15);
    expect(chamadasExportacao()).toHaveLength(2);
  });

  it("página lenta mas dentro do prazo (19 s) ainda responde", async () => {
    await montarHook();
    exportacao = () => responde(19_000, resposta([pedido(1)]));
    vi.useFakeTimers();

    const pronto = hook.buscarPedidosDoFiltroParaExportar({});
    await vi.advanceTimersByTimeAsync(19_000);
    await expect(pronto).resolves.toHaveLength(1);
  });

  it("na tela: a RPC trava, o botão se solta, nada é baixado e a lojista lê a frase da conexão lenta", async () => {
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    const botao = () =>
      Array.from(document.body.querySelectorAll("button")).find((item) =>
        /Exportar CSV|Gerando CSV/.test(item.getAttribute("aria-label") || ""),
      );
    await act(async () => {
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Filtros e ferramentas"]',
        )!
        .click();
    });
    const limite = Date.now() + 5000;
    for (;;) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const pronto = botao();
      if (
        (pronto &&
          /Exportar CSV/.test(pronto.getAttribute("aria-label") || "") &&
          !(pronto as HTMLButtonElement).disabled) ||
        Date.now() > limite
      )
        break;
    }
    exportacao = nuncaResponde;
    vi.useFakeTimers();

    await act(async () => {
      botao()!.click();
    });
    expect(botao()!.getAttribute("aria-label")).toBe("Gerando CSV...");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });

    expect(mocks.erro).toHaveBeenCalledWith(MENSAGEM_LENTA);
    expect(baixar).not.toHaveBeenCalled();
    expect(botao()!.getAttribute("aria-label")).toMatch(/Exportar CSV/);
    expect((botao() as HTMLButtonElement).disabled).toBe(false);
  });
});
