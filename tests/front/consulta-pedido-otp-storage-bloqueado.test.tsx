// @vitest-environment jsdom
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateOrderOtp = vi.fn();
const fetchOrdersByOtp = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ generateOrderOtp, fetchOrdersByOtp }),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: () => {}, medium: () => {} },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

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
    vi.resetAllMocks();
    generateOrderOtp.mockResolvedValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it.each(["gravação", "acesso"])(
    "entrega os pedidos sem toast de erro se a %s do cache lança SecurityError",
    async (falha) => {
      const erro = new DOMException("Armazenamento bloqueado", "SecurityError");
      if (falha === "gravação") {
        vi.spyOn(
          Object.getPrototypeOf(sessionStorage),
          "setItem",
        ).mockImplementation(() => {
          throw erro;
        });
      } else {
        vi.spyOn(globalThis, "sessionStorage", "get").mockImplementation(() => {
          throw erro;
        });
      }
      const aviso = vi.spyOn(console, "warn").mockImplementation(() => {});
      const erroNoConsole = vi
        .spyOn(console, "error")
        .mockImplementation(() => {});
      const pedidos = [{ id: "pedido-teste" }];
      fetchOrdersByOtp.mockResolvedValue(pedidos);
      const onOrdersFound = vi.fn();
      const { OrderSearch } = await import(
        "@/components/ui/custom/OrderSearch"
      );
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
        digitar(host, "ÚLTIMOS 6 DÍGITOS DO ID DO PEDIDO", "abcdef");
      });
      await act(async () => host.querySelector("form")!.requestSubmit());
      await act(async () =>
        digitar(host, "DIGITE O CÓDIGO DE 6 DÍGITOS", "123456"),
      );
      await act(async () => host.querySelector("form")!.requestSubmit());

      expect(fetchOrdersByOtp).toHaveBeenCalledTimes(1);
      expect(onOrdersFound).toHaveBeenCalledExactlyOnceWith(pedidos);
      expect(toastSuccess).toHaveBeenCalledWith("1 pedido(s) encontrado(s)!");
      expect(toastError).not.toHaveBeenCalled();
      expect(aviso).toHaveBeenCalledTimes(1);
      expect(erroNoConsole).not.toHaveBeenCalled();
    },
  );
});
