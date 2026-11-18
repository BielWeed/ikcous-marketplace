// @vitest-environment jsdom
//
// O botão de WhatsApp da ficha do pedido abre "Olá <nome>! Entramos em
// contato...". Pedido antigo com o nome só de espaços abria "Olá    !" (o `||`
// toma "   " por nome); nome com espaços nas pontas deixava espaço sobrando.
//
// Molde de montagem: ficha-do-pedido-por-tipo-de-entrega.test.tsx.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(nome: string): Order {
  return {
    id: "ped-nome-1",
    customer: {
      name: nome,
      whatsapp: "34999998888",
      address: "Rua das Flores",
      number: "10",
      neighborhood: "Centro",
      city: "Uberlândia",
      state: "MG",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "cash",
    status: "delivered",
    paymentStatus: "recebido_na_entrega",
    createdAt: "2026-10-08T14:00:00.000Z",
    updatedAt: "2026-10-08T14:00:00.000Z",
    cancelledAfterShipping: false,
  };
}

describe("ficha do pedido: WhatsApp usa o nome do cliente tratado", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let abrir: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    abrir = vi.fn();
    vi.stubGlobal("open", abrir);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.unstubAllGlobals();
  });

  async function mensagemAoTocar(nome: string): Promise<string> {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail order={pedido(nome)} onStatusChange={vi.fn()} />,
      );
    });
    const botao = hospedeiro.querySelector(
      '[aria-label="Conversar no WhatsApp"]',
    ) as HTMLButtonElement;
    await act(async () => {
      botao.click();
    });
    expect(abrir).toHaveBeenCalledTimes(1);
    const url = new URL(abrir.mock.calls[0][0] as string);
    return url.searchParams.get("text") ?? "";
  }

  it.each([
    ["só espaços", "   ", "Olá Cliente!"],
    ["vazio", "", "Olá Cliente!"],
    ["com espaços nas pontas", "  Maria  ", "Olá Maria!"],
    ["com espaços sobrando no meio", "  Maria   Silva ", "Olá Maria Silva!"],
  ])("nome %s", async (_descricao, nome, abertura) => {
    const texto = await mensagemAoTocar(nome);
    expect(texto.startsWith(`${abertura} Entramos em contato`)).toBe(true);
  });
});
