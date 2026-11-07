// @vitest-environment jsdom
// Integra a CartView com o useOrders real: a recarga por visibilidade cancela
// a primeira espera. O retorno [] do cancelamento não é uma lista concluída.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const rede = vi.hoisted(() => ({ consultas: [] as ((valor: any) => void)[] }));
const user = { id: "cliente-recarga" };
const conta = { user: user as { id: string } | null };
const config = { shippingFee: 10, freeShippingMin: 0 };
const cart = {
  cart: [],
  shippingFee: 0,
  updateQuantity: vi.fn(),
  removeFromCart: vi.fn(),
  selectedShippingOption: null,
  setSelectedShippingOption: vi.fn(),
  setShippingCep: vi.fn(),
};
const produtos = () => [];
vi.mock("@/contexts/StoreContext", () => ({ useStore: () => ({ config }) }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: conta.user, isAdmin: false }),
}));
vi.mock("@/hooks/useProducts", () => ({
  useProducts: () => ({ getFreeShippingEligibleProducts: produtos }),
}));
vi.mock("@/hooks/useCart", () => ({ useCart: () => cart }));
vi.mock("@/hooks/useAddresses", () => ({
  useAddresses: () => ({
    addresses: [],
    loading: false,
    fetchAddresses: vi.fn(),
  }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useDeferredRender", () => ({ useDeferredRender: () => true }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const query: any = {
        select: () => query,
        eq: () => query,
        order: () => query,
        abortSignal: () =>
          new Promise((resolve) => rede.consultas.push(resolve)),
      };
      return query;
    },
    channel: () => {
      const canal: any = { on: () => canal, subscribe: () => canal };
      return canal;
    },
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/components/ui/custom/OrderSearch", () => ({
  OrderSearch: () => null,
}));
vi.mock("@/components/ui/custom/EmptyCart", () => ({ EmptyCart: () => null }));
// @ts-expect-error flag interna do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
beforeEach(() => {
  conta.user = user;
  rede.consultas = [];
  const memoria = new Map<string, string>();
  const storage = {
    getItem: (k: string) => memoria.get(k) ?? null,
    setItem: (k: string, v: string) => void memoria.set(k, v),
    removeItem: (k: string) => void memoria.delete(k),
  };
  vi.stubGlobal("localStorage", storage);
  vi.stubGlobal("sessionStorage", storage);
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
it("convidado vê o rastreio salvo mesmo sem consultar pedidos da conta", async () => {
  conta.user = null;
  sessionStorage.setItem(
    "guest_tracked_orders",
    JSON.stringify({
      consultadoEm: Date.now(),
      pedidos: [
        {
          id: "pedido-rastreado",
          status: "pending",
          total: 10,
          paymentMethod: "pix",
          createdAt: new Date().toISOString(),
          customer: { name: "Cliente de teste" },
          items: [
            {
              productId: "produto-teste",
              name: "Produto do rastreio",
              price: 10,
              quantity: 1,
              image: "",
            },
          ],
        },
      ],
    }),
  );
  const { CartView } = await import("@/views/customer/CartView");
  await act(async () => {
    root.render(<CartView initialTab="orders" onNavigate={() => {}} />);
  });
  expect(host.textContent).toContain("Produto do rastreio");
  expect(host.textContent).toContain("Em andamento (1)");
  expect(rede.consultas).toHaveLength(0);
});

it.each(["vazia", "falha"] as const)(
  "não diz Nenhum pedido entre o aborto e a resposta sucessora (%s)",
  async (desfecho) => {
    const { CartView } = await import("@/views/customer/CartView");
    await act(async () => {
      root.render(<CartView initialTab="orders" onNavigate={() => {}} />);
    });
    expect(rede.consultas).toHaveLength(1);
    expect(host.textContent).not.toContain("Nenhum pedido");
    // O timer do hook é de 500ms, real para não alterar a ordem dos efeitos.
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 550));
    });
    expect(rede.consultas).toHaveLength(2);
    expect(host.textContent).not.toContain("Nenhum pedido");
    expect(host.textContent).not.toContain("Que tal começar a comprar");
    await act(async () => {
      rede.consultas[1]({
        data: desfecho === "vazia" ? [] : null,
        error: desfecho === "falha" ? { message: "sem rede" } : null,
      });
    });
    expect(host.textContent).toContain(
      desfecho === "vazia"
        ? "Nenhum pedido"
        : "Não conseguimos carregar seus pedidos",
    );
    // Libera também a rede da consulta cuja espera foi cancelada.
    await act(async () => {
      rede.consultas[0]({ data: [], error: null });
    });
  },
);
