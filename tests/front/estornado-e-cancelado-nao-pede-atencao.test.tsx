// @vitest-environment jsdom
//
// Pedido CANCELADO e já devolvido por inteiro ficava marcado para sempre como
// "Estornado — precisa de atenção", piscando, enquanto o cartão logo abaixo
// dizia "Todo o valor pago já foi devolvido". É o caso RESOLVIDO: o dinheiro
// voltou, nada a fazer. Só o pedido ATIVO com "estornado" é anomalia
// (devolução em pedido que segue de pé) e continua pedindo atenção.
import type { Order } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  PaymentStatusBadge,
  rotuloDoPagamento,
} from "@/components/admin/orders/OrderStatusBadge";
import { pedidosParaCsv } from "@/lib/pedidos-csv";
import { supabase } from "@/lib/supabase";

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
  AlertDialogAction: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
  AlertDialogCancel: ({ children }: { children: ReactNode }) => (
    <button type="button">{children}</button>
  ),
}));

// O cartão de devolução tem teste próprio; aqui só o selo e a frase importam.
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: () => ({
    linhas: [],
    pago: 100,
    devolvido: 100,
    emCurso: 0,
    emDuvida: 0,
    disponivel: 0,
    reservadoPorFora: 0,
    carregando: false,
    pedidoCarregado: true,
    erro: false,
    recarregar: vi.fn(),
    solicitarEstorno: vi.fn(),
    registrarPorForaAposEspera: vi.fn(),
    enviando: false,
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const base: Order = {
  id: "ped-estornado-1",
  customer: {
    name: "Cliente Teste",
    whatsapp: "349998888777",
    address: "Rua das Flores",
    number: "123",
    neighborhood: "Centro",
    city: "Patos de Minas",
    state: "MG",
  },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "estornado",
  status: "cancelled",
  createdAt: "2026-09-01T14:32:00.000Z",
  updatedAt: "2026-09-01T14:32:00.000Z",
  cancelledAfterShipping: false,
};

describe("selo do pagamento — cancelado + estornado é caso resolvido", () => {
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

  it("o rótulo do pedido cancelado e estornado é neutro: 'Estornado'", () => {
    expect(rotuloDoPagamento("estornado", "cancelled")).toBe("Estornado");
  });

  it("o selo do cancelado e estornado não pisca nem pede atenção", async () => {
    await act(async () => {
      raiz.render(
        <PaymentStatusBadge
          paymentStatus="estornado"
          orderStatus="cancelled"
        />,
      );
    });
    expect(hospedeiro.textContent).toContain("Estornado");
    expect(hospedeiro.textContent).not.toContain("precisa de atenção");
    expect(hospedeiro.innerHTML).not.toContain("animate-pulse");
  });

  it("pedido ATIVO com 'estornado' continua pedindo atenção", async () => {
    expect(rotuloDoPagamento("estornado", "processing")).toBe(
      "Estornado — precisa de atenção",
    );
    expect(rotuloDoPagamento("estornado")).toBe(
      "Estornado — precisa de atenção",
    );
    await act(async () => {
      raiz.render(
        <PaymentStatusBadge
          paymentStatus="estornado"
          orderStatus="processing"
        />,
      );
    });
    expect(hospedeiro.textContent).toContain("precisa de atenção");
    expect(hospedeiro.innerHTML).toContain("animate-pulse");
  });

  it("pago e cancelado (dinheiro preso) segue pedindo atenção", () => {
    expect(rotuloDoPagamento("pago", "cancelled")).toBe(
      "Pago e cancelado — precisa de atenção",
    );
  });

  it("a ficha do pedido cancelado e estornado não tem 'precisa de atenção' e diz que foi devolvido", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={base} onStatusChange={vi.fn()} />);
    });
    expect(hospedeiro.textContent).not.toContain("precisa de atenção");
    expect(hospedeiro.textContent).toContain("Estornado");
    // A frase do dinheiro é neutra: nada pendente, então nem âmbar nem verde.
    const frase = Array.from(hospedeiro.querySelectorAll("p")).find((p) =>
      p.textContent?.startsWith("Estornado ·"),
    );
    expect(frase).toBeTruthy();
    expect(frase?.className).not.toContain("text-amber-400");
  });

  it("a ficha do pedido ATIVO com 'estornado' continua com 'precisa de atenção'", async () => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={{ ...base, status: "processing" }}
          onStatusChange={vi.fn()}
        />,
      );
    });
    expect(hospedeiro.textContent).toContain("precisa de atenção");
  });

  it("a planilha: cancelado + estornado sem atenção; ativo + estornado com atenção", () => {
    const csv = pedidosParaCsv([
      base,
      { ...base, id: "ped-estornado-2", status: "processing" },
    ]);
    const [, resolvido, ativo] = csv.split(/\r?\n/);
    expect(resolvido).not.toContain("precisa de atenção");
    expect(resolvido).toContain(";Estornado;");
    expect(ativo).toContain("Estornado — precisa de atenção");
  });
});

// Pedido ENTREGUE e estornado tem DUAS origens que o par de status não
// distingue: a devolução concluída (caso resolvido) e a contestação no cartão
// (chargeback) PERDIDA pela loja — ali a lojista perdeu mercadoria E dinheiro
// e precisa saber. Por isso o selo só fica neutro com PROVA POSITIVA de que a
// devolução desse pedido foi concluída (o valor todo devolvido por pessoa, no
// livro `order_refunds`); sem a prova, o padrão é o alerta de sempre. A prova
// só existe na FICHA (que lê o livro do pedido); lista e planilha seguem com
// o alerta.
describe("pedido ENTREGUE e estornado — neutro só com a devolução concluída provada", () => {
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
    vi.mocked(supabase.from).mockReset();
  });

  const entregue: Order = { ...base, status: "delivered" };

  /** O livro `order_refunds` do pedido, como o PostgREST o devolve. */
  const livro = (
    linhas: Array<{ amount: number; solicitado_por: string }> | "falha",
  ) => {
    const resposta =
      linhas === "falha"
        ? { data: null, error: { message: "boom" } }
        : {
            data: linhas.map((l) => ({ ...l, status: "concluido" })),
            error: null,
          };
    // A cadeia do PostgREST é uma Promise com `select`/`eq` pendurados.
    vi.mocked(supabase.from).mockImplementation((() => {
      const cadeia = Object.assign(Promise.resolve(resposta), {
        select: () => cadeia,
        eq: () => cadeia,
      });
      return cadeia;
    }) as never);
  };

  const montarFicha = async (order: Order) => {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  };

  it("o rótulo: sem a prova pede atenção; com a prova é neutro ('Estornado')", () => {
    expect(rotuloDoPagamento("estornado", "delivered")).toBe(
      "Estornado — precisa de atenção",
    );
    expect(rotuloDoPagamento("estornado", "delivered", undefined, false)).toBe(
      "Estornado — precisa de atenção",
    );
    expect(rotuloDoPagamento("estornado", "delivered", undefined, true)).toBe(
      "Estornado",
    );
  });

  it("o selo: sem a prova (chargeback) pisca e pede atenção; com a prova não", async () => {
    for (const tamanho of ["padrao", "cartao"] as const) {
      await act(async () => {
        raiz.render(
          <PaymentStatusBadge
            paymentStatus="estornado"
            orderStatus="delivered"
            tamanho={tamanho}
          />,
        );
      });
      expect(hospedeiro.textContent).toContain("precisa de atenção");
      if (tamanho === "padrao") {
        expect(hospedeiro.innerHTML).toContain("animate-pulse");
      }
      await act(async () => {
        raiz.render(
          <PaymentStatusBadge
            paymentStatus="estornado"
            orderStatus="delivered"
            devolucaoConcluida
            tamanho={tamanho}
          />,
        );
      });
      expect(hospedeiro.textContent).toContain("Estornado");
      expect(hospedeiro.textContent).not.toContain("precisa de atenção");
      expect(hospedeiro.innerHTML).not.toContain("animate-pulse");
    }
  });

  it("o limite: a prova não neutraliza pedido que ainda não chegou à cliente", () => {
    for (const status of ["pending", "processing", "shipping"] as const) {
      expect(rotuloDoPagamento("estornado", status, undefined, true)).toBe(
        "Estornado — precisa de atenção",
      );
    }
  });

  it("a ficha: chargeback (só linha do sistema no livro) segue pedindo atenção", async () => {
    livro([{ amount: 100, solicitado_por: "sistema" }]);
    await montarFicha(entregue);
    expect(hospedeiro.textContent).toContain("precisa de atenção");
  });

  it("a ficha: pedido antigo sem nenhuma linha no livro segue pedindo atenção", async () => {
    livro([]);
    await montarFicha(entregue);
    expect(hospedeiro.textContent).toContain("precisa de atenção");
  });

  it("a ficha: devolução só PARCIAL da lojista + chargeback no resto segue pedindo atenção", async () => {
    livro([
      { amount: 40, solicitado_por: "lojista" },
      { amount: 60, solicitado_por: "sistema" },
    ]);
    await montarFicha(entregue);
    expect(hospedeiro.textContent).toContain("precisa de atenção");
  });

  it("a ficha: livro ilegível (erro de leitura) cai no alerta, nunca no neutro", async () => {
    livro("falha");
    await montarFicha(entregue);
    expect(hospedeiro.textContent).toContain("precisa de atenção");
  });

  it("a ficha: devolução concluída por inteiro (lojista) é neutra e diz 'Estornado · R$'", async () => {
    livro([{ amount: 100, solicitado_por: "lojista" }]);
    await montarFicha(entregue);
    expect(hospedeiro.textContent).not.toContain("precisa de atenção");
    const frase = Array.from(hospedeiro.querySelectorAll("p")).find((p) =>
      p.textContent?.startsWith("Estornado ·"),
    );
    expect(frase).toBeTruthy();
    expect(frase?.className).not.toContain("text-amber-400");
  });

  it("a ficha: devolução concluída em duas parcelas (lojista + cliente) também é neutra", async () => {
    livro([
      { amount: 60, solicitado_por: "lojista" },
      { amount: 40, solicitado_por: "cliente" },
    ]);
    await montarFicha(entregue);
    expect(hospedeiro.textContent).not.toContain("precisa de atenção");
  });

  it("a ficha: trocar para outro pedido não herda a prova do anterior", async () => {
    livro([{ amount: 100, solicitado_por: "lojista" }]);
    await montarFicha(entregue);
    expect(hospedeiro.textContent).not.toContain("precisa de atenção");
    // Outro pedido, mesma ficha (OrderDetail não desmonta ao trocar), cujo
    // livro só tem a linha de contestação do sistema.
    livro([{ amount: 100, solicitado_por: "sistema" }]);
    await montarFicha({ ...entregue, id: "ped-estornado-9" });
    expect(hospedeiro.textContent).toContain("precisa de atenção");
  });

  it("a lista: o cartão segue com o aviso e o selo de atenção (a lista não prova nada)", async () => {
    const { AdminOrderCard } = await import(
      "@/components/admin/orders/AdminOrderCard"
    );
    await act(async () => {
      raiz.render(
        <AdminOrderCard
          order={entregue}
          viewMode="compact"
          onSelect={vi.fn()}
          onWhatsApp={vi.fn()}
          onRegistrarPagamento={vi.fn()}
          registrandoPagamento={false}
          onStatusChange={vi.fn()}
          onReceberAntesDeAvancar={vi.fn()}
          onAnularVenda={vi.fn()}
          isOffline={false}
          destaquePrimario
        />,
      );
    });
    expect(hospedeiro.textContent).toContain(
      "Pagamento estornado · pedido aberto",
    );
    expect(hospedeiro.innerHTML).toContain("Estornado — precisa de atenção");
  });

  it("a planilha: entregue + estornado segue com 'precisa de atenção'", () => {
    const [, linha] = pedidosParaCsv([entregue]).split(/\r?\n/);
    expect(linha).toContain("Estornado — precisa de atenção");
  });
});
