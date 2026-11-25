// @vitest-environment jsdom
//
// Provas fortes do cartão do pedido (AdminOrderCard): a frase de cada situação
// de pagamento que a lojista lê na lista, e o botão "Recebi" que NÃO pode
// registrar o dinheiro duas vezes quando o pedido muda de situação com a
// pergunta aberta. Valores escritos à mão.
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
const onRegistrarPagamento = vi.fn();

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

function desenhar(order: Order) {
  act(() =>
    root.render(
      <AdminOrderCard
        order={order}
        viewMode="compact"
        onSelect={vi.fn()}
        onWhatsApp={vi.fn()}
        onRegistrarPagamento={onRegistrarPagamento}
        registrandoPagamento={false}
        onStatusChange={vi.fn()}
        onReceberAntesDeAvancar={vi.fn()}
        onAnularVenda={vi.fn()}
        isOffline={false}
        destaquePrimario
      />,
    ),
  );
}

const texto = () => (host.textContent ?? "").replace(/\s+/g, " ");

beforeEach(() => {
  vi.clearAllMocks();
  onRegistrarPagamento.mockResolvedValue(undefined);
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("Cartão do pedido — a frase de cada situação do pagamento", () => {
  it.each([
    ["expirado", "pending", "Pagamento expirado · pagamento não recebido"],
    ["recusado", "pending", "Pagamento recusado · pedido aberto"],
    ["estornado", "pending", "Pagamento estornado · pedido aberto"],
    ["estornado", "delivered", "Pagamento estornado · pedido finalizado"],
    [
      "pago_apos_expirar",
      "pending",
      "Pago fora do fluxo — precisa de atenção. Confira o pagamento na ficha antes de avançar.",
    ],
  ] as const)("%s num pedido %s diz: %s", (pagamento, etapa, frase) => {
    desenhar(pedido({ paymentStatus: pagamento, status: etapa }));
    expect(texto()).toContain(frase);
  });

  it("pedido cancelado diz 'Pedido cancelado', e a frase do pagamento não aparece por cima", () => {
    desenhar(pedido({ status: "cancelled", paymentStatus: "recusado" }));
    expect(texto()).toContain("Pedido cancelado");
    expect(texto()).not.toContain("Pagamento recusado · pedido aberto");
  });

  it("pagamento em dia (pago, etapa nova) não mostra nenhuma dessas frases de problema", () => {
    desenhar(pedido({ paymentStatus: "pago", status: "pending" }));
    for (const frase of [
      "Pagamento expirado",
      "Pagamento recusado",
      "Pagamento estornado",
      "Pago fora do fluxo",
    ]) {
      expect(texto()).not.toContain(frase);
    }
  });
});

describe("Cartão do pedido — 'Recebi' não registra o dinheiro duas vezes", () => {
  const aReceber = () =>
    pedido({
      paymentMethod: "cash",
      paymentStatus: "aguardando",
      status: "processing",
      pagamentoRecebidoEm: undefined,
    });

  async function abrirPerguntaDoRecebimento() {
    await act(async () =>
      host
        .querySelector<HTMLButtonElement>(
          'button[aria-label^="Ações do pedido"]',
        )!
        .click(),
    );
    const marcar = document.querySelector<HTMLButtonElement>(
      'button[aria-label="Marcar como recebido"]',
    );
    expect(marcar, "item Marcar como recebido").not.toBeNull();
    await act(async () => marcar!.click());
  }

  const recebi = () =>
    Array.from(document.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Recebi",
    ) as HTMLButtonElement | undefined;

  it("com o valor ainda por receber, 'Recebi' está habilitado e registra UMA vez", async () => {
    desenhar(aReceber());
    await abrirPerguntaDoRecebimento();
    expect(document.body.textContent).toContain("Recebeu os R$ 20,00 deste");
    expect(recebi()?.disabled).toBe(false);

    await act(async () => recebi()!.click());
    expect(onRegistrarPagamento).toHaveBeenCalledTimes(1);
    expect(onRegistrarPagamento).toHaveBeenCalledWith("pedido-abc123", true);
  });

  it("se o pedido ficar 'recebido' (outro aparelho) com a pergunta aberta, 'Recebi' trava e não registra de novo", async () => {
    desenhar(aReceber());
    await abrirPerguntaDoRecebimento();
    expect(recebi()?.disabled).toBe(false);

    desenhar({
      ...aReceber(),
      pagamentoRecebidoEm: "2026-10-17T13:00:00Z",
      paymentStatus: "recebido_na_entrega",
    });
    expect(recebi()?.disabled).toBe(true);
    await act(async () => recebi()!.click());
    expect(onRegistrarPagamento).not.toHaveBeenCalled();
  });
});
