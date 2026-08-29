// @vitest-environment jsdom
/**
 * OrderSearch — a tela para de anular o aviso de erro que o hook já deu.
 *
 * O DEFEITO (achado C da revisão de 22/08/2026): `fetchOrdersByOtp`
 * (useOrders.ts) devolve `[]` tanto para "perguntei e não achei" quanto para
 * "não consegui perguntar" — e em TODA causa de falha (código errado,
 * bloqueio por tentativas, ou falha em chegar à verificação: rede caiu,
 * servidor fora do ar) ela JÁ mostra o toast certo antes de devolver `[]`
 * (ver `mensagemAmigavelErroOtp` e o `data.ok === false` em useOrders.ts).
 * `OrderSearch` então caía no `else` e mostrava um SEGUNDO toast fixo —
 * "Nenhum pedido encontrado. Verifique se o código OTP está correto." — por
 * cima do primeiro. No caso de falha de rede isso é CONTRADITÓRIO: manda
 * conferir um código que nunca chegou a ser verificado.
 *
 * Este teste simula a rede caindo (fetchOrdersByOtp resolve `[]`, do jeito
 * que ela devolve depois de já ter toastado por dentro) e trava que
 * `OrderSearch` NÃO acrescenta o segundo toast fixo por cima.
 *
 * Mesma convenção de order-search-nao-avanca-sem-envio.test.tsx: sem
 * @testing-library/react, DOM real via react-dom/client, campos achados
 * pelo placeholder.
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

async function chegarNoPassoDeCodigo(raiz: HTMLElement) {
  generateOrderOtp.mockResolvedValue(true);
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

describe("OrderSearch — o segundo toast não anula o aviso do hook", () => {
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

  it("fetchOrdersByOtp devolve [] (a causa já foi avisada por dentro do hook): a tela NÃO acrescenta 'Nenhum pedido encontrado'", async () => {
    fetchOrdersByOtp.mockResolvedValue([]);
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });

    await chegarNoPassoDeCodigo(host);
    // O passo anterior (envio do código) já toastou sucesso — reseta antes
    // de exercitar o passo que este teste cobre de fato.
    toastSuccess.mockReset();
    toastError.mockReset();

    await act(async () => {
      digitar(host, CAMPO_CODIGO, "123456");
    });
    await act(async () => {
      host.querySelector<HTMLFormElement>("form")?.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchOrdersByOtp).toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).not.toHaveBeenCalledWith(
      expect.stringContaining("Nenhum pedido encontrado"),
    );
  });
});
