// @vitest-environment jsdom
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const { fetchUserOrders } = vi.hoisted(() => ({
  fetchUserOrders: vi.fn(),
}));
const pedidos: Order[] = [];
const usuario = { id: "cliente-teste" };
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ orders: pedidos, fetchUserOrders }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false } }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: [], error: null }),
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

import { OrderDetailsView } from "@/views/customer/OrderDetailsView";

function pedido(id: string, nome: string): Order {
  return {
    id,
    customer: { name: "Cliente fictício", whatsapp: "" },
    items: [
      {
        id: `item-${id}`,
        productId: "",
        name: nome,
        quantity: 1,
        price: 10,
        image: "",
      },
    ],
    subtotal: 10,
    shipping: 0,
    discount: 0,
    total: 10,
    paymentMethod: "pix",
    paymentStatus: "aguardando",
    status: "pending",
    createdAt: "2026-11-18T10:00:00Z",
    updatedAt: "2026-11-18T10:00:00Z",
    cancelledAfterShipping: false,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  localStorage.clear();
  sessionStorage.clear();
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  localStorage.clear();
  sessionStorage.clear();
  vi.unstubAllGlobals();
});

async function abrir(orderId: string) {
  await act(async () => {
    // Sem key aqui: exercita a defesa da ficha independentemente da remontagem no App.
    raiz.render(
      <OrderDetailsView
        orderId={orderId}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
  });
}

it("a consulta tardia de A não troca a ficha de B pelo pedido A", async () => {
  const a = pedido("pedido-a", "Produto do pedido A");
  const b = pedido("pedido-b", "Produto do pedido B");
  let terminarA!: (valor: Order[]) => void;
  fetchUserOrders
    .mockImplementationOnce(
      () =>
        new Promise<Order[]>((resolve) => {
          terminarA = resolve;
        }),
    )
    .mockResolvedValueOnce([a, b]);
  await abrir(a.id);
  expect(fetchUserOrders).toHaveBeenCalledTimes(1);
  await abrir(b.id);
  expect(fetchUserOrders).toHaveBeenCalledTimes(2);
  expect(hospedeiro.textContent).toContain("Produto do pedido B");

  // A cancelada pode aguardar a substituta e receber a mesma lista [A, B].
  await act(async () => terminarA([a, b]));
  expect(hospedeiro.textContent).toContain("Produto do pedido B");
  expect(hospedeiro.textContent).not.toContain("Produto do pedido A");
});
