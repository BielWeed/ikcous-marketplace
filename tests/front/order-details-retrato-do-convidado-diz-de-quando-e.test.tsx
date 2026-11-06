// @vitest-environment jsdom
//
// Rodada 21 (lote C2), achado B: quem rastreou o pedido SEM conta abre os
// detalhes e vê o status de quando consultou (sessionStorage), que nunca
// atualiza — sem nenhum aviso. Agora a tela diz "Status de HH:MM — pode ter
// mudado" e oferece "Consultar de novo". O aviso só existe quando o pedido
// veio desse retrato: pedido lido do servidor é vivo e não leva aviso.
//
// O retrato no formato ANTIGO (só a lista de pedidos) continua legível.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    config: { enableReviews: false, storeAddress: "Rua A, 10" },
  }),
}));

const ID = "pedido-do-rastreio";
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

async function abrir() {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView orderId={ID} onBack={onBack} onNavigate={() => {}} />,
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

describe("detalhes do pedido rastreado sem conta: o status diz de quando é", () => {
  it("retrato NOVO: mostra 'Status de HH:MM — pode ter mudado' e o botão Consultar de novo", async () => {
    sessionStorage.setItem(
      "guest_tracked_orders",
      JSON.stringify({ consultadoEm: Date.now(), pedidos: [pedido] }),
    );
    await abrir();

    // O pedido do retrato abriu (âncora: sem ela o aviso não prova nada).
    expect(texto()).not.toContain("Pedido não encontrado");
    expect(texto()).toMatch(/Status de \d{2}:\d{2} — pode ter mudado/);
    expect(botao("Consultar de novo")).toBeDefined();
  });

  it("retrato no formato ANTIGO (sem horário): vale como vencido, o pedido não abre e a chave some", async () => {
    sessionStorage.setItem("guest_tracked_orders", JSON.stringify([pedido]));
    await abrir();

    expect(texto()).toContain("Entre na conta para ver este pedido");
    expect(sessionStorage.getItem("guest_tracked_orders")).toBeNull();
  });

  it("'Consultar de novo' apaga o retrato e volta para a lista de pedidos", async () => {
    sessionStorage.setItem(
      "guest_tracked_orders",
      JSON.stringify({ consultadoEm: Date.now(), pedidos: [pedido] }),
    );
    await abrir();

    await act(async () => {
      botao("Consultar de novo")?.click();
    });

    expect(sessionStorage.getItem("guest_tracked_orders")).toBeNull();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("LIMITE: pedido lido do servidor (conta aberta) é vivo e não leva aviso", async () => {
    estado.user = { id: "u-1" };
    fetchUserOrders.mockResolvedValue([pedido]);
    await abrir();

    expect(texto()).not.toContain("Pedido não encontrado");
    expect(texto()).not.toContain("pode ter mudado");
    expect(botao("Consultar de novo")).toBeUndefined();
  });
});
