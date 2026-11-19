// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  CHAVE_DO_RETRATO,
  limparRetratoDoConvidado,
} from "@/lib/retrato-do-convidado";
import type { Order } from "@/types";

const generateOrderOtp = vi.fn();
const fetchOrdersByOtp = vi.fn();
const fetchUserOrders = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  ErroCancelamentoNaoConcluido: class extends Error {},
  useOrders: () => ({
    generateOrderOtp,
    fetchOrdersByOtp,
    fetchUserOrders,
    orders: [],
    ordersLoadError: null,
    updateOrderStatus: vi.fn(),
    reenviarComprovante: vi.fn(),
  }),
}));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, loading: false }),
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
vi.mock("@/contexts/StoreContext", () => ({
  useStore: () => ({ config: { enableReviews: false } }),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: () => {}, medium: () => {} },
}));

const pedido: Order = {
  id: "pedido-teste-abcdef",
  customer: { name: "Cliente fictício", whatsapp: "11999999999" },
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

function digitar(host: HTMLElement, placeholder: string, valor: string) {
  const campo = host.querySelector<HTMLInputElement>(
    `[placeholder="${placeholder}"]`,
  );
  if (!campo) throw new Error(`Campo não encontrado: ${placeholder}`);
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLInputElement.prototype,
    "value",
  )!.set!;
  setter.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("OrderSearch — storage bloqueado não esconde pedidos verificados", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
    vi.resetAllMocks();
    generateOrderOtp.mockResolvedValue(true);
    fetchOrdersByOtp.mockResolvedValue([pedido]);
    fetchUserOrders.mockResolvedValue([]);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.restoreAllMocks();
    limparRetratoDoConvidado();
    sessionStorage.clear();
    localStorage.clear();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function consultar() {
    const onOrdersFound = vi.fn();
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () =>
      raiz.render(
        <OrderSearch onNavigate={vi.fn()} onOrdersFound={onOrdersFound} />,
      ),
    );
    const aba = [...host.querySelectorAll("button")].find(
      (el) => el.textContent?.trim() === "Rastrear sem Conta",
    );
    if (!aba) throw new Error("Aba de rastreio não encontrada");
    await act(async () => aba.click());
    await act(async () => {
      digitar(host, "SEU E-MAIL", "pessoa@example.com");
      digitar(host, "SEU WHATSAPP", "11999999999");
      digitar(host, "6 FINAIS DO ID DO PEDIDO", "abcdef");
    });
    await act(async () => host.querySelector("form")!.requestSubmit());
    await act(async () =>
      digitar(host, "DIGITE O CÓDIGO DE 6 DÍGITOS", "123456"),
    );
    await act(async () => host.querySelector("form")!.requestSubmit());
    return onOrdersFound;
  }

  async function abrirDetalhes(orderId = pedido.id) {
    const { OrderDetailsView } = await import(
      "@/views/customer/OrderDetailsView"
    );
    await act(async () =>
      raiz.render(
        <OrderDetailsView
          orderId={orderId}
          onBack={vi.fn()}
          onNavigate={vi.fn()}
        />,
      ),
    );
  }

  function avisoDoRetrato() {
    return host.querySelector('[data-testid="aviso-retrato-do-convidado"]');
  }

  function bloquearStorage(...metodos: ("getItem" | "setItem")[]) {
    // O global Storage do Node pode não ser o mesmo do jsdom.
    const prototipo: Storage = Object.getPrototypeOf(sessionStorage);
    for (const metodo of metodos) {
      vi.spyOn(prototipo, metodo).mockImplementation(() => {
        throw new DOMException("Armazenamento bloqueado", "SecurityError");
      });
    }
  }

  it.each(["gravação", "acesso"])(
    "entrega os pedidos sem toast de erro se a %s do cache lança SecurityError",
    async (falha) => {
      if (falha === "gravação") {
        bloquearStorage("setItem");
      } else {
        vi.spyOn(globalThis, "sessionStorage", "get").mockImplementation(() => {
          throw new DOMException("Armazenamento bloqueado", "SecurityError");
        });
      }
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
      const erroNoConsole = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});

      const onOrdersFound = await consultar();

      expect(fetchOrdersByOtp).toHaveBeenCalledTimes(1);
      expect(onOrdersFound).toHaveBeenCalledExactlyOnceWith([pedido]);
      expect(toastSuccess).toHaveBeenCalledWith("1 pedido encontrado!");
      expect(toastError).not.toHaveBeenCalled();
      expect(aviso).toHaveBeenCalledTimes(1);
      expect(erroNoConsole).not.toHaveBeenCalled();
    },
  );

  it("abre os detalhes do pedido validado quando a gravação e a leitura estão bloqueadas", async () => {
    bloquearStorage("setItem", "getItem");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await consultar();

    await abrirDetalhes();

    expect(avisoDoRetrato()).not.toBeNull();
    expect(host.textContent).toContain("#ABCDEF");
  });

  it("abre o novo pedido, não o anterior que ficou no storage quando só a gravação falha", async () => {
    const anterior = { ...pedido, id: "pedido-anterior-654321" };
    sessionStorage.setItem(
      CHAVE_DO_RETRATO,
      JSON.stringify({ pedidos: [anterior], consultadoEm: Date.now() }),
    );
    bloquearStorage("setItem");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await consultar();

    await abrirDetalhes(anterior.id);
    expect(avisoDoRetrato()).toBeNull();
    await act(async () => raiz.render(null));
    await abrirDetalhes();
    expect(avisoDoRetrato()).not.toBeNull();
  });

  it("aberta após 15 minutos, a tela de detalhes não mostra a cópia em memória", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
    bloquearStorage("setItem", "getItem");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await consultar();

    vi.setSystemTime(Date.now() + 15 * 60_000 - 1);
    await abrirDetalhes();
    expect(avisoDoRetrato()).not.toBeNull();
    await act(async () => raiz.render(null));

    vi.setSystemTime(Date.now() + 2);
    await abrirDetalhes();
    expect(avisoDoRetrato()).toBeNull();
  });

  it("limpar a consulta também tira a cópia em memória", async () => {
    bloquearStorage("setItem", "getItem");
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await consultar();
    await abrirDetalhes();
    expect(avisoDoRetrato()).not.toBeNull();
    await act(async () => raiz.render(null));

    limparRetratoDoConvidado();
    await abrirDetalhes();
    expect(avisoDoRetrato()).toBeNull();
  });

  it("com storage funcionando, grava no formato de antes e abre os detalhes", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const agora = new Date("2026-11-19T12:00:00Z");
    vi.setSystemTime(agora);
    await consultar();

    expect(
      JSON.parse(sessionStorage.getItem(CHAVE_DO_RETRATO) ?? "null"),
    ).toEqual({
      consultadoEm: agora.getTime(),
      pedidos: [pedido],
    });
    expect(localStorage.getItem(CHAVE_DO_RETRATO)).toBeNull();
    await abrirDetalhes();
    expect(avisoDoRetrato()).not.toBeNull();
  });
});
