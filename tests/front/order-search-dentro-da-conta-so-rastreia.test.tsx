// @vitest-environment jsdom
/**
 * OrderSearch dentro da conta (27/11/2026): quem já entrou e quer consultar o
 * pedido feito sem conta recebe a MESMA busca de quem está fora dela, sem a
 * aba "Entrar na Conta" (já entrou) e sem uma segunda leitura viva dos pedidos
 * da conta (a tela de pedidos já tem a dela).
 */
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público — padrão da casa.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const generateOrderOtp = vi.fn();
const fetchOrdersByOtp = vi.fn();
const useOrders = vi.fn((..._args: unknown[]) => ({
  generateOrderOtp,
  fetchOrdersByOtp,
  idDaConta: "cliente-1",
}));

vi.mock("@/hooks/useOrders", () => ({
  useOrders: (...args: unknown[]) => useOrders(...args),
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: () => {}, medium: () => {}, heavy: () => {} },
}));

describe("OrderSearch — somenteRastreio", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    useOrders.mockClear();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  async function renderizar(props: Record<string, unknown>) {
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} {...props} />);
    });
  }
  const botoes = () =>
    [...host.querySelectorAll("button")].map((b) => b.textContent?.trim());

  it("sem a aba de entrar: abre direto no formulário de rastreio, com o aviso de quem comprou sem conta", async () => {
    await renderizar({ somenteRastreio: true, whatsappDaLoja: null });
    expect(botoes()).not.toContain("Entrar na Conta");
    expect(botoes()).not.toContain("Rastrear sem Conta");
    expect(botoes()).not.toContain("Entrar");
    expect(host.textContent).toContain("Rastrear Pedido");
    expect(host.textContent).toContain("Comprou sem criar conta?");
    expect(host.querySelector('input[type="email"]')).not.toBeNull();
  });

  it("não abre uma segunda leitura viva dos pedidos da conta (hook desligado)", async () => {
    await renderizar({ somenteRastreio: true });
    expect(useOrders).toHaveBeenCalled();
    for (const chamada of useOrders.mock.calls) expect(chamada[0]).toBe(false);
  });

  it("fora da conta continua igual: duas abas, começa em 'Entrar na Conta', hook ligado", async () => {
    await renderizar({});
    expect(botoes()).toContain("Entrar na Conta");
    expect(botoes()).toContain("Rastrear sem Conta");
    expect(host.querySelector('input[type="email"]')).toBeNull();
    for (const chamada of useOrders.mock.calls) expect(chamada[0]).toBe(true);
  });
});
