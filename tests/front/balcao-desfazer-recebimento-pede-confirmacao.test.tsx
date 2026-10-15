// @vitest-environment jsdom
//
// "Desfazer" o recebimento de uma venda do BALCÃO não pode ser um toque solto.
// Na lista de pedidos e na ficha, o botão desmarcava o recebimento sem
// perguntar — e para venda de balcão isso não tem volta: a venda passa a
// "entregue sem pagamento", sai do caixa e do Financeiro, o estoque continua
// baixado e, mesmo marcando como recebido de novo, a anulação é recusada para
// sempre (a migration 20261204 recusa venda cujo recebimento já foi desfeito).
//
// "Desfazer" abre uma pergunta com "Voltar" em foco em TODO pedido (15/10/2026:
// no do site também, porque desmarcar tira o valor das vendas, do lucro e do
// Financeiro e trava a devolução da cliente). A RPC só roda no botão de
// confirmar: "Desfazer mesmo assim" no balcão, "Desfazer recebimento" no resto.
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: rpcMock,
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

// 08/10/2026, 15:00 em São Paulo.
const AGORA = new Date("2026-10-08T18:00:00.000Z");
const ID = "ped-balcao-1";

function pedido(parcial: Partial<Order> = {}): Order {
  return {
    id: ID,
    customer: {
      name: "Venda no balcão",
      whatsapp: "",
      address: "",
      number: "",
      neighborhood: "",
      city: "",
      state: "",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "delivered",
    paymentStatus: "recebido_na_entrega",
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-08T14:00:00.000Z",
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: "2026-10-08T14:00:00.000Z",
    pagamentoRecebidoPor: null,
    canal: "presencial",
    ...parcial,
  } as Order;
}

/** Pedido do site pago em dinheiro na entrega e já marcado como recebido. */
function pedidoDoSite(): Order {
  return pedido({ id: "ped-site-1", canal: "online" });
}

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  ) as HTMLButtonElement | undefined;
}

describe("Desfazer o recebimento de venda do balcão pede confirmação", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const aoRegistrar = vi.fn();
  const aoSelecionar = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(AGORA);
    rpcMock.mockReset();
    aoRegistrar.mockReset();
    aoSelecionar.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function cartao(order: Order): Promise<void> {
    await act(async () => {
      raiz.render(
        <AdminOrderCard
          order={order}
          viewMode="compact"
          onSelect={aoSelecionar}
          onWhatsApp={vi.fn()}
          onRegistrarPagamento={aoRegistrar}
          registrandoPagamento={false}
        />,
      );
    });
  }

  async function ficha(order: Order): Promise<void> {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail
          order={order}
          onStatusChange={vi.fn()}
          onRegistrarPagamento={aoRegistrar}
        />,
      );
    });
  }

  async function clicar(el: HTMLElement | undefined): Promise<void> {
    expect(el, "botão ausente").toBeTruthy();
    await act(async () => {
      el!.click();
    });
  }

  const pergunta = () => document.querySelector('[role="alertdialog"]');

  describe.each([
    ["lista de pedidos (cartão)", cartao],
    ["ficha do pedido", ficha],
  ] as const)("%s", (_nome, montar) => {
    it("venda do balcão: 'Desfazer' só pergunta — a RPC não roda", async () => {
      await montar(pedido());
      await clicar(botao(hospedeiro, "Desfazer"));

      expect(aoRegistrar).not.toHaveBeenCalled();
      expect(pergunta()).not.toBeNull();
      const texto = pergunta()!.textContent ?? "";
      expect(texto).toContain("não poderá mais ser anulada");
      expect(texto).toContain("o estoque não volta");
      expect(texto).toContain("use Anular");
    });

    it("a ação padrão é 'Voltar' (foco), e 'Voltar' não desfaz nada", async () => {
      await montar(pedido());
      await clicar(botao(hospedeiro, "Desfazer"));

      const voltar = botao(document.body, "Voltar");
      expect(voltar).toBeTruthy();
      expect(document.activeElement).toBe(voltar);

      await clicar(voltar);
      expect(pergunta()).toBeNull();
      expect(aoRegistrar).not.toHaveBeenCalled();
      expect(aoSelecionar).not.toHaveBeenCalled();
    });

    it("'Desfazer mesmo assim' desfaz uma vez, para o pedido certo", async () => {
      await montar(pedido());
      await clicar(botao(hospedeiro, "Desfazer"));
      await clicar(botao(document.body, "Desfazer mesmo assim"));

      expect(aoRegistrar).toHaveBeenCalledTimes(1);
      expect(aoRegistrar).toHaveBeenCalledWith(ID, false);
      expect(pergunta()).toBeNull();
    });

    it("pedido do site: 'Desfazer' só pergunta — a RPC não roda", async () => {
      await montar(pedidoDoSite());
      await clicar(botao(hospedeiro, "Desfazer"));

      expect(aoRegistrar).not.toHaveBeenCalled();
      expect(pergunta()).not.toBeNull();
    });

    it("pedido do site: 'Voltar' está em foco e não desfaz nada", async () => {
      await montar(pedidoDoSite());
      await clicar(botao(hospedeiro, "Desfazer"));

      const voltar = botao(document.body, "Voltar");
      expect(voltar).toBeTruthy();
      expect(document.activeElement).toBe(voltar);

      await clicar(voltar);
      expect(pergunta()).toBeNull();
      expect(aoRegistrar).not.toHaveBeenCalled();
      expect(aoSelecionar).not.toHaveBeenCalled();
    });

    it("pedido do site: só 'Desfazer recebimento' desfaz, uma vez, para o pedido certo", async () => {
      await montar(pedidoDoSite());
      await clicar(botao(hospedeiro, "Desfazer"));
      await clicar(botao(document.body, "Desfazer recebimento"));

      expect(aoRegistrar).toHaveBeenCalledTimes(1);
      expect(aoRegistrar).toHaveBeenCalledWith("ped-site-1", false);
      expect(pergunta()).toBeNull();
    });

    it("pedido do site: a pergunta diz só o que o banco faz, sem falar de balcão", async () => {
      await montar(pedidoDoSite());
      await clicar(botao(hospedeiro, "Desfazer"));

      const texto = pergunta()?.textContent ?? "";
      expect(texto).toContain("Desfazer o recebimento deste pedido?");
      // O pagamento volta a ficar em branco: o valor sai das vendas, do lucro
      // e do Financeiro (crm__vendas e fin__movimentos exigem pagamento
      // marcado).
      expect(texto).toContain("vendas, do lucro e do Financeiro");
      // A cliente não consegue pedir devolução (20261175/20261199).
      expect(texto).toContain("não consegue pedir devolução");
      // Nada de regra que só existe no balcão.
      expect(texto).not.toContain("Anular");
      expect(texto).not.toContain("estoque");
    });

    it("pedido sem canal (antigo) também pergunta antes", async () => {
      await montar(pedido({ id: "ped-antigo", canal: undefined }));
      await clicar(botao(hospedeiro, "Desfazer"));

      expect(pergunta()).not.toBeNull();
      expect(aoRegistrar).not.toHaveBeenCalled();
    });

    it("venda do balcão de OUTRO dia: pergunta, mas sem mandar 'usar Anular' (já não dá)", async () => {
      await montar(pedido({ pagamentoRecebidoEm: "2026-10-07T14:00:00.000Z" }));
      await clicar(botao(hospedeiro, "Desfazer"));

      expect(aoRegistrar).not.toHaveBeenCalled();
      const texto = pergunta()?.textContent ?? "";
      expect(texto).toContain("o estoque não volta");
      expect(texto).not.toContain("use Anular");
    });
  });

  it("no cartão, tocar na pergunta não abre a ficha do pedido por baixo", async () => {
    await cartao(pedido());
    await clicar(botao(hospedeiro, "Desfazer"));
    expect(aoSelecionar).not.toHaveBeenCalled();

    // O clique e a tecla Enter dentro da pergunta sobem pela árvore do React
    // (o portal herda os pais): sem trava, abririam a ficha.
    await act(async () => {
      pergunta()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      botao(document.body, "Voltar")!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
      );
    });
    expect(aoSelecionar).not.toHaveBeenCalled();
  });

  it("com o recebimento em voo, o botão fica desabilitado", async () => {
    await act(async () => {
      raiz.render(
        <AdminOrderCard
          order={pedido()}
          viewMode="compact"
          onSelect={aoSelecionar}
          onWhatsApp={vi.fn()}
          onRegistrarPagamento={aoRegistrar}
          registrandoPagamento
        />,
      );
    });
    expect(botao(hospedeiro, "Desfazer")!.disabled).toBe(true);
  });
});
