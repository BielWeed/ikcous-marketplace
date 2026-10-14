// @vitest-environment jsdom
//
// RETIRADA NA LOJA: "Em Trânsito" vira "Pronto para retirar" (14/10/2026).
//
// Defeito medido: o painel tem um único caminho Novo → Separação → Em
// Trânsito → Finalizado. Para dizer "pode vir buscar" numa retirada, a
// lojista apertava "Avançar → Em Trânsito", e a cliente lia "Chegando até
// você" / "saiu para entrega" ao lado do quadro "Aguarde a confirmação da
// loja para retirar". SÓ TEXTO: a regra de status é a mesma (o valor gravado
// continua `shipping`). Pedido de ENTREGA fica idêntico (controle).
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, OrderStatus } from "@/types";

// `usuario` estável: um objeto novo a cada render reativaria o efeito de
// avaliações do pedido entregue em laço.
const { estado, usuario } = vi.hoisted(() => ({
  estado: { pedido: null as unknown as Order },
  usuario: { id: "user-1" },
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [estado.pedido],
    fetchUserOrders: vi.fn().mockResolvedValue([estado.pedido]),
    updateOrderStatus: vi.fn(),
  }),
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

const ENDERECO_DA_LOJA = "Rua Fictícia de Teste, 100 — Centro";
const PRONTO = "Pronto para retirar";
const FRASE_DA_CLIENTE = "Seu pedido está pronto! Venha retirar na loja.";

async function pedido(status: OrderStatus, retirada: boolean): Promise<Order> {
  const { mapOrderFromDB } = await import("@/lib/mappers");
  const customerData: Record<string, unknown> = {
    address: {
      street: "Rua da Cliente",
      number: "7",
      neighborhood: "Bairro Teste",
      city: "Cidade Teste",
      state: "MG",
      cep: "38500-000",
    },
  };
  if (retirada) customerData.pickup_address = ENDERECO_DA_LOJA;
  return mapOrderFromDB({
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
    status,
    notes: null,
    coupon_code: null,
    tracking_code: null,
    canal: "online",
    vendedor_id: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    items: [],
  } as never);
}

describe("retirada na loja — 'Pronto para retirar' no lugar de 'Em Trânsito'", () => {
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

  async function painel(p: Order): Promise<string> {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={p} onStatusChange={vi.fn()} />);
    });
    return hospedeiro.textContent ?? "";
  }

  async function telaDaCliente(p: Order): Promise<string> {
    estado.pedido = p;
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
    return hospedeiro.textContent ?? "";
  }

  function botaoAvancar(): string {
    const botoes = Array.from(hospedeiro.querySelectorAll("button"));
    return (
      botoes.find((b) => (b.textContent ?? "").includes("Avançar"))
        ?.textContent ?? ""
    );
  }

  describe("painel da lojista", () => {
    it("retirada em separação: o botão diz 'Avançar → Pronto para retirar'", async () => {
      await painel(await pedido("processing", true));
      expect(botaoAvancar()).toBe(`Avançar → ${PRONTO}`);
    });

    it("entrega em separação: o botão continua 'Avançar → Em Trânsito' (controle)", async () => {
      await painel(await pedido("processing", false));
      expect(botaoAvancar()).toBe("Avançar → Em Trânsito");
    });

    it("retirada pronta: a etapa da trilha diz 'Pronto para retirar', sem 'Trânsito'", async () => {
      const texto = await painel(await pedido("shipping", true));
      const etapas = hospedeiro.querySelector(
        '[aria-label="Etapas do pedido"]',
      );
      expect(etapas?.textContent).toContain(PRONTO);
      expect(texto).not.toMatch(/Tr[âa]nsito/);
    });

    it("entrega a caminho: a etapa da trilha continua 'Trânsito' (controle)", async () => {
      const texto = await painel(await pedido("shipping", false));
      const etapas = hospedeiro.querySelector(
        '[aria-label="Etapas do pedido"]',
      );
      expect(etapas?.textContent).toContain("Trânsito");
      expect(texto).not.toContain(PRONTO);
    });

    it("selo do cartão da lista: retirada em 'shipping' diz 'Pronto para retirar'; entrega, 'Em Trânsito'", async () => {
      const { OrderStatusBadge } = await import(
        "@/components/admin/orders/OrderStatusBadge"
      );
      await act(async () => {
        raiz.render(
          <OrderStatusBadge status="shipping" retiradaNaLoja={true} />,
        );
      });
      expect(hospedeiro.textContent).toBe(PRONTO);
      await act(async () => {
        raiz.render(<OrderStatusBadge status="shipping" />);
      });
      expect(hospedeiro.textContent).toBe("Em Trânsito");
      await act(async () => {
        raiz.render(
          <OrderStatusBadge status="processing" retiradaNaLoja={true} />,
        );
      });
      expect(hospedeiro.textContent).toBe("Em Separação");
    });
  });

  describe("tela da cliente", () => {
    it("retirada pronta: título, cartão e linha do tempo falam de retirar; nada de entrega", async () => {
      const texto = await telaDaCliente(await pedido("shipping", true));
      expect(texto).toContain(PRONTO);
      expect(texto).toContain(FRASE_DA_CLIENTE);
      expect(texto).not.toContain("Chegando até você");
      expect(texto).not.toContain("saiu para entrega");
      expect(texto).not.toContain("A caminho");
      // O quadro da retirada não pode mandar esperar uma loja que já avisou.
      expect(texto).toContain(`Retire em: ${ENDERECO_DA_LOJA}`);
      expect(texto).not.toContain("Aguarde a confirmação da loja");
    });

    it("entrega a caminho: textos de sempre (controle)", async () => {
      const texto = await telaDaCliente(await pedido("shipping", false));
      expect(texto).toContain("Chegando até você");
      expect(texto).toContain("Seu pedido já saiu para entrega");
      expect(texto).toContain("A caminho");
      expect(texto).not.toContain(PRONTO);
    });

    it("retirada em separação: textos de sempre, com o aviso de espera", async () => {
      const texto = await telaDaCliente(await pedido("processing", true));
      expect(texto).toContain("Em separação");
      expect(texto).toContain("Aguarde a confirmação da loja para retirar.");
      expect(texto).not.toContain(PRONTO);
      expect(texto).not.toContain(FRASE_DA_CLIENTE);
    });

    it("retirada entregue: textos de sempre, sem a frase de 'pronto'", async () => {
      const texto = await telaDaCliente(await pedido("delivered", true));
      expect(texto).toContain("Chegou!");
      expect(texto).not.toContain(FRASE_DA_CLIENTE);
      expect(texto).not.toContain(PRONTO);
    });
  });
});
