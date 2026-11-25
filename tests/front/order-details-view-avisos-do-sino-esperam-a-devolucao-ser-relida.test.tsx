// @vitest-environment jsdom
//
// Caça por mutação na ficha do pedido: abrir o pedido apaga do sino os avisos
// DELE, mas só depois de a devolução já ter sido relida por causa desses avisos
// (senão a pista some do sino antes de a tela mostrar o que o aviso contava).
// A tela repassa ao hook de avisos o sinal `aguardandoAviso` da devolução; se
// ela repassasse sempre "não espere", o aviso seria marcado como lido na hora,
// mesmo com a devolução ainda desatualizada. Os testes do hook não pegam isto:
// quem liga um ao outro é a tela.
//
// RENDER DE VERDADE da tela, dentro de um provedor de avisos de mentira; só a
// devolução do cliente é dublê (para escolher `aguardandoAviso`).
import { NotificationContext } from "@/contexts/NotificationContextCore";
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

const { marcarPedidoComoLido, estado } = vi.hoisted(() => ({
  marcarPedidoComoLido: vi.fn(),
  estado: { aguardandoAviso: false },
}));

const ID = "pedido-do-sino-00a1b2";
const pedido: Order = {
  id: ID,
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
  paymentMethod: "cash",
  paymentStatus: null,
  status: "delivered",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

vi.mock("@/hooks/useOrders", () => ({
  ErroCancelamentoNaoConcluido: class extends Error {},
  useOrders: () => ({
    orders: [pedido],
    ordersLoadError: null,
    fetchUserOrders: vi.fn().mockResolvedValue([pedido]),
    updateOrderStatus: vi.fn(),
    reenviarComprovante: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: { id: "user-1" } }),
}));
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
vi.mock("@/hooks/useDevolucaoCliente", () => ({
  useDevolucaoCliente: () => ({
    atual: null,
    devolucoes: [],
    elegibilidade: null,
    erro: null,
    carregando: false,
    aguardandoAviso: estado.aguardandoAviso,
    recarregar: vi.fn(),
    solicitar: vi.fn(),
    cancelar: vi.fn(),
    informarEnvio: vi.fn(),
    enviarFoto: vi.fn(),
    descartarFotos: vi.fn(),
  }),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function avisoNaoLido(orderId: string) {
  return { id: `aviso-${orderId}`, read: false, order_id: orderId };
}

describe("OrderDetailsView — abrir o pedido marca os avisos dele como lidos", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/OrderDetailsView");
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    estado.aguardandoAviso = false;
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrir(avisos: unknown[]) {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    const valor = {
      notifications: avisos,
      markOrderAsRead: marcarPedidoComoLido,
    } as never;
    await act(async () => {
      raiz.render(
        <NotificationContext.Provider value={valor}>
          <OrderDetailsView
            orderId={ID}
            onBack={() => {}}
            onNavigate={() => {}}
          />
        </NotificationContext.Provider>,
      );
    });
    for (let i = 0; i < 3; i++) {
      await act(async () => {
        await Promise.resolve();
      });
    }
  }

  it("com aviso não lido do pedido e a devolução em dia: marca o pedido como lido", async () => {
    await abrir([avisoNaoLido(ID)]);

    expect(marcarPedidoComoLido).toHaveBeenCalledExactlyOnceWith(ID);
  });

  it("com aviso não lido, mas a devolução ainda sendo relida (aguardandoAviso): NÃO marca ainda", async () => {
    estado.aguardandoAviso = true;

    await abrir([avisoNaoLido(ID)]);

    expect(marcarPedidoComoLido).not.toHaveBeenCalled();
  });

  it("aviso não lido de OUTRO pedido: não marca nada", async () => {
    await abrir([avisoNaoLido("outro-pedido-ffffff")]);

    expect(marcarPedidoComoLido).not.toHaveBeenCalled();
  });

  it("aviso deste pedido já lido: não marca de novo", async () => {
    await abrir([{ ...avisoNaoLido(ID), read: true }]);

    expect(marcarPedidoComoLido).not.toHaveBeenCalled();
  });
});
