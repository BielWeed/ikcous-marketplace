// @vitest-environment jsdom
/**
 * OrderSearch — a verificação do código manda o MESMO trio que pediu o código
 * (auditoria de 12/10/2026, R3; migration 20261217000000).
 *
 * A tela já guarda e-mail, WhatsApp e pedaço do pedido no passo de pedir o
 * código. Na verificação ela passa a mandar os três junto com o código, para
 * `fetchOrdersByOtp` chamar a `get_orders_by_otp_v2` (que só alcança o código
 * do pedido que confere com o trio). WhatsApp vai só com os dígitos, e-mail em
 * minúsculas e sem espaço, fragmento sem espaço — as mesmas formas que o pedido
 * do código usa.
 *
 * Mesma convenção de order-search-nao-repete-toast-de-erro-que-ja-foi-avisado.test.tsx:
 * DOM real via react-dom/client, campos achados pelo placeholder.
 */
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
  haptic: { light: () => {}, medium: () => {}, heavy: () => {} },
}));

function digitar(raiz: HTMLElement, placeholder: string, valor: string) {
  const campo = raiz.querySelector<HTMLInputElement>(
    `[placeholder="${placeholder}"]`,
  );
  if (!campo) throw new Error(`campo não encontrado: ${placeholder}`);
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

function clicarPorTexto(raiz: HTMLElement, texto: string) {
  const botao = [...raiz.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!botao) throw new Error(`botão não encontrado: ${texto}`);
  botao.click();
}

async function enviar(raiz: HTMLElement) {
  await act(async () => {
    raiz.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("OrderSearch — a verificação manda o trio", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    generateOrderOtp.mockReset();
    fetchOrdersByOtp.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
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

  it("pede o código com o trio e verifica com o MESMO trio + o código", async () => {
    generateOrderOtp.mockResolvedValue(true);
    fetchOrdersByOtp.mockResolvedValue([]);
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });
    await act(async () => {
      clicarPorTexto(host, "Rastrear sem Conta");
    });
    await act(async () => {
      digitar(host, "SEU E-MAIL", " Cliente@Teste.com ");
      digitar(host, "SEU WHATSAPP", "34999999999");
      digitar(host, "ÚLTIMOS 6 DÍGITOS DO ID DO PEDIDO", " abcdef ");
    });
    await enviar(host);
    expect(generateOrderOtp).toHaveBeenCalledWith(
      "cliente@teste.com",
      "34999999999",
      "abcdef",
    );

    await act(async () => {
      digitar(host, "DIGITE O CÓDIGO DE 6 DÍGITOS", "123456");
    });
    await enviar(host);

    expect(fetchOrdersByOtp).toHaveBeenCalledTimes(1);
    expect(fetchOrdersByOtp).toHaveBeenCalledWith(
      "cliente@teste.com",
      "123456",
      { whatsapp: "34999999999", fragmento: "abcdef" },
    );
  });
});
