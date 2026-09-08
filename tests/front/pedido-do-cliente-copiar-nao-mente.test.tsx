// @vitest-environment jsdom
//
// Brief "o app não mente quando copia" (08/09/2026) — a ficha do pedido do
// cliente (OrderDetailsView: handleCopyId, handleCopyTracking) e a lista de
// pedidos (OrderList: copyToClipboard) copiavam sem await/catch e já
// comemoravam ("copiado!"/toast de sucesso) MESMO quando a cópia falhava
// (permissão negada, janela sem foco, API ausente). Agora usam
// `copiarParaClipboard` (mesma peça do painel, `src/lib/copiar-para-clipboard.ts`)
// e só comemoram com `ok === true` — espelha
// ficha-do-pedido-copiar-endereco-falha-avisa.test.tsx (painel) para os
// pontos do cliente.
import type { Order } from "@/types";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/utils/haptic", () => ({
  haptic: { light: vi.fn(), medium: vi.fn(), success: vi.fn() },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// Mesmo motivo de order-details-gate-avaliacoes.test.tsx: `checkIfReviewed`
// consulta `reviews` direto pelo client do Supabase — sem vi.importActual,
// para não puxar o client de verdade (Web Worker, indisponível no jsdom) só
// de importar o módulo.
vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({ in: () => Promise.resolve({ data: [], error: null }) }),
      }),
    }),
  },
}));

const usuario = { id: "user-1" };
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: usuario }) }));

vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({
    config: { enableReviews: false, whatsappNumber: "34999999999" },
  }),
}));

import { toast } from "sonner";

const pedidoBase: Order = {
  id: "11111111-2222-3333-4444-555555555555",
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
  status: "shipping",
  trackingCode: "AA123456789BR",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
};

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    orders: [pedidoBase],
    fetchUserOrders: vi.fn().mockResolvedValue([pedidoBase]),
    updateOrderStatus: vi.fn(),
    reenviarComprovante: vi.fn(),
  }),
}));

let clipboardWriteText: (texto: string) => Promise<void> = vi
  .fn()
  .mockResolvedValue(undefined);

function stubClipboard() {
  Object.defineProperty(window.navigator, "clipboard", {
    value: {
      writeText: (...args: Parameters<typeof clipboardWriteText>) =>
        clipboardWriteText(...args),
    },
    configurable: true,
  });
}

// @ts-expect-error flag interna do React, sem tipo público
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderList — copiar o ID do pedido não mente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    stubClipboard();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    Reflect.deleteProperty(window.navigator, "clipboard");
  });

  async function renderizar() {
    const { OrderList } = await import("@/components/ui/custom/OrderList");
    await act(async () => {
      raiz.render(<OrderList orders={[pedidoBase]} onNavigate={() => {}} />);
    });
  }

  function botaoId() {
    return [...hospedeiro.querySelectorAll("button")].find(
      (b) =>
        b.textContent?.includes(`#${pedidoBase.id.slice(0, 8)}`) ||
        b.textContent?.includes("Copiado!"),
    );
  }

  it("clipboard recusa: nenhum toast de sucesso, toast de erro, cartão não vira 'Copiado!'", async () => {
    clipboardWriteText = vi
      .fn()
      .mockRejectedValue(new Error("NotAllowedError"));

    await renderizar();

    const botao = botaoId();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível copiar. Selecione o texto e copie manualmente.",
    );
    expect(botaoId()?.textContent).not.toContain("Copiado!");
  });

  it("clipboard aceita: toast de sucesso e o cartão vira 'Copiado!' (controle)", async () => {
    await renderizar();

    const botao = botaoId();
    await act(async () => {
      botao!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.success).toHaveBeenCalledWith("ID do pedido copiado!");
    expect(toast.error).not.toHaveBeenCalled();
    expect(botaoId()?.textContent).toContain("Copiado!");
  });
});

describe("OrderDetailsView — copiar id e rastreio não mente", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    vi.clearAllMocks();
    clipboardWriteText = vi.fn().mockResolvedValue(undefined);
    stubClipboard();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    Reflect.deleteProperty(window.navigator, "clipboard");
  });

  async function renderizar() {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () => {
      raiz.render(
        <OrderDetailsView
          orderId={pedidoBase.id}
          onBack={() => {}}
          onNavigate={() => {}}
        />,
      );
    });
    await act(async () => {
      await Promise.resolve();
    });
  }

  function botaoIdPedido() {
    return [...hospedeiro.querySelectorAll('[role="button"]')].find((el) =>
      el.textContent?.includes(`#${pedidoBase.id.slice(0, 8)}`),
    );
  }

  function botaoRastreio() {
    return [...hospedeiro.querySelectorAll("button")].find(
      (b) => b.getAttribute("title") === "Copiar código de rastreio",
    );
  }

  it("copiar ID: clipboard recusa não vira sucesso — toast de erro, sem toast de sucesso", async () => {
    clipboardWriteText = vi
      .fn()
      .mockRejectedValue(new Error("NotAllowedError"));

    await renderizar();

    const botao = botaoIdPedido();
    expect(botao).toBeTruthy();

    await act(async () => {
      (botao as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível copiar. Selecione o texto e copie manualmente.",
    );
  });

  it("copiar ID: clipboard aceita chama o toast de sucesso (controle)", async () => {
    await renderizar();

    const botao = botaoIdPedido();
    await act(async () => {
      (botao as HTMLElement).dispatchEvent(
        new MouseEvent("click", { bubbles: true }),
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.success).toHaveBeenCalledWith("ID do pedido copiado!");
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("copiar rastreio: clipboard recusa não vira sucesso — toast de erro, sem toast de sucesso", async () => {
    clipboardWriteText = vi
      .fn()
      .mockRejectedValue(new Error("NotAllowedError"));

    await renderizar();

    const botao = botaoRastreio();
    expect(botao).toBeTruthy();

    await act(async () => {
      botao!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.success).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledWith(
      "Não foi possível copiar. Selecione o texto e copie manualmente.",
    );
  });

  it("copiar rastreio: clipboard aceita chama o toast de sucesso (controle)", async () => {
    await renderizar();

    const botao = botaoRastreio();
    await act(async () => {
      botao!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toast.success).toHaveBeenCalledWith("Código de rastreio copiado!");
    expect(toast.error).not.toHaveBeenCalled();
  });
});
