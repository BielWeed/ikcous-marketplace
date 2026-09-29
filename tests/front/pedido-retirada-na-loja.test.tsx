// @vitest-environment jsdom
//
// RETIRADA NA LOJA NO PEDIDO (release 1.5.3, 22/09/2026).
//
// O único marcador persistido é o retrato `customer_data.pickup_address`
// que a RPC v23/v24 grava SÓ para `store-pickup` (migration
// 20261169000000). O que se prova:
//   1. o mapper deriva `retiradaNaLoja`/`enderecoDeRetirada` desse retrato
//      (aparado); pedido de entrega continua sem os campos ligados;
//   2. a ficha do lojista mostra "Retirada na loja" + o endereço, e o
//      endereço da cliente passa a se chamar "Endereço do cliente";
//   3. o recibo impresso traz "RETIRADA NA LOJA:" com o endereço;
//   4. o detalhe do pedido da cliente mostra "Retire em: …" e o aviso
//      neutro — nenhum prazo inventado — e o endereço dela como "Seu
//      endereço". Pedido de entrega: nada disso aparece (controle).
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const ENDERECO_FICTICIO = "Rua Fictícia de Teste, 100 — Centro";

const { estado } = vi.hoisted(() => ({
  estado: { pedido: null as unknown as Order },
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [estado.pedido],
    fetchUserOrders: vi.fn().mockResolvedValue([estado.pedido]),
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/components/ui/alert-dialog", () => {
  const Passa = ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  );
  return {
    AlertDialog: ({
      open,
      children,
    }: { open: boolean; children: ReactNode }) =>
      open ? <div>{children}</div> : null,
    AlertDialogContent: Passa,
    AlertDialogHeader: Passa,
    AlertDialogFooter: Passa,
    AlertDialogTitle: Passa,
    AlertDialogDescription: Passa,
    AlertDialogAction: Passa,
    AlertDialogCancel: Passa,
  };
});

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function linhaDoBanco(customerData: Record<string, unknown>) {
  return {
    id: "pedido-retirada",
    user_id: "user-1",
    customer_name: "Cliente Teste",
    customer_data: customerData,
    total: 120,
    subtotal: 120,
    shipping: 0,
    discount: 0,
    payment_method: "cash",
    payment_status: null,
    status: "pending",
    notes: null,
    coupon_code: null,
    tracking_code: null,
    canal: "online",
    vendedor_id: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    items: [],
  };
}

const ENDERECO_DA_CLIENTE = {
  street: "Rua da Cliente",
  number: "7",
  neighborhood: "Bairro Teste",
  city: "Cidade Teste",
  state: "MG",
  cep: "38500-000",
};

async function mapear(customerData: Record<string, unknown>): Promise<Order> {
  const { mapOrderFromDB } = await import("@/lib/mappers");
  return mapOrderFromDB(linhaDoBanco(customerData) as never);
}

describe("mapOrderFromDB — a retirada vem do retrato customer_data.pickup_address", () => {
  it("com retrato: retiradaNaLoja true e endereço aparado", async () => {
    const pedido = await mapear({
      address: ENDERECO_DA_CLIENTE,
      pickup_address: `  ${ENDERECO_FICTICIO}  `,
    });
    expect(pedido.retiradaNaLoja).toBe(true);
    expect(pedido.enderecoDeRetirada).toBe(ENDERECO_FICTICIO);
    // O endereço da cliente continua sendo o dela.
    expect(pedido.customer.address).toBe("Rua da Cliente");
  });

  it("sem retrato, vazio ou não-texto: é entrega (controle)", async () => {
    for (const extra of [
      {},
      { pickup_address: "   " },
      { pickup_address: 5 },
    ]) {
      const pedido = await mapear({ address: ENDERECO_DA_CLIENTE, ...extra });
      expect(pedido.retiradaNaLoja).toBe(false);
      expect(pedido.enderecoDeRetirada).toBeNull();
    }
  });
});

describe("telas do pedido — retirada na loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function pedidoDeRetirada(): Promise<Order> {
    return mapear({
      address: ENDERECO_DA_CLIENTE,
      pickup_address: ENDERECO_FICTICIO,
    });
  }

  it("ficha do lojista: 'Retirada na loja' + endereço, e 'Endereço do cliente'", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const pedido = await pedidoDeRetirada();
    await act(async () => {
      raiz.render(<OrderDetail order={pedido} onStatusChange={vi.fn()} />);
    });
    const bloco = hospedeiro.querySelector('[aria-label="Retirada na loja"]');
    expect(bloco?.textContent).toContain(ENDERECO_FICTICIO);
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Endereço do cliente");
    expect(texto).not.toContain("Endereço de Entrega");
  });

  it("ficha do lojista, pedido de ENTREGA: nada de retirada (controle)", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    const pedido = await mapear({ address: ENDERECO_DA_CLIENTE });
    await act(async () => {
      raiz.render(<OrderDetail order={pedido} onStatusChange={vi.fn()} />);
    });
    expect(
      hospedeiro.querySelector('[aria-label="Retirada na loja"]'),
    ).toBeNull();
    expect(hospedeiro.textContent).toContain("Endereço de Entrega");
  });

  it("recibo impresso: 'RETIRADA NA LOJA:' com o endereço", async () => {
    const { OrderReceipt } = await import(
      "@/components/admin/orders/OrderReceipt"
    );
    const pedido = await pedidoDeRetirada();
    await act(async () => {
      raiz.render(<OrderReceipt order={pedido} storeName="Loja Teste" />);
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("RETIRADA NA LOJA:");
    expect(texto).toContain(ENDERECO_FICTICIO);
  });

  it("detalhe da cliente: 'Retire em: …', aviso neutro, 'Seu endereço' — sem prazo", async () => {
    estado.pedido = await pedidoDeRetirada();
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-retirada"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain(`Retire em: ${ENDERECO_FICTICIO}`);
    expect(texto).toContain("Aguarde a confirmação da loja para retirar.");
    expect(texto).toContain("Seu endereço");
    expect(texto).not.toMatch(/dia útil|dias úteis/);
  });

  it("detalhe da cliente, pedido de ENTREGA: 'Endereço de entrega' e nada de retirada (controle)", async () => {
    estado.pedido = await mapear({ address: ENDERECO_DA_CLIENTE });
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-retirada"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    const texto = hospedeiro.textContent ?? "";
    // Redesenho, rodada 2 (revisor Opus, 25/09/2026): "Endereço de Entrega"
    // (Title Case) virou "Endereço de entrega" (frase normal) — mesmo
    // comportamento provado (pedido de entrega não mostra nada de
    // retirada), só a caixa do texto mudou.
    expect(texto).toContain("Endereço de entrega");
    expect(texto).not.toContain("Retire em:");
  });
});
