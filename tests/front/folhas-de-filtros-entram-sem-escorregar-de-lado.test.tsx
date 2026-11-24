// @vitest-environment jsdom
//
// As folhas "Filtros" do painel (a de Pedidos e a da barra de busca) são
// centradas com `left-1/2 -translate-x-1/2`. O keyframe de entrada do
// tailwindcss-animate parte de translate3d(0,0,0) e DESCARTA esse translate:
// sem a compensação `slide-in-from-left-1/2` a folha entrava escorregando de
// lado (e saía igual). A folha "Ações do pedido" já foi consertada assim; aqui
// as duas de Filtros ganham o mesmo contrato. O CSS gerado por essas classes é
// provado em folhas-do-painel-animacao-gera-css.test.ts (Tailwind real).
import { BarraDeBusca } from "@/components/admin/BarraDeBusca";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const pedidos: Order[] = [];

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn(), rpc: vi.fn() },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: pedidos,
    totalOrders: 0,
    isLoaded: true,
    loading: false,
    loadOrders: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/useNumerosDosPedidos", () => ({
  useNumerosDosPedidos: () => ({ pedirRecarga: vi.fn() }),
}));
vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));
vi.mock("@/hooks/useEstornosEmCursoDosPedidos", () => ({
  useEstornosEmCursoDosPedidos: () => ({ porPedido: {}, recarregar: vi.fn() }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  globalThis.localStorage.clear();
  hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  globalThis.localStorage.clear();
});

const janela = () =>
  document.querySelector<HTMLElement>('[role="dialog"]')?.className ?? "";

// A compensação do `-translate-x-1/2` (entrada e saída) e, a partir de `sm:`
// onde a folha vira janela no meio (`-translate-y-1/2`), a do eixo vertical.
const COMPENSACAO = [
  "data-[state=open]:slide-in-from-left-1/2",
  "data-[state=closed]:slide-out-to-left-1/2",
  "sm:data-[state=open]:slide-in-from-top-1/2",
  "sm:data-[state=closed]:slide-out-to-top-1/2",
];

describe("folhas de Filtros do painel: a animação não escorrega de lado", () => {
  it("Filtros de Pedidos compensa o -translate-x-1/2 na entrada e na saída", async () => {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(<AdminOrdersView active onNavigate={vi.fn()} />);
    });
    const abrir = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Filtros e ferramentas"]',
    );
    if (!abrir) throw new Error("botão de filtros não montou");
    await act(async () => abrir.click());

    const classes = janela().split(/\s+/);
    expect(classes).toContain("-translate-x-1/2");
    for (const classe of COMPENSACAO) expect(classes).toContain(classe);
  });

  it("Filtros da barra de busca compensa o -translate-x-1/2 na entrada e na saída", async () => {
    await act(async () => {
      raiz.render(
        <BarraDeBusca
          id="busca-teste"
          rotulo="Buscar produtos"
          placeholder="Buscar produto, código…"
          value=""
          onChange={vi.fn()}
          modo="compact"
          onMudarModo={vi.fn()}
          grupo="Categorias dos produtos"
          tituloFiltro="Categoria"
          filtrosAtivos={0}
          opcoes={[
            {
              valor: "all",
              rotulo: "Todas as categorias",
              selecionada: true,
              onClick: vi.fn(),
            },
          ]}
        />,
      );
    });
    const abrir = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label="Filtros"]',
    );
    if (!abrir) throw new Error("botão de filtros não montou");
    await act(async () => abrir.click());

    const classes = janela().split(/\s+/);
    expect(classes).toContain("-translate-x-1/2");
    for (const classe of COMPENSACAO) expect(classes).toContain(classe);
  });
});
