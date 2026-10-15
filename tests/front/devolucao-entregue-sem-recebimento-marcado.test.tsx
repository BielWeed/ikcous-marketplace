// @vitest-environment jsdom
//
// Pedido ENTREGUE de pagamento na entrega/retirada em que a lojista ainda não
// marcou o recebimento: o servidor recusa a devolução ("Este pedido não tem
// pagamento a devolver."), e para a cliente isso soa como "a loja ficou com o
// meu dinheiro". A tela troca SÓ essa frase por uma verdadeira e acionável, e
// decide pelo ESTADO do pedido (entregue + não-online + pagamento em branco),
// nunca comparando o texto do servidor. Os outros motivos seguem os do
// servidor. A regra do servidor não muda.
//
// Molde de montagem: devolucao-no-pedido-do-cliente.test.tsx.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { motivoDaDevolucaoIndisponivel } from "@/lib/texto-devolucao-indisponivel";
import type { Order } from "@/types";

const { fetchUserOrders, updateOrderStatus, rpc, respostas } = vi.hoisted(
  () => ({
    fetchUserOrders: vi.fn(),
    updateOrderStatus: vi.fn(),
    rpc: vi.fn(),
    respostas: new Map<string, unknown>(),
  }),
);

const FRASE_DO_SERVIDOR = "Este pedido não tem pagamento a devolver.";
const FRASE_NOVA =
  "A loja ainda não marcou este pagamento como recebido. Peça a ela para marcar; depois abra o pedido de novo para ver se a devolução ou troca está disponível.";

const pedidoNaEntrega: Order = {
  id: "pedido-dev",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    { productId: "p-1", name: "Tênis", price: 100, quantity: 1, image: "" },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "cash",
  paymentStatus: null,
  status: "delivered",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};

let pedidoAtual: Order = pedidoNaEntrega;

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders,
    updateOrderStatus,
  }),
}));

// Objeto ESTÁVEL: um `{ id }` novo a cada render religa os efeitos da tela.
const usuarioAtual = { id: "u-1" };

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

function bloqueio(motivo: string) {
  return {
    pode: false,
    motivo_bloqueio: motivo,
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
  };
}

describe("motivoDaDevolucaoIndisponivel", () => {
  const base = { status: "delivered", paymentMethod: "cash" } as const;

  it("entregue, na entrega e pagamento em branco: frase nova, não a do servidor", () => {
    for (const metodo of ["cash", "card", "pix"] as const) {
      expect(
        motivoDaDevolucaoIndisponivel(FRASE_DO_SERVIDOR, {
          ...base,
          paymentMethod: metodo,
          paymentStatus: null,
        }),
      ).toBe(FRASE_NOVA);
    }
  });

  it("pago online nunca recebe a frase nova (o servidor fala)", () => {
    expect(
      motivoDaDevolucaoIndisponivel(FRASE_DO_SERVIDOR, {
        ...base,
        paymentMethod: "online",
        paymentStatus: null,
      }),
    ).toBe(FRASE_DO_SERVIDOR);
  });

  it("pedido não entregue nunca recebe a frase nova", () => {
    for (const status of [
      "pending",
      "processing",
      "shipping",
      "cancelled",
    ] as const) {
      expect(
        motivoDaDevolucaoIndisponivel("Ainda não entregue.", {
          ...base,
          status,
          paymentStatus: null,
        }),
      ).toBe("Ainda não entregue.");
    }
  });

  it("pagamento aguardando/recusado/expirado/estornado ou já marcado: frase do servidor", () => {
    for (const pagamento of [
      "aguardando",
      "recusado",
      "expirado",
      "estornado",
      "recebido_na_entrega",
      "pago",
    ] as const) {
      expect(
        motivoDaDevolucaoIndisponivel(FRASE_DO_SERVIDOR, {
          ...base,
          paymentStatus: pagamento,
        }),
      ).toBe(FRASE_DO_SERVIDOR);
    }
  });

  it("pagamento ausente no cache (undefined) não vira frase nova: fica a do servidor", () => {
    expect(motivoDaDevolucaoIndisponivel(FRASE_DO_SERVIDOR, { ...base })).toBe(
      FRASE_DO_SERVIDOR,
    );
  });
});

describe("OrderDetailsView — devolução indisponível de pedido pago na entrega", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    fetchUserOrders.mockReset();
    updateOrderStatus.mockReset();
    rpc.mockReset();
    respostas.clear();
    respostas.set("devolucao_elegibilidade", bloqueio(FRASE_DO_SERVIDOR));
    respostas.set("devolucoes_do_pedido", []);
    rpc.mockImplementation((nome: string) =>
      Promise.resolve({ data: respostas.get(nome) ?? null, error: null }),
    );
    pedidoAtual = pedidoNaEntrega;
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

  const aviso = () =>
    hospedeiro.querySelector('[data-testid="devolucao-indisponivel"]')
      ?.textContent ?? "";

  it("entregue, na entrega, sem recebimento marcado: a cliente lê a frase verdadeira", async () => {
    await renderizar();

    expect(aviso()).toContain(FRASE_NOVA);
    expect(aviso()).not.toContain("não tem pagamento a devolver");
    // Nao promete: o servidor ainda pode recusar por prazo depois que a loja
    // marcar, e a tela so relê ao abrir de novo.
    expect(aviso()).not.toMatch(/liberad/);
    expect(aviso()).toContain("abra o pedido de novo");
  });

  it("pago online com pagamento aguardando: continua a frase do servidor", async () => {
    pedidoAtual = {
      ...pedidoNaEntrega,
      paymentMethod: "online",
      paymentStatus: "aguardando",
    };
    await renderizar();

    expect(aviso()).toContain(FRASE_DO_SERVIDOR);
    expect(aviso()).not.toContain(FRASE_NOVA);
  });

  it("na entrega com pagamento recusado: continua a frase do servidor", async () => {
    pedidoAtual = { ...pedidoNaEntrega, paymentStatus: "recusado" };
    await renderizar();

    expect(aviso()).toContain(FRASE_DO_SERVIDOR);
    expect(aviso()).not.toContain(FRASE_NOVA);
  });
});
