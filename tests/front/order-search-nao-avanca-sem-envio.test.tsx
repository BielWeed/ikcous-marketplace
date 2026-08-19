// @vitest-environment jsdom
/**
 * OrderSearch — a tela não avança de passo sem envio confirmado.
 *
 * Estes dois testes NASCEM VERDES, e isso é dito de propósito: a tela já
 * respeitava o booleano que o hook devolvia. O defeito nunca esteve aqui —
 * estava no hook, que devolvia `true` cedo demais (ver
 * use-orders-otp-so-promete-o-que-enviou.test.tsx). O papel deste arquivo é
 * travar a regra contra regressão: no dia em que alguém mover
 * `setStep("verify")` para fora do `if (success)`, esta suíte acusa.
 *
 * Fatos da tela lidos em 19/08/2026 — não há um único `id=` no componente, e
 * os campos se acham pelo `placeholder`.
 */
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
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

const CAMPO_CODIGO = "DIGITE O CÓDIGO DE 6 DÍGITOS";

function porPlaceholder(raiz: HTMLElement, texto: string) {
  return raiz.querySelector<HTMLInputElement>(`[placeholder="${texto}"]`);
}

function digitar(raiz: HTMLElement, placeholder: string, valor: string) {
  const campo = porPlaceholder(raiz, placeholder);
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

async function preencherEEnviar(raiz: HTMLElement) {
  // O componente abre na aba de login; o formulário de convidado só existe
  // depois deste clique.
  await act(async () => {
    clicarPorTexto(raiz, "Rastrear sem Conta");
  });
  await act(async () => {
    digitar(raiz, "SEU E-MAIL", "cliente@teste.com");
    digitar(raiz, "SEU WHATSAPP", "34999999999");
    digitar(raiz, "ÚLTIMOS 6 DÍGITOS DO ID DO PEDIDO", "abcdef");
  });
  await act(async () => {
    raiz.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("OrderSearch — a tela só avança quando o código saiu", () => {
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

  it("envio falhou: NÃO diz 'enviado' e continua pedindo os dados", async () => {
    generateOrderOtp.mockResolvedValue(false);
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });

    await preencherEEnviar(host);

    expect(generateOrderOtp).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    // O campo do código não apareceu: a pessoa continua no passo de pedir, e
    // pode corrigir e tentar de novo em vez de esperar um e-mail que não vem.
    expect(porPlaceholder(host, CAMPO_CODIGO)).toBeNull();
  });

  it("envio deu certo: diz 'enviado' e mostra o campo do código", async () => {
    generateOrderOtp.mockResolvedValue(true);
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });

    await preencherEEnviar(host);

    expect(toastSuccess).toHaveBeenCalled();
    expect(porPlaceholder(host, CAMPO_CODIGO)).not.toBeNull();
  });
});
