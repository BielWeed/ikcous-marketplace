// @vitest-environment jsdom
//
// Defeito da cliente (14/10/2026): num pedido CANCELADO e PAGO online, o
// detalhe dizia "o pagamento foi recebido. Fale com a loja para resolver."
// até a consulta de devolução voltar — e para sempre se ela falhasse. Causa:
// a tela lia o hook só como `{ linhas }` e descartava carregando/erro; antes
// da resposta `linhas` é `[]`, e `[]` é exatamente o "sem devolução
// automática" que manda falar com a loja. "Ainda não sei" se passava por
// "sei que não há".
//
// Os QUATRO estados da consulta, na tela de verdade (hook real, só o Supabase
// é dublê):
//   carregando — "Conferindo sua devolução…", nada de "fale com a loja";
//   erro       — continua "Conferindo…" enquanto há nova tentativa e, esgotadas
//                as tentativas, "Não consegui conferir agora…";
//   vazio      — leitura boa sem linha: a frase de sempre ("Fale com a loja");
//   com linha  — leitura boa com devolução em curso: "volta sozinho".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order, PaymentStatus } from "@/types";

const pedidoBase: Order = {
  id: "pedido-devolucao",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
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
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  status: "cancelled",
  paymentStatus: "pago",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

let pedidoAtual: Order = pedidoBase;

type Resposta =
  | "nunca-volta"
  | "erro"
  | "vazio"
  | "com-linha-em-curso"
  | "com-linha-concluida";
// Fila de respostas, uma por leitura de `order_refunds`; a última se repete.
let respostas: Resposta[] = ["vazio"];
let leiturasFeitas = 0;

function proximaResposta(): Promise<{ data: unknown; error: unknown }> {
  const qual =
    respostas[Math.min(leiturasFeitas, respostas.length - 1)] ?? "vazio";
  leiturasFeitas += 1;
  switch (qual) {
    case "nunca-volta":
      return new Promise(() => {});
    case "erro":
      return Promise.resolve({ data: null, error: { message: "rede caiu" } });
    case "com-linha-em-curso":
      return Promise.resolve({
        data: [
          {
            amount: 100,
            status: "solicitado",
            solicitado_por: "sistema",
            concluido_em: null,
          },
        ],
        error: null,
      });
    case "com-linha-concluida":
      return Promise.resolve({
        data: [
          {
            amount: 100,
            status: "concluido",
            solicitado_por: "sistema",
            concluido_em: "2026-10-14T10:00:00Z",
          },
        ],
        error: null,
      });
    default:
      return Promise.resolve({ data: [], error: null });
  }
}

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoAtual]),
    updateOrderStatus: vi.fn(),
  }),
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
        eq: () => ({
          in: () => Promise.resolve({ data: [], error: null }),
          order: () => proximaResposta(),
        }),
      }),
    }),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CONFERINDO = "Conferindo sua devolução…";
const NAO_CONSEGUI =
  "Não consegui conferir agora. Tente de novo mais tarde ou fale com a loja.";
const FRASE_FALE_COM_A_LOJA =
  "Este pedido foi cancelado, mas o seu pagamento foi recebido. Fale com a loja para resolver.";

describe("OrderDetailsView — pedido cancelado e pago não afirma nada da devolução antes de saber", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    respostas = ["vazio"];
    leiturasFeitas = 0;
    pedidoAtual = pedidoBase;
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
  });

  async function soltarMicrotarefas() {
    await act(async () => {
      for (let i = 0; i < 6; i++) await Promise.resolve();
    });
  }

  async function renderizar(paymentStatus: PaymentStatus = "pago") {
    pedidoAtual = { ...pedidoBase, paymentStatus };
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-devolucao"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await soltarMicrotarefas();
  }

  async function passar(ms: number) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(ms);
    });
    await soltarMicrotarefas();
  }

  const texto = () => hospedeiro.textContent ?? "";
  const ocorrencias = (trecho: string) => texto().split(trecho).length - 1;

  it("CARREGANDO: diz que está conferindo e não afirma 'fale com a loja' nem 'volta sozinho'", async () => {
    respostas = ["nunca-volta"];

    await renderizar();

    // Dois lugares falam da devolução (cartão de status e bloco "Pagamento"):
    // os dois esperam a leitura.
    expect(ocorrencias(CONFERINDO)).toBe(2);
    expect(texto()).not.toContain("Fale com a loja para resolver");
    expect(texto()).not.toContain("volta sozinho");
    expect(texto()).not.toContain(NAO_CONSEGUI);
  });

  it("ERRO: segue 'Conferindo…' enquanto há nova tentativa; esgotadas, diz que não conseguiu — nunca a frase afirmativa", async () => {
    respostas = ["erro"];

    await renderizar();
    // 1ª leitura falhou, a 2ª está agendada: ainda é "não sei".
    expect(leiturasFeitas).toBe(1);
    expect(texto()).toContain(CONFERINDO);
    expect(texto()).not.toContain(NAO_CONSEGUI);

    await passar(4_000);
    expect(leiturasFeitas).toBe(2);
    expect(texto()).toContain(CONFERINDO);
    expect(texto()).not.toContain(NAO_CONSEGUI);

    await passar(4_000);
    expect(leiturasFeitas).toBe(3);
    expect(ocorrencias(NAO_CONSEGUI)).toBe(2);
    expect(texto()).not.toContain(CONFERINDO);
    expect(texto()).not.toContain("Fale com a loja para resolver");
    expect(texto()).not.toContain("volta sozinho");

    // Desistiu: não fica martelando o servidor.
    await passar(60_000);
    expect(leiturasFeitas).toBe(3);
  });

  it("ERRO que passa na nova tentativa: a tela vai para a frase de verdade, sem ficar presa em 'não consegui'", async () => {
    respostas = ["erro", "com-linha-em-curso"];

    await renderizar();
    expect(texto()).toContain(CONFERINDO);

    await passar(4_000);
    expect(texto()).toContain("O dinheiro volta sozinho para você");
    expect(texto()).not.toContain(CONFERINDO);
    expect(texto()).not.toContain(NAO_CONSEGUI);
  });

  it("VAZIO (leitura boa, sem linha): a frase de sempre — 'Fale com a loja' — quando já se sabe", async () => {
    respostas = ["vazio"];

    await renderizar();

    expect(texto()).toContain(FRASE_FALE_COM_A_LOJA);
    expect(texto()).not.toContain(CONFERINDO);
    expect(texto()).not.toContain(NAO_CONSEGUI);
  });

  it("COM LINHA em curso: 'volta sozinho', como antes", async () => {
    respostas = ["com-linha-em-curso"];

    await renderizar();

    expect(texto()).toContain("O dinheiro volta sozinho para você");
    expect(texto()).not.toContain(FRASE_FALE_COM_A_LOJA);
    expect(texto()).not.toContain(CONFERINDO);
  });

  it("COM LINHA concluída: o valor devolvido, como antes", async () => {
    respostas = ["com-linha-concluida"];

    await renderizar();

    expect(texto()).toContain("Devolução concluída: R$");
    expect(texto()).not.toContain(CONFERINDO);
  });

  it("pago após o vencimento também espera a leitura antes de falar", async () => {
    respostas = ["nunca-volta"];

    await renderizar("pago_apos_expirar");

    expect(texto()).toContain(CONFERINDO);
    expect(texto()).not.toContain("Fale com a loja para resolver");
  });

  it("pedido pago na entrega (sem consulta de devolução): a frase de sempre, sem 'conferindo'", async () => {
    respostas = ["nunca-volta"];

    await renderizar("recebido_na_entrega");

    expect(texto()).toContain(
      "Este pedido foi cancelado, mas o seu pagamento foi recebido. Fale com a loja para resolver.",
    );
    expect(texto()).not.toContain(CONFERINDO);
    expect(leiturasFeitas).toBe(0);
  });
});
