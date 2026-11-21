// @vitest-environment jsdom
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import { mapOrderFromDB } from "@/lib/mappers";
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

it.each([
  ["processing", "aguardando", "pix", "2000-01-01T00:00:00Z", true],
  ["shipping", "aguardando", "pix", "2000-01-01T00:00:00Z", true],
  ["delivered", "aguardando", "pix", "2000-01-01T00:00:00Z", false],
  ["processing", "pago", "pix", "2000-01-01T00:00:00Z", false],
  ["processing", "aguardando", "credito", "2000-01-01T00:00:00Z", false],
  ["pending", "aguardando", "pix", "2000-01-01T00:00:00Z", false],
  ["processing", "aguardando", "pix", "2099-01-01T00:00:00Z", false],
] as const)(
  "aviso de Pix: %s, %s, %s, vence em %s",
  (status, paymentStatus, metodoOnline, expiraEm, mostraAviso) => {
    montar(pedido({ status, paymentStatus, metodoOnline, expiraEm }));
    expect(host.textContent?.includes("O Pix deste pedido venceu")).toBe(
      mostraAviso,
    );
  },
);

it("usa o vencimento gravado na cobrança, não a idade do pedido", () => {
  const linha = {
    id: "pedido-abc123",
    status: "processing",
    payment_method: "online",
    payment_status: "aguardando",
    metodo_online: "pix",
    created_at: "2000-01-01T00:00:00Z",
    expires_at: "2099-01-01T00:00:00Z",
  } as Parameters<typeof mapOrderFromDB>[0];
  montar(mapOrderFromDB(linha));
  expect(host.textContent).not.toContain("O Pix deste pedido venceu");

  montar(mapOrderFromDB({ ...linha, expires_at: "2000-01-01T00:30:00Z" }));
  expect(host.textContent).toContain("O Pix deste pedido venceu");
});

it.each([
  ["Em Separação", "processing"],
  ["Pronto para retirar", "shipping"],
] as const)("avisa do Pix vencido na retirada em %s", (_, status) => {
  montar(
    pedido({
      status,
      canal: "online",
      retiradaNaLoja: true,
      paymentStatus: "aguardando",
      metodoOnline: "pix",
      expiraEm: "2000-01-01T00:00:00Z",
    }),
  );
  expect(host.textContent).toContain("O Pix deste pedido venceu");
  expect(host.textContent).toContain(
    "Se você não recebeu por fora e a peça continua na loja, use Cancelar pedido para liberar o estoque.",
  );
});

it.each([
  { caso: "Pix já pago", dados: { paymentStatus: "pago" } },
  {
    caso: "Pix pago com atraso",
    dados: { paymentStatus: "pago_apos_expirar" },
  },
  { caso: "Pix na retirada", dados: { paymentMethod: "pix" } },
  {
    caso: "venda de balcão",
    dados: { canal: "presencial", retiradaNaLoja: false },
  },
  { caso: "prazo futuro", dados: { expiraEm: "2099-01-01T00:00:00Z" } },
  {
    caso: "entrega sem prazo",
    dados: { retiradaNaLoja: false, expiraEm: undefined },
  },
  {
    caso: "entrega com prazo ilegível",
    dados: { retiradaNaLoja: false, expiraEm: "data ilegível" },
  },
] as const)("não mostra aviso de Pix vencido: $caso", ({ dados }) => {
  montar(
    pedido({
      status: "processing",
      retiradaNaLoja: true,
      paymentStatus: "aguardando",
      metodoOnline: "pix",
      expiraEm: "2000-01-01T00:00:00Z",
      ...dados,
    }),
  );
  expect(host.textContent).not.toContain("O Pix deste pedido venceu");
});

it("avisa do Pix vencido sem prometer reposição em retirada com histórico de saída", () => {
  montar(
    pedido({
      status: "shipping",
      retiradaNaLoja: true,
      cancelledAfterShipping: true,
      paymentStatus: "aguardando",
      metodoOnline: "pix",
      expiraEm: "2000-01-01T00:00:00Z",
    }),
  );
  expect(host.textContent).toContain("O Pix deste pedido venceu");
  expect(host.textContent).not.toContain("para liberar o estoque");
});

it("avisa no instante exato do vencimento com fração de segundo e fuso", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-19T15:00:00.123Z"));
  montar(
    pedido({
      status: "shipping",
      paymentStatus: "aguardando",
      metodoOnline: "pix",
      expiraEm: "2026-11-19T12:00:00.123456-03:00",
    }),
  );
  expect(host.textContent).toContain("O Pix deste pedido venceu");
  expect(host.textContent).toContain(
    "Se decidir desistir, use Cancelar pedido.",
  );
  expect(host.textContent).not.toContain("liberar a reserva");
});

it("explica que avançar não confirma um pedido no Pix", async () => {
  montar(pedido({ paymentStatus: "aguardando", metodoOnline: "pix" }));
  await clicar("Avançar sem pagamento confirmado");
  expect(document.body.textContent).toContain(
    "Avançar não confirma o Pix. Se você não recebeu por fora, confira com o cliente antes de seguir.",
  );
  expect(avancar).not.toHaveBeenCalled();
});

it("mantém a confirmação de avanço da retirada sem acrescentar o aviso de reserva", async () => {
  montar(
    pedido({
      retiradaNaLoja: true,
      paymentStatus: "aguardando",
      metodoOnline: "pix",
    }),
  );
  await clicar("Avançar sem pagamento confirmado");
  expect(document.body.textContent).toContain(
    "Este pedido não está com o pagamento confirmado",
  );
  expect(document.body.textContent).not.toContain("Avançar não confirma o Pix");
  expect(avancar).not.toHaveBeenCalled();
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

// Pedido PAGO: o botão de avançar do cartão manda a etapa SEGUINTE do fluxo
// (e a atual como origem esperada), não repete a etapa em que o pedido já está.
it.each([
  { de: "pending", para: "processing" },
  { de: "processing", para: "shipping" },
  { de: "shipping", para: "delivered" },
] as const)(
  "pedido pago em $de: avançar pede $para, com $de como origem",
  async ({ de, para }) => {
    montar(pedido({ status: de, paymentStatus: "pago" }));
    const principal = [...host.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().startsWith("Avançar →"),
    );
    expect(principal, "botão Avançar do cartão").toBeTruthy();
    await act(async () => principal!.click());
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(avancar).toHaveBeenCalledWith("pedido-abc123", para, de);
  },
);

it.each(["aguardando", "recusado", "estornado"] as const)(
  "%s: avançar é secundário, não chama nada antes da confirmação e Voltar só fecha",
  async (paymentStatus) => {
    const status = paymentStatus === "estornado" ? "processing" : "pending";
    montar(
      pedido({
        paymentStatus,
        status,
        ...(status === "processing" && { shippingLabelId: "etiqueta-teste" }),
      }),
    );
    expect(botao("Avançar sem pagamento confirmado")?.className).not.toContain(
      "from-[#",
    );
    await clicar("Avançar sem pagamento confirmado");
    expect(avancar).not.toHaveBeenCalled();
    if (paymentStatus === "estornado") {
      expect(document.body.textContent).toContain(
        "O pagamento deste pedido foi estornado. Se avançar, o pedido segue sem esse pagamento. Depois de finalizado, não dá mais para cancelar e devolver ao estoque.",
      );
      expect(document.body.textContent).not.toContain(
        "O dinheiro deste pedido não entrou.",
      );
    } else {
      expect(document.body.textContent).toContain(
        paymentStatus === "aguardando"
          ? "O pagamento ainda não foi confirmado. Não despache até aparecer “Pago”."
          : "O dinheiro deste pedido não entrou.",
      );
      expect(document.body.textContent).toContain(
        "Se você avançar, a mercadoria caminha para sair mesmo assim — e, depois de finalizado, não dá mais para cancelar e devolver ao estoque. Se a cliente pagou na loja, feche este aviso, cancele o pedido (botão Cancelar pedido) e registre a venda em Vender.",
      );
    }
    // Assim como na ficha, "Voltar" só fecha o aviso.
    await clicar("Voltar");
    expect(avancar).not.toHaveBeenCalled();
    await clicar("Avançar sem pagamento confirmado");
    await clicar("Avançar sem pagamento confirmado");
    expect(avancar).toHaveBeenCalledTimes(1);
    expect(avancar).toHaveBeenCalledWith(
      "pedido-abc123",
      status === "processing" ? "shipping" : "processing",
      status,
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
      clienteSemConta: !order.userId,
    });
    expect(document.body.textContent).toContain(texto);
    if (order.status === "shipping") {
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain(
        "Esperando o produto voltar",
      );
    }
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

const pedidoLocal = pedido({ paymentMethod: "cash", paymentStatus: null });
const pedidoZerado = { ...pedidoLocal, total: 0, discount: 20 };

it("pedido zerado não oferece recebimento manual nem no cartão nem em Ações", async () => {
  montar(pedidoZerado);
  expect.soft(botao("Marcar como recebido")).toBeUndefined();

  await abrirAcoes();
  expect(botao("Fechar ações do pedido")).toBeTruthy();
  expect(botao("Marcar como recebido")).toBeUndefined();
  expect(document.body.textContent).not.toMatch(/Recebeu os R\$\s*0,00/);
});

it("fecha a pergunta de recebimento manual se o pedido passar a não ter valor a pagar", async () => {
  montar(pedidoLocal);
  await clicar("Marcar como recebido");
  expect(document.body.textContent).toMatch(/Recebeu os R\$\s*20,00/);

  montar(pedidoZerado);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(document.body.textContent).not.toMatch(/Recebeu os R\$\s*0,00/);
  expect(receber).not.toHaveBeenCalled();

  // Total zerado com subtotal sem desconto: dado incompleto, não um brinde.
  montar({ ...pedidoLocal, total: 0 });
  expect(botao("Marcar como recebido")).toBeTruthy();
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  await abrirAcoes();
  expect(botao("Marcar como recebido")?.disabled).toBe(false);
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
    await clicar("Avançar sem pagamento confirmado");
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
      order.status === "shipping"
        ? "Recebi"
        : "Avançar sem pagamento confirmado",
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

it("Finalizar sem registrar recebimento avança o pedido, como na ficha", async () => {
  montar(
    pedido({ status: "shipping", paymentMethod: "cash", paymentStatus: null }),
  );
  await abrirAcoes();
  await clicar("Avançar → Finalizado");
  await clicar("Finalizar sem registrar recebimento");
  expect(receber).not.toHaveBeenCalled();
  expect(avancar).toHaveBeenCalledWith(
    "pedido-abc123",
    "delivered",
    "shipping",
  );
});

it.each([
  { status: "shipping" as const },
  { paymentStatus: "estornado" as const },
  { cancelledAfterShipping: true },
  { returnedToSellerAt: "2026-11-06T12:00:00Z" },
  { valorEstornado: 5 },
  { shippingLabelId: "etiqueta-1" },
  { retiradaNaLoja: true },
])("cancelamento aberto perde a validade quando muda %j", async (mudanca) => {
  const aviso = vi.spyOn(toast, "warning");
  const order = pedido();
  montar(order);
  await abrirAcoes();
  await clicar("Cancelar pedido");
  montar({ ...order, ...mudanca });
  expect(document.querySelector('[role="dialog"]')).toBeNull();
  expect(aviso).toHaveBeenCalledWith(
    "O pedido mudou de situação. Confira antes de cancelar.",
  );
  expect(avancar).not.toHaveBeenCalled();
  // Uma nova confirmação usa a situação atual.
  await abrirAcoes();
  await clicar("Cancelar pedido");
  await clicar("Cancelar pedido");
  expect(avancar).toHaveBeenCalledWith(
    order.id,
    "cancelled",
    mudanca.status ?? order.status,
  );
});

it("cancelamento não fecha por mudança que não afeta a pergunta", async () => {
  const order = pedido({ paymentStatus: "aguardando" });
  montar(order);
  await clicar("Cancelar pedido");
  montar({ ...order, total: 19 });
  expect(document.querySelector('[role="dialog"]')).not.toBeNull();
  await clicar("Cancelar pedido");
  expect(avancar).toHaveBeenCalledWith(order.id, "cancelled", "pending");
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

it.each([
  { rotulo: "convidado (sem conta)", userId: undefined, promete: false },
  { rotulo: "cliente com conta", userId: "user-1", promete: true },
])(
  "cancelar pedido de $rotulo: a confirmação só promete aviso no aplicativo para quem tem conta",
  async ({ userId, promete }) => {
    montar(pedido({ paymentStatus: "aguardando", userId }));
    await abrirAcoes();
    await clicar("Cancelar pedido");
    const tela = document.body.textContent ?? "";
    if (promete) {
      expect(tela).toContain("o cliente é avisado no aplicativo");
    } else {
      expect(tela).not.toContain("avisado no aplicativo");
      expect(tela).toContain("NÃO recebe aviso");
    }
    expect(avancar).not.toHaveBeenCalled();
  },
);
