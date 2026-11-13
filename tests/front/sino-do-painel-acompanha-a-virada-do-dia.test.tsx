// @vitest-environment jsdom
//
// Defeito: o corte dos "recebimentos por marcar" do sino (a janela do prazo de
// devolução, medida em dias de calendário de São Paulo) avança à meia-noite,
// mas a bolinha só era recontada por evento do banco ou por volta de foco. Com
// o painel aberto de 23h59 a 00h01, o pedido que acabou de sair da janela
// seguia contado até a lojista trocar de aba. Agora a virada do dia pede a
// recontagem (o mesmo `admin:recontar-avisos` que a lista de Notificações e o
// sino já ouvem, com a mesma espera de agrupamento).
// Relógio falso cruzando a meia-noite de São Paulo (UTC−3: 03:00Z).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ANTES_DA_MEIA_NOITE = "2026-11-13T02:59:50Z"; // 12/11, 23:59:50 em SP
const PEDIDOS_PARA_PREPARAR = 4;

let cortesDoSino: string[] = [];
let rodadasDoSino = 0;

function criarBuilder(tabela: string) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.or = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  // Só a consulta de recebimentos por marcar usa `updated_at`: o corte da
  // janela de devolução é o que a virada do dia move.
  builder.gte = vi.fn((coluna: string, valor: string) => {
    if (coluna === "updated_at") cortesDoSino.push(valor);
    return builder;
  });
  builder.maybeSingle = vi.fn(() => Promise.resolve({ data: null }));
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) => {
    if (tabela === "pedidos_de_privacidade") rodadasDoSino += 1;
    return Promise.resolve({
      count: tabela === "marketplace_orders" ? PEDIDOS_PARA_PREPARAR : 0,
      error: null,
    }).then(resolve, reject);
  };
  return builder;
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => criarBuilder(tabela)),
    rpc: vi.fn((nome: string) => {
      const data =
        nome === "admin_devolucoes_listar"
          ? { total: 0, itens: [], contagem: { solicitada: 0 } }
          : { total_count: 0 };
      return Promise.resolve({ data, error: null });
    }),
    channel: vi.fn(() => ({
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(),
    })),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    fetchExecutiveSummary: vi.fn(),
    fetchCategoryAnalytics: vi.fn(),
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ loadOrders: vi.fn() }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ loadProducts: vi.fn() }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function avancar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("AdminLayout — o sino acompanha a virada do dia", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    cortesDoSino = [];
    rodadasDoSino = 0;
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date(ANTES_DA_MEIA_NOITE));
    vi.stubGlobal(
      "BroadcastChannel",
      class {
        postMessage() {}
        close() {}
        addEventListener() {}
        removeEventListener() {}
      },
    );
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: false,
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    Reflect.deleteProperty(document, "visibilityState");
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function montar() {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-orders" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
    await avancar(200);
  }

  it("com o painel aberto na virada do dia, o sino reconta e o corte da janela avança", async () => {
    await montar();
    expect(rodadasDoSino).toBe(1);
    expect(cortesDoSino).toHaveLength(1);

    // O temporizador da meia-noite dispara aos ~11 s; a recontagem espera o
    // agrupamento de 1 s do sino.
    await avancar(12_000);
    await avancar(1_500);

    expect(rodadasDoSino).toBe(2);
    expect(cortesDoSino).toHaveLength(2);
    expect(cortesDoSino[1]).not.toBe(cortesDoSino[0]);
  });

  it("o evento de recontagem sai uma vez só na virada (a lista de avisos ouve o mesmo)", async () => {
    const recontar = vi.fn<() => void>();
    window.addEventListener("admin:recontar-avisos", recontar);
    try {
      await montar();
      await avancar(12_000);
      await avancar(1_500);
      expect(recontar).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener("admin:recontar-avisos", recontar);
    }
  });

  it("controle: sem virada de dia, o tempo passando não reconta o sino", async () => {
    await montar();
    await avancar(5_000);
    expect(rodadasDoSino).toBe(1);
    expect(cortesDoSino).toHaveLength(1);
  });

  it("aba escondida na virada não bate na rede (a volta ao foco reconta)", async () => {
    await montar();
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      value: "hidden",
    });
    await avancar(12_000);
    await avancar(1_500);
    expect(rodadasDoSino).toBe(1);
  });
});
