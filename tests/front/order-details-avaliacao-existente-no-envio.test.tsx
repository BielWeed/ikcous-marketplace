import type { Order } from "@/types";
// @vitest-environment jsdom
// Integra a folha e o hook reais: a consulta ao abrir ainda não via a
// avaliação feita no outro aparelho; a consulta do envio já a encontra.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
  usuario: { id: "comprador-fixture" },
  inicial: vi.fn(),
  existentes: vi.fn(),
  insert: vi.fn(),
  erro: vi.fn(),
  sucesso: vi.fn(),
  fetchUserOrders: vi.fn(),
}));
const pedido: Order = {
  id: "pedido-fixture",
  customer: { name: "Cliente Fixture", whatsapp: "" },
  items: [
    {
      productId: "produto-fixture",
      name: "Produto Fixture",
      price: 10,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 10,
  shipping: 0,
  discount: 0,
  total: 10,
  paymentMethod: "cash",
  status: "delivered",
  createdAt: "2026-11-01T12:00:00Z",
  updatedAt: "2026-11-01T12:00:00Z",
  cancelledAfterShipping: false,
};
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders: h.fetchUserOrders,
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: h.usuario, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/utils/admin_cache", () => ({
  cachedReviewsData: null,
  setCachedReviewsData: vi.fn(),
}));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: true, whatsappNumber: "" } }),
}));
vi.mock("sonner", () => ({
  toast: { error: h.erro, success: h.sucesso, info: vi.fn() },
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const filtro = {
        eq: () => filtro,
        in: h.inicial,
        limit: h.existentes,
      };
      return { select: () => filtro, insert: h.insert };
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let hospedeiro: HTMLDivElement;
const folha = () =>
  document.body.querySelector<HTMLElement>(
    '[aria-labelledby="titulo-avaliacao"]',
  );

beforeEach(() => {
  vi.clearAllMocks();
  h.fetchUserOrders.mockResolvedValue([pedido]);
  h.inicial.mockResolvedValue({ data: [], error: null });
  h.existentes.mockResolvedValue({
    data: [{ id: "avaliacao-no-outro-aparelho" }],
    error: null,
  });
  h.insert.mockReturnValue({
    select: () => ({
      single: async () => ({
        data: null,
        error: { message: "Failed to fetch" },
      }),
    }),
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});
afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});
async function enviar() {
  const { OrderDetailsView } = await import(
    "@/views/customer/OrderDetailsView"
  );
  await act(async () => {
    raiz.render(
      <OrderDetailsView
        orderId={pedido.id}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
  });
  expect(h.inicial).toHaveBeenCalledTimes(1);
  expect(hospedeiro.textContent).toContain("Escrever avaliação");
  const estrela = hospedeiro.querySelector<HTMLButtonElement>(
    '[aria-label="Dar 4 estrelas para Produto Fixture"]',
  );
  expect(estrela).not.toBeNull();
  await act(async () => estrela?.click());
  const area = folha()?.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  await act(async () => {
    setter?.call(area, "Comentário que não pode sumir por falha de rede");
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await act(async () => {
    folha()?.querySelector<HTMLButtonElement>('button[type="submit"]')?.click();
  });
}

it("já avaliado no outro aparelho: fecha a folha, marca Avaliado e não insere", async () => {
  await enviar();
  expect(h.erro).toHaveBeenCalledWith("Você já avaliou este produto.");
  expect(h.insert).not.toHaveBeenCalled();
  expect(folha()).toBeNull();
  expect(hospedeiro.textContent).toContain("Avaliado");
  expect(hospedeiro.textContent).not.toContain("Escrever avaliação");
});

it("falha real de rede mantém a folha aberta e o comentário para tentar de novo", async () => {
  h.existentes.mockResolvedValue({ data: [], error: null });
  await enviar();
  expect(h.insert).toHaveBeenCalledTimes(1);
  expect(h.erro).toHaveBeenCalledWith(
    "Sem conexão com o servidor. Verifique sua internet e tente novamente.",
  );
  expect(folha()).not.toBeNull();
  expect(folha()?.querySelector("textarea")?.value).toBe(
    "Comentário que não pode sumir por falha de rede",
  );
  expect(hospedeiro.textContent).toContain("Escrever avaliação");
  expect(h.sucesso).not.toHaveBeenCalled();
});
