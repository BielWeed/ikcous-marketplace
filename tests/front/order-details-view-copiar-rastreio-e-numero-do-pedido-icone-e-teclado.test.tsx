// @vitest-environment jsdom
//
// Caça por mutação na ficha do pedido: o botão de copiar o código de rastreio
// mostra o ícone de "copiar" enquanto nada foi copiado e troca para o "visto"
// SÓ depois que a cópia deu certo (a mesma regra do aviso "Código de rastreio
// copiado!"). Se a cópia falha, o ícone continua sendo o de copiar e o aviso é
// de erro — a tela não pode comemorar uma cópia que não aconteceu. Nenhum teste
// prendia o ícone.
//
// RENDER DE VERDADE da tela; só os hooks de dados, a sessão, o banco e a área
// de transferência são dublês.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
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

const { copiar } = vi.hoisted(() => ({ copiar: vi.fn() }));

const pedido: Order = {
  id: "pedido-rastreio-3884be",
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
  status: "shipping",
  trackingCode: "AA123456789BR",
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
vi.mock("@/lib/copiar-para-clipboard", () => ({
  copiarParaClipboard: copiar,
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), success: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderDetailsView — ícone do botão de copiar o rastreio", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeAll(async () => {
    await import("@/views/customer/OrderDetailsView");
  }, 60_000);

  beforeEach(() => {
    vi.clearAllMocks();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrir() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-rastreio-3884be"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const botaoCopiar = () =>
    hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="Copiar código de rastreio"]',
    );

  it("antes de copiar: ícone de copiar, sem o visto", async () => {
    await abrir();

    expect(botaoCopiar()).not.toBeNull();
    expect(botaoCopiar()?.querySelector(".lucide-copy")).not.toBeNull();
    expect(botaoCopiar()?.querySelector(".lucide-check")).toBeNull();
  });

  it("copiou com sucesso: copia o código limpo, avisa e troca para o visto", async () => {
    copiar.mockResolvedValue(true);
    await abrir();

    await act(async () => botaoCopiar()?.click());

    expect(copiar).toHaveBeenCalledExactlyOnceWith("AA123456789BR");
    expect(vi.mocked(toast.success)).toHaveBeenCalledExactlyOnceWith(
      "Código de rastreio copiado!",
    );
    expect(botaoCopiar()?.querySelector(".lucide-check")).not.toBeNull();
    expect(botaoCopiar()?.querySelector(".lucide-copy")).toBeNull();
  });

  it("a cópia falhou: avisa o erro e o ícone continua sendo o de copiar", async () => {
    copiar.mockResolvedValue(false);
    await abrir();

    await act(async () => botaoCopiar()?.click());

    expect(vi.mocked(toast.error)).toHaveBeenCalledExactlyOnceWith(
      "Não foi possível copiar. Selecione o texto e copie manualmente.",
    );
    expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    expect(botaoCopiar()?.querySelector(".lucide-copy")).not.toBeNull();
    expect(botaoCopiar()?.querySelector(".lucide-check")).toBeNull();
  });
});

// A etiqueta "#3884BE" do pedido também copia, e é um botão de teclado:
// Enter e Espaço copiam o NÚMERO (os 6 últimos caracteres, em maiúsculas, não
// o id inteiro) e seguram o comportamento padrão da tecla (Espaço rolaria a
// página); qualquer outra tecla não faz nada.
describe("OrderDetailsView — copiar o número do pedido pelo teclado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    copiar.mockResolvedValue(true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  async function abrir() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-rastreio-3884be"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  const etiqueta = () =>
    hospedeiro.querySelector<HTMLElement>(
      '[role="button"][aria-label="Copiar número do pedido #3884BE"]',
    );

  async function apertar(tecla: string) {
    const evento = new KeyboardEvent("keydown", {
      key: tecla,
      bubbles: true,
      cancelable: true,
    });
    await act(async () => {
      etiqueta()?.dispatchEvent(evento);
    });
    return evento;
  }

  it.each([
    ["Enter", "Enter"],
    ["Espaço", " "],
  ])(
    "%s copia o número '3884BE', avisa e segura o padrão da tecla",
    async (_nome, tecla) => {
      await abrir();

      const evento = await apertar(tecla);

      expect(copiar).toHaveBeenCalledExactlyOnceWith("3884BE");
      expect(vi.mocked(toast.success)).toHaveBeenCalledExactlyOnceWith(
        "Número do pedido copiado",
      );
      expect(evento.defaultPrevented).toBe(true);
    },
  );

  it("outra tecla (a letra 'a') não copia nada e não segura o padrão", async () => {
    await abrir();

    const evento = await apertar("a");

    expect(copiar).not.toHaveBeenCalled();
    expect(evento.defaultPrevented).toBe(false);
  });

  it("o toque copia o mesmo número", async () => {
    await abrir();

    await act(async () => etiqueta()?.click());

    expect(copiar).toHaveBeenCalledExactlyOnceWith("3884BE");
  });
});
