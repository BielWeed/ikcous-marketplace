// @vitest-environment jsdom
//
// LOTE 210 (r210-d) — no painel, a retirada na loja não lê "entrega" quando o
// assunto é o dinheiro. Pedido que paga na hora de BUSCAR dizia "Cartão na
// entrega", "Recebido na entrega", "Falta receber na entrega" e "Pedido de
// pagamento na entrega" — ninguém entrega nada numa retirada. Só o TEXTO muda;
// o valor gravado (`recebido_na_entrega`, `payment_method`) e as regras de
// dinheiro são os mesmos. A entrega (e o balcão) seguem iguais em cada caso.
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import { rotuloDoPagamento } from "@/components/admin/orders/OrderStatusBadge";
import { rotuloDaFormaDoPedido } from "@/lib/forma-de-pagamento";
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import type { Order } from "@/types";
import type { ReactNode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [],
    fetchUserOrders: vi.fn().mockResolvedValue([]),
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
    AlertDialogTrigger: Passa,
    AlertDialogContent: Passa,
    AlertDialogHeader: Passa,
    AlertDialogFooter: Passa,
    AlertDialogTitle: Passa,
    AlertDialogDescription: Passa,
    AlertDialogAction: Passa,
    AlertDialogCancel: Passa,
  };
});

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

class ObservadorStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeEach(() => {
  vi.stubGlobal("ResizeObserver", ObservadorStub);
  vi.stubGlobal("IntersectionObserver", ObservadorStub);
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function pedido(sobre: Partial<Order>): Order {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000eca2d5",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [
      { productId: "p1", name: "Maleta", price: 99.9, quantity: 1, image: "" },
    ],
    subtotal: 99.9,
    shipping: 0,
    discount: 0,
    total: 99.9,
    paymentMethod: "cash",
    status: "shipping",
    paymentStatus: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: null,
    ...sobre,
  } as Order;
}

const RETIRADA = {
  retiradaNaLoja: true,
  enderecoDeRetirada: "Rua da Loja, 1",
} as const;

describe("rótulos puros — a retirada não diz 'entrega' no dinheiro", () => {
  it("cartão: 'na retirada' na retirada, 'na entrega' na entrega, 'na maquininha' no balcão", () => {
    expect(
      rotuloDaFormaDoPedido({ paymentMethod: "card", retiradaNaLoja: true }),
    ).toBe("Cartão na retirada");
    expect(
      rotuloDaFormaDoPedido({ paymentMethod: "card", retiradaNaLoja: false }),
    ).toBe("Cartão na entrega");
    expect(rotuloDaFormaDoPedido({ paymentMethod: "card" })).toBe(
      "Cartão na entrega",
    );
    expect(
      rotuloDaFormaDoPedido({ paymentMethod: "card", canal: "presencial" }),
    ).toBe("Cartão na maquininha");
  });

  it("selo do pagamento: 'Recebido na retirada' só na retirada; o balcão ganha da retirada", () => {
    expect(
      rotuloDoPagamento(
        "recebido_na_entrega",
        "delivered",
        undefined,
        false,
        true,
      ),
    ).toBe("Recebido na retirada");
    expect(rotuloDoPagamento("recebido_na_entrega", "delivered")).toBe(
      "Recebido na entrega",
    );
    expect(
      rotuloDoPagamento(
        "recebido_na_entrega",
        "delivered",
        "presencial",
        false,
        true,
      ),
    ).toBe("Recebido no balcão");
  });

  it("planilha: a coluna do pagamento também lê 'Recebido na retirada'", () => {
    const csv = pedidosParaCsv([
      pedido({
        ...RETIRADA,
        paymentStatus: "recebido_na_entrega",
        status: "delivered",
      }),
    ]);
    expect(csv).toContain("Recebido na retirada");
    expect(csv).not.toContain("na entrega");
  });
});

describe("AdminOrderCard — retirada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  function montarCard(sobre: Partial<Order>) {
    act(() => {
      raiz.render(
        <AdminOrderCard
          order={pedido(sobre)}
          viewMode="compact"
          onSelect={vi.fn()}
          onWhatsApp={vi.fn()}
          onStatusChange={vi.fn()}
          onRegistrarPagamento={vi.fn()}
          onReceberAntesDeAvancar={vi.fn()}
          registrandoPagamento={false}
        />,
      );
    });
  }

  it("a forma e o selo do dinheiro dizem 'na retirada'", () => {
    montarCard({
      ...RETIRADA,
      paymentMethod: "card",
      paymentStatus: "recebido_na_entrega",
      pagamentoRecebidoEm: new Date().toISOString(),
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Cartão na retirada");
    expect(texto).toContain("Recebido na retirada");
    expect(texto).not.toContain("na entrega");
  });

  it("controle: o mesmo pedido de entrega continua dizendo 'na entrega'", () => {
    montarCard({
      paymentMethod: "card",
      paymentStatus: "recebido_na_entrega",
      pagamentoRecebidoEm: new Date().toISOString(),
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Cartão na entrega");
    expect(texto).toContain("Recebido na entrega");
  });

  async function abrirPerguntaDeRecebimentoNoCard(sobre: Partial<Order>) {
    montarCard(sobre);
    const menu = hospedeiro.querySelector<HTMLButtonElement>(
      'button[aria-label^="Ações do pedido"]',
    );
    expect(menu, "menu de ações do card").not.toBeNull();
    await act(async () => {
      menu!.click();
    });
    const avancar = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Avançar →"),
    );
    expect(avancar, "ação Avançar no menu").toBeDefined();
    await act(async () => {
      avancar!.click();
    });
    return document.body.textContent ?? "";
  }

  it("a pergunta de recebimento fala em 'retirada' (controle: 'entrega')", async () => {
    const retirada = await abrirPerguntaDeRecebimentoNoCard({ ...RETIRADA });
    expect(retirada).toContain("Pedido de pagamento na retirada.");
    expect(retirada).not.toContain("Pedido de pagamento na entrega.");
  });

  it("controle: sem retirada a pergunta continua falando em 'entrega'", async () => {
    const entrega = await abrirPerguntaDeRecebimentoNoCard({});
    expect(entrega).toContain("Pedido de pagamento na entrega.");
  });

  async function marcarComoRecebidoNoCard(sobre: Partial<Order>) {
    montarCard(sobre);
    const marcar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Marcar como recebido"),
    );
    expect(marcar, "botão Marcar como recebido do card").toBeDefined();
    await act(async () => {
      marcar!.click();
    });
    return document.body.textContent ?? "";
  }

  it("'Marcar como recebido' no card pergunta 'na retirada' (controle: 'na entrega')", async () => {
    const retirada = await marcarComoRecebidoNoCard({ ...RETIRADA });
    expect(retirada).toContain("Recebeu os R$");
    expect(retirada).toContain("Pedido de pagamento na retirada.");
    expect(retirada).not.toContain("Pedido de pagamento na entrega.");

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    const entrega = await marcarComoRecebidoNoCard({});
    expect(entrega).toContain("Pedido de pagamento na entrega.");
  });
});

describe("OrderDetail (ficha) — retirada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function montarFicha(sobre: Partial<Order>) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={pedido(sobre)}
          onStatusChange={vi.fn()}
          onRegistrarPagamento={vi.fn()}
        />,
      );
    });
  }

  it("a frase do dinheiro: 'Falta receber na retirada' e, recebido, 'Recebido na retirada'", async () => {
    await montarFicha({ ...RETIRADA });
    expect(hospedeiro.textContent).toContain("Falta receber na retirada");
    expect(hospedeiro.textContent).not.toContain("Falta receber na entrega");

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montarFicha({
      ...RETIRADA,
      paymentStatus: "recebido_na_entrega",
      pagamentoRecebidoEm: new Date().toISOString(),
    });
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Recebido na retirada · R$");
    expect(texto).not.toContain("Recebido na entrega");
    // O selo mora ao lado da frase e também lê "retirada" (e continua verde).
    const verde = hospedeiro.querySelector(
      "[data-testid='bloco-dinheiro'] p.text-emerald-400",
    );
    expect(verde?.textContent).toContain("Recebido na retirada");
  });

  it("controle: a entrega continua 'Falta receber na entrega' e 'Recebido na entrega'", async () => {
    await montarFicha({});
    expect(hospedeiro.textContent).toContain("Falta receber na entrega");
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    await montarFicha({
      paymentStatus: "recebido_na_entrega",
      pagamentoRecebidoEm: new Date().toISOString(),
    });
    expect(hospedeiro.textContent).toContain("Recebido na entrega · R$");
  });

  async function avancarNaFicha(sobre: Partial<Order>) {
    await montarFicha(sobre);
    const avancar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Avançar →"),
    );
    expect(avancar, "botão Avançar da ficha").toBeDefined();
    await act(async () => {
      avancar!.click();
    });
    return hospedeiro.textContent ?? "";
  }

  async function marcarComoRecebidoNaFicha(sobre: Partial<Order>) {
    await montarFicha(sobre);
    const marcar = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Marcar como recebido"),
    );
    expect(marcar, "botão Marcar como recebido da ficha").toBeDefined();
    await act(async () => {
      marcar!.click();
    });
    return document.body.textContent ?? "";
  }

  it("'Marcar como recebido' na ficha pergunta 'na retirada' (controle: 'na entrega')", async () => {
    const retirada = await marcarComoRecebidoNaFicha({ ...RETIRADA });
    expect(retirada).toContain("Recebeu os R$");
    expect(retirada).toContain("Pedido de pagamento na retirada.");
    expect(retirada).not.toContain("Pedido de pagamento na entrega.");

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    const entrega = await marcarComoRecebidoNaFicha({});
    expect(entrega).toContain("Pedido de pagamento na entrega.");
  });

  it("a pergunta 'Recebeu os R$…?' fala em 'retirada' (controle: 'entrega')", async () => {
    const retirada = await avancarNaFicha({ ...RETIRADA });
    expect(retirada).toContain("Recebeu os R$");
    expect(retirada).toContain("Pedido de pagamento na retirada.");
    expect(retirada).not.toContain("Pedido de pagamento na entrega.");

    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);
    const entrega = await avancarNaFicha({});
    expect(entrega).toContain("Pedido de pagamento na entrega.");
  });
});
