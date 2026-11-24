// @vitest-environment jsdom
//
// "Meu pedido" — o resumo de valores, o destino (entrega, retirada ou balcão)
// e o quadro da retirada na loja, que muda de frase em cada etapa. Caça por
// mutação: o aviso do quadro da retirada ("Aguarde a confirmação...", "A loja
// já confirmou...") podia ser trocado por qualquer texto sem derrubar teste, e
// o mesmo valia para "Grátis" / "Sem frete (retirada)" e para a linha de
// desconto. O dublê de hooks é o de `order-details-codigo-de-rastreio.test.tsx`.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const pedidoBase = {
  id: "pedido-resumo",
  customer: { name: "Maria Souza", whatsapp: "34999999999" },
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
  paymentMethod: "card",
  status: "processing",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
} as unknown as Order;

let pedidoAtual: Order = pedidoBase;
let horarioDaLoja: string | undefined;
let avaliacoesLigadas = false;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: avaliacoesLigadas,
      whatsappNumber: "34999999999",
      businessHours: horarioDaLoja,
    },
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

const com = (campos: Record<string, unknown>) =>
  ({ ...pedidoBase, ...campos }) as unknown as Order;

describe("OrderDetailsView — resumo, destino e quadro da retirada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    pedidoAtual = pedidoBase;
    horarioDaLoja = undefined;
    avaliacoesLigadas = false;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });
  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function renderizar(pedido: Order) {
    pedidoAtual = pedido;
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    act(() => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-resumo"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const texto = () => (hospedeiro.textContent ?? "").replace(/\s/g, " ");
  // O cartão "Resumo": do título até o fim do cartão (a linha tracejada e o total).
  const linhasDoResumo = () => {
    const titulo = [...hospedeiro.querySelectorAll("h4")].find(
      (h) => h.textContent === "Resumo",
    );
    return (titulo?.parentElement?.textContent ?? "").replace(/\s/g, " ");
  };
  // O parágrafo logo abaixo de "Retire em: ..." / "Local da retirada: ...".
  const avisoDoQuadro = () =>
    [...hospedeiro.querySelectorAll("p")].find((p) =>
      /^(Retire em|Local da retirada|Local de retirada original):/.test(
        p.textContent ?? "",
      ),
    )?.nextElementSibling?.textContent ?? undefined;
  const rotuloDoDestino = () =>
    [...hospedeiro.querySelectorAll("p")].find((p) =>
      ["Endereço de entrega", "Retirada na loja", "Compra na loja"].includes(
        p.textContent ?? "",
      ),
    )?.textContent;

  describe("frete e desconto no resumo", () => {
    it("frete com valor mostra o valor", async () => {
      await renderizar(com({ shipping: 20 }));
      expect(linhasDoResumo()).toContain("FreteR$ 20,00");
      // "Produtos" é o subtotal (100), não o total com frete (120).
      expect(linhasDoResumo()).toContain(
        "ProdutosR$ 100,00FreteR$ 20,00TotalR$ 120,00",
      );
    });

    it("frete zero em entrega diz 'Grátis'", async () => {
      await renderizar(com({ shipping: 0, total: 100 }));
      expect(linhasDoResumo()).toContain("FreteGrátis");
    });

    it("frete zero em retirada diz 'Sem frete (retirada)', nunca 'Grátis'", async () => {
      await renderizar(com({ shipping: 0, total: 100, retiradaNaLoja: true }));
      expect(linhasDoResumo()).toContain("FreteSem frete (retirada)");
      expect(linhasDoResumo()).not.toContain("Grátis");
    });

    it("compra no balcão não tem linha de frete", async () => {
      await renderizar(
        com({
          shipping: 0,
          total: 100,
          canal: "presencial",
          status: "delivered",
        }),
      );
      expect(linhasDoResumo()).not.toContain("Frete");
      expect(linhasDoResumo()).toContain("ProdutosR$ 100,00");
    });

    it("só mostra desconto quando há desconto, com o sinal de menos", async () => {
      await renderizar(com({ discount: 0 }));
      expect(linhasDoResumo()).not.toContain("Desconto");
      await renderizar(com({ discount: 15, total: 105 }));
      expect(linhasDoResumo()).toContain("Desconto- R$ 15,00");
    });
  });

  describe("o nome do total", () => {
    it.each([
      [
        {
          status: "pending",
          paymentMethod: "online",
          paymentStatus: "aguardando",
        },
        "Total",
      ],
      [
        {
          status: "processing",
          paymentMethod: "online",
          paymentStatus: "pago",
        },
        "Total pago",
      ],
      [
        { status: "cancelled", paymentMethod: "online", paymentStatus: "pago" },
        "Total",
      ],
      [
        {
          status: "processing",
          paymentMethod: "online",
          paymentStatus: "pago",
          metodoOnline: "credito",
          parcelas: 3,
        },
        "Total do pedido",
      ],
      [
        {
          status: "processing",
          paymentMethod: "online",
          paymentStatus: "pago",
          metodoOnline: "credito",
          parcelas: 1,
        },
        "Total pago",
      ],
    ])("%j diz '%s'", async (extra, esperado) => {
      await renderizar(com(extra));
      const rotulo = [...hospedeiro.querySelectorAll("span")].find(
        (s) =>
          s.className.includes("text-sm font-semibold text-zinc-500") &&
          ["Total", "Total pago", "Total do pedido"].includes(
            s.textContent ?? "",
          ),
      );
      expect(rotulo?.textContent).toBe(esperado);
    });
  });

  describe("o destino", () => {
    it.each([
      [{}, "Endereço de entrega"],
      [{ retiradaNaLoja: true }, "Retirada na loja"],
      [{ canal: "presencial", status: "delivered" }, "Compra na loja"],
    ])("%j rotula '%s'", async (extra, esperado) => {
      await renderizar(com(extra));
      expect(rotuloDoDestino()).toBe(esperado);
    });

    it("quem vai receber só aparece em entrega, e só quando é outra pessoa", async () => {
      const cliente = {
        name: "Maria Souza",
        whatsapp: "",
        recipientName: "João Lima",
      };
      await renderizar(com({ customer: cliente }));
      expect(texto()).toContain("Recebe: João Lima");

      await renderizar(
        com({ customer: { ...cliente, recipientName: "maria  souza" } }),
      );
      expect(texto()).not.toContain("Recebe:");

      await renderizar(com({ customer: cliente, retiradaNaLoja: true }));
      expect(texto()).not.toContain("Recebe:");

      await renderizar(
        com({ customer: cliente, canal: "presencial", status: "delivered" }),
      );
      expect(texto()).not.toContain("Recebe:");
    });
  });

  describe("o quadro da retirada na loja, etapa por etapa", () => {
    const loja = "Rua da Loja, 100 - Centro";

    it.each([
      ["pending", "Retire em:", "Aguarde a confirmação da loja para retirar."],
      [
        "processing",
        "Retire em:",
        "Aguarde a confirmação da loja para retirar.",
      ],
      ["shipping", "Retire em:", "A loja já confirmou: pode retirar."],
      ["delivered", "Local da retirada:", "Pedido retirado na loja."],
    ])("%s diz '%s' e '%s'", async (status, chamada, aviso) => {
      await renderizar(
        com({ status, retiradaNaLoja: true, enderecoDeRetirada: loja }),
      );
      expect(texto()).toContain(`${chamada} ${loja}`);
      // O aviso é o parágrafo logo abaixo da chamada "Retire em: ..." — o
      // mesmo texto também aparece na frase do cartão de status, e conferir o
      // texto da tela inteira não pega um aviso trocado.
      expect(avisoDoQuadro()).toBe(aviso);
    });

    it("cancelado fala do local ORIGINAL e não dá aviso nenhum", async () => {
      await renderizar(
        com({
          status: "cancelled",
          retiradaNaLoja: true,
          enderecoDeRetirada: loja,
        }),
      );
      expect(texto()).toContain(`Local de retirada original: ${loja}`);
      expect(avisoDoQuadro()).toBeUndefined();
      expect(texto()).not.toContain("Aguarde a confirmação da loja");
      expect(texto()).not.toContain("A loja já confirmou");
      expect(texto()).not.toContain("Pedido retirado na loja.");
    });

    it("o horário da loja só aparece quando o pedido está pronto para retirar", async () => {
      horarioDaLoja = "Seg a Sex, 9h às 18h";
      await renderizar(
        com({
          status: "shipping",
          retiradaNaLoja: true,
          enderecoDeRetirada: loja,
        }),
      );
      expect(texto()).toContain("Horário: Seg a Sex, 9h às 18h");

      await renderizar(
        com({
          status: "processing",
          retiradaNaLoja: true,
          enderecoDeRetirada: loja,
        }),
      );
      expect(texto()).not.toContain("Horário:");
    });

    it("sem horário cadastrado, manda confirmar com a loja (e só quando está pronto)", async () => {
      horarioDaLoja = "   ";
      await renderizar(
        com({
          status: "shipping",
          retiradaNaLoja: true,
          enderecoDeRetirada: loja,
        }),
      );
      expect(texto()).toContain(
        "Confirme o horário de retirada com a loja antes de vir.",
      );
      expect(texto()).not.toContain("Horário:");

      await renderizar(
        com({
          status: "pending",
          retiradaNaLoja: true,
          enderecoDeRetirada: loja,
        }),
      );
      expect(texto()).not.toContain("Confirme o horário de retirada");
    });

    it("o rótulo 'Seu endereço' só aparece na retirada quando a cliente tem endereço no pedido", async () => {
      const semEndereco = com({
        status: "processing",
        retiradaNaLoja: true,
        enderecoDeRetirada: loja,
      });
      await renderizar(semEndereco);
      expect(texto()).not.toContain("Seu endereço");
      // Sem endereço dela no pedido, o nome também não fica solto sob o local da loja.
      expect(texto()).not.toContain("Maria Souza");

      await renderizar(
        com({
          status: "processing",
          retiradaNaLoja: true,
          enderecoDeRetirada: loja,
          customer: {
            name: "Maria Souza",
            whatsapp: "",
            address: "Rua da Cliente",
            number: "7",
          },
        }),
      );
      expect(texto()).toContain("Seu endereço");
      expect(texto()).toContain("Rua da Cliente, 7");
      expect(texto()).toContain("Maria Souza");
    });

    it("pedido de ENTREGA nunca mostra o quadro da retirada", async () => {
      await renderizar(com({ status: "shipping" }));
      expect(texto()).not.toContain("Retire em:");
      expect(texto()).not.toContain("A loja já confirmou: pode retirar.");
    });
  });

  describe("o cartão 'O que achou da compra?' só existe depois de entregue", () => {
    it.each(["pending", "processing", "shipping", "cancelled"])(
      "pedido %s, com avaliações ligadas na loja: sem cartão",
      async (status) => {
        avaliacoesLigadas = true;
        await renderizar(com({ status }));
        expect(texto()).not.toContain("O que achou da compra?");
      },
    );

    it("entregue, com avaliações ligadas: o cartão aparece", async () => {
      avaliacoesLigadas = true;
      await renderizar(com({ status: "delivered" }));
      expect(texto()).toContain("O que achou da compra?");
    });

    it("entregue, com avaliações DESLIGADAS na loja: sem cartão", async () => {
      avaliacoesLigadas = false;
      await renderizar(com({ status: "delivered" }));
      expect(texto()).not.toContain("O que achou da compra?");
    });
  });
});
