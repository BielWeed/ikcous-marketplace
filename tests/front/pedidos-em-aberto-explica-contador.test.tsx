// @vitest-environment jsdom
import { AdminOrdersView } from "@/views/admin/AdminOrdersView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ pagamentosAConferir: 0, carregar: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: { rpc: vi.fn(), from: vi.fn(), functions: { invoke: vi.fn() } },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {}, isLoaded: true }),
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    loadOrders: h.carregar,
    totalOrders: 0,
    isLoaded: true,
    loading: false,
  }),
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/useNumerosDosPedidos", () => ({
  useNumerosDosPedidos: () => ({
    paraPreparar: 3,
    aguardandoPagamento: 1,
    aCaminho: 1,
    abertosComPagamentoAConferir: h.pagamentosAConferir,
    pedirRecarga: vi.fn(),
  }),
}));

const explicacao =
  "Em Aberto também mostra pedidos aguardando pagamento, a caminho ou prontos para retirada. O número Para preparar não inclui esses pedidos.";
let host: HTMLDivElement;
let raiz: Root;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const armazem = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (chave: string) => armazem.get(chave) ?? null,
    setItem: (chave: string, valor: string) => armazem.set(chave, valor),
    removeItem: (chave: string) => armazem.delete(chave),
  });
  host = document.createElement("div");
  document.body.appendChild(host);
  raiz = createRoot(host);
});

afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it.each([0, 1])(
  "explica só em Em Aberto, com %s pagamento(s) para conferir",
  async (pagamentosAConferir) => {
    h.pagamentosAConferir = pagamentosAConferir;
    await act(async () => {
      raiz.render(<AdminOrdersView onNavigate={vi.fn()} active />);
    });

    expect(host.textContent?.split(explicacao)).toHaveLength(2);
    expect(
      Boolean(host.querySelector('[data-aviso="pagamento-a-conferir"]')),
    ).toBe(pagamentosAConferir > 0);

    const clicar = async (status: string) => {
      const botao = host.querySelector<HTMLButtonElement>(
        `button[aria-label="Status do pedido: ${status}"]`,
      );
      expect(botao).not.toBeNull();
      await act(async () => botao?.click());
    };

    await clicar("Todos");
    expect(host.textContent).not.toContain(explicacao);
    await clicar("Em Aberto");
    expect(host.textContent?.split(explicacao)).toHaveLength(2);
  },
);
