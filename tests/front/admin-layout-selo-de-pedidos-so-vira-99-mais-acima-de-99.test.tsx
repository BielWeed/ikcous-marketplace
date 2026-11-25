// @vitest-environment jsdom
//
// O selo de "Pedidos" no menu do painel (lateral do computador e barra de
// baixo do celular) mostra o número de pedidos para preparar e só vira "99+"
// ACIMA de 99. Com exatamente 99 pedidos o número aparece inteiro: esconder o
// 99 atrás de "99+" faria a lojista achar que são "mais de 99".
//
// Os dois selos são desenhados em lugares diferentes do AdminLayout, cada um
// com a sua comparação; o teste confere os dois no mesmo desenho.
import { supabase } from "@/lib/supabase";
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

function criarContagemBuilder(contagem: number) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.or = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  builder.gte = vi.fn(() => builder);
  builder.lte = vi.fn(() => builder);
  builder.not = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  builder.limit = vi.fn(() => builder);
  builder.range = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ count: contagem, data: [], error: null }).then(
      resolve,
      reject,
    );
  return builder;
}

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(() =>
      Promise.resolve({ data: { total_count: 0 }, error: null }),
    ),
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

async function esperarAte(
  condicao: () => boolean,
  { timeoutMs = 3000, passoMs = 20 } = {},
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

describe("AdminLayout: o selo de Pedidos no menu e o teto de 99", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  // Tela pesada: aquece o import uma vez, fora do relógio de cada teste.
  beforeAll(async () => {
    await import("@/components/layouts/AdminLayout");
  }, 60_000);

  beforeEach(() => {
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
    vi.unstubAllGlobals();
  });

  /** Os selos visuais (aria-hidden) de cada botão "Pedidos, N para preparar". */
  async function selosDePedidos(contagem: number): Promise<string[]> {
    vi.mocked(supabase.from).mockImplementation(
      () => criarContagemBuilder(contagem) as never,
    );
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-dashboard" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
    const botoesDePedidos = () =>
      Array.from(hospedeiro.querySelectorAll("button")).filter((botao) =>
        (botao.getAttribute("aria-label") ?? "").startsWith("Pedidos, "),
      );
    await esperarAte(() => botoesDePedidos().length >= 2);
    return botoesDePedidos().map((botao) => {
      const selo = Array.from(
        botao.querySelectorAll('span[aria-hidden="true"]'),
      ).find((s) => /^(\d+|99\+)$/.test(s.textContent ?? ""));
      return selo?.textContent ?? "(sem selo)";
    });
  }

  it("98 pedidos: o número aparece inteiro nos dois menus", async () => {
    expect(await selosDePedidos(98)).toEqual(["98", "98"]);
  });

  it("99 pedidos: ainda é o número, nada de 99+", async () => {
    expect(await selosDePedidos(99)).toEqual(["99", "99"]);
  });

  it("100 pedidos: vira 99+ nos dois menus", async () => {
    expect(await selosDePedidos(100)).toEqual(["99+", "99+"]);
  });

  it("o nome acessível guarda o número inteiro mesmo com o selo em 99+", async () => {
    await selosDePedidos(100);
    const nomes = Array.from(hospedeiro.querySelectorAll("button"))
      .map((botao) => botao.getAttribute("aria-label") ?? "")
      .filter((nome) => nome.startsWith("Pedidos, "));
    expect(nomes).toEqual([
      "Pedidos, 100 para preparar",
      "Pedidos, 100 para preparar",
    ]);
  });
});
