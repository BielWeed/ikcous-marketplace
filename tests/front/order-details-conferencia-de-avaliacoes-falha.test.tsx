// @vitest-environment jsdom
//
// Caça 13-C #5: quando a conferência de "quais itens eu já avaliei" FALHA, a
// ficha do pedido não pode afirmar "0 de N avaliados" nem oferecer estrelas
// (a cliente avaliaria de novo e a nota do produto contaria duas vezes). O
// dublê do supabase devolve `{ data: null, error }` DE VERDADE, como o
// supabase-js faz (ele não lança).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const fetchUserOrders = vi.fn();

const pedidoEntregue: Order = {
  id: "pedido-101",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Produto Teste",
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
  status: "delivered",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  cancelledAfterShipping: false,
};

let pedidoExibido = pedidoEntregue;
let usarFormularioReal = false;
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/components/ui/custom/ReviewForm", async () => {
  const real = await vi.importActual<
    typeof import("@/components/ui/custom/ReviewForm")
  >("@/components/ui/custom/ReviewForm");
  return {
    ReviewForm: (
      props: import("react").ComponentProps<typeof real.ReviewForm>,
    ) =>
      usarFormularioReal ? (
        <real.ReviewForm {...props} />
      ) : (
        <button onClick={props.onSuccess}>Confirmar avaliação de teste</button>
      ),
  };
});
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoExibido],
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
  }),
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: usuario }),
}));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: true, whatsappNumber: "34999999999" },
  }),
}));

const respostas: Array<
  { data: unknown; error: unknown } | Promise<{ data: unknown; error: unknown }>
> = [];
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const b: any = {};
      b.select = () => b;
      b.eq = () => b;
      b.in = () =>
        Promise.resolve(respostas.shift() ?? { data: [], error: null });
      b.insert = () => b;
      b.single = () => new Promise(() => {});
      b.limit = () => b;
      b.maybeSingle = () =>
        Promise.resolve({ data: { id: "avaliacao-confirmada" }, error: null });
      return b;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function botaoDeEstrela(dentroDe: HTMLElement) {
  return [...dentroDe.querySelectorAll("button")].find(
    (b) =>
      b.getAttribute("aria-label")?.startsWith("Dar ") ||
      b.textContent?.includes("Escrever avaliação"),
  );
}

describe("OrderDetailsView — conferência de avaliações que falha (13-C #5)", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  async function abrir() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-101"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    respostas.length = 0;
    pedidoExibido = pedidoEntregue;
    usarFormularioReal = false;
    fetchUserOrders.mockReset();
    fetchUserOrders.mockResolvedValue([pedidoEntregue]);
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

  it("envio sem resposta mas avaliação confirmada fecha a folha e não oferece reenviar", async () => {
    usarFormularioReal = true;
    vi.useFakeTimers();
    try {
      await abrir();
      await act(async () => {
        botaoDeEstrela(hospedeiro)!.click();
      });
      const submit = document.body.querySelector<HTMLButtonElement>(
        'button[type="submit"]',
      );
      expect(submit).toBeTruthy();
      await act(async () => {
        submit!.click();
        for (let i = 0; i < 30; i++) await Promise.resolve();
        await vi.advanceTimersByTimeAsync(15001);
      });
      expect(
        document.body.querySelector('[aria-labelledby="titulo-avaliacao"]'),
      ).toBeNull();
      expect(hospedeiro.textContent).toMatch(/1 de 1\s*avaliados/);
      expect(botaoDeEstrela(hospedeiro)).toBeUndefined();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resposta antiga não apaga a avaliação confirmada enquanto a folha estava aberta", async () => {
    await abrir();
    await act(async () => {
      botaoDeEstrela(hospedeiro)!.click();
    });
    let resolver!: (valor: { data: unknown; error: unknown }) => void;
    respostas.push(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    pedidoExibido = { ...pedidoEntregue, updatedAt: "2027-01-01T00:00:00Z" };
    await abrir();
    await act(async () => {
      const confirmar = [...document.body.querySelectorAll("button")].find(
        (b) => b.textContent === "Confirmar avaliação de teste",
      );
      expect(confirmar).toBeTruthy();
      confirmar!.click();
    });
    await act(async () => {
      resolver({ data: [], error: null });
    });
    expect(hospedeiro.textContent).toMatch(/1 de 1\s*avaliados/);
  });

  it("enquanto confere não oferece avaliar nem afirma zero; prazo oferece tentar de novo", async () => {
    vi.useFakeTimers();
    respostas.push(new Promise(() => {}));
    try {
      await abrir();
      expect(hospedeiro.textContent).toContain("Conferindo suas avaliações");
      expect(hospedeiro.textContent).not.toMatch(/0 de 1\s*avaliados/);
      expect(botaoDeEstrela(hospedeiro)).toBeUndefined();
      await act(async () => {
        await vi.advanceTimersByTimeAsync(15001);
      });
      expect(hospedeiro.textContent).toContain(
        "Não deu para conferir suas avaliações",
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("na falha, não diz '0 de N avaliados' nem oferece avaliar; oferece tentar de novo", async () => {
    respostas.push({ data: null, error: { message: "rede" } });
    await abrir();

    expect(hospedeiro.textContent).not.toMatch(/0 de 1\s*avaliados/);
    expect(botaoDeEstrela(hospedeiro)).toBeUndefined();
    expect(hospedeiro.textContent).toContain(
      "Não deu para conferir suas avaliações",
    );
    expect(
      hospedeiro.querySelector('[data-testid="avaliacoes-tentar-de-novo"]'),
    ).not.toBeNull();
  });

  it("'Tentar de novo' refaz a conferência e, dando certo, volta ao normal", async () => {
    respostas.push({ data: null, error: { message: "rede" } });
    respostas.push({ data: [{ product_id: "prod-1" }], error: null });
    await abrir();

    const tentar = hospedeiro.querySelector(
      '[data-testid="avaliacoes-tentar-de-novo"]',
    ) as HTMLButtonElement;
    await act(async () => {
      tentar.click();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(hospedeiro.textContent).toMatch(/1 de 1\s*avaliados/);
    expect(
      hospedeiro.querySelector('[data-testid="avaliacoes-tentar-de-novo"]'),
    ).toBeNull();
  });
});
