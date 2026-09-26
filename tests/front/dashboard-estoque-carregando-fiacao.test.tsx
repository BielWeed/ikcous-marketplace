// @vitest-environment jsdom
//
// O card "Estoque baixo" + checklist "loja pronta para vender"
// (LojaProntaEEstoqueBaixo) continua no Início do painel. Desde 26/09/2026
// o número vem de `painel_inicio().pendencias.estoque_baixo` (o Início não
// chama mais a RPC de analytics do dashboard antigo, que foi para a Visão
// geral do CRM). A fiação que este teste prende é a mesma de antes:
// "ainda buscando" é "Conferindo estoque…" — nunca o alarme de falha — e
// número em mãos aparece sem carregando.
import { type ComponentProps, act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  receberProps: vi.fn(),
  resolverPainel: null as
    | ((resposta: { data: unknown; error: unknown }) => void)
    | null,
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (nome: string) =>
      nome === "painel_inicio"
        ? new Promise((resolve) => {
            h.resolverPainel = resolve;
          })
        : Promise.resolve({ data: null, error: null }),
    channel: () => {
      const canal: Record<string, unknown> = {
        on: () => canal,
        subscribe: () => canal,
      };
      return canal;
    },
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { originCep: "12345-678", storeName: "Loja" },
    isLoaded: true,
    products: [{ isActive: true }],
    loadingProducts: false,
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ session: { user: { id: "adm-1" } }, profile: null }),
}));
vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("@/hooks/useScrollRestoration", () => ({
  useScrollRestoration: () => ({ ref: { current: null } }),
}));
vi.mock("@/hooks/usePrefetchOnHover", () => ({
  usePrefetchOnHover: () => ({ prefetchView: vi.fn() }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

// Painel, ponte e card são reais; só espiamos as props que chegam ao card.
vi.mock(
  "@/components/admin/dashboard/LojaProntaEEstoqueBaixo",
  async (importOriginal) => {
    const original =
      await importOriginal<
        typeof import("@/components/admin/dashboard/LojaProntaEEstoqueBaixo")
      >();
    return {
      ...original,
      LojaProntaEEstoqueBaixo: (
        props: ComponentProps<typeof original.LojaProntaEEstoqueBaixo>,
      ) => {
        h.receberProps(props);
        return <original.LojaProntaEEstoqueBaixo {...props} />;
      },
    };
  },
);

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function esperarAte(condicao: () => boolean, timeoutMs = 3000) {
  const inicio = Date.now();
  while (!condicao()) {
    if (Date.now() - inicio > timeoutMs) {
      throw new Error(`esperarAte: não aconteceu em ${timeoutMs}ms`);
    }
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
  }
}

describe("Início liga o carregamento do painel ao card de estoque", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    // Cache do Início é de módulo: cada teste parte de um módulo novo.
    vi.resetModules();
    vi.clearAllMocks();
    h.resolverPainel = null;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montarPainel() {
    const { AdminDashboardView } = await import(
      "@/views/admin/AdminDashboardView"
    );
    await act(async () => {
      raiz.render(<AdminDashboardView active={true} onNavigate={vi.fn()} />);
    });
    await esperarAte(() => h.resolverPainel !== null);
  }

  function botaoSincronizar() {
    return Array.from(hospedeiro.querySelectorAll("button")).find((botao) =>
      botao.textContent?.includes("Sincronizar"),
    );
  }

  it("buscando sem número: estoqueCarregando=true e não acusa falha", async () => {
    await montarPainel();

    // Online, botão desabilitado confirma que o estado interno ainda carrega.
    expect(botaoSincronizar()?.disabled).toBe(true);
    expect(h.receberProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ stats: null, estoqueCarregando: true }),
    );
    expect(hospedeiro.textContent).toMatch(/conferindo estoque/i);
    expect(hospedeiro.textContent).not.toMatch(/não foi possível conferir/i);
    expect(hospedeiro.textContent).not.toMatch(/tentar de novo/i);
  });

  it("número em mãos: estoqueCarregando=false e o número do painel aparece", async () => {
    await montarPainel();
    await act(async () => {
      h.resolverPainel?.({
        data: { pendencias: { estoque_baixo: 3 } },
        error: null,
      });
    });
    await esperarAte(() =>
      (hospedeiro.textContent ?? "").includes("Estoque baixo: 3 produtos"),
    );

    expect(h.receberProps).toHaveBeenLastCalledWith(
      expect.objectContaining({
        stats: { inventoryAlerts: 3 },
        estoqueCarregando: false,
      }),
    );
    expect(hospedeiro.textContent).not.toMatch(/conferindo estoque/i);
    expect(hospedeiro.textContent).not.toMatch(/não foi possível conferir/i);
    expect(botaoSincronizar()?.disabled).toBe(false);
  });
});
