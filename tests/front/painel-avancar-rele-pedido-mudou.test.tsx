// @vitest-environment jsdom
//
// L-9 front (brief `lider-avancar-rele-o-pedido-0809`, 08/09/2026), critério
// 7: com a resposta "mudou", a FICHA do painel (não só o estado do hook) tem
// que refletir a verdade — o cabeçalho passa a mostrar o status real e o
// botão "Avançar" some (porque o pedido virou `cancelled`).
//
// Medido pelo líder antes desta tarefa (ver AdminOrdersView.tsx:558-643): o
// `useEffect` que sincroniza `selectedOrder` a partir de `orders` reage a
// QUALQUER mudança de referência de `orders` — não só quando o id
// selecionado muda (`isIdChanged` só decide a ANIMAÇÃO de transição, as duas
// ramificações chamam `updateState(order)`). Ou seja: bastar `setOrders`
// corrigir o pedido já propaga para a ficha sozinho, sem tocar em
// AdminOrdersView.tsx nem OrderDetail.tsx.
//
// POR QUE MOCAR `useOrders` COM UM HOOK STATEFUL (não um dublê estático):
// para provar a PROPAGAÇÃO de verdade (setOrders → efeito de sincronização →
// selectedOrder → OrderDetail), o `orders` exposto por `useOrders` precisa
// ser REATIVO. `updateOrderStatus` abaixo reproduz — linha a linha — o que
// `useOrders.ts` de produção faz na guarda nova (mesma técnica de
// admin-orders-status-erro-cru-nao-duplica-toast.test.tsx: reproduzir o
// hook real para testar a INTERAÇÃO sem montar a máquina inteira de
// realtime/RPC/cache). Os testes de tests/front/useorders-admin-rele-status-
// antes-de-avancar.test.tsx já provam que o `updateOrderStatus` REAL faz
// exatamente isto (critérios 1-6); este arquivo prova que a VIEW reage
// certo quando ele faz.
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, OrderStatus } from "@/types";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {},
    isLoaded: true,
    updateConfig: vi.fn(),
  }),
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

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));

/** Status que o "servidor" (dublê) devolve quando `updateOrderStatus` relê
 * antes de gravar — cada teste ajusta antes do clique. */
let statusVerdadeiroNoServidor: OrderStatus = "processing";
let mockOrders: Order[] = [];

vi.mock("@/hooks/useOrders", async () => {
  const React = await vi.importActual<typeof import("react")>("react");
  const { statusConfig } = await vi.importActual<
    typeof import("@/components/admin/orders/OrderStatusBadge")
  >("@/components/admin/orders/OrderStatusBadge");
  // `Map` em vez de indexação dinâmica — mesma razão de `statusConfigByKey`
  // em useOrders.ts: `statusConfig[chave]` acende
  // `security/detect-object-injection` no eslint-plugin-security mesmo a
  // chave vindo de uma união fechada.
  const statusConfigByKey = new Map(Object.entries(statusConfig));
  const { toast: toastReal } = await import("sonner");
  // Achado E do laudo da rodada 2: antes daqui o dublê lançava um `Error`
  // cru com `name = "ErroPedidoMudou"` — o `instanceof` do lado da VIEW
  // (AdminOrdersView.tsx) nunca era exercido de verdade, mesmo com a
  // releitura de produção desligada. Importar a classe REAL (não uma
  // cópia) faz este arquivo provar a mesma checagem que roda em produção.
  const { ErroPedidoMudou: ErroPedidoMudouReal } =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );

  return {
    ErroPedidoMudou: ErroPedidoMudouReal,
    useOrders: () => {
      const [orders, setOrders] = React.useState<Order[]>(mockOrders);

      const updateOrderStatus = React.useCallback(
        async (
          orderId: string,
          status: OrderStatus,
          _notes?: string,
          silent = false,
        ) => {
          const atual = orders.find((o) => o.id === orderId);
          // Reprodução da guarda de useOrders.ts (L-9): só para
          // avanço (não cancelamento), relê o "servidor" ANTES de gravar.
          if (status !== "cancelled" && atual) {
            const statusServidor = statusVerdadeiroNoServidor;
            if (statusServidor !== atual.status) {
              setOrders((prev) =>
                prev.map((o) =>
                  o.id === orderId ? { ...o, status: statusServidor } : o,
                ),
              );
              if (!silent) {
                const rotulo =
                  statusConfigByKey.get(statusServidor)?.label ??
                  statusServidor;
                toastReal.warning(
                  `Este pedido mudou há instantes: agora está "${rotulo}". A ficha foi atualizada.`,
                );
              }
              throw new ErroPedidoMudouReal(statusServidor);
            }
          }
          setOrders((prev) =>
            prev.map((o) => (o.id === orderId ? { ...o, status } : o)),
          );
          if (!silent) toastReal.success("Status atualizado com sucesso");
        },
        [orders],
      );

      return {
        orders,
        loadOrders: vi.fn(),
        updateOrderStatus,
        totalOrders: orders.length,
        isLoaded: true,
        loading: false,
      };
    },
  };
});

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público — mesmo padrão
// dos outros testes de componente deste projeto.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
class IntersectionObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}

const pedidoBase: Order = {
  id: "pedido-em-processamento",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  // `pago` + a correção virando `cancelled` é o par que faz o cabeçalho
  // MUDAR DE TEXTO (PaymentStatusBadge: "Pago" vira "Pago e cancelado —
  // precisa de atenção") — sinal mais forte do que só sumir um botão.
  paymentStatus: "pago",
  status: "processing",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

describe("AdminOrdersView / OrderDetail — a ficha reflete o status VERDADEIRO quando a releitura descobre que o pedido mudou (L-9 front, critério 7)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    statusVerdadeiroNoServidor = "processing";
    mockOrders = [pedidoBase];
    const armazem = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (chave: string) => armazem.get(chave) ?? null,
      setItem: (chave: string, valor: string) => {
        armazem.set(chave, valor);
      },
      removeItem: (chave: string) => {
        armazem.delete(chave);
      },
    });
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    vi.stubGlobal("IntersectionObserver", IntersectionObserverStub);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function renderizarComPedidoSelecionado() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={pedidoBase.id}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function botaoAvancar() {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Avançar"),
    );
  }

  function botaoAbortar() {
    return Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.getAttribute("title") === "Abortar Operação",
    );
  }

  it("controle: servidor CONFIRMA o status em memória — avança normalmente, botão Avançar continua (agora aponta para o próximo passo)", async () => {
    statusVerdadeiroNoServidor = "processing"; // bate com pedidoBase.status

    await renderizarComPedidoSelecionado();

    expect(botaoAvancar()).toBeTruthy();

    await act(async () => {
      botaoAvancar()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hospedeiro.textContent).not.toContain("Cancelado");
    expect(toast.warning).not.toHaveBeenCalled();
  });

  it("servidor devolve CANCELLED (o cliente cancelou entre a leitura e o clique): o cabeçalho passa a mostrar 'Pago e cancelado', e o botão Avançar SOME", async () => {
    statusVerdadeiroNoServidor = "cancelled";

    await renderizarComPedidoSelecionado();

    const antes = botaoAvancar();
    expect(antes).toBeTruthy();
    expect(hospedeiro.textContent).not.toContain("Pago e cancelado");

    await act(async () => {
      antes!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // O cabeçalho mostra o status VERDADEIRO — o PaymentStatusBadge
    // combina paymentStatus="pago" + orderStatus="cancelled" num rótulo
    // só: "Pago e cancelado — precisa de atenção" (OrderStatusBadge.tsx).
    // Isto só aparece se `selectedOrder.status` realmente virou
    // "cancelled" — prova a PROPAGAÇÃO orders -> selectedOrder -> ficha.
    expect(hospedeiro.textContent).toContain("Pago e cancelado");

    // O botão "Avançar" só aparece quando `orderStatus !== "cancelled"`
    // (OrderDetail.tsx, OrderHeader) — sumir prova que a ficha não ficou
    // travada no status velho.
    expect(botaoAvancar()).toBeFalsy();
    expect(botaoAbortar()).toBeFalsy();

    // Exatamente UM toast, de AVISO — nunca de erro (a armadilha do
    // catch, item 2 do brief).
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(String(vi.mocked(toast.warning).mock.calls[0][0])).toContain(
      "Cancelado",
    );
    expect(toast.error).not.toHaveBeenCalled();
  });
});
