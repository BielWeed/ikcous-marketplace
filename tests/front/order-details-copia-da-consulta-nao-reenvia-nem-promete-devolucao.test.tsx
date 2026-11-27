// @vitest-environment jsdom
//
// 27/11/2026 (caça de regressão do #2019) — a cliente logada abre o detalhe de
// um pedido DELA que consultou antes pela busca com código, e a lista da conta
// falhou: a tela mostra o RETRATO (cópia de get_orders_by_otp_v2, guardada até
// ~15 min). Desde o #2019 as ações da dona aparecem sobre essa cópia — mas ela
// não traz `cancelled_after_shipping` nem `returned_to_seller_at` (viram
// false/null) e o status é o de quando consultou.
//
// Duas consequências, as duas sobre o que a cópia não sabe:
//  - "Reenviar comprovante": se a loja cancelou depois da consulta, a cópia
//    ainda diz ativo; a edge não lê o status e o e-mail "Recebemos seu pedido"
//    gasta o único envio reservado. Com a cópia, o botão não aparece.
//  - a pergunta do Cancelar: "o dinheiro volta sozinho" é falso para pedido
//    enviado, cancelado e reativado (o servidor não abre a devolução). Com a
//    cópia, a pergunta usa a frase que não promete devolução automática.
// As demais ações seguem (o servidor protege).
//
// RENDER DE VERDADE da tela; só os hooks de dados, a sessão e o banco são
// dublês (molde de order-details-pedido-da-consulta-na-conta-e-de-visitante).
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

const { fetchUserOrders, estado } = vi.hoisted(() => ({
  fetchUserOrders: vi.fn(),
  estado: { user: null as { id: string } | null },
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: () => Promise.resolve({ data: null, error: null }),
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
vi.mock("@/hooks/useOrders", () => ({
  ErroCancelamentoNaoConcluido: class extends Error {},
  useOrders: () => ({
    orders: [],
    ordersLoadError: null,
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
    reenviarComprovante: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, loading: false }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: {
      enableReviews: true,
      storeAddress: "Rua Inventada, 10",
      whatsappNumber: "11900000000",
    },
  }),
}));

const ID = "pedido-consultado-pela-dona";
const CONTA = "conta-da-dona";
const pedido = (parcial: Partial<Order>): Order => ({
  id: ID,
  userId: CONTA,
  customer: { name: "Cliente Inventada", whatsapp: "11900000001" },
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
  paymentStatus: "pago",
  status: "processing",
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T11:00:00Z",
  cancelledAfterShipping: false,
  ...parcial,
});

// Pago online e em preparo: o caso em que a pergunta diria "volta sozinho".
const PAGO_ONLINE = pedido({});
// Pagar na entrega, ainda ativo na cópia: o caso do "Reenviar comprovante".
const PAGAR_NA_ENTREGA = pedido({ paymentMethod: "cash", paymentStatus: null });

const PROMESSA = "volta sozinho";
const FRASE_NEUTRA = "a loja cuida de devolver o seu dinheiro";

function armazem() {
  const dados = new Map<string, string>();
  return {
    getItem: (c: string) => dados.get(c) ?? null,
    setItem: (c: string, v: string) => {
      dados.set(c, String(v));
    },
    removeItem: (c: string) => {
      dados.delete(c);
    },
    clear: () => dados.clear(),
    key: (i: number) => Array.from(dados.keys()).at(i) ?? null,
    get length() {
      return dados.size;
    },
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

function gravarRetrato(p: Order) {
  sessionStorage.setItem(
    "guest_tracked_orders",
    JSON.stringify({ consultadoEm: Date.now(), pedidos: [p] }),
  );
}

async function abrir() {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView
        orderId={ID}
        onBack={vi.fn()}
        onNavigate={vi.fn()}
        onRetomarPagamento={vi.fn()}
      />,
    );
  });
  for (let i = 0; i < 6; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const texto = () => hospedeiro.textContent ?? "";
const botao = (rotulo: string) =>
  Array.from(hospedeiro.querySelectorAll<HTMLButtonElement>("button")).find(
    (b) => b.textContent?.includes(rotulo),
  );

async function perguntaDoCancelar(): Promise<string> {
  const cancelar = botao("Cancelar Pedido");
  expect(cancelar).toBeDefined();
  await act(async () => {
    cancelar!.click();
  });
  const caixa = document.querySelector<HTMLElement>('[role="alertdialog"]');
  expect(caixa).not.toBeNull();
  return caixa!.textContent ?? "";
}

beforeAll(async () => {
  await import("@/views/customer/OrderDetailsView");
}, 60_000);

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("sessionStorage", armazem());
  vi.stubGlobal("localStorage", armazem());
  vi.clearAllMocks();
  estado.user = { id: CONTA };
  // A lista da conta falhou (voltou vazia): só o retrato tem o pedido.
  fetchUserOrders.mockResolvedValue([]);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

describe("ficha do pedido da própria conta vindo da cópia da consulta", () => {
  it("não oferece 'Reenviar comprovante' (o status da cópia pode estar velho)", async () => {
    gravarRetrato(PAGAR_NA_ENTREGA);

    await abrir();

    // A ficha abriu pela cópia, e as ações da dona seguem (Cancelar).
    expect(texto()).toContain("pode ter mudado");
    expect(texto()).toContain("Cancelar Pedido");
    expect(texto()).not.toContain("Reenviar comprovante");
  });

  it("a pergunta do Cancelar não promete que o dinheiro volta sozinho", async () => {
    gravarRetrato(PAGO_ONLINE);

    await abrir();

    expect(texto()).toContain("pode ter mudado");
    const pergunta = await perguntaDoCancelar();
    expect(pergunta).not.toContain(PROMESSA);
    expect(pergunta).toContain(FRASE_NEUTRA);
  });

  it("controle: o MESMO pedido vindo da lista da conta segue com o reenvio e a promessa", async () => {
    fetchUserOrders.mockResolvedValue([PAGAR_NA_ENTREGA]);
    await abrir();
    expect(texto()).not.toContain("pode ter mudado");
    expect(texto()).toContain("Reenviar comprovante");
    act(() => raiz.unmount());

    raiz = createRoot(hospedeiro);
    fetchUserOrders.mockResolvedValue([PAGO_ONLINE]);
    await abrir();
    expect(texto()).toContain("Reenviar comprovante");
    const pergunta = await perguntaDoCancelar();
    expect(pergunta).toContain(PROMESSA);
    expect(pergunta).not.toContain(FRASE_NEUTRA);
  });
});
