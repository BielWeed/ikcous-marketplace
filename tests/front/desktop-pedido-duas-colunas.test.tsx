// @vitest-environment jsdom
import type { Order } from "@/types";
import { OrderDetailsView } from "@/views/customer/OrderDetailsView";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { classesDoCelular } from "./classes-do-celular";

const pedido: Order = {
  id: "pedido-desktop",
  customer: { name: "Cliente", whatsapp: "" },
  items: [
    {
      productId: "produto",
      name: "Produto",
      price: 100,
      quantity: 1,
      image: "/produto.png",
    },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "cash",
  status: "delivered",
  cancelledAfterShipping: false,
  createdAt: "2026-09-28T12:00:00Z",
  updatedAt: "2026-09-28T12:00:00Z",
};
const usuario = { id: "cliente" };
const buscar = vi.fn(async () => [pedido]);
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedido],
    fetchUserOrders: buscar,
    updateOrderStatus: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: true } }),
}));
vi.mock("@/hooks/useDevolucaoCliente", () => ({
  useDevolucaoCliente: () => ({
    atual: null,
    elegibilidade: null,
    devolucoes: [],
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: async () => ({ data: [], error: null }) }),
      }),
    }),
  },
}));

// @ts-expect-error flag de teste do React.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
let raiz: Root;
let host: HTMLDivElement;
beforeEach(async () => {
  host = document.createElement("div");
  document.body.append(host);
  raiz = createRoot(host);
  await act(async () => {
    raiz.render(
      <OrderDetailsView
        orderId={pedido.id}
        onBack={() => {}}
        onNavigate={() => {}}
      />,
    );
  });
});
afterEach(() => {
  act(() => raiz.unmount());
  host.remove();
});

it("preserva a ordem dos cartões e o espaçamento do celular nas duas colunas", () => {
  const status = host.querySelector<HTMLElement>(
    '[data-testid="cartao-status"]',
  )!;
  const esquerda = status.parentElement!;
  expect(classesDoCelular(esquerda.className)).toBe("space-y-4");
  const grade = esquerda.parentElement!;
  expect(classesDoCelular(grade.className)).toBe(
    "mx-auto max-w-2xl space-y-4 px-6 py-4",
  );
  expect(grade.classList.contains("lg:grid")).toBe(true);
  expect(grade.classList.contains("lg:space-y-0")).toBe(true);
  expect(grade.classList.contains("lg:grid-cols-[minmax(0,1fr)_360px]")).toBe(
    true,
  );
  expect(
    [...esquerda.children].map((el) =>
      el.querySelector("h2,h4")?.textContent?.trim(),
    ),
  ).toEqual(["Entregue", "O que achou da compra?", "Itens do pedido"]);
  const direita = esquerda.nextElementSibling as HTMLElement;
  expect(classesDoCelular(direita.className)).toBe("space-y-4");
  expect(direita.classList.contains("lg:sticky")).toBe(true);
  expect(direita.classList.contains("lg:top-6")).toBe(true);
  expect(direita.classList.contains("lg:overflow-y-auto")).toBe(true);
  expect(direita.children[0].querySelector("h4")?.textContent).toBe("Resumo");
  expect(direita.children[1].textContent).toContain("Endereço de entrega");
});

it("centraliza a avaliação só no desktop e conserva o fechamento e o portal", async () => {
  const gatilho = host.querySelector<HTMLButtonElement>(
    '[aria-label="Dar 3 estrelas para Produto"]',
  )!;
  await act(async () => gatilho.click());
  const dialogo = document.body.querySelector<HTMLElement>('[role="dialog"]')!;
  expect(classesDoCelular(dialogo.className)).toBe(
    "relative z-10 max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-[2.5rem] bg-zinc-50 p-6 shadow-2xl duration-300 animate-in slide-in-from-bottom",
  );
  expect(dialogo.classList.contains("lg:rounded-[2.5rem]")).toBe(true);
  expect(dialogo.classList.contains("lg:max-w-lg")).toBe(true);
  expect(classesDoCelular(dialogo.parentElement!.className)).toBe(
    "fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm duration-300 animate-in fade-in",
  );
  expect(dialogo.parentElement!.classList.contains("lg:items-center")).toBe(
    true,
  );
  expect(host.contains(dialogo)).toBe(false);
  await act(async () =>
    dialogo
      .querySelector<HTMLButtonElement>('[aria-label="Fechar avaliação"]')!
      .click(),
  );
  expect(document.body.querySelector('[role="dialog"]')).toBeNull();
});
