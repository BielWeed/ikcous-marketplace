// @vitest-environment jsdom
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import { textoCancelamentoDoPainel } from "@/lib/texto-cancelamento-do-painel";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const avancar = vi.fn();
const receber = vi.fn();
const selecionar = vi.fn();
const anular = vi.fn();
const pedido = (sobre: Partial<Order> = {}): Order => ({
  id: "pedido-abc123",
  customer: {
    name: "Maria Aparecida dos Santos Albuquerque",
    whatsapp: "11999999999",
  },
  items: [
    {
      productId: "p1",
      name: "Caneca térmica Inox 500 ml",
      quantity: 2,
      price: 10,
      image: "",
    },
  ],
  subtotal: 20,
  total: 20,
  shipping: 0,
  discount: 0,
  status: "pending",
  paymentMethod: "online",
  paymentStatus: "pago",
  createdAt: "2026-10-17T12:00:00Z",
  updatedAt: "2026-10-17T12:00:00Z",
  cancelledAfterShipping: false,
  ...sobre,
});
const botao = (texto: string) => {
  const contexto = document.querySelector('[role="dialog"]') ?? document.body;
  return [...contexto.querySelectorAll("button")].find(
    (b) =>
      b.textContent?.trim() === texto || b.getAttribute("aria-label") === texto,
  );
};
async function clicar(texto: string) {
  const b = botao(texto);
  expect(b, texto).toBeTruthy();
  await act(async () => b!.click());
}
async function abrirAcoes() {
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="Ações do pedido"]',
      )!
      .click(),
  );
}
function montar(order: Order, offline = false) {
  act(() =>
    root.render(
      <AdminOrderCard
        order={order}
        viewMode="compact"
        onSelect={selecionar}
        onWhatsApp={vi.fn()}
        onRegistrarPagamento={receber}
        registrandoPagamento={false}
        onStatusChange={avancar}
        onReceberAntesDeAvancar={receber}
        onAnularVenda={anular}
        isOffline={offline}
        destaquePrimario
      />,
    ),
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  avancar.mockResolvedValue(undefined);
  receber.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("a leitura segue status, identificação, cliente/produto, total/pagamento e ação; o nome longo não corta", () => {
  montar(pedido());
  const texto = host.textContent ?? "";
  const trechos = [
    "Novo Pedido",
    "#ABC123",
    "Maria Aparecida",
    "Caneca térmica",
    "20,00",
    "Avançar → Em Separação",
  ];
  expect(trechos.map((t) => texto.indexOf(t))).toEqual(
    [...trechos.map((t) => texto.indexOf(t))].sort((a, b) => a - b),
  );
  const abrir = host.querySelector("button[data-abrir-pedido]");
  expect(abrir?.getAttribute("aria-label")).toContain(
    "Ver detalhes do pedido #ABC123",
  );
  expect(abrir?.querySelector("h4")?.className).not.toMatch(
    /truncate|line-clamp/,
  );
});

it.each(["aguardando", "recusado", "estornado"] as const)(
  "%s: avançar é secundário, não chama nada antes da confirmação e Cancelar só fecha",
  async (paymentStatus) => {
    montar(pedido({ paymentStatus }));
    expect(botao("Avançar mesmo assim")?.className).not.toContain("from-[#");
    await clicar("Avançar mesmo assim");
    expect(avancar).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain(
      "depois de finalizado, não dá mais para cancelar e devolver ao estoque",
    );
    await clicar("Cancelar");
    expect(avancar).not.toHaveBeenCalled();
    await clicar("Avançar mesmo assim");
    await clicar("Avançar mesmo assim");
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(avancar).toHaveBeenCalledWith(
      "pedido-abc123",
      "processing",
      "pending",
    );
    expect(selecionar).not.toHaveBeenCalled();
  },
);

it.each([
  {},
  { status: "shipping" as const },
  { cancelledAfterShipping: true },
  { valorEstornado: 5 },
  {
    paymentStatus: "recebido_na_entrega" as const,
    paymentMethod: "cash" as const,
  },
])(
  "cancelamento mantém todo o aviso financeiro por caso: %j",
  async (sobre) => {
    const order = pedido(sobre);
    montar(order);
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label^="Ações do pedido"]',
        )!
        .click(),
    );
    await clicar("Cancelar pedido");
    const texto = textoCancelamentoDoPainel({
      status: order.status,
      payment_status: order.paymentStatus,
      cancelledAfterShipping: order.cancelledAfterShipping,
      valorEstornado: order.valorEstornado,
    });
    expect(document.body.textContent).toContain(texto);
    expect(avancar).not.toHaveBeenCalled();
    await clicar("Manter pedido");
    expect(avancar).not.toHaveBeenCalled();
  },
);

it("finalizar sem recebimento preserva a pergunta e registra o dinheiro antes do status", async () => {
  montar(
    pedido({ status: "shipping", paymentMethod: "cash", paymentStatus: null }),
  );
  await abrirAcoes();
  await clicar("Avançar → Finalizado");
  expect(receber).not.toHaveBeenCalled();
  expect(avancar).not.toHaveBeenCalled();
  await clicar("Recebi");
  expect(receber).toHaveBeenCalledWith("pedido-abc123", true);
  expect(avancar).toHaveBeenCalledWith(
    "pedido-abc123",
    "delivered",
    "shipping",
  );
  expect(receber.mock.invocationCallOrder[0]).toBeLessThan(
    avancar.mock.invocationCallOrder[0],
  );
});

const casosDeConfirmacao = [
  { status: "pending", paymentStatus: "aguardando", paymentMethod: "online" },
  { status: "shipping", paymentStatus: null, paymentMethod: "cash" },
] as const;

async function abrirConfirmacao(order: Order) {
  montar(order);
  if (order.status === "shipping") {
    await abrirAcoes();
    await clicar("Avançar → Finalizado");
  } else {
    await clicar("Avançar mesmo assim");
  }
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
}

it.each(casosDeConfirmacao)(
  "O1: filtro Todos mantém cartão $status montado; cancelar por props fecha a confirmação sem avançar",
  async (sobre) => {
    const aviso = vi.spyOn(toast, "warning");
    const order = pedido(sobre);
    await abrirConfirmacao(order);
    // Simula a atualização de tempo real no filtro Todos: MESMA instância.
    montar({ ...order, status: "cancelled" });
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(aviso).toHaveBeenCalledWith(
      "O pedido mudou de situação. Confira antes de avançar.",
    );
    expect(avancar).not.toHaveBeenCalled();
    expect(receber).not.toHaveBeenCalled();
  },
);

it.each(casosDeConfirmacao)(
  "O1: confirmação legítima em $status envia a origem capturada",
  async (sobre) => {
    const order = pedido(sobre);
    await abrirConfirmacao(order);
    montar({ ...order, total: 19 });
    await clicar(
      order.status === "shipping" ? "Recebi" : "Avançar mesmo assim",
    );
    expect(avancar).toHaveBeenCalledWith(
      order.id,
      order.status === "shipping" ? "delivered" : "processing",
      order.status,
    );
  },
);

it("se registrar o dinheiro falhar, não finaliza", async () => {
  receber.mockRejectedValue(new Error("falha simulada"));
  montar(
    pedido({ status: "shipping", paymentMethod: "cash", paymentStatus: null }),
  );
  await abrirAcoes();
  await clicar("Avançar → Finalizado");
  await clicar("Recebi");
  expect(avancar).not.toHaveBeenCalled();
});

it("Ainda não finaliza sem gravar recebimento, como na ficha", async () => {
  montar(
    pedido({ status: "shipping", paymentMethod: "cash", paymentStatus: null }),
  );
  await abrirAcoes();
  await clicar("Avançar → Finalizado");
  await clicar("Ainda não");
  expect(receber).not.toHaveBeenCalled();
  expect(avancar).toHaveBeenCalledWith(
    "pedido-abc123",
    "delivered",
    "shipping",
  );
});

it("confirmar cancelamento executa só depois do segundo clique", async () => {
  montar(pedido({ paymentStatus: "aguardando" }));
  await clicar("Cancelar pedido");
  expect(avancar).not.toHaveBeenCalled();
  await clicar("Cancelar pedido");
  expect(avancar).toHaveBeenCalledTimes(1);
  expect(avancar).toHaveBeenCalledWith("pedido-abc123", "cancelled", "pending");
});

it("pagamento fora do fluxo destaca a conferência na ficha", async () => {
  montar(pedido({ paymentStatus: "pago_apos_expirar" }));
  expect(botao("Avançar → Em Separação")).toBeUndefined();
  await clicar("Ver detalhes");
  expect(selecionar).toHaveBeenCalledTimes(1);
  expect(avancar).not.toHaveBeenCalled();
});

it("retirada usa o rótulo já existente; offline mantém leitura e bloqueia escrita", async () => {
  montar(pedido({ status: "processing", retiradaNaLoja: true }), true);
  expect(botao("Avançar → Pronto para retirar")?.disabled).toBe(true);
  expect(host.textContent).toContain("Sem internet agora");
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="Ações do pedido"]',
      )!
      .click(),
  );
  expect(botao("Cancelar pedido")?.disabled).toBe(true);
  expect(avancar).not.toHaveBeenCalled();
});

it("balcão do dia mantém motivo e confirmação explícita; sem telefone a ação fica bloqueada", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-17T15:00:00Z"));
  montar(
    pedido({
      status: "delivered",
      canal: "presencial",
      paymentMethod: "cash",
      paymentStatus: "recebido_na_entrega",
      pagamentoRecebidoEm: "2026-10-17T12:00:00Z",
      customer: { name: "Maria", whatsapp: "" },
    }),
  );
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="Ações do pedido"]',
      )!
      .click(),
  );
  expect(botao("Cancelar pedido")?.disabled).toBe(true);
  await clicar("Anular venda");
  expect(document.body.textContent).toContain(
    "O app não devolve o dinheiro ao cliente",
  );
  expect(botao("Confirmar anulação")?.disabled).toBe(true);
  expect(anular).not.toHaveBeenCalled();
});
