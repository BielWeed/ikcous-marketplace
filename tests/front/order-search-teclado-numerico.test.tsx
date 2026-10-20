// @vitest-environment jsdom
//
// Código de 6 dígitos do rastreio: o celular abria o teclado de LETRAS e não
// oferecia o código que chegou por SMS/e-mail. Pede teclado numérico e o
// preenchimento automático. Continua `type="text"` (não perde zero à esquerda).
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const generateOrderOtp = vi.fn();
const fetchOrdersByOtp = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ generateOrderOtp, fetchOrdersByOtp }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: () => {}, medium: () => {}, heavy: () => {} },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function campo(host: HTMLElement, placeholder: string) {
  return host.querySelector<HTMLInputElement>(`[placeholder="${placeholder}"]`);
}

function digitar(host: HTMLElement, placeholder: string, valor: string) {
  const el = campo(host, placeholder) as HTMLInputElement;
  Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set?.call(el, valor);
  el.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("OrderSearch — teclado do código de 6 dígitos", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    generateOrderOtp.mockResolvedValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  it("pede teclado numérico e aceita o código do SMS/e-mail", async () => {
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Rastrear sem Conta")
        ?.click();
    });
    await act(async () => {
      digitar(host, "SEU E-MAIL", "cliente@teste.com");
      digitar(host, "SEU WHATSAPP", "34999999999");
      digitar(host, "ÚLTIMOS 6 DÍGITOS DO ID DO PEDIDO", "abcdef");
    });
    await act(async () => {
      host.querySelector<HTMLFormElement>("form")?.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });
    const codigo = campo(host, "DIGITE O CÓDIGO DE 6 DÍGITOS");
    expect(codigo).not.toBeNull();
    expect(codigo?.getAttribute("inputmode")).toBe("numeric");
    expect(codigo?.getAttribute("autocomplete")).toBe("one-time-code");
    expect(codigo?.type).toBe("text");
  });
});
