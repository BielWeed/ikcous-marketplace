// @vitest-environment jsdom
//
// Auditoria do painel do lojista, achado 14 (20/08/2026) — no extrato do
// cliente, a coluna SITUAÇÃO mostrava "pending" cru, em inglês, enquanto os
// outros status apareciam traduzidos ("Cancelado", "Entregue", "Enviado").
//
// O QUE ESTAVA ERRADO
//   `getStatusBadge` cobre "new", "processing", "shipping", "delivered" e
//   "cancelled" — mas não "pending", que é justamente o status que TODA
//   criação de pedido carimba (`create_marketplace_order_v23`/`v24` gravam
//   'pending' no INSERT). Sem um `case` próprio, cai no `default:`, que
//   imprime o valor cru.
//
// A PALAVRA ESCOLHIDA, E POR QUÊ
//   "Novo Pedido" — não "Pendente". O precedente forte não é o texto solto
//   de um guia de ajuda (que usa "Pendente" só como prosa explicativa e
//   nunca aparece como selo de verdade), e sim `statusConfig.pending.label`
//   em `src/components/admin/orders/OrderStatusBadge.tsx`: o selo que
//   aparece de verdade em TODO card e ficha de pedido do app — inclusive do
//   lado do cliente (`OrderDetailsView.tsx`, `OrderList.tsx`). Usar
//   "Pendente" aqui criaria um segundo nome para o mesmo status.
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
  payment_status?: string | null;
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

describe("AdminUserDetailView — o extrato traduz 'pending', igual aos outros status", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    estado.orders = [
      { id: "cbbd2df9", status: "pending", total: 1 },
      { id: "96c81d5f", status: "cancelled", total: 1 },
      { id: "2e3c99be", status: "delivered", total: 111.6 },
    ];
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

  let TelaFicha: typeof TipoTelaFicha;

  beforeAll(async () => {
    ({ AdminUserDetailView: TelaFicha } = await import(
      "@/views/admin/AdminUserDetailView"
    ));
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

  it("o pedido 'pending' aparece traduzido, não com o valor cru em inglês", async () => {
    await abrirFicha();

    expect(texto()).not.toMatch(/\bpending\b/);
    // A mesma palavra que o selo de pedido usa em todo o resto do app
    // (statusConfig.pending.label, OrderStatusBadge.tsx).
    expect(texto()).toContain("Novo Pedido");
  });

  it("os outros status continuam traduzidos do lado do 'pending' agora corrigido", async () => {
    await abrirFicha();

    expect(texto()).toContain("Cancelado");
    expect(texto()).toContain("Entregue");
  });
});
