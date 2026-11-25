// @vitest-environment jsdom
//
// Caça por mutação na ficha do pedido da cliente: a tela entrega à devolução
// três coisas que ela mesma lê do cadastro da loja, e os testes dos componentes
// (que recebem tudo pronto por propriedade) não pegam a fiação:
//   1. O ENDEREÇO e o HORÁRIO da loja na folha "Solicitar devolução": quem vai
//      entregar o pacote na loja precisa saber para onde ir.
//   2. O endereço e o horário no CARTÃO da devolução já aprovada para entregar
//      na loja.
//   3. A variação de cada linha (cor/tamanho) na lista de itens da folha, para
//      distinguir duas linhas do mesmo produto.
//
// RENDER DE VERDADE da ficha, com a devolução real do hook; só o servidor
// (supabase.rpc) é dublê, com valores inventados.
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

import type { Order } from "@/types";

const { fetchUserOrders, rpc, respostas } = vi.hoisted(() => ({
  fetchUserOrders: vi.fn(),
  rpc: vi.fn(),
  respostas: new Map<string, unknown>(),
}));

const ENDERECO = "Rua das Palmeiras, 456 - Centro";
const HORARIO = "Ter a Sab, 10h as 17h";

const pedido: Order = {
  id: "pedido-dev-fiacao",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      id: "oi-1",
      productId: "p-1",
      name: "Tenis",
      price: 100,
      quantity: 1,
      image: "",
      variacaoNomeNaCompra: "Tamanho",
      variacaoValorNaCompra: "38",
    },
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

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "u-1" } }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: false,
      whatsappNumber: "34999999999",
      storeAddress: ENDERECO,
      businessHours: HORARIO,
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
        in: () => Promise.resolve({ data: [], error: null }),
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
  metodos_locais: ["entrega_na_loja"],
  metodos_nacionais: ["envio_proprio"],
  reembolso_momento: "ao_receber",
  frete_troca_pago_por: "cliente",
  categorias_sem_troca: [],
  texto_politica: null,
  endereco_devolucao: null,
};

const ELEGIBILIDADE = {
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
      product_name: "Tenis",
      image_url: null,
      quantidade: 1,
      ja_devolvida: 0,
      disponivel: 1,
      valor_unitario: 100,
    },
  ],
  politica: POLITICA,
};

const DETALHE = {
  id: "d-1",
  protocolo: "DV260926-ZZZZZ",
  order_id: "pedido-dev-fiacao",
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
  mensagem_loja: null,
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
      product_name: "Tenis",
      quantidade: 1,
      valor_unitario: 100,
    },
  ],
  eventos: [],
  pedido: null,
};

describe("OrderDetailsView — devolução leva o endereço, o horário e a variação da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/OrderDetailsView");
  }, 60_000);

  beforeEach(() => {
    fetchUserOrders.mockReset();
    fetchUserOrders.mockResolvedValue([pedido]);
    rpc.mockReset();
    respostas.clear();
    respostas.set("devolucao_elegibilidade", ELEGIBILIDADE);
    respostas.set("devolucoes_do_pedido", []);
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
    );
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
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-dev-fiacao"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }

  // A folha é portalada no body: busca no DOCUMENTO.
  const folha = () =>
    document.querySelector<HTMLElement>('[data-testid="folha-devolucao"]');
  const botaoDaFolha = (texto: string) =>
    [...(folha()?.querySelectorAll("button") ?? [])].find(
      (b) =>
        b.textContent?.trim() === texto ||
        b.getAttribute("aria-label") === texto,
    );
  async function clicar(el: HTMLElement | null | undefined) {
    expect(el).toBeTruthy();
    await act(async () => {
      el?.click();
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });
  }
  const radio = (valor: string) =>
    folha()?.querySelector<HTMLInputElement>(
      `input[type="radio"][value="${valor}"]`,
    );

  async function abrirAFolha() {
    await renderizar();
    await clicar(
      hospedeiro.querySelector<HTMLElement>(
        '[data-testid="acao-solicitar-devolucao"]',
      ),
    );
    expect(folha()).not.toBeNull();
  }

  it("folha, lista de itens: mostra a variação guardada na compra de cada linha", async () => {
    await abrirAFolha();

    const itens = folha()?.querySelector('[data-testid="passo-itens"]');
    const variacao = itens?.querySelector(
      '[data-testid="variacao-do-item-elegivel"]',
    );
    expect(variacao?.textContent).toBe("Tamanho 38");
  });

  it("folha, método 'entregar na loja': mostra o endereço e o horário do cadastro da loja", async () => {
    await abrirAFolha();
    await clicar(botaoDaFolha("Aumentar Tenis (Tamanho 38)"));
    await clicar(botaoDaFolha("Continuar"));
    await clicar(radio("tamanho_pequeno"));
    await clicar(botaoDaFolha("Continuar"));

    expect(folha()?.querySelector('[data-testid="passo-resolucao"]')).not.toBe(
      null,
    );
    expect(folha()?.textContent).toContain(ENDERECO);
    expect(folha()?.textContent).toContain(`Horário: ${HORARIO}`);
  });

  it("cartão da devolução aprovada, com a política lida ao vivo: leva até a loja, com endereço e horário", async () => {
    respostas.set("devolucoes_do_pedido", [DETALHE]);
    respostas.set("devolucao_detalhe", DETALHE);

    await renderizar();

    const cartao = hospedeiro.querySelector('[data-testid="cartao-devolucao"]');
    expect(cartao?.textContent).toContain(
      `Leve o produto até a loja: ${ENDERECO}. Horário de atendimento: ${HORARIO}.`,
    );
  });

  it("sem a leitura da elegibilidade o cartão nem aparece (nunca um endereço inventado)", async () => {
    // O hook lê elegibilidade e devoluções JUNTAS: se a primeira falta, a leitura
    // inteira falha e a tela não mostra cartão (e portanto nenhum destino).
    respostas.delete("devolucao_elegibilidade");
    respostas.set("devolucoes_do_pedido", [DETALHE]);
    respostas.set("devolucao_detalhe", DETALHE);

    await renderizar();

    expect(
      hospedeiro.querySelector('[data-testid="cartao-devolucao"]'),
    ).toBeNull();
    expect(hospedeiro.textContent).not.toContain(ENDERECO);
  });
});
