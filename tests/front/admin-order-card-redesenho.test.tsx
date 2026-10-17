// @vitest-environment jsdom
// Card de pedido da lista do painel (redesenho de 07/10/2026): o rodapé reúne
// WhatsApp e "Marcar como recebido" numa linha só. O que se prova aqui é o
// CONTRATO que o redesenho não pode perder — cada ramo do rodapé, a escala do
// valor e a leitura do pedido —, não a aparência.
import { AdminOrderCard } from "@/components/admin/orders/AdminOrderCard";
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

(
  globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;

function pedido(sobre: Partial<Order> = {}): Order {
  return {
    id: "aaaaaaaa-0000-0000-0000-000000eca2d5",
    customer: { name: "João Gabriel Vieira", whatsapp: "34999999999" },
    items: [
      {
        productId: "p1",
        name: "maleta canetas 120",
        price: 99.9,
        quantity: 2,
        image: "",
      },
    ],
    subtotal: 99.9,
    shipping: 0,
    discount: 0,
    total: 99.9,
    paymentMethod: "cash",
    status: "pending",
    paymentStatus: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    cancelledAfterShipping: false,
    pagamentoRecebidoEm: null,
    ...sobre,
  } as Order;
}

describe("AdminOrderCard — rodapé e leitura do pedido", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const aoSelecionar = vi.fn();
  const aoChamarWhatsapp = vi.fn();
  const aoRegistrar = vi.fn();

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    aoSelecionar.mockReset();
    aoChamarWhatsapp.mockReset();
    aoRegistrar.mockReset();
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  function desenhar(
    order: Order,
    modo: "compact" | "detailed" = "compact",
    registrando = false,
  ) {
    act(() => {
      raiz.render(
        <AdminOrderCard
          order={order}
          viewMode={modo}
          onSelect={aoSelecionar}
          onWhatsApp={aoChamarWhatsapp}
          onRegistrarPagamento={aoRegistrar}
          registrandoPagamento={registrando}
        />,
      );
    });
  }

  const botao = (texto: string) =>
    Array.from(hospedeiro.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === texto,
    );

  it("mostra quem comprou, o produto, o valor em reais e a conta de unidades (não de linhas)", () => {
    desenhar(pedido());
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("João Gabriel Vieira");
    expect(texto).toContain("maleta canetas 120");
    expect(texto).toContain("99,90");
    // 1 linha de pedido com quantidade 2 = "2 itens", não "1 item".
    expect(texto).toContain("2 un.");
    expect(texto).toContain("#ECA2D5");
  });

  it("pedido a receber: o botão de recebimento convive com o WhatsApp e só ele chama a RPC", () => {
    desenhar(pedido());
    const zap = hospedeiro.querySelector('button[title="WhatsApp"]');
    expect(zap).toBeTruthy();
    expect(zap?.getAttribute("aria-label")).toMatch(/whatsapp/i);

    act(() => {
      botao("Marcar como recebido")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    expect(aoRegistrar).not.toHaveBeenCalled();
    const confirmar = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Recebi",
    );
    expect(confirmar).toBeTruthy();
    act(() => confirmar?.click());
    expect(aoRegistrar).toHaveBeenCalledWith(
      "aaaaaaaa-0000-0000-0000-000000eca2d5",
      true,
    );
    // O toque no botão não abre a ficha do pedido.
    expect(aoSelecionar).not.toHaveBeenCalled();
  });

  it("em voo: o botão diz 'Registrando...' e fica desabilitado", () => {
    desenhar(pedido(), "compact", true);
    const b = botao("Registrando...");
    expect(b).toBeTruthy();
    expect((b as HTMLButtonElement).disabled).toBe(true);
    expect(botao("Marcar como recebido")).toBeUndefined();
  });

  it("já recebido: mostra a data e o 'Desfazer', e some o 'Marcar como recebido'", () => {
    desenhar(pedido({ pagamentoRecebidoEm: "2026-10-05T12:00:00.000Z" }));
    expect(hospedeiro.textContent).toMatch(/Recebido em/);
    expect(botao("Marcar como recebido")).toBeUndefined();
    act(() => {
      botao("Desfazer")?.dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
    });
    // 15/10/2026: "Desfazer" só pergunta; quem desfaz é o botão de confirmar.
    expect(aoRegistrar).not.toHaveBeenCalled();
    const confirmar = [...document.body.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === "Desfazer recebimento",
    );
    expect(confirmar).toBeTruthy();
    act(() => {
      confirmar?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(aoRegistrar).toHaveBeenCalledTimes(1);
    expect(aoRegistrar).toHaveBeenCalledWith(
      "aaaaaaaa-0000-0000-0000-000000eca2d5",
      false,
    );
  });

  it("pedido pago online (a loja não registra recebimento): nenhum botão de recebimento, só 'Ver detalhes'", () => {
    desenhar(pedido({ paymentMethod: "online", paymentStatus: "pago" }));
    expect(botao("Marcar como recebido")).toBeUndefined();
    expect(botao("Desfazer")).toBeUndefined();
    expect(hospedeiro.textContent).toContain("Ver detalhes");
  });

  it("sem WhatsApp válido mostra o motivo e mantém o contato desabilitado", () => {
    desenhar(pedido({ customer: { name: "Maria", whatsapp: "" } as never }));
    const zap = hospedeiro.querySelector<HTMLButtonElement>(
      'button[title="WhatsApp"]',
    );
    expect(zap).toBeTruthy();
    expect(zap?.disabled).toBe(true);
    expect(hospedeiro.textContent).toContain(
      "Este cliente não tem telefone válido",
    );
    act(() => zap?.click());
    expect(aoChamarWhatsapp).not.toHaveBeenCalled();
  });

  it("clicar no card abre o pedido; o toque no WhatsApp não", () => {
    desenhar(pedido());
    act(() => {
      hospedeiro
        .querySelector('button[title="WhatsApp"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
        );
    });
    expect(aoSelecionar).not.toHaveBeenCalled();
    act(() => {
      hospedeiro
        .querySelector('button[title="WhatsApp"]')
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(aoChamarWhatsapp).toHaveBeenCalledTimes(1);
    expect(aoSelecionar).not.toHaveBeenCalled();

    act(() => {
      hospedeiro
        .querySelector("button[data-abrir-pedido]")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(aoSelecionar).toHaveBeenCalledTimes(1);
  });

  it("modo detalhado lista o que há no pedido (até 3 linhas + 'outros')", () => {
    const itens = Array.from({ length: 5 }, (_, i) => ({
      productId: `p${i}`,
      name: `Produto ${i}`,
      price: 10,
      quantity: 1,
      image: "",
    }));
    desenhar(pedido({ items: itens }), "detailed");
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Produto 0");
    expect(texto).toContain("Produto 2");
    expect(texto).not.toContain("Produto 3");
    expect(texto).toMatch(/e mais 2/);
  });
});
