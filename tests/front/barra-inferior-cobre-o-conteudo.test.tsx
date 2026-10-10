// @vitest-environment jsdom
//
// A BARRA INFERIOR DO CELULAR COBRE O CONTEÚDO — painel simples, onda J (J7).
// O `motion.nav` levava `admin-glass` junto de `bg-zinc-950/95`. A `.admin-glass`
// (src/index.css, @layer utilities) sai DEPOIS de `.bg-zinc-950/95` no CSS final
// e vencia o fundo e a borda: a barra ficava translúcida e o conteúdo aparecia
// por baixo dos rótulos.
//
// O CONTRATO (este arquivo):
//   1. O <nav> fixo do celular NÃO tem `admin-glass` e mantém o fundo
//      `bg-zinc-950/95`, a borda e o blur explícitos.
//   2. O selo de número da aba Pedidos sobe de 8px para 11px (`text-[11px]`,
//      `h-5 min-w-5`).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PEDIDOS_PARA_PREPARAR = 3;

function criarContagemBuilder() {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.in = vi.fn(() => builder);
  builder.or = vi.fn(() => builder);
  builder.is = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: mock do query builder thenable do Supabase
  builder.then = (resolve: any, reject?: any) =>
    Promise.resolve({ count: PEDIDOS_PARA_PREPARAR, error: null }).then(
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
    from: vi.fn(() => criarContagemBuilder()),
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

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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

describe("AdminLayout — a barra inferior do celular cobre o conteúdo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

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

  async function montar() {
    const { AdminLayout } = await import("@/components/layouts/AdminLayout");
    await act(async () => {
      raiz.render(
        <AdminLayout currentView="admin-dashboard" onNavigate={vi.fn()}>
          <div />
        </AdminLayout>,
      );
    });
    // A barra móvel é o único <nav> fixo; a da lateral é uma coluna comum.
    const nav = hospedeiro.querySelector("nav.fixed") as HTMLElement | null;
    expect(nav).toBeTruthy();
    return nav!;
  }

  it("o nav móvel não tem `admin-glass` e mantém fundo, borda e blur explícitos", async () => {
    const nav = await montar();
    const classes = nav.className.split(/\s+/);
    expect(classes).not.toContain("admin-glass");
    expect(classes).toContain("bg-zinc-950/95");
    expect(classes).toContain("border-white/15");
    expect(classes).toContain("backdrop-blur-2xl");
  });

  it("o selo de número da aba Pedidos tem 11px", async () => {
    const nav = await montar();
    const botaoPedidos = () =>
      Array.from(nav.querySelectorAll("button")).find((b) =>
        (b.getAttribute("aria-label") ?? "").startsWith("Pedidos"),
      ) as HTMLButtonElement | undefined;
    await esperarAte(() =>
      (botaoPedidos()?.getAttribute("aria-label") ?? "").includes(
        String(PEDIDOS_PARA_PREPARAR),
      ),
    );
    const selo = Array.from(botaoPedidos()!.querySelectorAll("span")).find(
      (s) => s.textContent?.trim() === String(PEDIDOS_PARA_PREPARAR),
    );
    expect(selo).toBeTruthy();
    const classes = selo!.className.split(/\s+/);
    expect(classes).toContain("text-[11px]");
    expect(classes).not.toContain("text-[8px]");
    expect(classes).toContain("h-5");
    expect(classes).toContain("min-w-5");
  });
});
