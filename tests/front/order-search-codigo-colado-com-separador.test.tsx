// @vitest-environment jsdom
/**
 * OrderSearch — o código de 6 dígitos colado com espaço ou traço ('123 456',
 * '123-456') não perde o último dígito.
 *
 * O DEFEITO: o campo tinha `maxLength={6}`. O navegador corta o texto COLADO
 * em 6 caracteres ANTES do `onChange` tirar o que não é dígito, então
 * '123 456' chegava como '123 45' -> '12345' e a pessoa tinha de digitar o
 * último dígito de novo (mesma família do CEP e do CPF colados com máscara,
 * ver address-form-cep-colado-e-redigitado.test.tsx). Sem o `maxLength`, o
 * `onChange` limpa e corta em 6 dígitos.
 *
 * jsdom não aplica `maxLength` a um valor posto por código (só a digitação de
 * verdade), por isso a prova do corte é o ATRIBUTO ausente; a prova do
 * efeito é o que a tela entrega a `fetchOrdersByOtp`.
 *
 * Mesma convenção de order-search-manda-o-trio-na-verificacao.test.tsx.
 */
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

const CAMPO_CODIGO = "DIGITE O CÓDIGO DE 6 DÍGITOS";

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

async function enviar(host: HTMLElement) {
  await act(async () => {
    host.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("OrderSearch — código colado com separador", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(async () => {
    generateOrderOtp.mockReset();
    fetchOrdersByOtp.mockReset();
    generateOrderOtp.mockResolvedValue(true);
    fetchOrdersByOtp.mockResolvedValue([]);
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
    await act(async () => {
      digitar(host, "SEU E-MAIL", "cliente@teste.com");
      digitar(host, "SEU WHATSAPP", "34999999999");
      digitar(host, "6 FINAIS DO ID DO PEDIDO", "abcdef");
    });
    await enviar(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  it("o campo do código não tem maxlength: o corte do navegador antes da limpeza perdia o último dígito", () => {
    expect(campo(host, CAMPO_CODIGO)?.hasAttribute("maxlength")).toBe(false);
  });

  it.each([
    ["123 456", "123456"],
    ["123-456", "123456"],
    [" 123 456 ", "123456"],
    ["123456789", "123456"],
  ])("colar %j: a verificação recebe %j", async (colado, esperado) => {
    await act(async () => {
      digitar(host, CAMPO_CODIGO, colado);
    });
    expect(campo(host, CAMPO_CODIGO)?.value).toBe(esperado);

    await enviar(host);

    expect(fetchOrdersByOtp).toHaveBeenCalledTimes(1);
    expect(fetchOrdersByOtp.mock.calls[0][1]).toBe(esperado);
  });

  it("código incompleto ('123 45'): continua barrado antes de ir ao servidor", async () => {
    await act(async () => {
      digitar(host, CAMPO_CODIGO, "123 45");
    });
    await enviar(host);
    expect(fetchOrdersByOtp).not.toHaveBeenCalled();
  });
});
