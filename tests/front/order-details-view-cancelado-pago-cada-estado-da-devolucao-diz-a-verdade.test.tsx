// @vitest-environment jsdom
//
// Buracos de prova do detalhe do pedido da cliente achados por MUTAÇÃO (plantar
// um defeito de uma linha em `OrderDetailsView.tsx` e ver se algum teste cai):
// a frase do cartão de um pedido CANCELADO e PAGO (`cancelledDescription`)
// depende de três coisas — o tipo de pagamento confirmado, a leitura da
// devolução (conferindo / não deu para conferir / lida) e o desfecho nas linhas
// do livro (em curso / concluída / sem devolução automática). Cada combinação
// diz uma verdade diferente sobre o dinheiro da cliente; trocar duas delas não
// derrubava nenhum teste vizinho. Aqui o hook da devolução é controlado, e cada
// estado confere a frase certa E a ausência das frases dos outros estados.
// Também fica fixo o que muda quando o pedido veio do balcão e foi anulado.
// Mutantes EQUIVALENTES (não dá para derrubar): o valor padrão `"lida"` do
// parâmetro `leituraDaDevolucao` de `cancelledDescription` — a tela sempre
// passa o valor explicitamente — e o `&& !retiradaPronta` de `jaFoiEnviado` na
// caixa "Cancelar pedido": `textoConfirmarCancelamento` já olha a retirada
// pronta ANTES de olhar o pedido enviado, então o texto sai igual.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

import type { Order, PaymentStatus } from "@/types";

const estado = vi.hoisted(() => ({
  pedido: {} as Record<string, unknown>,
  usuario: { id: "user-1" } as { id: string } | null,
  avaliacoes: false,
  atualizarStatus: vi.fn(),
  devolucao: {
    linhas: [] as unknown[],
    lido: true,
    desistiu: false,
    carregando: false,
    erro: false,
  },
}));

vi.mock("@/hooks/useOrders", () => ({
  ErroCancelamentoNaoConcluido: class extends Error {},
  useOrders: () => ({
    orders: [estado.pedido],
    ordersLoadError: false,
    fetchUserOrders: vi.fn().mockResolvedValue([estado.pedido]),
    updateOrderStatus: estado.atualizarStatus,
    reenviarComprovante: vi.fn(),
  }),
}));
vi.mock("@/hooks/useDevolucaoDoPedidoCliente", () => ({
  useDevolucaoDoPedidoCliente: () => estado.devolucao,
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.usuario, profile: null, loading: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: estado.avaliacoes, whatsappNumber: "34999999999" },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE = "Este pedido foi cancelado, mas o seu pagamento foi recebido.";
const CONFERINDO = "Conferindo sua devolução…";
const NAO_CONSEGUI = "Não consegui conferir agora.";
const VOLTA_SOZINHO = "O dinheiro volta sozinho para você.";
const FALE_COM_A_LOJA = `${BASE} Fale com a loja para resolver.`;

function pedido(extra: Partial<Order>): Record<string, unknown> {
  return {
    id: "pedido-1",
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [
      { productId: "p1", name: "Blusa", price: 100, quantity: 1, image: "" },
    ],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "online",
    metodoOnline: "pix",
    status: "cancelled",
    paymentStatus: "pago",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    cancelledAfterShipping: false,
    ...extra,
  };
}

const linha = (status: string) => ({
  amount: 100,
  status,
  solicitado_por: "sistema",
  concluido_em: null,
});

describe("OrderDetailsView — pedido cancelado e pago: cada estado da devolução diz a verdade", () => {
  let raiz: Root;
  let host: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/OrderDetailsView");
  }, 60_000);

  beforeEach(() => {
    estado.usuario = { id: "user-1" };
    estado.avaliacoes = false;
    estado.atualizarStatus.mockReset();
    estado.devolucao = {
      linhas: [],
      lido: true,
      desistiu: false,
      carregando: false,
      erro: false,
    };
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  async function abrir(extra: Partial<Order>) {
    estado.pedido = pedido(extra);
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-1"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
    return host.textContent ?? "";
  }

  describe.each<PaymentStatus>(["pago", "pago_apos_expirar"])(
    "pagamento '%s'",
    (pagamento) => {
      it("ainda conferindo a devolução: diz só o fato e que está conferindo", async () => {
        estado.devolucao = { ...estado.devolucao, lido: false };
        const texto = await abrir({ paymentStatus: pagamento });
        expect(texto).toContain(`${BASE} ${CONFERINDO}`);
        expect(texto).not.toContain(NAO_CONSEGUI);
        expect(texto).not.toContain(VOLTA_SOZINHO);
        expect(texto).not.toContain("Fale com a loja para resolver");
      });

      it("desistiu de conferir: diz que não conseguiu, sem prometer nem negar a devolução", async () => {
        estado.devolucao = { ...estado.devolucao, lido: false, desistiu: true };
        const texto = await abrir({ paymentStatus: pagamento });
        expect(texto).toContain(`${BASE} ${NAO_CONSEGUI}`);
        expect(texto).not.toContain(CONFERINDO);
        expect(texto).not.toContain(VOLTA_SOZINHO);
        expect(texto).not.toContain("Fale com a loja para resolver");
      });

      it("lida, devolução EM CURSO: 'o dinheiro volta sozinho', com a orientação do Pix", async () => {
        estado.devolucao = {
          ...estado.devolucao,
          linhas: [linha("em_processamento")],
        };
        const texto = await abrir({ paymentStatus: pagamento });
        expect(texto).toContain(
          `${BASE} ${VOLTA_SOZINHO} No Pix, o valor volta para a conta de origem.`,
        );
        expect(texto).not.toContain("Fale com a loja para resolver");
        expect(texto).not.toContain(CONFERINDO);
      });

      it("lida, devolução CONCLUÍDA: só o fato, sem prometer o que já aconteceu", async () => {
        estado.devolucao = {
          ...estado.devolucao,
          linhas: [linha("concluido")],
        };
        const texto = await abrir({ paymentStatus: pagamento });
        expect(texto).toContain(BASE);
        expect(texto).not.toContain(VOLTA_SOZINHO);
        expect(texto).not.toContain("Fale com a loja para resolver");
        expect(texto).not.toContain(CONFERINDO);
      });

      it("lida, SEM devolução automática (nenhuma linha, ou só 'falhou'): fale com a loja", async () => {
        const vazio = await abrir({ paymentStatus: pagamento });
        expect(vazio).toContain(FALE_COM_A_LOJA);
        expect(vazio).not.toContain(VOLTA_SOZINHO);

        act(() => raiz.unmount());
        raiz = createRoot(host);
        estado.devolucao = { ...estado.devolucao, linhas: [linha("falhou")] };
        const falhou = await abrir({ paymentStatus: pagamento });
        expect(falhou).toContain(FALE_COM_A_LOJA);
        expect(falhou).not.toContain(VOLTA_SOZINHO);
      });
    },
  );

  describe("outras decisões da ficha", () => {
    it("pedido em separação com Pix ainda aguardando: o aviso 'Já pagou? Não faça outro pedido' acompanha a etapa", async () => {
      const texto = await abrir({
        status: "processing",
        paymentStatus: "aguardando",
      });
      expect(texto).toContain("Já pagou? Não faça outro pedido.");
    });

    it("pedido em separação com cartão aguardando: sem o aviso do Pix", async () => {
      const texto = await abrir({
        status: "processing",
        paymentStatus: "aguardando",
        metodoOnline: "credito",
      });
      expect(texto).not.toContain("Já pagou? Não faça outro pedido.");
    });

    it("pedido entregue: o cartão 'O que achou da compra?' só aparece para quem tem conta", async () => {
      estado.avaliacoes = true;
      const logada = await abrir({
        status: "delivered",
        paymentStatus: "pago",
      });
      expect(logada).toContain("O que achou da compra?");

      act(() => raiz.unmount());
      raiz = createRoot(host);
      estado.usuario = null;
      const convidada = await abrir({
        status: "delivered",
        paymentStatus: "pago",
      });
      expect(convidada).not.toContain("O que achou da compra?");
      expect(convidada).toContain("Meu pedido");
    });

    it("rótulo do total: crédito parcelado e entregue é 'Total do pedido'; cancelado volta a ser 'Total'", async () => {
      const entregue = await abrir({
        status: "delivered",
        paymentStatus: "pago",
        metodoOnline: "credito",
        parcelas: 2,
      });
      expect(entregue).toContain("Total do pedido");

      act(() => raiz.unmount());
      raiz = createRoot(host);
      const cancelado = await abrir({
        status: "cancelled",
        paymentStatus: "pago",
        metodoOnline: "credito",
        parcelas: 2,
      });
      expect(cancelado).not.toContain("Total do pedido");
      expect(cancelado).not.toContain("Total pago");
    });

    it("dois toques seguidos em 'Cancelar pedido' (na caixa de confirmação) cancelam UMA vez", async () => {
      estado.atualizarStatus.mockImplementation(() => new Promise(() => {}));
      await abrir({ status: "pending", paymentStatus: "aguardando" });
      const abrirCaixa = [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Cancelar Pedido"),
      );
      expect(abrirCaixa).toBeDefined();
      await act(async () => {
        abrirCaixa?.click();
      });
      const confirmar = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent === "Cancelar pedido",
      );
      expect(confirmar).toBeDefined();
      await act(async () => {
        confirmar?.click();
        confirmar?.click();
      });
      expect(estado.atualizarStatus).toHaveBeenCalledTimes(1);
      expect(estado.atualizarStatus.mock.calls[0].slice(0, 2)).toEqual([
        "pedido-1",
        "cancelled",
      ]);
      // A etapa que a tela mostrava vai junto: o servidor recusa se mudou.
      expect(estado.atualizarStatus.mock.calls[0][4]).toBe("pending");
    });

    it("convidado (sem conta) não vê 'Cancelar Pedido' num pedido em andamento", async () => {
      estado.usuario = null;
      await abrir({ status: "pending", paymentStatus: "aguardando" });
      const botao = [...host.querySelectorAll("button")].find((b) =>
        b.textContent?.includes("Cancelar Pedido"),
      );
      expect(botao).toBeUndefined();
    });

    it("compra para OUTRA pessoa: a entrega em casa mostra quem recebe; a retirada na loja e o balcão não", async () => {
      const clienteComDestinataria = {
        name: "Cliente Teste",
        whatsapp: "34999999999",
        recipientName: "Outra Pessoa",
      };
      const entrega = await abrir({
        status: "shipping",
        paymentStatus: "pago",
        customer: clienteComDestinataria,
      } as Partial<Order>);
      expect(entrega).toContain("Outra Pessoa");

      act(() => raiz.unmount());
      raiz = createRoot(host);
      const retirada = await abrir({
        status: "shipping",
        paymentStatus: "pago",
        retiradaNaLoja: true,
        customer: clienteComDestinataria,
      } as Partial<Order>);
      expect(retirada).not.toContain("Outra Pessoa");

      act(() => raiz.unmount());
      raiz = createRoot(host);
      const balcao = await abrir({
        status: "delivered",
        paymentStatus: "pago",
        canal: "presencial",
        customer: clienteComDestinataria,
      } as Partial<Order>);
      expect(balcao).not.toContain("Outra Pessoa");
    });
  });

  it("estornado de pedido online: o dinheiro já foi devolvido", async () => {
    const texto = await abrir({ paymentStatus: "estornado" });
    expect(texto).toContain(
      "Este pedido foi cancelado e o seu pagamento foi estornado: o dinheiro foi devolvido.",
    );
    expect(texto).not.toContain("anulada pela loja");
  });

  it("estornado de venda do BALCÃO: compra anulada, valor combinado com a loja (não afirma devolução)", async () => {
    const texto = await abrir({
      paymentStatus: "estornado",
      canal: "presencial",
    });
    expect(texto).toContain(
      "Esta compra foi anulada pela loja. A devolução do valor é combinada diretamente com a loja.",
    );
    expect(texto).not.toContain("o dinheiro foi devolvido");
  });

  it("pagamento recebido na ENTREGA e cancelado: não é do Mercado Pago, a loja resolve", async () => {
    const texto = await abrir({
      paymentStatus: "recebido_na_entrega",
      paymentMethod: "cash",
    });
    expect(texto).toContain(FALE_COM_A_LOJA);
    expect(texto).not.toContain(VOLTA_SOZINHO);
    expect(texto).not.toContain(CONFERINDO);
  });
});
