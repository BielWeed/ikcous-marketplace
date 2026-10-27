// @vitest-environment jsdom
//
// Lote 230: "Cancelar pedido" na ficha do pedido do painel pergunta pela
// JANELA DO APP, não pela caixa nativa do navegador. O texto é o mesmo de
// antes (`textoCancelamentoDoPainel`). Prova: a janela abre, `confirm` NÃO é
// chamado, nada é cancelado antes da resposta, confirmar cancela UMA vez
// (mesmo com duplo toque) e "Voltar" não cancela.
// Mocks do supabase copiados de ficha-cancelar-pago-diz-quem-devolve.test.tsx.
import type { Order, OrderStatus } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: vi.fn(),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(() =>
            Promise.resolve({ data: null, error: null }),
          ),
        })),
      })),
    })),
    functions: { invoke: vi.fn() },
    channel: vi.fn(),
    removeChannel: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedidoPago(): Order {
  return {
    id: "ped-230",
    customer: {
      name: "Cliente Teste",
      whatsapp: "34999999999",
      address: "Rua das Flores",
      number: "123",
      neighborhood: "Centro",
      city: "Patos de Minas",
      state: "MG",
    },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "online",
    paymentStatus: "pago",
    status: "processing",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
  };
}

const normal = (t: string | null | undefined) =>
  (t ?? "").replace(/\s+/g, " ").trim();

describe("lote 230 — Cancelar pedido (ficha do painel) pergunta pela janela do app", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let nativo: ReturnType<typeof vi.fn>;
  let onStatusChange: Mock<
    (id: string, status: OrderStatus, esperado?: OrderStatus) => void
  >;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    nativo = vi.fn(() => true);
    vi.stubGlobal("confirm", nativo);
    onStatusChange = vi.fn();
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
    document.body.innerHTML = "";
    vi.unstubAllGlobals();
  });

  const janela = () =>
    document.querySelector<HTMLElement>('[data-testid="confirmar-acao"]');

  async function tocarEmCancelar() {
    const { OrderDetail } = await import(
      "@/components/admin/orders/OrderDetail"
    );
    await act(async () => {
      raiz.render(
        <OrderDetail order={pedidoPago()} onStatusChange={onStatusChange} />,
      );
    });
    const botao = [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("Cancelar pedido"),
    );
    expect(botao).toBeDefined();
    await act(async () => {
      botao?.click();
    });
  }

  it("abre a janela com o texto de antes e o verbo da ação, sem confirm nativo e sem cancelar ainda", async () => {
    await tocarEmCancelar();

    expect(nativo).not.toHaveBeenCalled();
    const j = janela();
    expect(j).not.toBeNull();
    expect(normal(j?.textContent)).toContain("Cancelar este pedido?");
    expect(normal(j?.textContent)).toContain(
      "Este pedido está PAGO e ainda não saiu para entrega.",
    );
    expect(normal(j?.textContent)).toContain("Cancelar mesmo assim?");
    expect(
      Array.from(j?.querySelectorAll("button") ?? []).map((b) =>
        normal(b.textContent),
      ),
    ).toEqual(["Voltar", "Cancelar pedido"]);
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("confirmar cancela UMA vez, mesmo com duplo toque", async () => {
    await tocarEmCancelar();
    const botoes = Array.from(janela()?.querySelectorAll("button") ?? []);
    const acao = botoes[botoes.length - 1];

    await act(async () => {
      acao.click();
      acao.click();
    });

    expect(nativo).not.toHaveBeenCalled();
    const cancelamentos = onStatusChange.mock.calls.filter(
      (c) => c[1] === "cancelled",
    );
    expect(cancelamentos).toHaveLength(1);
    expect(cancelamentos[0][0]).toBe("ped-230");
  });

  it("'Voltar' não cancela nada", async () => {
    await tocarEmCancelar();
    const voltar = Array.from(janela()?.querySelectorAll("button") ?? [])[0];

    await act(async () => {
      voltar.click();
    });

    expect(nativo).not.toHaveBeenCalled();
    expect(onStatusChange).not.toHaveBeenCalled();
    expect(janela()).toBeNull();
  });
});
