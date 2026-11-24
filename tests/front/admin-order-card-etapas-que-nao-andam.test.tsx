// @vitest-environment jsdom
//
// O servidor NÃO tem máquina de etapas para a lojista: quem tem a permissão pode
// levar o pedido de qualquer etapa para qualquer outra (reativar um cancelado é
// de propósito). Então o que impede o cartão de oferecer "Avançar" num pedido
// cancelado, ou "Cancelar pedido" num pedido já cancelado/entregue, é só a tela.
// Cada teste abaixo existe porque a guarda correspondente foi APAGADA de verdade
// (mutação) e nenhum dos 100+ testes que tocam o cartão e a lista reclamou.
//
// Molde de montagem: admin-order-card-acoes-v6.test.tsx.
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root;
let host: HTMLDivElement;
const avancar = vi.fn();
const receber = vi.fn();

const pedido = (sobre: Partial<Order> = {}): Order => ({
  id: "pedido-abc123",
  customer: { name: "Maria Aparecida", whatsapp: "11999999999" },
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

function montar(order: Order) {
  act(() =>
    root.render(
      <AdminOrderCard
        order={order}
        viewMode="compact"
        onSelect={vi.fn()}
        onWhatsApp={vi.fn()}
        onRegistrarPagamento={receber}
        registrandoPagamento={false}
        onStatusChange={avancar}
        onReceberAntesDeAvancar={receber}
        onAnularVenda={vi.fn()}
        isOffline={false}
        destaquePrimario
      />,
    ),
  );
}

/** Só o corpo do cartão: a folha de ações e as confirmações moram num portal fora do `host`. */
const botoesDoCartao = () => [...host.querySelectorAll("button")];
const textoDe = (b: HTMLButtonElement) =>
  `${b.textContent ?? ""} ${b.getAttribute("aria-label") ?? ""}`
    .replace(/\s+/g, " ")
    .trim();
const botaoDoCartao = (rotulo: string) =>
  botoesDoCartao().find((b) => textoDe(b).includes(rotulo));
/** O botão grande do pé do cartão (o cabeçalho tem outro, "Ver detalhes do pedido #…", sempre presente). */
const botaoGrandeVerDetalhes = () =>
  botoesDoCartao().find((b) => b.textContent?.trim() === "Ver detalhes");
const botaoDaFolha = (rotulo: string) =>
  [
    ...(
      document.querySelector('[role="dialog"]') ?? document.body
    ).querySelectorAll<HTMLButtonElement>("button"),
  ].find((b) => b.getAttribute("aria-label") === rotulo);

async function abrirAcoes() {
  await act(async () =>
    host
      .querySelector<HTMLButtonElement>(
        'button[aria-label^="Ações do pedido"]',
      )!
      .click(),
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
  vi.restoreAllMocks();
});

const pagamentos = [
  undefined,
  "pago",
  "aguardando",
  "recusado",
  "estornado",
  "pago_apos_expirar",
] as const;

describe("cartão do pedido: onde NÃO há próxima etapa", () => {
  it.each(
    (["cancelled", "delivered"] as const).flatMap((status) =>
      pagamentos.map((paymentStatus) => [status, paymentStatus] as const),
    ),
  )(
    "pedido %s (pagamento %s) não oferece Avançar, nem no cartão nem na folha de ações",
    async (status, paymentStatus) => {
      montar(pedido({ status, paymentStatus }));

      expect(botoesDoCartao().map(textoDe).join(" | ")).not.toContain(
        "Avançar",
      );
      // Sem etapa para andar, o botão grande vira o caminho para a ficha.
      expect(botaoGrandeVerDetalhes()).toBeTruthy();

      await abrirAcoes();
      const folha = document.querySelector('[role="dialog"]');
      expect(folha).not.toBeNull();
      expect(
        [...folha!.querySelectorAll("button")].map(textoDe).join(" | "),
      ).not.toContain("Avançar");
      expect(avancar).not.toHaveBeenCalled();
    },
  );

  it("controle: pedido em andamento continua oferecendo a próxima etapa", () => {
    montar(pedido({ status: "processing" }));
    expect(botaoDoCartao("Avançar")).toBeTruthy();
    expect(botaoGrandeVerDetalhes()).toBeFalsy();
  });
});

describe("cartão do pedido: o botão vermelho de Cancelar do corpo", () => {
  const pagamentosQueExibemOBotao = [
    "aguardando",
    "recusado",
    "estornado",
    "pago_apos_expirar",
  ] as const;

  it.each(
    (["cancelled", "delivered"] as const).flatMap((status) =>
      pagamentosQueExibemOBotao.map(
        (paymentStatus) => [status, paymentStatus] as const,
      ),
    ),
  )(
    "pedido %s com pagamento %s não mostra Cancelar pedido (já cancelado ou finalizado)",
    (status, paymentStatus) => {
      montar(pedido({ status, paymentStatus }));
      expect(botaoDoCartao("Cancelar pedido")).toBeUndefined();
    },
  );

  it.each(pagamentosQueExibemOBotao)(
    "controle: pedido em andamento com pagamento %s mostra Cancelar pedido",
    (paymentStatus) => {
      montar(pedido({ status: "processing", paymentStatus }));
      expect(botaoDoCartao("Cancelar pedido")).toBeTruthy();
    },
  );
});

describe("cartão do pedido: pagamento na entrega de pedido cancelado", () => {
  // Pagamento na entrega NÃO é "online": só por isso o cartão cogita receber.
  const naEntrega = (sobre: Partial<Order> = {}) =>
    pedido({
      paymentMethod: "cash",
      paymentStatus: undefined,
      ...sobre,
    });

  it("cancelado e ainda sem recebimento: não convida a Marcar como recebido", async () => {
    montar(naEntrega({ status: "cancelled" }));

    expect(botaoDoCartao("Marcar como recebido")).toBeUndefined();

    await abrirAcoes();
    const item = botaoDaFolha("Marcar como recebido");
    expect(item).toBeTruthy();
    expect(item!.disabled).toBe(true);
    expect(textoDe(item!)).toContain("Indisponível: pedido cancelado.");
    expect(receber).not.toHaveBeenCalled();
  });

  it("cancelado com recebimento já registrado: não oferece Desfazer o recebimento", () => {
    montar(
      naEntrega({
        status: "cancelled",
        paymentStatus: "recebido_na_entrega",
        pagamentoRecebidoEm: "2026-10-17T15:00:00Z",
      }),
    );

    expect(botaoDoCartao("Desfazer")).toBeUndefined();
    expect(host.textContent).not.toContain("Recebido em");
  });

  it("controles: em andamento convida a receber; com recebimento registrado oferece Desfazer", () => {
    montar(naEntrega({ status: "processing" }));
    expect(botaoDoCartao("Marcar como recebido")).toBeTruthy();

    montar(
      naEntrega({
        status: "processing",
        paymentStatus: "recebido_na_entrega",
        pagamentoRecebidoEm: "2026-10-17T15:00:00Z",
      }),
    );
    expect(botaoDoCartao("Desfazer")).toBeTruthy();
    expect(host.textContent).toContain("Recebido em");
  });
});

describe("cartão do pedido: toque repetido no Avançar", () => {
  it("duas batidas antes de a tela redesenhar gravam UMA vez (o botão ainda não travou)", async () => {
    // A gravação demora: o segundo toque cai com a primeira em andamento. As duas
    // batidas ficam dentro do MESMO `act`, então a tela não redesenhou entre elas e
    // o botão ainda não está desabilitado — quem segura o segundo toque é a trava
    // do cartão, não o atributo `disabled`.
    avancar.mockReturnValue(new Promise<void>(() => {}));
    montar(pedido({ status: "processing" }));
    const proximo = botaoDoCartao("Avançar") as HTMLButtonElement;
    expect(proximo).toBeTruthy();
    expect(proximo.disabled).toBe(false);

    await act(async () => {
      proximo.click();
      proximo.click();
    });

    expect(avancar).toHaveBeenCalledTimes(1);
    expect(avancar).toHaveBeenCalledWith(
      "pedido-abc123",
      "shipping",
      "processing",
    );
  });
});
