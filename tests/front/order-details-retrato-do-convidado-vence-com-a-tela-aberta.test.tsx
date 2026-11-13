// @vitest-environment jsdom
//
// Privacidade do rastreio sem conta: a lista do convidado sai da tela quando o
// retrato vence (60 min), mas "Ver detalhes" guardava o pedido em estado e
// seguia mostrando endereço e dados da compra com a tela esquecida aberta. Agora
// o detalhe do convidado solta o pedido no mesmo instante em que o retrato
// vence, apaga o retrato do aparelho e volta para a consulta.
//
// Dois caminhos fecham a janela, como na lista: o relógio (a pessoa deixou a
// tela aberta) e a volta ao primeiro plano (o relógio dormiu com o aparelho).
// Quem tem conta não passa por aqui: o pedido dele é lido do servidor.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PRAZO_DO_RETRATO_MS } from "@/lib/retrato-do-convidado";
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

const passar = (ms: number) =>
  act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

async function abrir() {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView orderId={ID} onBack={onBack} onNavigate={() => {}} />,
    );
  });
  await passar(0);
}

const texto = () => hospedeiro.textContent ?? "";
const avisoDoRetrato = () =>
  hospedeiro.querySelector('[data-testid="aviso-retrato-do-convidado"]');

function guardarRetrato() {
  sessionStorage.setItem(
    "guest_tracked_orders",
    JSON.stringify({ consultadoEm: Date.now(), pedidos: [pedido] }),
  );
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
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
  vi.useRealTimers();
});

describe("detalhes do pedido rastreado sem conta: o prazo vale com a tela aberta", () => {
  it("antes do prazo o pedido segue na tela; passado 1 h + 1 s ele some, o aparelho solta o retrato e volta para a consulta", async () => {
    guardarRetrato();
    await abrir();
    expect(avisoDoRetrato()).not.toBeNull();

    await passar(PRAZO_DO_RETRATO_MS - 60_000);
    expect(avisoDoRetrato()).not.toBeNull();
    expect(onBack).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("guest_tracked_orders")).not.toBeNull();

    await passar(61_000);
    expect(avisoDoRetrato()).toBeNull();
    expect(texto()).not.toContain("Status de");
    expect(texto()).not.toContain("#");
    expect(sessionStorage.getItem("guest_tracked_orders")).toBeNull();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("o relógio dormiu com o aparelho: a volta ao primeiro plano solta o pedido", async () => {
    guardarRetrato();
    await abrir();

    // O tempo passou sem o relógio disparar (aba em segundo plano).
    vi.setSystemTime(Date.now() + PRAZO_DO_RETRATO_MS + 1_000);
    expect(onBack).not.toHaveBeenCalled();
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
    });

    expect(avisoDoRetrato()).toBeNull();
    expect(texto()).not.toContain("#");
    expect(sessionStorage.getItem("guest_tracked_orders")).toBeNull();
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it("LIMITE: quem tem conta não é afetado (o pedido vem do servidor e não tem prazo)", async () => {
    estado.user = { id: "u-1" };
    fetchUserOrders.mockResolvedValue([pedido]);
    await abrir();
    expect(texto()).toContain("#");

    await passar(PRAZO_DO_RETRATO_MS * 3);
    expect(texto()).toContain("#");
    expect(onBack).not.toHaveBeenCalled();
  });

  it("LIMITE: sair da tela antes do prazo não deixa o relógio disparar depois", async () => {
    guardarRetrato();
    await abrir();
    act(() => raiz.unmount());
    raiz = createRoot(hospedeiro);

    await passar(PRAZO_DO_RETRATO_MS + 5_000);
    expect(onBack).not.toHaveBeenCalled();
  });
});
