// @vitest-environment jsdom
//
// UI-191 (G10): "Cancelar Pedido" perguntava pelo `confirm()` do navegador, que
// numa loja instalada aparece com o endereço do site e o visual do sistema.
// Agora é a caixa de confirmação da casa (AlertDialog), acima da barra de
// navegação, com O MESMO caminho de cancelamento: nada é cancelado antes do
// "sim", "Manter pedido" não cancela, e o "sim" chama a mesma edge uma vez.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Order } from "@/types";
import type * as Modulo from "@/views/customer/OrderDetailsView";

const pedido: Order = {
  id: "pedido-cancelar",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 20,
  discount: 0,
  total: 120,
  paymentMethod: "pix",
  status: "pending",
  paymentStatus: "pago",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

// O pedido que a lista do hook entrega agora. O teste do texto vivo troca este
// valor (a loja marcou "enviado" com a caixa aberta) e renderiza de novo.
let pedidoAtual: Order = pedido;
const updateOrderStatusMock = vi.fn();
vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoAtual],
    fetchUserOrders: vi.fn().mockResolvedValue([pedido]),
    updateOrderStatus: updateOrderStatusMock,
  }),
  ErroCancelamentoNaoConcluido: class extends Error {},
}));
// Mesmo objeto a cada chamada: usuário novo a cada render refaz os efeitos da
// tela (a conferência de avaliações do pedido entregue) sem parar.
const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
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
vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderDetailsView — cancelar pedido pela caixa de confirmação da loja", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let confirmSpy: ReturnType<typeof vi.spyOn>;
  let OrderDetailsView: typeof Modulo.OrderDetailsView;

  beforeEach(async () => {
    pedidoAtual = pedido;
    updateOrderStatusMock.mockReset().mockResolvedValue(undefined);
    confirmSpy = vi.spyOn(globalThis, "confirm").mockReturnValue(true);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    ({ OrderDetailsView } = await import("@/views/customer/OrderDetailsView"));
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-cancelar"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    confirmSpy.mockRestore();
  });

  const caixa = () =>
    document.querySelector<HTMLElement>('[role="alertdialog"]');
  const botao = (raizDoBotao: ParentNode, rotulo: string) =>
    Array.from(raizDoBotao.querySelectorAll<HTMLButtonElement>("button")).find(
      (b) => b.textContent?.includes(rotulo),
    );

  async function abrirACaixa() {
    const abrir = botao(hospedeiro, "Cancelar Pedido");
    expect(abrir).toBeDefined();
    await act(async () => {
      abrir!.click();
    });
  }

  it("abre a caixa da loja (não o confirm do navegador) e ainda não cancela nada", async () => {
    await abrirACaixa();

    expect(confirmSpy).not.toHaveBeenCalled();
    expect(caixa()).not.toBeNull();
    expect(caixa()!.textContent).toContain("Cancelar este pedido?");
    // O texto é o de sempre sobre o dinheiro (pedido pago e não enviado).
    expect(caixa()!.textContent).toContain("volta sozinho");
    // Acima da barra de navegação da loja (z-120).
    expect(caixa()!.className).toContain("z-[130]");
    expect(updateOrderStatusMock).not.toHaveBeenCalled();
  });

  it("'Manter pedido' fecha a caixa e não cancela", async () => {
    await abrirACaixa();
    await act(async () => {
      botao(caixa()!, "Manter pedido")!.click();
    });

    expect(caixa()).toBeNull();
    expect(updateOrderStatusMock).not.toHaveBeenCalled();
    expect(botao(hospedeiro, "Cancelar Pedido")).toBeDefined();
  });

  it("'Cancelar pedido' (o sim) chama o cancelamento uma vez, com o id do pedido", async () => {
    await abrirACaixa();
    await act(async () => {
      botao(caixa()!, "Cancelar pedido")!.click();
      await Promise.resolve();
    });

    expect(updateOrderStatusMock).toHaveBeenCalledTimes(1);
    expect(updateOrderStatusMock).toHaveBeenCalledWith(
      "pedido-cancelar",
      "cancelled",
    );
    expect(caixa()).toBeNull();
    expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("Escape fecha a caixa sem cancelar", async () => {
    await abrirACaixa();
    await act(async () => {
      caixa()!.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(updateOrderStatusMock).not.toHaveBeenCalled();
  });

  it("duplo toque no 'sim', com a caixa ainda na tela, cancela UMA vez", async () => {
    // Na saída da caixa (200 ms de animação) o botão segue na tela e clicável.
    // O jsdom não anima, então simulamos a animação de saída: o Radix só
    // desmonta o conteúdo quando ela termina.
    const original = globalThis.getComputedStyle;
    let saindo = false;
    const estilo = vi
      .spyOn(globalThis, "getComputedStyle")
      .mockImplementation((el, pseudo) => {
        const real = original(el, pseudo);
        return new Proxy(real, {
          get: (alvo, prop) =>
            prop === "animationName"
              ? saindo
                ? "saida-da-caixa"
                : "none"
              : Reflect.get(alvo, prop),
        });
      });
    try {
      await abrirACaixa();
      const sim = botao(caixa()!, "Cancelar pedido")!;
      saindo = true;
      await act(async () => {
        sim.click();
      });
      // Prova de que o cenário é o real: o mesmo botão continua montado.
      expect(sim.isConnected).toBe(true);
      await act(async () => {
        sim.click();
      });

      expect(updateOrderStatusMock).toHaveBeenCalledTimes(1);
    } finally {
      estilo.mockRestore();
    }
  });

  it("duplo toque com o servidor ainda respondendo cancela UMA vez", async () => {
    // Mesmo cenário, mas a edge demora: o segundo toque cai com o primeiro
    // cancelamento em andamento.
    const original = globalThis.getComputedStyle;
    let saindo = false;
    const estilo = vi
      .spyOn(globalThis, "getComputedStyle")
      .mockImplementation((el, pseudo) => {
        const real = original(el, pseudo);
        return new Proxy(real, {
          get: (alvo, prop) =>
            prop === "animationName"
              ? saindo
                ? "saida-da-caixa"
                : "none"
              : Reflect.get(alvo, prop),
        });
      });
    let terminar: () => void = () => {};
    updateOrderStatusMock.mockReturnValue(
      new Promise<void>((resolve) => {
        terminar = resolve;
      }),
    );
    try {
      await abrirACaixa();
      const sim = botao(caixa()!, "Cancelar pedido")!;
      saindo = true;
      await act(async () => {
        sim.click();
      });
      expect(sim.isConnected).toBe(true);
      await act(async () => {
        sim.click();
      });
      expect(updateOrderStatusMock).toHaveBeenCalledTimes(1);
      await act(async () => {
        terminar();
      });
    } finally {
      estilo.mockRestore();
    }
  });

  async function renderizarDeNovo() {
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-cancelar"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  it("pedido que deixa de ser cancelável fecha a caixa, sem frase falsa de dinheiro", async () => {
    // Pago e já enviado; com a caixa aberta a loja marca como entregue.
    pedidoAtual = {
      ...pedido,
      status: "shipping",
      updatedAt: new Date(30_000).toISOString(),
    };
    await renderizarDeNovo();
    await abrirACaixa();
    expect(caixa()).not.toBeNull();

    pedidoAtual = {
      ...pedido,
      status: "delivered",
      updatedAt: new Date(60_000).toISOString(),
    };
    // Registra tudo que a caixa chegou a mostrar na virada, mesmo por um
    // único render que ninguém chegaria a ver: o texto de dinheiro de um
    // pedido entregue não pode aparecer nem de passagem.
    const textosVistos: string[] = [];
    const vigia = new MutationObserver((registros) => {
      for (const r of registros) {
        if (r.type === "characterData")
          textosVistos.push(r.target.textContent ?? "");
        for (const no of Array.from(r.addedNodes))
          textosVistos.push(no.textContent ?? "");
      }
    });
    vigia.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });
    await renderizarDeNovo();
    vigia.disconnect();
    expect(textosVistos.join("|")).not.toContain("volta sozinho");

    // O botão "Cancelar Pedido" sumiu e a caixa foi junto.
    expect(botao(hospedeiro, "Cancelar Pedido")).toBeUndefined();
    expect(caixa()).toBeNull();
    expect(document.body.textContent).not.toContain("volta sozinho");

    // E não fica "armada": se o pedido voltasse a ser cancelável, a caixa
    // não reabre sozinha.
    pedidoAtual = {
      ...pedido,
      status: "shipping",
      updatedAt: new Date(120_000).toISOString(),
    };
    await renderizarDeNovo();
    expect(botao(hospedeiro, "Cancelar Pedido")).toBeDefined();
    expect(caixa()).toBeNull();
    expect(updateOrderStatusMock).not.toHaveBeenCalled();
  });

  it("cancelamento que falhou: tocar em 'Cancelar Pedido' de novo reabre a caixa e o 2º 'sim' cancela", async () => {
    updateOrderStatusMock
      .mockRejectedValueOnce(new Error("falhou"))
      .mockResolvedValue(undefined);
    const erroNoConsole = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    try {
      await abrirACaixa();
      await act(async () => {
        botao(caixa()!, "Cancelar pedido")!.click();
        await Promise.resolve();
      });
      await act(async () => {
        await Promise.resolve();
      });
      expect(updateOrderStatusMock).toHaveBeenCalledTimes(1);
      expect(caixa()).toBeNull();

      // O pedido segue cancelável e o botão voltou: nova tentativa.
      await abrirACaixa();
      expect(caixa()).not.toBeNull();
      await act(async () => {
        botao(caixa()!, "Cancelar pedido")!.click();
        await Promise.resolve();
      });
      expect(updateOrderStatusMock).toHaveBeenCalledTimes(2);
    } finally {
      erroNoConsole.mockRestore();
    }
  });

  it("o texto do dinheiro acompanha o pedido enquanto a caixa está aberta", async () => {
    await abrirACaixa();
    expect(caixa()!.textContent).toContain("volta sozinho");

    // A loja marca como enviado com a caixa aberta: o produto saiu.
    pedidoAtual = {
      ...pedido,
      status: "shipping",
      updatedAt: new Date(60_000).toISOString(),
    };
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId="pedido-cancelar"
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(caixa()).not.toBeNull();
    expect(caixa()!.textContent).not.toContain("volta sozinho");
    expect(caixa()!.textContent?.toLowerCase()).toContain("produto");
  });
});
