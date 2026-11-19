// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  info: vi.fn(),
  erro: vi.fn(),
}));
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
  useAuth: () => ({ user: { id: "admin-teste" }, isAdmin: true }),
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
  toast: { error: mocks.erro, info: mocks.info, success: vi.fn() },
}));

import { AdminOrdersView } from "@/views/admin/AdminOrdersView";

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
let raiz: Root;
let hospedeiro: HTMLDivElement;
let baixar: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  const armazem = new Map<string, string>();
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
  mocks.rpc.mockImplementation(
    (nome: string, args: Record<string, string | number>) => {
      const pedidos =
        nome === "get_admin_orders_paged" && args.p_page_size === 12
          ? [
              {
                id: "pedido-000001",
                customer_name: "Cliente fictícia",
                customer_data: { whatsapp: "11999999999" },
                items: [],
                total: 100,
                status: "pending",
                payment_status: "aguardando",
                payment_method: "pix",
                created_at: "2026-09-01T12:00:00.000Z",
                updated_at: "2026-09-01T12:00:00.000Z",
              },
            ]
          : [];
      const resultado = Promise.resolve({
        data: { data: pedidos, total_count: pedidos.length },
        error: null,
      });
      return Object.assign(resultado, { abortSignal: () => resultado });
    },
  );
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("avisa sem baixar CSV quando a contagem antiga permite exportar um filtro vazio", async () => {
  await act(async () => {
    raiz.render(<AdminOrdersView onNavigate={vi.fn()} active={true} />);
  });
  await act(async () => {
    hospedeiro
      .querySelector<HTMLButtonElement>(
        'button[aria-label="Filtros e ferramentas"]',
      )!
      .click();
  });
  let botao: HTMLButtonElement | undefined;
  const limite = Date.now() + 5000;
  while (!botao && Date.now() < limite) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 20));
    });
    botao = Array.from(document.body.querySelectorAll("button")).find(
      (item) =>
        item.getAttribute("aria-label") === "Exportar CSV (1 no filtro)" &&
        !item.disabled,
    );
  }
  expect(botao).toBeDefined();
  // A listagem ainda tem um pedido; a consulta independente do CSV retorna zero.
  await act(async () => botao!.click());
  expect(
    mocks.rpc.mock.calls.some(
      ([nome, args]) =>
        nome === "get_admin_orders_paged" && args.p_page_size === 100,
    ),
  ).toBe(true);
  expect(baixar).not.toHaveBeenCalled();
  expect(URL.createObjectURL).not.toHaveBeenCalled();
  expect(mocks.info).toHaveBeenCalledWith(
    "Nenhum pedido neste filtro para exportar.",
  );
  expect(mocks.erro).not.toHaveBeenCalled();
  expect(botao!.disabled).toBe(false);
});
