// @vitest-environment jsdom
/**
 * Rastreio salvo em outro aparelho não apaga o que a lojista está digitando
 * (lote r75-a).
 *
 * O pedido da ficha se atualiza ao vivo. Antes, qualquer mudança do código de
 * rastreio que chegasse (salva em outro aparelho) reescrevia o campo aberto, e
 * o que ela estava digitando sumia. Agora: o código SALVO sempre acompanha o
 * pedido; o texto digitado só é trocado se ela não tinha mexido nele (ou se a
 * ficha passou para OUTRO pedido). Quando preserva o rascunho, avisa em
 * português simples que o código mudou em outro aparelho.
 */
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () =>
            Promise.resolve({
              data:
                tabela === "config_mototaxi"
                  ? { whatsapp: null, nome: null }
                  : null,
              error: null,
            }),
        }),
      }),
    }),
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));
vi.mock("@/components/admin/orders/EtiquetaDoPedidoCard", () => ({
  EtiquetaDoPedidoCard: () => null,
}));
vi.mock("@/components/admin/orders/EstornoCard", () => ({
  EstornoCard: () => null,
}));
vi.mock("@/components/admin/orders/DevolucaoDoPedidoAdminCard", () => ({
  DevolucaoDoPedidoAdminCard: () => null,
}));

import { OrderDetail } from "@/components/admin/orders/OrderDetail";
import { toast } from "sonner";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(id: string, trackingCode: string): Order {
  return {
    id,
    notes: "",
    trackingCode,
    customer: { name: "Cliente Teste", whatsapp: "34999999999" },
    items: [],
    subtotal: 100,
    shipping: 0,
    discount: 0,
    total: 100,
    paymentMethod: "pix",
    paymentStatus: "pago",
    status: "processing",
    createdAt: "2026-11-08T09:00:00Z",
    updatedAt: "2026-11-08T09:00:00Z",
    cancelledAfterShipping: false,
  };
}

describe("ficha do pedido — rastreio que chega de outro aparelho", () => {
  let hospedeiro: HTMLDivElement;
  let raiz: Root;

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

  async function mostrar(order: Order) {
    await act(async () => {
      raiz.render(<OrderDetail order={order} onStatusChange={vi.fn()} />);
    });
  }

  function clicar(texto: string) {
    const botao = [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.textContent === texto || b.getAttribute("title") === texto,
    );
    if (!botao) throw new Error(`Botão ausente: ${texto}`);
    act(() => botao.click());
  }

  function campo() {
    const elemento =
      hospedeiro.querySelector<HTMLInputElement>("#tracking-input");
    if (!elemento) throw new Error("Campo do rastreio ausente");
    return elemento;
  }

  function digitar(texto: string) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set;
    if (!setter) throw new Error("Campo sem setter de valor");
    act(() => {
      setter.call(campo(), texto);
      campo().dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  it("com o campo aberto e texto digitado, o código novo NÃO troca o que ela digita — mas passa a ser o salvo", async () => {
    await mostrar(pedido("A", "ANTIGO"));
    clicar("Editar Código");
    digitar("MEU-TEXTO");

    await mostrar(pedido("A", "NOVO-DE-OUTRO-APARELHO"));

    expect(campo().value).toBe("MEU-TEXTO");
    expect(toast.info).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.info).mock.calls[0][0]).toContain(
      "mudou em outro aparelho",
    );
    // Cancelar volta ao código que está salvo AGORA, não ao antigo.
    act(() =>
      hospedeiro
        .querySelector<HTMLButtonElement>(
          '[aria-label="Cancelar edição do código"]',
        )
        ?.click(),
    );
    expect(hospedeiro.textContent).toContain("NOVO-DE-OUTRO-APARELHO");
    expect(hospedeiro.textContent).not.toContain("ANTIGO");
  });

  it("com o campo aberto e SEM texto novo digitado, o código novo aparece no campo", async () => {
    await mostrar(pedido("A", "ANTIGO"));
    clicar("Editar Código");
    expect(campo().value).toBe("ANTIGO");

    await mostrar(pedido("A", "NOVO-DE-OUTRO-APARELHO"));

    expect(campo().value).toBe("NOVO-DE-OUTRO-APARELHO");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("com o campo fechado, o código novo aparece na ficha sem aviso", async () => {
    await mostrar(pedido("A", "ANTIGO"));

    await mostrar(pedido("A", "NOVO-DE-OUTRO-APARELHO"));

    expect(hospedeiro.textContent).toContain("NOVO-DE-OUTRO-APARELHO");
    expect(toast.info).not.toHaveBeenCalled();
  });

  it("trocar de pedido descarta o rascunho do anterior, mesmo digitado", async () => {
    await mostrar(pedido("A", "CODIGO-A"));
    clicar("Editar Código");
    digitar("RASCUNHO-DE-A");

    await mostrar(pedido("B", "CODIGO-B"));
    clicar("Editar Código");

    expect(campo().value).toBe("CODIGO-B");
    expect(toast.info).not.toHaveBeenCalled();
  });
});
