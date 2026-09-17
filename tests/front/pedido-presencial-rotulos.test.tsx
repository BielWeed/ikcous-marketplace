// @vitest-environment jsdom
//
// C4.2 — D1 do dono em código: o banco NÃO ganhou um oitavo `payment_status`.
// A venda de balcão grava o MESMO `recebido_na_entrega` de sempre; quem
// muda é o RÓTULO, e o rótulo passa a ser função de payment_status × canal.
// Este arquivo trava as três frentes que o rótulo alimenta: o selo do
// lojista (OrderStatusBadge), a frase da ficha (OrderDetail) e a cor da
// seção Pagamento (que não pode pintar a venda de balcão paga de âmbar).
//
// Molde de montagem do componente: painel-avisa-pedido-pago-e-cancelado.test.tsx
// (createRoot + act, sem supabase real). Molde da ficha inteira:
// ficha-do-pedido-mesa-do-lojista.test.tsx (mesmos mocks de @/lib/supabase e
// @/components/ui/alert-dialog — OrderDetail.tsx importa supabase no topo).
import type { Order, PaymentStatus } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/components/ui/alert-dialog", () => ({
  AlertDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: ReactNode;
  }) => (open ? <div>{children}</div> : null),
  AlertDialogContent: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogHeader: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogFooter: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogTitle: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogDescription: ({ children }: { children: ReactNode }) => (
    <div>{children}</div>
  ),
  AlertDialogAction: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  AlertDialogCancel: ({
    children,
    onClick,
  }: {
    children: ReactNode;
    onClick?: () => void;
  }) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Os 8 valores de PaymentStatusKey (7 de PaymentStatus + null → sem_cobranca)
// que `rotuloDoPagamento`/`paymentStatusConfig` cobrem hoje.
const TODOS_OS_PAYMENT_STATUS: (PaymentStatus | null)[] = [
  "aguardando",
  "pago",
  "recusado",
  "expirado",
  "estornado",
  "pago_apos_expirar",
  "recebido_na_entrega",
  null,
];

describe("rotuloDoPagamento — terceiro parâmetro `canal` (D1, lote C4)", () => {
  it("matriz payment_status × canal: SÓ recebido_na_entrega + presencial muda de rótulo", async () => {
    const { rotuloDoPagamento } = await import(
      "@/components/admin/orders/OrderStatusBadge"
    );

    for (const status of TODOS_OS_PAYMENT_STATUS) {
      const rotuloOnline = rotuloDoPagamento(status, "delivered", "online");
      const rotuloPresencial = rotuloDoPagamento(
        status,
        "delivered",
        "presencial",
      );
      const rotuloSemCanal = rotuloDoPagamento(status, "delivered");

      // Sem canal, o comportamento é idêntico ao de canal "online" — é a
      // prova de compatibilidade com todo chamador que não sabe de canal.
      expect(rotuloSemCanal).toBe(rotuloOnline);

      if (status === "recebido_na_entrega") {
        expect(rotuloOnline).toBe("Recebido na entrega");
        expect(rotuloPresencial).toBe("Recebido no balcão");
      } else {
        // Nenhum outro valor muda com o canal.
        expect(rotuloPresencial).toBe(rotuloOnline);
      }
    }
  });

  it("precedência: presencial + cancelled continua 'Pago e cancelado — precisa de atenção' — o cruzamento de atenção vence o canal", async () => {
    const { rotuloDoPagamento } = await import(
      "@/components/admin/orders/OrderStatusBadge"
    );

    expect(
      rotuloDoPagamento("recebido_na_entrega", "cancelled", "presencial"),
    ).toBe("Pago e cancelado — precisa de atenção");
    expect(rotuloDoPagamento("pago", "cancelled", "presencial")).toBe(
      "Pago e cancelado — precisa de atenção",
    );
  });

  it("getPaymentStatusConfig (o rótulo do BOTÃO do filtro) não mudou: continua 'Recebido na entrega', sem canal nenhum", async () => {
    const { getPaymentStatusConfig, paymentStatusConfig } = await import(
      "@/components/admin/orders/OrderStatusBadge"
    );

    expect(getPaymentStatusConfig("recebido_na_entrega").label).toBe(
      "Recebido na entrega",
    );
    // A forma do Record não mudou: ainda são as 8 chaves de sempre, sem
    // campo de canal dentro de cada entrada.
    expect(Object.keys(paymentStatusConfig).sort()).toEqual(
      [
        "aguardando",
        "estornado",
        "expirado",
        "pago",
        "pago_apos_expirar",
        "recebido_na_entrega",
        "recusado",
        "sem_cobranca",
      ].sort(),
    );
  });
});

describe("PaymentStatusBadge (componente) — prop `canal`", () => {
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

  async function renderizar(canal?: "online" | "presencial") {
    const { PaymentStatusBadge } = await import(
      "@/components/admin/orders/OrderStatusBadge"
    );
    await act(async () => {
      raiz.render(
        <PaymentStatusBadge
          paymentStatus="recebido_na_entrega"
          orderStatus="delivered"
          canal={canal}
        />,
      );
    });
  }

  it("canal='presencial': mostra 'Recebido no balcão' e SEM animate-pulse (não é caso de atenção)", async () => {
    await renderizar("presencial");

    expect(hospedeiro.textContent).toBe("Recebido no balcão");
    const selo = hospedeiro.querySelector("div");
    expect(selo?.className).not.toContain("animate-pulse");
    // Mesma família visual de "Recebido na entrega": verde (emerald), não
    // âmbar — dinheiro que entrou não pode parecer pendência.
    expect(selo?.className).toContain("emerald");
  });

  it("sem a prop `canal` (compatibilidade): continua 'Recebido na entrega', comportamento de antes desta tarefa", async () => {
    await renderizar(undefined);

    expect(hospedeiro.textContent).toBe("Recebido na entrega");
  });
});

const pedidoBase: Order = {
  id: "ped-mesa-balcao",
  customer: { name: "Cliente Teste", whatsapp: "349998888777" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "cash",
  status: "delivered",
  paymentStatus: "recebido_na_entrega",
  createdAt: "2026-09-16T14:00:00.000Z",
  updatedAt: "2026-09-16T14:00:00.000Z",
  cancelledAfterShipping: false,
  pagamentoRecebidoEm: "2026-09-16T14:01:00.000Z",
  pagamentoRecebidoPor: null,
};

function pedidoFake(overrides: Partial<Order> = {}): Order {
  return { ...pedidoBase, ...overrides };
}

// A frase (`fraseSituacaoDoPagamento`) não é exportada de OrderDetail.tsx —
// como a ficha inteira já monta sem puxar Supabase de verdade (mocado
// acima, mesmo padrão de ficha-do-pedido-mesa-do-lojista.test.tsx), a
// escolha aqui é montar <OrderDetail> e ler o texto renderizado, em vez de
// exportar uma função que hoje só serve a esse arquivo.
describe("ficha do pedido — frase-situação e cor para venda de balcão (canal presencial)", () => {
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
    vi.restoreAllMocks();
  });

  async function renderizar(order: Order) {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  it("venda de balcão paga: 'Recebido no balcão · R$ 100,00' — não 'na entrega'", async () => {
    await renderizar(pedidoFake({ canal: "presencial" }));

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Recebido no balcão · R$ 100,00");
    expect(texto).not.toContain("Recebido na entrega");
  });

  it("venda de balcão SEM o dinheiro recebido ainda: 'Falta receber no balcão · R$ 100,00'", async () => {
    await renderizar(
      pedidoFake({ canal: "presencial", pagamentoRecebidoEm: null }),
    );

    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Falta receber no balcão · R$ 100,00");
  });

  it("canal 'online' (comportamento de hoje): continua 'Recebido na entrega · R$ 100,00'", async () => {
    await renderizar(pedidoFake({ canal: "online" }));

    expect(hospedeiro.textContent).toContain("Recebido na entrega · R$ 100,00");
  });

  it("ARMADILHA MEDIDA (OrderDetail.tsx:664-668): a venda de balcão paga pinta o selo de Pagamento de VERDE (emerald), não de âmbar", async () => {
    await renderizar(pedidoFake({ canal: "presencial" }));

    // A seção "Pagamento" tem um <span> cuja classe carrega a cor da
    // situação — bg-emerald-500/10 quando positiva, bg-amber-500/10 quando
    // não. Procura o span que contém o texto da frase-situação.
    const spans = Array.from(hospedeiro.querySelectorAll("span"));
    const seloDaSituacao = spans.find((span) =>
      (span.textContent ?? "").includes("Recebido no balcão"),
    );
    expect(seloDaSituacao).not.toBeUndefined();
    expect(seloDaSituacao?.className).toContain("emerald");
    expect(seloDaSituacao?.className).not.toContain("amber");
  });
});
