// @vitest-environment jsdom
//
// T3 do lote B (12/09/2026) — reforço do crítico de desenho (achado 1, o mais
// grave do lote): a ficha do pedido é a PORTA da devolução de dinheiro quando
// um pedido pago é cancelado. Este arquivo monta `<OrderDetail>` INTEIRO (não
// o EstornoCard sozinho, que tem suíte própria em
// estorno-card-lojista-devolve-o-dinheiro.test.tsx) e exige que, no caso
// online + pago + cancelado:
//
//   1. o botão "Devolver R$ …" apareça ATRAVÉS da ficha — a condição de
//      renderização mora no JSX do OrderDetail (`paymentMethod === "online"`
//      && status de pagamento ∈ {pago, pago_apos_expirar, estornado}); se
//      alguém quebrá-la, o cartão cai em silêncio e o lojista perde a única
//      porta de devolução do app;
//   2. o EstornoCard tenha LUGAR definido na comanda de coluna única: logo
//      abaixo da seção Pagamento (depois do "Total do pedido", antes de
//      "Entrega e rastreio");
//   3. a frase-situação do dinheiro no cabeçalho de Pagamento concorde com o
//      SELO do pagamento — mesma fonte (`rotuloDoPagamento`), então o caso
//      pago+cancelado diz "Pago e cancelado — precisa de atenção · R$ …",
//      nunca "Pago no site" (que pintaria de resolvido um dinheiro PRESO).
//
// Molde de montagem: order-detail-aviso-pagamento-pendente.test.tsx (mocks de
// `@/lib/supabase` e `@/components/ui/alert-dialog`; `items: []` evita o
// IntersectionObserver do LazyImage). O hook `useEstornosDoPedido` é mockado
// por inteiro, mesmo molde de estorno-card-lojista-devolve-o-dinheiro.test.tsx
// — aqui o alvo é a INTEGRAÇÃO (ficha chama o cartão no lugar certo), não a
// leitura do banco (coberta em use-estornos-do-pedido-rpc-depois-edge).
import type { LinhaEstornoDoPedido } from "@/hooks/useEstornosDoPedido";
import type { Order } from "@/types";
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

const useEstornosDoPedidoMock = vi.fn();
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: (orderId: string) => useEstornosDoPedidoMock(orderId),
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// O caso que abre a porta: cobrado no site, dinheiro ENTROU, pedido DEPOIS
// foi cancelado e o produto já voltou (`cancelledAfterShipping: false`).
const pedidoPagoCancelado: Order = {
  id: "ped-estorno-pela-ficha",
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
  paymentStatus: "pago",
  status: "cancelled",
  createdAt: "2026-09-01T14:32:00.000Z",
  updatedAt: "2026-09-01T14:32:00.000Z",
  cancelledAfterShipping: false,
};

function hookPadrao() {
  return {
    linhas: [] as LinhaEstornoDoPedido[],
    pago: 100,
    devolvido: 0,
    emCurso: 0,
    disponivel: 100,
    carregando: false,
    pedidoCarregado: true,
    erro: false,
    recarregar: vi.fn(),
    solicitarEstorno: vi.fn().mockResolvedValue(undefined),
    enviando: false,
  };
}

// `formatCurrency` (EstornoCard) usa NBSP entre "R$" e o número — normaliza
// antes de comparar, mesmo molde de estorno-card-lojista-devolve-o-dinheiro.
function normalizarEspacos(valor: string | null): string {
  return (valor ?? "").replace(/\s+/g, " ");
}

describe("OrderDetail (ficha) — a porta de devolução do pedido pago e cancelado continua de pé na comanda", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    useEstornosDoPedidoMock.mockReset();
    useEstornosDoPedidoMock.mockReturnValue(hookPadrao());
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

  async function renderizarFicha() {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail order={pedidoPagoCancelado} onStatusChange={vi.fn()} />,
      );
    });
  }

  it("o botão 'Devolver R$ 100,00' do EstornoCard aparece ATRAVÉS da ficha (a condição de renderização no JSX do OrderDetail não caiu)", async () => {
    await renderizarFicha();

    const botaoDevolver = Array.from(
      hospedeiro.querySelectorAll("button"),
    ).find((b) =>
      normalizarEspacos(b.textContent).includes("Devolver R$ 100,00"),
    );
    expect(botaoDevolver).toBeDefined();
    // Âncora de render de verdade: é um pedido mesmo, não uma tela vazia.
    expect(normalizarEspacos(hospedeiro.textContent)).toContain(
      "Devolução de dinheiro",
    );
  });

  it("o EstornoCard mora logo abaixo da seção Pagamento: depois do 'Total do pedido' e antes de 'Entrega e rastreio'", async () => {
    await renderizarFicha();

    const texto = normalizarEspacos(hospedeiro.textContent);
    const posTotal = texto.indexOf("Total do pedido");
    const posEstorno = texto.indexOf("Devolução de dinheiro");
    const posEntrega = texto.indexOf("Entrega e rastreio");
    // Sanidade: as três âncoras renderizaram (indexOf -1 mentiria na ordem).
    expect(posTotal).toBeGreaterThan(-1);
    expect(posEstorno).toBeGreaterThan(-1);
    expect(posEntrega).toBeGreaterThan(-1);
    expect(posEstorno).toBeGreaterThan(posTotal);
    expect(posEstorno).toBeLessThan(posEntrega);
  });

  it("a frase-situação do dinheiro concorda com o SELO no caso mais perigoso: 'Pago e cancelado — precisa de atenção · R$ 100,00' (nunca 'Pago no site')", async () => {
    await renderizarFicha();

    const texto = normalizarEspacos(hospedeiro.textContent);
    expect(texto).toContain(
      "Pago e cancelado — precisa de atenção · R$ 100,00",
    );
    // A frase NÃO pode mentir que o dinheiro está resolvido: "Pago no site"
    // é o rótulo do caso saudável (pago + não cancelado).
    expect(texto).not.toContain("Pago no site");
  });
});
