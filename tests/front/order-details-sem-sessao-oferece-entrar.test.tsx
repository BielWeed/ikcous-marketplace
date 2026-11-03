// @vitest-environment jsdom
//
// Caça 03/11 (achado d8): a cliente que toca no aviso "Seu pedido saiu para
// entrega" SEM estar com a conta aberta (sessão vencida, revogada em outro
// aparelho) via "Pedido não encontrado", como se o pedido não existisse, e o
// único botão era "Voltar aos pedidos". O pedido existe: bastava entrar.
//
// O convidado que rastreou o pedido por e-mail + código (sessionStorage
// `guest_tracked_orders`) continua vendo o pedido normalmente — por isso o
// App NÃO redireciona o visitante ao login nesta tela; o convite aparece só
// no ramo "não achei o pedido".
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";

const { fetchUserOrders, estado } = vi.hoisted(() => ({
  fetchUserOrders: vi.fn(),
  estado: {
    user: null as { id: string } | null,
    loading: false,
    ordersLoadError: null as string | null,
  },
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
    ordersLoadError: estado.ordersLoadError,
    fetchUserOrders,
    updateOrderStatus: vi.fn(),
    reenviarComprovante: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: estado.user, loading: estado.loading }),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, storeAddress: "Rua A, 10" },
  }),
}));

const ID = "pedido-do-aviso";
const pedido: Order = {
  id: ID,
  customer: { name: "Cliente", whatsapp: "34999999999" },
  items: [],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  paymentStatus: "pago",
  status: "shipping",
  createdAt: "2026-10-15T10:00:00Z",
  updatedAt: "2026-10-15T11:00:00Z",
  cancelledAfterShipping: false,
};

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
const onBack = vi.fn();
const onNavigate = vi.fn();

async function abrir() {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView orderId={ID} onBack={onBack} onNavigate={onNavigate} />,
    );
  });
  for (let i = 0; i < 5; i++) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

const texto = () => hospedeiro.textContent ?? "";
const botao = (nome: string) =>
  Array.from(hospedeiro.querySelectorAll("button")).find(
    (b) => b.textContent?.trim() === nome,
  );

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("sessionStorage", armazem());
  vi.stubGlobal("localStorage", armazem());
  vi.clearAllMocks();
  estado.user = null;
  estado.loading = false;
  estado.ordersLoadError = null;
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

describe("pedido aberto sem conta aberta", () => {
  it("convida a entrar na conta, sem dizer que o pedido não existe", async () => {
    await abrir();

    expect(texto()).toContain("Entre na conta para ver este pedido");
    expect(texto()).not.toContain("Pedido não encontrado");
    expect(texto()).not.toContain("em nosso sistema");
  });

  it("o botão Entrar leva à tela de login e Voltar aos pedidos continua lá", async () => {
    await abrir();

    await act(async () => {
      botao("Entrar")?.click();
    });
    expect(onNavigate).toHaveBeenCalledWith("auth");

    await act(async () => {
      botao("Voltar aos pedidos")?.click();
    });
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("LIMITE: convidado que rastreou por código vê o pedido, sem convite de login", async () => {
    sessionStorage.setItem("guest_tracked_orders", JSON.stringify([pedido]));

    await abrir();

    expect(texto()).not.toContain("Entre na conta para ver este pedido");
    expect(texto()).not.toContain("Pedido não encontrado");
    expect(botao("Entrar")).toBeUndefined();
  });

  it("LIMITE: com conta aberta e pedido inexistente, continua 'Pedido não encontrado' (sem convite)", async () => {
    estado.user = { id: "u-1" };

    await abrir();

    expect(texto()).toContain("Pedido não encontrado");
    expect(texto()).not.toContain("Entre na conta para ver este pedido");
    expect(botao("Entrar")).toBeUndefined();
  });

  it("LIMITE: falha de carregamento sem conta mantém 'Tentar de novo' (a falha é de rede, não de sessão)", async () => {
    estado.ordersLoadError = "falha de rede";

    await abrir();

    expect(texto()).toContain("Não conseguimos carregar agora");
    expect(botao("Tentar de novo")).toBeDefined();
    expect(texto()).not.toContain("Entre na conta para ver este pedido");
  });

  it("LIMITE: sessão ainda sendo verificada não pisca o convite de login", async () => {
    estado.loading = true;

    await abrir();

    expect(texto()).not.toContain("Entre na conta para ver este pedido");
    expect(texto()).not.toContain("Pedido não encontrado");
  });
});
