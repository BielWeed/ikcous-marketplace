// @vitest-environment jsdom
//
// Caça por mutação na ficha do pedido da cliente: a tela entrega à folha
// "Solicitar devolução" o FRETE do pedido (`freteDoPedido={order.shipping}`).
// Os testes da folha recebem o frete pronto por propriedade e não pegam a
// fiação: sem ela a folha não sabe que houve frete pago e cala a promessa do
// Código de Defesa do Consumidor (art. 49) de devolver o frete quando o pedido
// inteiro volta com reembolso.
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

const PROMESSA_DO_FRETE =
  "Como o pedido inteiro é reembolsado, o frete que você pagou também é devolvido.";

const pedido: Order = {
  id: "pedido-dev-frete",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      id: "oi-1",
      productId: "p-1",
      name: "Tenis",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 19.9,
  discount: 0,
  total: 119.9,
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
      storeAddress: "Rua Exemplo, 1",
      businessHours: "Seg a Sex, 9h as 18h",
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
  politica: {
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
  },
};

describe("OrderDetailsView — a folha de devolução recebe o frete do pedido", () => {
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

  it("pedido entregue com frete pago, devolvido inteiro com reembolso: a revisão promete o frete de volta", async () => {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-dev-frete"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      for (let i = 0; i < 10; i++) await Promise.resolve();
    });

    await clicar(
      hospedeiro.querySelector<HTMLElement>(
        '[data-testid="acao-solicitar-devolucao"]',
      ),
    );
    expect(folha()).not.toBeNull();

    // Passo 1: a única unidade do pedido (o pedido inteiro).
    await clicar(botaoDaFolha("Aumentar Tenis"));
    await clicar(botaoDaFolha("Continuar"));
    // Passo 2: desistência dentro do prazo (arrependimento, sem foto).
    await clicar(radio("tamanho_pequeno"));
    await clicar(botaoDaFolha("Continuar"));
    // Passo 3: reembolso, entregando na loja.
    await clicar(radio("reembolso"));
    await clicar(radio("entrega_na_loja"));
    await clicar(botaoDaFolha("Continuar"));

    const revisao = folha()?.querySelector('[data-testid="passo-revisao"]');
    expect(revisao).not.toBeNull();
    expect(revisao?.textContent).toContain(PROMESSA_DO_FRETE);
  });
});
