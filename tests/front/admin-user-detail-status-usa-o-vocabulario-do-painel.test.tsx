// @vitest-environment jsdom
//
// Achado b16 (caça de 03/11/2026) — a ficha do cliente dizia "Processando",
// "Enviado" e "Entregue" enquanto a lista de Pedidos do mesmo painel diz "Em
// Separação", "Em Trânsito" e "Finalizado", e um pedido de RETIRADA na loja
// pronto aparecia como "Enviado". A ficha passa a usar `rotuloDoStatus`
// (OrderStatusBadge.tsx), com a retirada. Valor desconhecido segue cru.
import type { AdminUserDetailView as TipoTelaFicha } from "@/views/admin/AdminUserDetailView";
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

type PedidoFalso = {
  id: string;
  status: string;
  total: number;
  customer_data?: Record<string, unknown>;
};

const { estado } = vi.hoisted(() => ({
  estado: { orders: [] as PedidoFalso[] },
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: true, user: { id: "admin-1" } }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () =>
      Promise.resolve({
        data: {
          profile: {
            id: "cliente-1",
            full_name: "Cliente de Prova",
            role: "customer",
            created_at: "2026-02-07T00:00:00Z",
            email: "prova@exemplo.com",
            whatsapp: "34999999999",
          },
          orders: estado.orders.map((o) => ({
            ...o,
            created_at: "2026-08-18T00:00:00Z",
            items: [],
          })),
          cart_items: [],
          addresses: [],
        },
        error: null,
      }),
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: [], error: null }),
      }),
      delete: () => ({ eq: () => Promise.resolve({ error: null }) }),
    }),
  },
}));

vi.mock("@/hooks/useOnlineStatus", () => ({ useOnlineStatus: () => false }));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function esperar(ms = 0): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("AdminUserDetailView — o extrato fala como a lista de Pedidos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let TelaFicha: typeof TipoTelaFicha;

  beforeAll(async () => {
    ({ AdminUserDetailView: TelaFicha } = await import(
      "@/views/admin/AdminUserDetailView"
    ));
  });

  beforeEach(() => {
    vi.clearAllMocks();
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
  });

  async function abrirFicha() {
    const AdminUserDetailView = TelaFicha;
    await act(async () => {
      raiz.render(
        <AdminUserDetailView
          userId="cliente-1"
          onBack={vi.fn()}
          onNavigate={vi.fn()}
        />,
      );
    });
    await act(async () => {
      await esperar(50);
    });
  }

  const texto = () => (hospedeiro.textContent ?? "").replace(/\s+/g, " ");

  it("usa 'Em Separação', 'Pronto para retirar' e 'Em Trânsito', não 'Processando' nem 'Enviado'", async () => {
    estado.orders = [
      { id: "aaaa1111", status: "processing", total: 1 },
      {
        id: "bbbb2222",
        status: "shipping",
        total: 1,
        customer_data: { pickup_address: "Rua da Loja, 10" },
      },
      { id: "cccc3333", status: "shipping", total: 1 },
    ];
    await abrirFicha();

    expect(texto()).toContain("Em Separação");
    expect(texto()).toContain("Pronto para retirar");
    expect(texto()).toContain("Em Trânsito");
    expect(texto()).not.toContain("Processando");
    expect(texto()).not.toContain("Enviado");
  });

  it("pedido entregue lê 'Finalizado' e valor desconhecido continua cru", async () => {
    estado.orders = [
      { id: "dddd4444", status: "delivered", total: 1 },
      { id: "eeee5555", status: "returned", total: 1 },
    ];
    await abrirFicha();

    expect(texto()).toContain("Finalizado");
    expect(texto()).not.toContain("Entregue");
    expect(texto()).toContain("returned");
  });
});
