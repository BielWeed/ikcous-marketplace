// @vitest-environment jsdom
//
// Devolução/troca na tela do pedido do CLIENTE (OrderDetailsView): a linha
// "Solicitar devolução ou troca" só existe com pedido ENTREGUE, cliente
// logado e `devolucao_elegibilidade.pode`; sem poder (e sem devolução
// ainda), o motivo aparece discreto; com devolução, o cartão dela aparece.
// Convidado e pedido não entregue nem chegam a perguntar ao servidor.
//
// Molde de montagem: order-details-cartao-de-avaliacao-em-destaque.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const { fetchUserOrders, updateOrderStatus, rpc, respostas } = vi.hoisted(
  () => ({
    fetchUserOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    rpc: vi.fn(),
    respostas: new Map<string, unknown>(),
  }),
);

const pedidoBase: Order = {
  id: "pedido-dev",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    { productId: "p-1", name: "Tênis", price: 100, quantity: 1, image: "" },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "delivered",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};

let pedidoAtual: Order = pedidoBase;
let usuarioAtual: { id: string } | null = { id: "u-1" };

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders,
    updateOrderStatus,
  }),
}));

vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuarioAtual }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: false,
      whatsappNumber: "34999999999",
      storeAddress: "Rua A, 10",
      businessHours: "Seg a Sex, 9h às 18h",
    },
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
    rpc,
  },
}));

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POLITICA = {
  prazo_arrependimento_dias: 7,
  prazo_troca_dias: 30,
  prazo_vicio_dias: 90,
  aceita_troca: true,
  aceita_vale: true,
  exige_fotos_vicio: true,
  metodos_locais: ["entrega_na_loja", "coleta"],
  metodos_nacionais: ["etiqueta_reversa", "envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
};

function elegibilidade(extra: Record<string, unknown> = {}) {
  return {
    pode: true,
    motivo_bloqueio: null,
    entregue_em: "2026-09-24T15:00:00Z",
    dias_desde_entrega: 2,
    modalidade: "local",
    metodos: ["entrega_na_loja"],
    prazos: {
      arrependimento_ate: "2026-10-01",
      troca_ate: "2026-10-24",
      vicio_ate: "2026-12-23",
    },
    janelas: { arrependimento: true, troca: true, vicio: true },
    itens: [
      {
        order_item_id: "oi-1",
        product_id: "p-1",
        product_name: "Tênis",
        image_url: null,
        quantidade: 1,
        ja_devolvida: 0,
        disponivel: 1,
        valor_unitario: 100,
      },
    ],
    politica: POLITICA,
    ...extra,
  };
}

const DETALHE = {
  id: "d-1",
  protocolo: "DV260926-ABCDE",
  order_id: "pedido-dev",
  tipo: "arrependimento",
  motivo: "tamanho_pequeno",
  detalhe: null,
  resolucao_desejada: "reembolso",
  resolucao_final: null,
  modalidade: "local",
  metodo_retorno: "entrega_na_loja",
  status: "aprovada",
  valor_itens: 100,
  valor_frete_ida: 0,
  valor_reembolso: null,
  refund_id: null,
  reembolso_manual: false,
  fotos: [],
  codigo_rastreio: null,
  codigo_postagem: null,
  etiqueta_url: null,
  coleta_em: null,
  mensagem_loja: "Traga com a etiqueta, por favor.",
  observacao_inspecao: null,
  entregue_em: "2026-09-24T15:00:00Z",
  prazo_ate: "2026-10-01",
  politica: POLITICA,
  created_at: "2026-09-26T10:00:00Z",
  aprovada_em: "2026-09-26T11:00:00Z",
  itens: [
    {
      id: "di-1",
      order_item_id: "oi-1",
      product_name: "Tênis",
      quantidade: 1,
      valor_unitario: 100,
    },
  ],
  eventos: [],
  pedido: null,
};

describe("OrderDetailsView — devolução ou troca do produto entregue", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    fetchUserOrders.mockReset();
    updateOrderStatus.mockReset();
    rpc.mockReset();
    respostas.clear();
    respostas.set("devolucao_elegibilidade", elegibilidade());
    respostas.set("devolucoes_do_pedido", []);
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
    );
    pedidoAtual = pedidoBase;
    usuarioAtual = { id: "u-1" };
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
  });

  async function renderizar() {
    fetchUserOrders.mockResolvedValue([pedidoAtual]);
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-dev"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  const botaoPedir = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      '[data-testid="acao-solicitar-devolucao"]',
    );
  const nomesDasRpcs = () => rpc.mock.calls.map((c) => c[0]);

  it("entregue + logado + elegível: a linha 'Solicitar devolução ou troca' aparece", async () => {
    await renderizar();

    expect(botaoPedir()?.textContent).toContain("Solicitar devolução ou troca");
    expect(rpc).toHaveBeenCalledWith("devolucao_elegibilidade", {
      p_order_id: "pedido-dev",
    });
  });

  it("tocar na linha abre a folha do pedido de devolução", async () => {
    await renderizar();
    await act(async () => {
      botaoPedir()?.click();
    });
    const folha = document.querySelector('[data-testid="folha-devolucao"]');
    expect(folha?.textContent).toContain("O que vai voltar?");
  });

  it("pedido ainda a caminho: nem linha nem pergunta ao servidor", async () => {
    pedidoAtual = { ...pedidoBase, status: "shipping" };
    await renderizar();

    expect(botaoPedir()).toBeNull();
    expect(nomesDasRpcs()).not.toContain("devolucao_elegibilidade");
  });

  it("convidado (sem sessão): nem linha nem pergunta ao servidor", async () => {
    usuarioAtual = null;
    await renderizar();

    expect(botaoPedir()).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("sem poder e sem devolução ainda: o motivo do servidor aparece discreto", async () => {
    respostas.set(
      "devolucao_elegibilidade",
      elegibilidade({
        pode: false,
        motivo_bloqueio:
          "O prazo para devolução ou troca deste pedido terminou.",
        janelas: { arrependimento: false, troca: false, vicio: false },
      }),
    );
    await renderizar();

    expect(botaoPedir()).toBeNull();
    expect(
      hospedeiro.querySelector('[data-testid="devolucao-indisponivel"]')
        ?.textContent,
    ).toContain("O prazo para devolução ou troca deste pedido terminou.");
  });

  it("com devolução em andamento: o cartão mostra protocolo, instrução e a mensagem da loja", async () => {
    respostas.set(
      "devolucao_elegibilidade",
      elegibilidade({
        pode: false,
        motivo_bloqueio:
          "Já existe uma devolução em andamento para este pedido.",
      }),
    );
    respostas.set("devolucoes_do_pedido", [
      {
        id: "d-1",
        protocolo: "DV260926-ABCDE",
        status: "aprovada",
        tipo: "arrependimento",
        resolucao_desejada: "reembolso",
        metodo_retorno: "entrega_na_loja",
        valor_itens: 100,
        created_at: "2026-09-26T10:00:00Z",
      },
    ]);
    respostas.set("devolucao_detalhe", DETALHE);
    await renderizar();

    const cartao = hospedeiro.querySelector('[data-testid="cartao-devolucao"]');
    expect(cartao?.textContent).toContain("DV260926-ABCDE");
    expect(cartao?.textContent).toContain("Devolução aprovada");
    expect(cartao?.textContent).toContain("Rua A, 10");
    expect(cartao?.textContent).toContain("Traga com a etiqueta, por favor.");
    expect(cartao?.textContent).toContain("Cancelar devolução");
    expect(rpc).toHaveBeenCalledWith("devolucao_detalhe", { p_id: "d-1" });
    // Já tem devolução: nem a linha de pedir, nem o motivo de bloqueio.
    expect(botaoPedir()).toBeNull();
    expect(
      hospedeiro.querySelector('[data-testid="devolucao-indisponivel"]'),
    ).toBeNull();
  });
});
