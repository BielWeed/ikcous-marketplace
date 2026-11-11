// @vitest-environment jsdom
//
// O convidado que achou o pedido por e-mail + código (retrato em sessionStorage
// `guest_tracked_orders`) NÃO vê "Cancelar Pedido": `update_order_status_atomic`
// recusa chamador sem `auth.uid()`, então o botão falharia sempre — e a caixa
// "Cancelar este pedido?" ainda diria uma frase sobre devolução de dinheiro.
// A guarda é o `Boolean(user) &&` de `podeCancelarPedido`. Os vizinhos de
// cancelamento fixam `useAuth` com um usuário; os de convidado não tocam em
// "Cancelar", então apagar a guarda deixava a suíte verde.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const { fetchUserOrders, estado } = vi.hoisted(() => ({
  fetchUserOrders: vi.fn(),
  estado: {
    user: null as { id: string } | null,
    loading: false,
  },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
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
vi.mock("@/hooks/useOrders", () => ({
  ErroCancelamentoNaoConcluido: class extends Error {},
  useOrders: () => ({
    orders: [],
    ordersLoadError: null,
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
    reenviarComprovante: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, loading: estado.loading }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, storeAddress: "Rua A, 10" },
  }),
}));

const ID = "pedido-do-convidado";
const pedidoComStatus = (status: Order["status"]): Order => ({
  id: ID,
  customer: { name: "Cliente", whatsapp: "34999999999" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status,
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T11:00:00Z",
  cancelledAfterShipping: false,
});

function armazem() {
  const dados = new Map<string, string>();
  return {
    getItem: (c: string) => dados.get(c) ?? null,
    setItem: (c: string, v: string) => {
      dados.set(c, String(v));
    },
    removeItem: (c: string) => {
      dados.delete(c);
    },
    clear: () => dados.clear(),
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

function guardarRetratoDoConvidado(status: Order["status"]) {
  sessionStorage.setItem(
    "guest_tracked_orders",
    JSON.stringify({
      consultadoEm: Date.now(),
      pedidos: [pedidoComStatus(status)],
    }),
  );
}

async function abrir() {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView orderId={ID} onBack={vi.fn()} onNavigate={vi.fn()} />,
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const texto = () => hospedeiro.textContent ?? "";
const botao = (nome: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === nome,
  );
// A caixa de confirmação sai num portal, fora do hospedeiro.
const caixaDeCancelar = () =>
  document.body.textContent?.includes("Cancelar este pedido?") ?? false;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("sessionStorage", armazem());
  vi.stubGlobal("localStorage", armazem());
  vi.clearAllMocks();
  estado.user = null;
  estado.loading = false;
  fetchUserOrders.mockResolvedValue([]);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("ficha do pedido do convidado — sem 'Cancelar Pedido'", () => {
  it.each(["pending", "processing", "shipping"] as const)(
    "convidado (sem conta) com pedido pago '%s' no retrato: a ficha abre, mas não há botão nem caixa de cancelar",
    async (status) => {
      guardarRetratoDoConvidado(status);

      await abrir();

      // A ficha abriu mesmo (não é "sem pedido"): sem isso a ausência do botão
      // não provaria nada.
      expect(texto()).not.toContain("Pedido não encontrado");
      expect(texto()).not.toContain("Entre na conta para ver este pedido");
      expect(texto()).toContain("Meu pedido");
      expect(botao("Cancelar Pedido")).toBeUndefined();
      expect(texto()).not.toContain("Cancelar Pedido");
      expect(caixaDeCancelar()).toBe(false);
    },
  );

  it.each(["pending", "processing", "shipping"] as const)(
    "controle '%s': com conta aberta, o MESMO retrato mostra 'Cancelar Pedido' e o toque abre a caixa",
    async (status) => {
      estado.user = { id: "u-1" };
      guardarRetratoDoConvidado(status);

      await abrir();

      const cancelar = botao("Cancelar Pedido");
      expect(cancelar).toBeDefined();
      expect(caixaDeCancelar()).toBe(false);

      await act(async () => {
        cancelar?.click();
      });
      expect(caixaDeCancelar()).toBe(true);
    },
  );

  it("controle de borda: com conta aberta, pedido ENTREGUE não mostra 'Cancelar Pedido' (é devolução)", async () => {
    estado.user = { id: "u-1" };
    guardarRetratoDoConvidado("delivered");

    await abrir();

    expect(texto()).toContain("Meu pedido");
    expect(botao("Cancelar Pedido")).toBeUndefined();
  });
});
