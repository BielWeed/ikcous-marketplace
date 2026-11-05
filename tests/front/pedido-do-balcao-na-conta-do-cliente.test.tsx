// @vitest-environment jsdom
//
// Compra do balcão (canal "presencial") vinculada à conta da cliente aparece
// em "Meus pedidos". Ela nasce entregue, sem frete e sem endereço, então a
// tela de entrega mentia: linha do tempo de envio, "Frete: Grátis", "Endereço
// de entrega", "Chegou!" e "foi entregue com sucesso". E, se a loja anula a
// venda, a tela afirmava "o dinheiro foi devolvido" sem o app ter devolvido
// nada (a devolução é combinada com a loja).
//
// Pedido online (controle): os textos de sempre, sem mudar uma vírgula.
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, PaymentStatus } from "@/types";

// Referências estáveis: objeto novo a cada render refaz os efeitos da ficha.
const { estado, usuario, hookDePedidos } = vi.hoisted(() => {
  const estado = { pedido: null as unknown as Order };
  const hookDePedidos = {
    orders: [] as Order[],
    fetchUserOrders: async () => [estado.pedido],
    updateOrderStatus: () => {},
  };
  return { estado, usuario: { id: "user-1" }, hookDePedidos };
});

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => hookDePedidos,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
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
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: vi.fn().mockResolvedValue(true),
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

const pedidoBase: Order = {
  id: "11111111-2222-3333-4444-555555555555",
  customer: {
    name: "Cliente Teste",
    whatsapp: "34999999999",
    address: "Rua da Cliente",
    number: "7",
    neighborhood: "Bairro Teste",
    city: "Cidade Teste",
    state: "MG",
    cep: "38500-000",
  },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "https://exemplo.test/foto.jpg",
    },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "pix",
  paymentStatus: "pago",
  status: "delivered",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
  canal: "online",
};

const doBalcao = (extra: Partial<Order> = {}): Order => ({
  ...pedidoBase,
  canal: "presencial",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  ...extra,
});

const estornado = {
  status: "cancelled",
  paymentStatus: "estornado" as PaymentStatus,
} as const;

describe("pedido do balcão na conta da cliente", () => {
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

  async function detalhe(pedido: Order): Promise<string> {
    estado.pedido = pedido;
    hookDePedidos.orders = [pedido];
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={pedido.id}
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
    return hospedeiro.textContent ?? "";
  }

  async function lista(pedido: Order): Promise<string> {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(<OrderList orders={[pedido]} onNavigate={() => {}} />);
    });
    return hospedeiro.textContent ?? "";
  }

  describe("ficha do pedido", () => {
    it("balcão entregue: 'Compra na loja', sem envio, sem frete, sem endereço de entrega", async () => {
      const texto = await detalhe(doBalcao());
      expect(texto).toContain("Compra na loja");
      expect(texto).toContain("Compra concluída no balcão");
      expect(texto).not.toContain("Chegou!");
      expect(texto).not.toContain("entregue com sucesso");
      expect(texto).not.toContain("Frete");
      expect(texto).not.toContain("Grátis");
      expect(texto).not.toContain("Endereço de entrega");
      expect(texto).not.toContain("A caminho");
      expect(texto).not.toContain("Separado");
      expect(texto).not.toContain("Recebido");
    });

    it("pedido online entregue (controle): tudo como sempre", async () => {
      const texto = await detalhe(pedidoBase);
      expect(texto).toContain("Chegou!");
      expect(texto).toContain("O pedido foi entregue com sucesso");
      expect(texto).toContain("Frete");
      expect(texto).toContain("Grátis");
      expect(texto).toContain("Endereço de entrega");
      expect(texto).toContain("A caminho");
      expect(texto).toContain("Separado");
      expect(texto).not.toContain("Compra na loja");
    });

    it("balcão anulado e estornado: não afirma que o dinheiro foi devolvido", async () => {
      const texto = await detalhe(doBalcao(estornado));
      expect(texto).toContain("anulada pela loja");
      expect(texto).toContain("combinada diretamente com a loja");
      expect(texto).not.toContain("o dinheiro foi devolvido");
    });

    it("online cancelado e estornado (controle): a frase de sempre", async () => {
      const texto = await detalhe({ ...pedidoBase, ...estornado });
      expect(texto).toContain(
        "Este pedido foi cancelado e o seu pagamento foi estornado: o dinheiro foi devolvido.",
      );
    });
  });

  describe("lista Meus pedidos", () => {
    it("balcão entregue: 'Compra na loja' em vez de 'Pedido entregue'", async () => {
      const texto = await lista(doBalcao());
      expect(texto).toContain("Compra na loja");
      expect(texto).not.toContain("Pedido entregue");
    });

    it("online entregue (controle): 'Pedido entregue'", async () => {
      const texto = await lista(pedidoBase);
      expect(texto).toContain("Pedido entregue");
      expect(texto).not.toContain("Compra na loja");
    });

    it("balcão anulado e estornado: não diz que o dinheiro foi devolvido", async () => {
      const texto = await lista(doBalcao(estornado));
      expect(texto).toContain("combinada com a loja");
      expect(texto).not.toContain("foi devolvido");
    });

    it("online cancelado e estornado (controle): 'foi devolvido' como antes", async () => {
      const texto = await lista({ ...pedidoBase, ...estornado });
      expect(texto).toContain("O dinheiro deste pedido foi devolvido.");
    });
  });
});
