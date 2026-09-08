// @vitest-environment jsdom
//
// L-9 front rodada 2 (08/09/2026), critério C do laudo (achado 1 do
// revisor, caminho do DEEP LINK): quando o admin chega pelo link direto de
// um pedido — ou clica num pedido de dentro da ficha de um cliente
// (AdminUserDetailView.tsx:978) —, `orders` NÃO traz esse pedido (só a
// página carregada), e `AdminOrdersView` busca a ficha avulso em
// `marketplace_orders`, guardando o resultado em `selectedOrder` — um
// estado À PARTE de `orders` (ver AdminOrdersView.tsx:604-643). O `useEffect`
// que corrige `orders` dentro do hook (`useOrders.ts`, guarda da rodada 1)
// não alcança esse pedido porque ele nunca esteve em `orders` para começar
// — por isso a correção real desta rodada é o `catch` de
// `AdminOrdersView.handleStatusChange`, que lê `err.statusVerdadeiro`
// (`ErroPedidoMudou`) e corrige `selectedOrder` diretamente.
//
// `orders` é mantido VAZIO neste arquivo inteiro, de propósito — é o que
// simula "pedido fora da página carregada". `updateOrderStatus` é um
// `vi.fn()` controlável (mesmo padrão de
// admin-orders-status-erro-cru-nao-duplica-toast.test.tsx), e a fábrica do
// mock encaminha `ErroPedidoMudou` REAL via `vi.importActual` — o mesmo
// `instanceof` que `AdminOrdersView.tsx` usa no `catch` precisa reconhecer
// a instância que este arquivo lança.
//
// Rodada 3 (achado 1 do laudo, mutação i): o teste "controle: o pedido
// selecionado muda para OUTRO..." é a ÚNICA exceção ao `orders` vazio —
// precisa de um segundo pedido JÁ carregado para provar que
// `AdminOrdersView.tsx:971` só manda `statusEsperado` quando o id do
// pedido que está avançando bate com o do `selectedOrder` atual.
import { mapOrderFromDB } from "@/lib/mappers";
import type { Order } from "@/types";
import { act } from "react";
import type { ReactNode } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const updateOrderStatus = vi.fn();
const from = vi.fn();

vi.mock("@/hooks/useOrders", async () => {
  const real =
    await vi.importActual<typeof import("@/hooks/useOrders")>(
      "@/hooks/useOrders",
    );
  return {
    // O mesmo `ErroPedidoMudou` que `AdminOrdersView.tsx` importa — não uma
    // cópia — para que `instanceof` no `catch` reconheça o que este arquivo
    // lança (achado E do laudo: o dublê anterior lançava um `Error` com só
    // `name` igual, e nenhum `instanceof` real era exercido).
    ErroPedidoMudou: real.ErroPedidoMudou,
    useOrders: () => ({
      orders: mockOrders,
      loadOrders: vi.fn(),
      updateOrderStatus,
      totalOrders: mockOrders.length,
      isLoaded: true,
      loading: false,
    }),
  };
});

vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (...args: unknown[]) => from(...args),
    rpc: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

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

/** `orders` do hook — VAZIO em todo o arquivo: é isso que faz o pedido
 * abaixo ser um deep link (fora da página carregada). */
let mockOrders: Order[] = [];

const PEDIDO_ID = "pedido-deep-link";

/** Linha crua que `supabase.from("marketplace_orders").select(...).eq("id",
 * …).single()` devolve — o caminho de `AdminOrdersView.tsx:607-639`
 * ("Fetch from Supabase if not found locally"). Forma mínima que
 * `mapOrderFromDB` (src/lib/mappers.ts) aceita. */
function linhaCruaDoDeepLink() {
  return {
    id: PEDIDO_ID,
    status: "processing",
    payment_status: "pago",
    payment_method: "pix",
    total: 120,
    subtotal: 100,
    shipping: 20,
    discount: 0,
    customer_name: "Cliente Teste",
    customer_data: { whatsapp: "34999999999" },
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    items: [],
    address: null,
  };
}

function builderPedidoUnico(linha: unknown) {
  const builder: any = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve({ data: linha, error: null }));
  return builder;
}

/** Variante de `linhaCruaDoDeepLink` com pagamento AGUARDANDO — é o que faz
 * `OrderDetail.requestStatusChange` abrir a confirmação ("Avançar mesmo
 * assim") em vez de chamar `handleStatusChange` direto (só usada no teste
 * da mutação i, abaixo). */
function linhaCruaAguardandoPagamento() {
  return { ...linhaCruaDoDeepLink(), payment_status: "aguardando" };
}

const PEDIDO_ID_OUTRO = "pedido-deep-link-outro";

/** Segundo pedido, só usado no teste da mutação i: precisa estar em
 * `orders` (não vir de busca avulsa) para a troca de `selectedOrder`
 * acontecer sem passar pela tela de "Carregando Pedido" — que desmontaria
 * `OrderDetail` e apagaria a confirmação pendente que o teste depende de
 * manter viva. */
function linhaCruaOutroPedido() {
  return { ...linhaCruaDoDeepLink(), id: PEDIDO_ID_OUTRO, status: "pending" };
}

describe("AdminOrdersView — a ficha aberta por DEEP LINK reflete o status VERDADEIRO quando a releitura descobre que o pedido mudou (L-9 front rodada 2, critério C)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    mockOrders = [];
    updateOrderStatus.mockReset();
    from.mockReset();
    from.mockImplementation(() => builderPedidoUnico(linhaCruaDoDeepLink()));
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

  async function renderizarComDeepLink() {
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={PEDIDO_ID}
        />,
      );
    });
    // A busca avulsa (`fetchSingleOrder`) é assíncrona — mais de um
    // `Promise.resolve()` para deixar o `await` da query e o `setState`
    // seguinte assentarem antes de procurar o botão.
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  function botaoAvancar() {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      b.textContent?.includes("Avançar"),
    );
  }

  it("confirma o casco: `orders` está vazio e a ficha ainda assim carrega pela busca avulsa", async () => {
    await renderizarComDeepLink();

    expect(mockOrders).toHaveLength(0);
    expect(from).toHaveBeenCalled();
    expect(botaoAvancar()).toBeTruthy();
  });

  it("servidor devolve CANCELLED (o cliente cancelou entre a leitura e o clique): a ficha do deep link passa a mostrar 'Pago e cancelado', o botão Avançar SOME, e nenhum SEGUNDO toast é empilhado", async () => {
    updateOrderStatus.mockImplementation(async () => {
      const { ErroPedidoMudou: RealErroPedidoMudou } = await import(
        "@/hooks/useOrders"
      );
      // Reproduz o ÚNICO aviso que o hook de produção dispara antes de
      // lançar — o que está sob prova aqui é o `catch` da VIEW não
      // empilhar um segundo em cima deste.
      toast.warning(
        'Este pedido mudou há instantes: agora está "Cancelado". A ficha foi atualizada.',
      );
      throw new RealErroPedidoMudou("cancelled");
    });

    await renderizarComDeepLink();

    const antes = botaoAvancar();
    expect(antes).toBeTruthy();
    expect(hospedeiro.textContent).not.toContain("Pago e cancelado");

    await act(async () => {
      antes!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // O cabeçalho mostra o status VERDADEIRO — só acontece se
    // `selectedOrder.status` realmente virou "cancelled" pelo `catch` de
    // `handleStatusChange` (a propagação `orders -> selectedOrder` não
    // alcança este pedido: ele nunca esteve em `orders`).
    expect(hospedeiro.textContent).toContain("Pago e cancelado");
    expect(botaoAvancar()).toBeFalsy();

    // Exatamente UM aviso (o do hook) — a view não mostra um segundo por
    // cima (achado 3 do laudo: "Sem toast nenhum ali").
    expect(toast.warning).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("controle: servidor CONFIRMA o status em memória — avança normalmente, sem toast de aviso", async () => {
    updateOrderStatus.mockResolvedValue(undefined);

    await renderizarComDeepLink();

    const botao = botaoAvancar();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(hospedeiro.textContent).not.toContain("Pago e cancelado");
    expect(toast.warning).not.toHaveBeenCalled();
    expect(toast.error).not.toHaveBeenCalled();

    // Rodada 3 (achado 1 do laudo): prende o 5º argumento (`statusEsperado`)
    // que `AdminOrdersView.tsx:971` manda a `updateOrderStatus`. Sem esta
    // asserção, apagar aquela expressão inteira (virar `undefined` sempre)
    // deixava a suíte toda verde — a linha que sustenta a guarda do deep
    // link não tinha rede de proteção nenhuma. `linhaCruaDoDeepLink` carrega
    // `status: "processing"`, e o pedido aberto É o `selectedOrder` (mesmo
    // id) — por isso o valor esperado é o status dele, nunca `undefined`.
    expect(updateOrderStatus.mock.calls[0][4]).toBe("processing");
  });

  it("controle: o pedido selecionado muda para OUTRO enquanto a confirmação de pagamento pendente está aberta — o 5º argumento vai `undefined`, NUNCA o status do pedido errado (rodada 3, mutação i)", async () => {
    // Pagamento "aguardando" faz `OrderDetail.requestStatusChange` desviar
    // para a confirmação (`setPendingAdvance`) em vez de chamar
    // `handleStatusChange` direto — é essa pausa que abre a janela para o
    // `selectedOrder` mudar por baixo enquanto o id do pedido A já está
    // capturado no diálogo.
    from.mockImplementation(() =>
      builderPedidoUnico(linhaCruaAguardandoPagamento()),
    );
    updateOrderStatus.mockResolvedValue(undefined);

    await renderizarComDeepLink();

    const botaoAvancarPrimeiro = botaoAvancar();
    expect(botaoAvancarPrimeiro).toBeTruthy();

    await act(async () => {
      botaoAvancarPrimeiro!.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });

    function botaoConfirmarAvancoMesmoAssim() {
      return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
        b.textContent?.includes("Avançar mesmo assim"),
      );
    }

    // O diálogo abriu em vez de gravar direto — prova que o clique caiu no
    // caminho de confirmação, não no caminho direto do outro teste.
    expect(botaoConfirmarAvancoMesmoAssim()).toBeTruthy();
    expect(updateOrderStatus).not.toHaveBeenCalled();

    // Troca o pedido aberto ANTES de confirmar. `mockOrders` passa a conter
    // o pedido B — assim `AdminOrdersView` acha `nextOrder` local (efeito de
    // AdminOrdersView.tsx:564-566) e troca `selectedOrder` SEM passar pela
    // tela de "Carregando Pedido", que desmontaria `OrderDetail` e limparia
    // a confirmação pendente que este teste depende de manter viva.
    mockOrders = [mapOrderFromDB(linhaCruaOutroPedido() as any)];
    const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
    await act(async () => {
      raiz.render(
        <AdminOrdersView
          onNavigate={vi.fn()}
          active={true}
          selectedOrderId={PEDIDO_ID_OUTRO}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // A ficha agora mostra o pedido B — o diálogo de confirmação continua
    // aberto, com o id do pedido A ainda capturado dentro dele.
    expect(hospedeiro.textContent).toContain(PEDIDO_ID_OUTRO.slice(-6));
    const botaoConfirmar = botaoConfirmarAvancoMesmoAssim();
    expect(botaoConfirmar).toBeTruthy();

    await act(async () => {
      botaoConfirmar!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // `updateOrderStatus` é chamado com o id do pedido A (o que estava
    // sendo confirmado), mas o `selectedOrder` no instante da chamada já é
    // o pedido B — os ids NÃO batem, e o 5º argumento tem que vir
    // `undefined`. Se `AdminOrdersView.tsx:971` mandasse
    // `selectedOrder.status` sem conferir o id (mutação i), este teste
    // receberia o status do pedido ERRADO (B) em vez de `undefined`.
    expect(updateOrderStatus).toHaveBeenCalledTimes(1);
    expect(updateOrderStatus.mock.calls[0][0]).toBe(PEDIDO_ID);
    expect(updateOrderStatus.mock.calls[0][4]).toBeUndefined();
  });
});
