// @vitest-environment jsdom
//
// Defeito (14/10/2026, caçador de leitura de código no commit 28602766): a
// tela do pedido da cliente só chamava `setOrder` na abertura (`loadOrder`) e
// ao cancelar. A lista `orders` — que o tempo real atualiza — só alimentava um
// `ref` que nada lia. Efeito visível: a cliente paga o PIX no app do banco,
// volta ao app e a tela continua em "Aguardando pagamento", com o botão
// "Retomar pagamento", até sair e voltar.
//
// A regra: quando o pedido ABERTO muda na lista, a tela passa a mostrar a
// versão nova — sem refazer a busca, sem trazer versão mais velha por cima da
// mais nova, sem piscar, e sem atropelar um cancelamento em andamento.
//
// POR QUE RENDER DE VERDADE: mesmo raciocínio de
// pedido-mostra-pagamento-confirmado.test.tsx. As funções do dublê do hook são
// ESTÁVEIS (fora do `useOrders`): uma função nova a cada render refaria a
// busca da tela inteira e esconderia exatamente o defeito que se mede aqui.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const ID = "pedido-aberto";

const pedidoAguardando: Order = {
  id: ID,
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "https://exemplo.invalid/foto.jpg",
    },
  ],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "online",
  status: "pending",
  paymentStatus: "aguardando",
  createdAt: "2026-10-14T10:00:00.000Z",
  updatedAt: "2026-10-14T10:00:00.000Z",
  cancelledAfterShipping: false,
};

const pedidoPago: Order = {
  ...pedidoAguardando,
  paymentStatus: "pago",
  updatedAt: "2026-10-14T10:05:00.000Z",
};

const outroPedido: Order = {
  ...pedidoAguardando,
  id: "outro-pedido",
  items: [{ ...pedidoAguardando.items[0], name: "Saia Outra" }],
};

let lista: Order[] = [pedidoAguardando];

// Estáveis de propósito — ver o cabeçalho.
const fetchUserOrders = vi.fn();
const updateOrderStatus = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: lista,
    fetchUserOrders,
    updateOrderStatus,
  }),
  ErroCancelamentoNaoConcluido: class extends Error {},
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderDetailsView — a tela acompanha o pedido quando ele muda na lista", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    lista = [pedidoAguardando];
    fetchUserOrders.mockReset();
    fetchUserOrders.mockResolvedValue([pedidoAguardando]);
    updateOrderStatus.mockReset();
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

  /** Elemento NOVO a cada chamada: o React não refaz o render de um elemento
   * idêntico ao anterior, e aí a lista nova nunca seria lida. */
  async function montarTela() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={ID}
          onBack={() => {}}
          onNavigate={() => {}}
          onRetomarPagamento={() => {}}
        />,
      );
    });
  }

  async function renderizar() {
    await montarTela();
    await act(async () => {
      await Promise.resolve();
    });
  }

  /** O tempo real troca a lista: o componente relê `orders` no próximo render. */
  async function emitirLista(nova: Order[]): Promise<void> {
    lista = nova;
    await montarTela();
    await act(async () => {
      await Promise.resolve();
    });
  }

  const temRetomarPagamento = () =>
    hospedeiro.textContent?.includes("Retomar pagamento") ?? false;

  it("PIX pago no app do banco: a lista traz a versão paga e a tela troca o status e some o 'Retomar pagamento'", async () => {
    await renderizar();
    expect(temRetomarPagamento()).toBe(true);
    expect(hospedeiro.textContent).toContain("Aguardando pagamento");

    await emitirLista([pedidoPago]);

    expect(temRetomarPagamento()).toBe(false);
    expect(hospedeiro.textContent).toContain(
      "Pagamento confirmado. A loja vai iniciar a separação.",
    );
    expect(hospedeiro.textContent).not.toContain("Aguardando pagamento");
    // sem piscar: nunca voltou ao carregamento, e a busca não foi refeita
    expect(hospedeiro.textContent).not.toContain("Sincronizando pedido");
    expect(fetchUserOrders).toHaveBeenCalledTimes(1);
  });

  it("a lista traz o pedido avançando na esteira: o título e o cartão acompanham", async () => {
    await renderizar();

    await emitirLista([
      {
        ...pedidoPago,
        status: "processing",
        updatedAt: "2026-10-14T10:10:00.000Z",
      },
    ]);

    expect(hospedeiro.textContent).toContain("Preparando seu pedido");
    expect(temRetomarPagamento()).toBe(false);
  });

  it("CONTROLE — outro pedido mudando na lista não mexe na tela deste", async () => {
    lista = [pedidoAguardando, outroPedido];
    await renderizar();

    // Este pedido volta como objeto NOVO com o MESMO conteúdo (é o que a busca
    // `fetchUserOrders` faz com a lista inteira): o comparador por conteúdo
    // absorve, a tela não muda.
    await emitirLista([
      { ...pedidoAguardando },
      {
        ...outroPedido,
        paymentStatus: "pago",
        updatedAt: "2026-10-14T10:09:00.000Z",
      },
    ]);

    expect(temRetomarPagamento()).toBe(true);
    expect(hospedeiro.textContent).toContain("Aguardando pagamento");
    expect(hospedeiro.textContent).toContain("Blusa Teste");
    expect(hospedeiro.textContent).not.toContain("Saia Outra");
  });

  it("versão MAIS VELHA na lista não regride a tela", async () => {
    lista = [pedidoPago];
    fetchUserOrders.mockResolvedValue([pedidoPago]);
    await renderizar();
    expect(temRetomarPagamento()).toBe(false);

    // eco atrasado do tempo real, de antes do pagamento
    await emitirLista([
      { ...pedidoAguardando, updatedAt: "2026-10-14T10:01:00.000Z" },
    ]);

    expect(temRetomarPagamento()).toBe(false);
    expect(hospedeiro.textContent).toContain("Pagamento confirmado");
    expect(hospedeiro.textContent).not.toContain("Aguardando pagamento");
  });

  describe("cancelamento em andamento", () => {
    const TEXTO_NAO_PAGUE =
      "Este pedido foi cancelado. Se o pagamento ainda estiver aberto no seu banco, não pague";
    const TEXTO_PAGO_E_CANCELADO =
      "Este pedido foi cancelado, mas o seu pagamento foi recebido.";

    // O pior caso real: o cancelamento chega ao servidor e, ao mesmo tempo, o
    // pagamento é confirmado. O eco do tempo real traz o pedido cancelado COM
    // o dinheiro dentro (`pago_apos_expirar` é o par que o banco grava).
    const canceladoMasPago: Order = {
      ...pedidoAguardando,
      status: "cancelled",
      paymentStatus: "pago_apos_expirar",
      updatedAt: "2026-10-14T10:05:00.000Z",
    };

    /** Abre o cancelamento e o deixa PENDURADO; devolve como terminá-lo. */
    async function iniciarCancelamento() {
      vi.spyOn(globalThis, "confirm").mockReturnValue(true);
      vi.spyOn(console, "error").mockImplementation(() => {});
      let terminar: (falhou: boolean) => void = () => {};
      updateOrderStatus.mockReturnValue(
        new Promise<void>((resolve, reject) => {
          terminar = (falhou) =>
            falhou ? reject(new Error("falha de rede")) : resolve();
        }),
      );
      await renderizar();

      const botaoCancelar = Array.from(
        hospedeiro.querySelectorAll("button"),
      ).find((b) => b.textContent?.includes("Cancelar Pedido"));
      expect(botaoCancelar).toBeDefined();
      await act(async () => {
        botaoCancelar?.click();
      });
      expect(hospedeiro.textContent).toContain("Processando");
      return async (falhou: boolean) => {
        await act(async () => {
          terminar(falhou);
        });
      };
    }

    it("a lista emite no meio: a tela não é mexida enquanto dura, e ao terminar (sucesso) mostra a versão mais nova da lista", async () => {
      const terminar = await iniciarCancelamento();

      await emitirLista([canceladoMasPago]);
      // durante: nada mudou
      expect(hospedeiro.textContent).toContain("Aguardando pagamento");

      await terminar(false);

      // depois: a tela não fica em "não pague" com o dinheiro já dentro
      expect(hospedeiro.textContent).toContain("Pedido cancelado");
      expect(hospedeiro.textContent).toContain(TEXTO_PAGO_E_CANCELADO);
      expect(hospedeiro.textContent).not.toContain(TEXTO_NAO_PAGUE);
    });

    it("a lista emite no meio e o cancelamento FALHA: a tela passa a mostrar a versão mais nova da lista (paga)", async () => {
      const terminar = await iniciarCancelamento();

      await emitirLista([pedidoPago]);
      expect(hospedeiro.textContent).toContain("Aguardando pagamento");

      await terminar(true);

      expect(hospedeiro.textContent).toContain(
        "Pagamento confirmado. A loja vai iniciar a separação.",
      );
      expect(temRetomarPagamento()).toBe(false);
      expect(hospedeiro.textContent).not.toContain("Aguardando pagamento");
    });

    it("CONTROLE — a lista não emite nada: sucesso mostra cancelado com o pagamento de antes", async () => {
      const terminar = await iniciarCancelamento();

      await terminar(false);

      expect(hospedeiro.textContent).toContain("Pedido cancelado");
      expect(hospedeiro.textContent).toContain(TEXTO_NAO_PAGUE);
    });

    it("CONTROLE — a lista não emite nada: falha deixa a tela como estava", async () => {
      const terminar = await iniciarCancelamento();

      await terminar(true);

      expect(hospedeiro.textContent).toContain("Aguardando pagamento");
      expect(temRetomarPagamento()).toBe(true);
    });

    // eco atrasado, de antes da tela abrir (e com "pago", para ser notado)
    const ecoMaisVelho: Order = {
      ...pedidoPago,
      updatedAt: "2026-10-14T09:00:00.000Z",
    };

    it("a lista emite no meio uma versão MAIS VELHA e o cancelamento dá certo: não regride a tela", async () => {
      const terminar = await iniciarCancelamento();
      await emitirLista([ecoMaisVelho]);

      await terminar(false);

      expect(hospedeiro.textContent).toContain("Pedido cancelado");
      expect(hospedeiro.textContent).toContain(TEXTO_NAO_PAGUE);
    });

    // A atualização OTIMISTA do hook: muda o status na lista sem mexer em
    // `updatedAt`. Só o eco REAL do servidor (que grava `updated_at = NOW()`)
    // avança a data.
    const otimista: Order = { ...pedidoAguardando, status: "cancelled" };

    it("b2 — a lista emite a otimista e depois uma busca velha com a MESMA data, e o cancelamento dá certo: a tela fica cancelada", async () => {
      const terminar = await iniciarCancelamento();

      await emitirLista([otimista]);
      // busca que nasceu antes do cancelamento: pendente, mesma data
      await emitirLista([{ ...pedidoAguardando }]);

      await terminar(false);

      expect(hospedeiro.textContent).toContain("Pedido cancelado");
      expect(hospedeiro.textContent).toContain(TEXTO_NAO_PAGUE);
      const botaoCancelar = Array.from(
        hospedeiro.querySelectorAll("button"),
      ).find((b) => b.textContent?.includes("Cancelar Pedido"));
      expect(botaoCancelar).toBeUndefined();
    });

    it("b3 — só a otimista foi emitida e o cancelamento FALHA: o estado final NÃO é cancelado", async () => {
      const terminar = await iniciarCancelamento();

      await emitirLista([otimista]);

      await terminar(true);

      expect(hospedeiro.textContent).not.toContain("Pedido cancelado");
      expect(hospedeiro.textContent).toContain("Aguardando pagamento");
      expect(temRetomarPagamento()).toBe(true);
    });

    it.each([
      ["ilegível", "lixo"],
      ["ausente", undefined],
    ])(
      "a versão emitida no meio com data %s não é aplicada, mesmo com conteúdo diferente",
      async (_nome, data) => {
        const terminar = await iniciarCancelamento();

        await emitirLista([
          { ...pedidoPago, updatedAt: data as unknown as string },
        ]);

        await terminar(false);

        expect(hospedeiro.textContent).toContain("Pedido cancelado");
        expect(hospedeiro.textContent).toContain(TEXTO_NAO_PAGUE);
      },
    );

    it("a lista emite no meio uma versão MAIS VELHA e o cancelamento falha: não regride a tela", async () => {
      const terminar = await iniciarCancelamento();
      await emitirLista([ecoMaisVelho]);

      await terminar(true);

      expect(hospedeiro.textContent).toContain("Aguardando pagamento");
      expect(temRetomarPagamento()).toBe(true);
    });
  });

  it("a busca que volta atrasada, mais velha que o que a lista já trouxe, não desfaz a atualização", async () => {
    let responderBusca: (pedidos: Order[]) => void = () => {};
    fetchUserOrders.mockReturnValue(
      new Promise<Order[]>((resolve) => {
        responderBusca = resolve;
      }),
    );
    await montarTela();
    // a tela já pintou com o que estava em memória; a busca ainda não voltou
    expect(hospedeiro.textContent).toContain("Aguardando pagamento");

    await emitirLista([pedidoPago]);
    expect(hospedeiro.textContent).toContain("Pagamento confirmado");

    // a resposta da busca nasceu ANTES do pagamento
    await act(async () => {
      responderBusca([pedidoAguardando]);
    });

    expect(hospedeiro.textContent).toContain("Pagamento confirmado");
    expect(temRetomarPagamento()).toBe(false);
  });
});
