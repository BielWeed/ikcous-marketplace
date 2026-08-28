// @vitest-environment jsdom
//
// Task 4b do plano docs/superpowers/plans/2026-08-27-recebimento-na-entrega.md
// (achado da revisão da Task 4, aprovado pelo Gabriel via laudo do `socio`).
//
// Task 4 pôs o botão "Marcar como recebido" só no CARTÃO da lista, que nasce
// filtrada em "open" e exclui `delivered` no servidor — o botão some no
// exato instante em que o dinheiro chega na mão. Existe um caminho de um
// clique humano até a FICHA de um pedido entregue (Clientes → pedido do
// cliente), e lá não havia nada para clicar.
//
// Esta suíte cobre as duas metades que fazem a ficha virar a DONA do
// recebimento:
//   A) ao avançar um pedido de pagamento na entrega para "delivered", a
//      ficha pergunta "recebeu?" antes de avançar — e só avança depois de
//      registrar, na ORDEM certa (dinheiro primeiro, status depois).
//   B) o botão "Marcar como recebido"/"Desfazer" fica disponível na ficha
//      o tempo todo, igual ao cartão.
//
// Molde de montagem: tests/front/painel-avisa-pedido-pago-e-cancelado.test.tsx
// (renderiza <OrderDetail> direto, com @/lib/supabase mocado porque
// OrderDetail.tsx importa `supabase` no topo — sem o mock, só IMPORTAR o
// módulo dispara leitura de env var ausente neste ambiente).
import type { Order, OrderStatus, PaymentMethod } from "@/types";
import { act, useCallback, useState } from "react";
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

// Task 4c (caça-defeitos, achado 1) — usados só pelo describe de baixo, que
// monta <AdminOrdersView> inteira (não <OrderDetail> direto) porque o
// defeito mora no `handleStatusChange` DELA, não da ficha. `useOrders` vira
// um hook de VERDADE (com `useState` real) em vez do dublê estático que o
// resto do arquivo usa: só assim `registrarPagamentoRecebido` consegue
// atualizar `orders` e disparar o re-render que expõe o fecho velho —
// espelha exatamente o `setOrders` de `useOrders.ts` (linhas 1874-1882).
let mockOrdersIniciais: Order[] = [];
// Resolve por um MACROTASK (`setTimeout`), não por microtask
// (`mockResolvedValue`/`Promise.resolve`): é essa a diferença que faz este
// teste enxergar o defeito de verdade. A RPC real (`supabase.rpc`) é uma
// chamada de rede — o motor JS tem tempo de sobra para o React comitar o
// render e rodar o efeito de sincronização (linhas 553-636 de
// AdminOrdersView.tsx) ANTES de `handleStatusChange` retomar depois do
// `await`. Com resolução por microtask (como estava antes), o React 18
// agrupa a atualização otimista de `orders` (dentro de `updateOrderStatus`)
// e a sobrescrita de `handleStatusChange` no MESMO commit, e o efeito só
// roda DEPOIS dos dois — corrigindo a tela por acaso e escondendo o
// defeito. Medido: com microtask o teste de baixo passava mesmo com a
// linha antiga (`{ ...selectedOrder, status: newStatus }`) ainda no lugar.
const updateOrderStatusMock = vi.fn<
  (
    orderId: string,
    status: OrderStatus,
    notes?: string,
    silent?: boolean,
  ) => Promise<undefined>
>(
  () =>
    new Promise<undefined>((resolve) =>
      setTimeout(() => resolve(undefined), 0),
    ),
);
const registrarPagamentoRecebidoMock = vi.fn().mockResolvedValue({
  payment_status: "recebido_na_entrega",
  pagamento_recebido_em: "2026-08-27T12:00:00Z",
  pagamento_recebido_por: null,
});

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => {
    const [orders, setOrders] = useState<Order[]>(() => mockOrdersIniciais);
    const registrarPagamentoRecebido = useCallback(
      async (orderId: string, recebido: boolean) => {
        const data = await registrarPagamentoRecebidoMock(orderId, recebido);
        setOrders((prev) =>
          prev.map((o) =>
            o.id === orderId
              ? {
                  ...o,
                  paymentStatus: data?.payment_status ?? null,
                  pagamentoRecebidoEm: data?.pagamento_recebido_em ?? null,
                  pagamentoRecebidoPor: data?.pagamento_recebido_por ?? null,
                }
              : o,
          ),
        );
        return data;
      },
      [],
    );
    // Espelha o `updateOrderStatus` real (useOrders.ts:1604-1663): a
    // ATUALIZAÇÃO OTIMISTA de `orders` roda ANTES do "RPC" (aqui, o
    // `updateOrderStatusMock` assertável), não depois — é essa ordem que
    // garante que o efeito de sincronização de `AdminOrdersView.tsx`
    // (linhas 553-636) já tenha uma chance de rodar com o status novo
    // ANTES de `handleStatusChange` (achado 1) fazer a sua própria
    // sobrescrita por cima, no fecho velho. Sem isto, `orders` só mudava
    // UMA vez (via `registrarPagamentoRecebido`) e o teste passava por
    // ACASO, não porque o defeito estivesse corrigido.
    const updateOrderStatus = useCallback(
      async (
        orderId: string,
        status: OrderStatus,
        notes?: string,
        silent?: boolean,
      ) => {
        setOrders((prev) =>
          prev.map((o) => (o.id === orderId ? { ...o, status } : o)),
        );
        return updateOrderStatusMock(orderId, status, notes, silent);
      },
      [],
    );
    return {
      orders,
      loadOrders: vi.fn(),
      updateOrderStatus,
      confirmarRetornoDoProduto: vi.fn().mockResolvedValue({ ok: true }),
      registrarPagamentoRecebido,
      totalOrders: orders.length,
      isLoaded: true,
      loading: false,
      pedidosCancelados: [],
      carregandoPedidosCancelados: false,
      fetchPedidosCancelados: vi.fn().mockResolvedValue([]),
      pedidosCanceladosIncompleto: false,
    };
  },
}));

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({
    stats: null,
    fetchExecutiveSummary: vi.fn(),
  }),
}));

// `@/components/ui/alert-dialog` mocado pelo MESMO motivo de
// order-detail-aviso-pagamento-pendente.test.tsx: o Radix real depende de
// PointerEvent/ResizeObserver ausentes no jsdom deste projeto, e sem o mock
// o `<AlertDialogContent>` simplesmente não chega a montar no DOM — medido:
// o `open` prop e o `pendingAdvance` do componente ficam corretos (conferido
// com log de depuração), mas nada aparece em `hospedeiro.textContent`.
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

function pedidoFake(overrides: {
  id: string;
  status?: OrderStatus;
  paymentMethod?: PaymentMethod;
  pagamentoRecebidoEm?: string | null;
}): Order {
  return {
    id: overrides.id,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    // Vazio de propósito: com item nenhum, `OrderItemsCard` não monta
    // `LazyImage`, que cria `new IntersectionObserver` — ausente no jsdom
    // deste projeto e fora do escopo desta tarefa. Mesma saída do outro
    // describe de `painel-avisa-pedido-pago-e-cancelado.test.tsx` que
    // também monta <OrderDetail> direto.
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: overrides.paymentMethod ?? "cash",
    status: overrides.status ?? "shipping",
    paymentStatus: null,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    returnedToSellerAt: null,
    pagamentoRecebidoEm: overrides.pagamentoRecebidoEm ?? null,
    pagamentoRecebidoPor: null,
  };
}

function botaoComTexto(hospedeiro: HTMLElement, textoParcial: string) {
  return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    b.textContent?.includes(textoParcial),
  );
}

describe("OrderDetail (ficha do pedido) — pergunta se recebeu ao avançar para entregue (Task 4b)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Tipada pela IMPLEMENTAÇÃO passada a `vi.fn`, não por `ReturnType<typeof
  // vi.fn>` solto: sem isso o TypeScript infere um mock genérico demais e
  // `npm run typecheck` reprova ao passar o mock como prop de `<OrderDetail>`
  // (a assinatura de `OrderDetailProps.onStatusChange`/`onRegistrarPagamento`
  // não bate com `Mock<Procedure>`).
  let onStatusChangeMock: ReturnType<
    typeof vi.fn<(orderId: string, status: OrderStatus) => Promise<void>>
  >;
  let onRegistrarPagamentoMock: ReturnType<
    typeof vi.fn<(orderId: string, recebido: boolean) => Promise<unknown>>
  >;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    onStatusChangeMock = vi.fn(async () => {});
    onRegistrarPagamentoMock = vi.fn(async () => ({
      payment_status: "recebido_na_entrega",
    }));
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
      raiz.render(
        <OrderDetail
          order={order}
          onStatusChange={onStatusChangeMock}
          onRegistrarPagamento={onRegistrarPagamentoMock}
        />,
      );
    });
  }

  function clicarAvancar() {
    const botao = botaoComTexto(hospedeiro, "Avançar");
    expect(botao).toBeTruthy();
    return act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });
  }

  it("caso 1: pedido na entrega, sem recebimento, avançando para 'delivered' — abre a caixinha", async () => {
    const order = pedidoFake({
      id: "ped-1",
      status: "shipping",
      paymentMethod: "cash",
      pagamentoRecebidoEm: null,
    });
    await renderizar(order);

    await clicarAvancar();

    // Âncora positiva: a página desenhou o header do pedido, e É a
    // caixinha nova (não a antiga de "pagamento não confirmado").
    expect(hospedeiro.textContent).toContain("Pedido");
    expect(hospedeiro.textContent).toMatch(/Recebeu/i);
    expect(botaoComTexto(hospedeiro, "Recebi")).toBeTruthy();
    expect(botaoComTexto(hospedeiro, "Ainda não")).toBeTruthy();
    expect(onStatusChangeMock).not.toHaveBeenCalled();
  });

  it("caso 2: clicar 'Recebi' — registra o pagamento E DEPOIS avança o status, nessa ordem", async () => {
    const order = pedidoFake({
      id: "ped-2",
      status: "shipping",
      paymentMethod: "pix",
      pagamentoRecebidoEm: null,
    });
    await renderizar(order);
    await clicarAvancar();

    const chamadas: string[] = [];
    onRegistrarPagamentoMock.mockImplementation(async () => {
      chamadas.push("registrar");
      return { payment_status: "recebido_na_entrega" };
    });
    onStatusChangeMock.mockImplementation(async () => {
      chamadas.push("avancar");
    });

    const botaoRecebi = botaoComTexto(hospedeiro, "Recebi");
    await act(async () => {
      botaoRecebi!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRegistrarPagamentoMock).toHaveBeenCalledWith("ped-2", true);
    expect(onStatusChangeMock).toHaveBeenCalledWith("ped-2", "delivered");
    expect(chamadas).toEqual(["registrar", "avancar"]);
  });

  it("caso 3: clicar 'Ainda não' — avança o status, e registrarPagamento NÃO é chamado", async () => {
    const order = pedidoFake({
      id: "ped-3",
      status: "shipping",
      paymentMethod: "card",
      pagamentoRecebidoEm: null,
    });
    await renderizar(order);
    await clicarAvancar();

    const botaoAindaNao = botaoComTexto(hospedeiro, "Ainda não");
    await act(async () => {
      botaoAindaNao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onStatusChangeMock).toHaveBeenCalledWith("ped-3", "delivered");
    expect(onRegistrarPagamentoMock).not.toHaveBeenCalled();
  });

  it("caso 4: a gravação do dinheiro FALHA — o status NÃO avança (prova a ordem segura)", async () => {
    const order = pedidoFake({
      id: "ped-4",
      status: "shipping",
      paymentMethod: "cash",
      pagamentoRecebidoEm: null,
    });
    await renderizar(order);
    await clicarAvancar();

    onRegistrarPagamentoMock.mockRejectedValue(new Error("RPC falhou"));

    const botaoRecebi = botaoComTexto(hospedeiro, "Recebi");
    await act(async () => {
      botaoRecebi!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(onRegistrarPagamentoMock).toHaveBeenCalledWith("ped-4", true);
    expect(onStatusChangeMock).not.toHaveBeenCalled();
  });

  it("caso 5: pedido de pagamento ONLINE — avançar para 'delivered' NÃO abre a caixinha (comportamento antigo preservado)", async () => {
    const order = pedidoFake({
      id: "ped-5",
      status: "shipping",
      paymentMethod: "online",
      pagamentoRecebidoEm: null,
    });
    await renderizar(order);

    await clicarAvancar();

    // Âncora positiva: a página desenhou de verdade.
    expect(hospedeiro.textContent).toContain("Pedido");
    expect(hospedeiro.textContent).not.toMatch(/Recebeu/i);
    expect(onStatusChangeMock).toHaveBeenCalledWith("ped-5", "delivered");
    expect(onRegistrarPagamentoMock).not.toHaveBeenCalled();
  });

  it("caso 6: ficha de pedido já entregue e já recebido — mostra 'Desfazer', e clicar chama registrarPagamento(id, false)", async () => {
    const order = pedidoFake({
      id: "ped-6",
      status: "delivered",
      paymentMethod: "cash",
      pagamentoRecebidoEm: "2026-08-27T12:00:00Z",
    });
    await renderizar(order);

    expect(hospedeiro.textContent).toMatch(/Recebido/i);
    const botaoDesfazer = botaoComTexto(hospedeiro, "Desfazer");
    expect(botaoDesfazer).toBeTruthy();

    await act(async () => {
      botaoDesfazer!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onRegistrarPagamentoMock).toHaveBeenCalledTimes(1);
    // 🔴 O SEGUNDO ARGUMENTO é o que este caso existe para pegar: marcar e
    // desmarcar chamam a MESMA função.
    expect(onRegistrarPagamentoMock).toHaveBeenCalledWith("ped-6", false);
  });

  // Task 4c (caça-defeitos, achado 2) — o botão "Marcar como recebido" DA
  // FICHA (OrderDetail.tsx:655-663) nunca tinha asserção nenhuma: as duas
  // únicas chamadas com `(id, true)` na suíte eram do botão "Recebi" do
  // DIÁLOGO (caso 2 e caso 4 acima), um ponto de clique diferente. Trocar o
  // `true` da linha 658 por `false` deixava a suíte inteira verde — este
  // caso é a rede que falta.
  it("caso 7 (achado 2): ficha de pedido entregue e AINDA NÃO recebido — botão 'Marcar como recebido' chama registrarPagamento(id, true)", async () => {
    const order = pedidoFake({
      id: "ped-7",
      status: "delivered",
      paymentMethod: "cash",
      pagamentoRecebidoEm: null,
    });
    await renderizar(order);

    // Âncora positiva: a ficha desenhou de verdade, e é a ficha de um
    // pedido AINDA sem recebimento (sem isso, a ausência de "Desfazer"
    // logo abaixo seria verdadeira por vacuidade).
    expect(hospedeiro.textContent).toContain("Pedido");
    expect(botaoComTexto(hospedeiro, "Desfazer")).toBeUndefined();

    const botaoMarcar = botaoComTexto(hospedeiro, "Marcar como recebido");
    expect(botaoMarcar).toBeTruthy();

    await act(async () => {
      botaoMarcar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(onRegistrarPagamentoMock).toHaveBeenCalledTimes(1);
    expect(onRegistrarPagamentoMock).toHaveBeenCalledWith("ped-7", true);
  });
});

// Task 4c (caça-defeitos, achado 1) — o defeito mora em
// AdminOrdersView.tsx:809-811 (`handleStatusChange`), não em OrderDetail.
// `handleStatusChange` é função comum (não `useCallback`), e antes da Task
// 4b isso era seguro porque nada rodava entre capturar `selectedOrder` e
// usá-lo. A Task 4b inseriu um `await onRegistrarPagamento(...)` no meio
// desse caminho (dentro de OrderDetail.confirmarRecebimentoEAvancar): o
// fecho de `handleStatusChange` que o clique em "Recebi" acaba chamando é o
// de ANTES desse await, com o `selectedOrder` de ANTES do dinheiro ser
// gravado — e `setSelectedOrder({ ...selectedOrderVELHO, status })`
// reescreve `pagamentoRecebidoEm`/`paymentStatus` de volta para `null`.
//
// Por isso este describe monta <AdminOrdersView> inteira (ver os mocks de
// `@/hooks/useOrders` e `@/hooks/useAnalytics` no topo do arquivo) — o
// describe de cima só renderiza <OrderDetail> direto, com `onStatusChange`
// mocado sem estado nenhum, e por isso nunca exercitou o fecho velho.
describe("AdminOrdersView — a ficha não perde o recebimento depois do 'Recebi' (Task 4c, achado 1)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    // AdminOrdersView lê `admin_orders_payment_filter` e
    // `admin_orders_view_mode` de `localStorage` no PRIMEIRO render (mesmo
    // stub de painel-botao-registrar-pagamento-recebido.test.tsx) — sem
    // isso `localStorage.getItem` nem existe no jsdom deste projeto.
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
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    mockOrdersIniciais = [];
    updateOrderStatusMock.mockClear();
    registrarPagamentoRecebidoMock.mockClear();
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function botaoComTexto(hospedeiro: HTMLElement, textoParcial: string) {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes(textoParcial),
    );
  }

  it("pedido cash sem recebimento, avança para 'delivered' clicando 'Recebi' — depois de tudo assentar a ficha ainda mostra o recebimento", async () => {
    mockOrdersIniciais = [
      {
        id: "ped-8",
        customer: { name: "Cliente Teste", whatsapp: "34999999999" },
        items: [],
        subtotal: 100,
        shipping: 0,
        discount: 0,
        total: 100,
        paymentMethod: "cash" as PaymentMethod,
        status: "shipping" as OrderStatus,
        paymentStatus: null,
        createdAt: new Date(0).toISOString(),
        updatedAt: new Date(0).toISOString(),
        cancelledAfterShipping: false,
        returnedToSellerAt: null,
        pagamentoRecebidoEm: null,
        pagamentoRecebidoPor: null,
      },
    ];

    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId="ped-8"
        />,
      );
    });

    // Âncora positiva: a ficha (não a lista) abriu de verdade.
    expect(hospedeiro.textContent).toContain("Pedido");

    const botaoAvancar = botaoComTexto(hospedeiro, "Avançar");
    expect(botaoAvancar).toBeTruthy();
    await act(async () => {
      botaoAvancar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(hospedeiro.textContent).toMatch(/Recebeu/i);
    const botaoRecebi = botaoComTexto(hospedeiro, "Recebi");
    expect(botaoRecebi).toBeTruthy();

    // Cada `setTimeout` (MACROTASK, não microtask — espelha o
    // `updateOrderStatusMock` acima) vive no seu PRÓPRIO `act()`: um único
    // `act()` que engolisse os três de uma vez deixava o React acumular as
    // atualizações pendentes e só comitar tudo (o `setOrders` de
    // `pagamentoRecebidoEm`, o `setOrders` de `status` E a sobrescrita de
    // `handleStatusChange`) num commit só, ao SAIR do `act()` — o efeito de
    // sincronização (linhas 553-636 de AdminOrdersView.tsx) então rodava
    // UMA vez, já depois da sobrescrita, e "corrigia" a tela por acaso.
    // Fechando o `act()` a cada macrotask, o React é forçado a comitar e
    // rodar o efeito NO MEIO do caminho — a mesma folga que uma chamada de
    // rede de verdade dá em produção. Medido: só assim o teste caiu com a
    // linha antiga (`{ ...selectedOrder, status: newStatus }`) ainda em
    // AdminOrdersView.tsx.
    await act(async () => {
      botaoRecebi!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(registrarPagamentoRecebidoMock).toHaveBeenCalledWith("ped-8", true);
    expect(updateOrderStatusMock).toHaveBeenCalledWith(
      "ped-8",
      "delivered",
      undefined,
      false,
    );

    // O ACHADO: depois de tudo assentar, a ficha ainda mostra o
    // recebimento — não voltou a oferecer "Marcar como recebido".
    expect(hospedeiro.textContent).toMatch(/Recebido/i);
    expect(botaoComTexto(hospedeiro, "Marcar como recebido")).toBeUndefined();
  });
});
