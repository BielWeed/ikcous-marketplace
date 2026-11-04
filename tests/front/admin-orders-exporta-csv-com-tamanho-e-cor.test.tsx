// @vitest-environment jsdom
// A tela real: ao exportar, a planilha busca o tamanho/cor das peças pelos
// variantId dos itens; se essa busca falhar, avisa e NÃO baixa uma planilha
// sem tamanho/cor (quem separa o pedido por ela ficaria sem a informação).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  from: vi.fn(),
  em: vi.fn(),
  erro: vi.fn(),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: mocks.rpc,
    from: mocks.from,
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

import { AdminOrdersView } from "@/views/admin/AdminOrdersView";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

function pedido(numero: number, variantId: string) {
  return {
    id: `pedido-${String(numero).padStart(6, "0")}`,
    customer_name: `Cliente ${numero}`,
    customer_data: { whatsapp: "11999999999" },
    items: [
      {
        product_id: "produto-1",
        variant_id: variantId,
        product_name: "Camiseta Básica",
        quantity: 1,
        price: 49.9,
      },
    ],
    total: 49.9,
    status: "pending",
    payment_status: "aguardando",
    payment_method: "pix",
    created_at: "2026-09-01T12:00:00.000Z",
    updated_at: "2026-09-01T12:00:00.000Z",
  };
}
function consulta<T>(resultado: Promise<T>) {
  return Object.assign(resultado, { abortSignal: () => resultado });
}

describe("CSV de pedidos com tamanho e cor", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let armazem: Map<string, string>;
  let textoCsv: string;
  let baixar: ReturnType<typeof vi.spyOn>;
  let variacoes: (
    ids: string[],
  ) => Promise<{ data: unknown; error: Error | null }>;
  let pedidosDoBanco: ReturnType<typeof pedido>[];

  function botao() {
    const encontrado = Array.from(
      document.body.querySelectorAll("button"),
    ).find((item) =>
      /Exportar CSV|Gerando CSV/.test(item.getAttribute("aria-label") || ""),
    );
    expect(encontrado).toBeDefined();
    return encontrado!;
  }
  async function montarTela() {
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
    });
    await act(async () =>
      hospedeiro
        .querySelector<HTMLButtonElement>(
          'button[aria-label="Filtros e ferramentas"]',
        )!
        .click(),
    );
    const limite = Date.now() + 5000;
    for (;;) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const pronto = Array.from(document.body.querySelectorAll("button")).find(
        (item) =>
          /Exportar CSV/.test(item.getAttribute("aria-label") || "") &&
          !item.disabled,
      );
      if (pronto || Date.now() > limite) break;
    }
  }

  beforeEach(() => {
    mocks.rpc.mockReset();
    mocks.from.mockReset();
    mocks.em.mockReset();
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
    pedidosDoBanco = [pedido(1, "var-m"), pedido(2, "var-gg")];
    variacoes = async (ids) => ({
      data: ids.map((id) => ({
        id,
        name: "Tamanho",
        value: id === "var-m" ? "M" : "GG",
      })),
      error: null,
    });
    mocks.rpc.mockImplementation((nome: string, args: Record<string, number>) =>
      consulta(
        Promise.resolve({
          data:
            nome === "get_admin_orders_paged" && args.p_page_size !== 200
              ? { data: pedidosDoBanco, total_count: pedidosDoBanco.length }
              : { data: [], total_count: 0 },
          error: null,
        }),
      ),
    );
    mocks.from.mockImplementation((tabela: string) => ({
      select: () => ({
        in: (_coluna: string, ids: string[]) => {
          // A tela lê outras tabelas por conta própria; só interessa a
          // consulta dos rótulos.
          if (tabela !== "product_variants")
            return Promise.resolve({ data: [], error: null });
          mocks.em(tabela, ids);
          return Promise.resolve(variacoes(ids));
        },
      }),
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
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("a coluna Itens diz o tamanho de cada peça, lido pelos variantId dos itens", async () => {
    await montarTela();
    await act(async () => {
      botao().click();
    });
    expect(mocks.em).toHaveBeenCalledTimes(1);
    expect(mocks.em).toHaveBeenCalledWith(
      "product_variants",
      expect.arrayContaining(["var-m", "var-gg"]),
    );
    expect(baixar).toHaveBeenCalledTimes(1);
    expect(textoCsv).toContain("Camiseta Básica - Tamanho M (1 x 49,90)");
    expect(textoCsv).toContain("Camiseta Básica - Tamanho GG (1 x 49,90)");
  });

  it("repete o mesmo variantId uma vez só e faz consultas de no máximo 100", async () => {
    pedidosDoBanco = Array.from({ length: 250 }, (_, i) =>
      pedido(i + 1, `var-${i % 230}`),
    );
    await montarTela();
    await act(async () => {
      botao().click();
    });
    const lotes = mocks.em.mock.calls.map(([, ids]) => ids as string[]);
    expect(lotes).toHaveLength(3);
    expect(Math.max(...lotes.map((l) => l.length))).toBeLessThanOrEqual(100);
    expect(new Set(lotes.flat()).size).toBe(230);
    expect(lotes.flat()).toHaveLength(230);
  });

  it("se a busca do tamanho falhar, avisa a lojista e não baixa planilha sem tamanho", async () => {
    variacoes = async () => ({ data: null, error: new Error("sem rede") });
    await montarTela();
    await act(async () => {
      botao().click();
    });
    expect(baixar).not.toHaveBeenCalled();
    expect(mocks.erro).toHaveBeenCalledTimes(1);
    expect(mocks.erro.mock.calls[0][0]).toMatch(/tamanho e a cor/);
    expect(botao().disabled).toBe(false);
  });
});
