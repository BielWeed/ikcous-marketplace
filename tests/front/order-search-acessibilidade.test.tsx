// @vitest-environment jsdom
//
// Caça 8 (26/10/2026), item 2: os campos do "Rastrear Pedido" só tinham
// placeholder (some ao digitar, não é nome para leitor de tela) e o celular não
// oferecia e-mail/telefone salvos nem o teclado certo.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    generateOrderOtp: vi.fn(),
    fetchOrdersByOtp: vi.fn(),
  }),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: () => {}, medium: () => {}, heavy: () => {} },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

describe("OrderSearch — campos com nome e teclado certos", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(async () => {
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Rastrear sem Conta")
        ?.click();
    });
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  it("cada campo tem nome acessível e o preenchimento automático certo", () => {
    const campos = [...host.querySelectorAll<HTMLInputElement>("input")];
    expect(campos).toHaveLength(3);
    const [email, zap, fragmento] = campos;

    expect(email.getAttribute("aria-label")).toBe("Seu e-mail");
    expect(email.getAttribute("autocomplete")).toBe("email");

    expect(zap.getAttribute("aria-label")).toBe("Seu WhatsApp");
    expect(zap.getAttribute("autocomplete")).toBe("tel");
    expect(zap.getAttribute("inputmode")).toBe("tel");

    expect(fragmento.getAttribute("aria-label")).toBe(
      "Últimos 6 dígitos do ID do pedido",
    );
    // o ID do pedido tem letras (hexadecimal): NÃO pode forçar teclado numérico
    expect(fragmento.getAttribute("inputmode")).toBeNull();
  });
});
