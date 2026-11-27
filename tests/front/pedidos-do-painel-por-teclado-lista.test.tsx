// @vitest-environment jsdom
//
// Lista de Pedidos do painel usada só com teclado ou leitor de tela (lote 487):
//  2) abrir "Ver detalhes do pedido #N" e voltar jogava o foco no começo da
//     página: a volta devolve o foco ao botão do pedido que foi aberto;
//  3) "Avançar" do cartão virava `disabled` enquanto gravava (o Chrome joga o
//     foco no <body>), e o cartão que sai da lista ("Em Aberto" sem os
//     finalizados) levava o foco junto. Agora o foco fica no botão enquanto
//     grava, vai ao cartão seguinte quando o seu some, e o status novo é
//     anunciado numa região de aviso.
import type { Order, OrderStatus } from "@/types";
import { act, useCallback, useState } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn((nome: string) =>
      nome === "devolucoes_do_pedido" ? { data: [], error: null } : undefined,
    ),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: {} }),
}));

let pedidosIniciais: Order[] = [];
// Quem chama decide quando a gravação termina e se o cartão sai da lista.
let gravacao: {
  soltar: () => void;
  sairDaLista: boolean;
} = { soltar: () => {}, sairDaLista: false };
const mudarStatus = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => {
    const [orders, setOrders] = useState<Order[]>(() => pedidosIniciais);
    const updateOrderStatus = useCallback(
      (orderId: string, status: OrderStatus) => {
        mudarStatus(orderId, status);
        return new Promise<undefined>((resolve) => {
          gravacao.soltar = () => {
            setOrders((prev) =>
              gravacao.sairDaLista
                ? prev.filter((o) => o.id !== orderId)
                : prev.map((o) => (o.id === orderId ? { ...o, status } : o)),
            );
            resolve(undefined);
          };
        });
      },
      [],
    );
    return {
      orders,
      totalOrders: orders.length,
      isLoaded: true,
      loading: false,
      loadOrders: vi.fn(),
      updateOrderStatus,
      registrarPagamentoRecebido: vi.fn(),
      confirmarRetornoDoProduto: vi.fn(),
      pedidosCancelados: [],
      carregandoPedidosCancelados: false,
      fetchPedidosCancelados: vi.fn().mockResolvedValue([]),
      pedidosCanceladosIncompleto: false,
    };
  },
}));
vi.mock("@/hooks/useAnalytics", () => ({
  useAnalytics: () => ({ stats: null, fetchExecutiveSummary: vi.fn() }),
}));
vi.mock("@/hooks/useNumerosDosPedidos", () => ({
  useNumerosDosPedidos: () => ({ pedirRecarga: vi.fn() }),
}));
vi.mock("@/hooks/useDevolucoesAdmin", () => ({
  useDevolucoesAbertas: () => ({ abertas: 0 }),
}));
vi.mock("@/hooks/useEstornosEmCursoDosPedidos", () => ({
  useEstornosEmCursoDosPedidos: () => ({ porPedido: {}, recarregar: vi.fn() }),
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function pedido(id: string, parcial: Partial<Order> = {}): Order {
  return {
    id,
    customer: { name: "Maria", whatsapp: "34999998888" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "online",
    status: "pending",
    paymentStatus: "pago",
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-08T14:00:00.000Z",
    cancelledAfterShipping: false,
    returnedToSellerAt: null,
    ...parcial,
  };
}

const A = "aaaaaaaa-0000-0000-0000-000000000001";
const B = "bbbbbbbb-0000-0000-0000-000000000002";

const onNavigate = vi.fn();
let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  globalThis.localStorage.clear();
  onNavigate.mockClear();
  mudarStatus.mockClear();
  gravacao = { soltar: () => {}, sairDaLista: false };
  pedidosIniciais = [pedido(A), pedido(B)];
  hospedeiro = document.createElement("div");
  document.body.append(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  globalThis.localStorage.clear();
});

async function montar(selectedOrderId: string | null = null) {
  const { AdminOrdersView } = await import("@/views/admin/AdminOrdersView");
  await act(async () => {
    raiz.render(
      <AdminOrdersView
        active
        onNavigate={onNavigate}
        selectedOrderId={selectedOrderId}
      />,
    );
  });
}

function cartao(id: string) {
  return [...hospedeiro.querySelectorAll("article")].find(
    (artigo) =>
      artigo
        .querySelector("[data-abrir-pedido]")
        ?.getAttribute("aria-label")
        ?.includes(numero(id)) ?? false,
  );
}
// Mesma regra de `numeroDoPedido`: os 6 últimos caracteres, em maiúsculas.
function numero(id: string) {
  return id.slice(-6).toUpperCase();
}
const abrir = (id: string) =>
  cartao(id)?.querySelector<HTMLButtonElement>("[data-abrir-pedido]") ?? null;
const avancarDo = (id: string) =>
  [...(cartao(id)?.querySelectorAll("button") ?? [])].find((b) =>
    /Avançar|Processando/.test(b.textContent ?? ""),
  ) as HTMLButtonElement | undefined;

it("abrir a ficha e voltar devolve o foco ao botão do pedido aberto", async () => {
  await montar();
  const botao = abrir(B);
  expect(botao).not.toBeNull();
  botao?.focus();
  await act(async () => botao?.click());
  expect(onNavigate).toHaveBeenCalledWith("admin-orders", B);

  await montar(B);
  expect(hospedeiro.querySelector("h1")?.textContent).toContain("Pedido");
  await montar(null);

  expect(document.activeElement).toBe(abrir(B));
});

it("enquanto grava, Avançar do cartão fica aria-disabled e com o foco", async () => {
  await montar();
  const botao = avancarDo(A) as HTMLButtonElement;
  expect(botao.textContent).toContain("Avançar");
  botao.focus();
  await act(async () => botao.click());
  expect(mudarStatus).toHaveBeenCalledWith(A, "processing");

  const gravando = avancarDo(A) as HTMLButtonElement;
  expect(gravando.textContent).toContain("Processando");
  expect(gravando.disabled).toBe(false);
  expect(gravando.getAttribute("aria-disabled")).toBe("true");
  expect(document.activeElement).toBe(gravando);
  await act(async () => gravando.click());
  expect(mudarStatus).toHaveBeenCalledTimes(1);

  await act(async () => gravacao.soltar());
  expect(document.activeElement).toBe(avancarDo(A));
  expect(
    hospedeiro.querySelector('[role="status"]#aviso-do-status-do-pedido')
      ?.textContent,
  ).toBe(`Pedido #${numero(A)} agora está Em Separação.`);
});

it("o cartão que sai da lista passa o foco ao cartão seguinte e anuncia o status", async () => {
  pedidosIniciais = [
    pedido(A, { status: "shipping" }),
    pedido(B, { status: "shipping" }),
  ];
  gravacao.sairDaLista = true;
  await montar();
  const botao = avancarDo(A) as HTMLButtonElement;
  expect(botao.textContent).toContain("Finalizado");
  botao.focus();
  await act(async () => botao.click());
  await act(async () => gravacao.soltar());

  expect(cartao(A)).toBeUndefined();
  expect(document.activeElement).toBe(abrir(B));
  expect(
    document.querySelector("#aviso-do-status-do-pedido")?.textContent,
  ).toBe(`Pedido #${numero(A)} agora está Finalizado.`);
});
