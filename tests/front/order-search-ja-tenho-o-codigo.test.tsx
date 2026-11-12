// @vitest-environment jsdom
/**
 * OrderSearch — "Já tenho o código" tira a cliente do beco do "Voltar".
 *
 * O caminho que doía: ela recebe o código por e-mail, toca em "Voltar" na etapa
 * do código e pede de novo. O servidor responde `muito_recente` (janela de 60 s
 * por pedido), o hook devolve `false` e a tela fica na etapa de pedir — que não
 * tem campo para digitar o código. Com o código na mão e sem como usá-lo por até
 * 60 s. A saída é um botão de texto na etapa de pedir que leva direto ao campo
 * do código, sem novo envio.
 *
 * Os campos se acham pelo `placeholder` (o componente não usa `id=`).
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

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CAMPO_CODIGO = "DIGITE O CÓDIGO DE 6 DÍGITOS";
const BOTAO = "Já tenho o código";

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

function botaoPorTexto(raiz: HTMLElement, texto: string) {
  return (
    [...raiz.querySelectorAll("button")].find(
      (b) => b.textContent?.trim() === texto,
    ) ?? null
  );
}

async function clicar(raiz: HTMLElement, texto: string) {
  const botao = botaoPorTexto(raiz, texto);
  if (!botao) throw new Error(`botão não encontrado: ${texto}`);
  await act(async () => {
    botao.click();
  });
}

async function preencher(
  raiz: HTMLElement,
  dados = {
    email: "cliente@teste.com",
    zap: "34999999999",
    id: "abcdef",
  },
) {
  await act(async () => {
    digitar(raiz, "SEU E-MAIL", dados.email);
    digitar(raiz, "SEU WHATSAPP", dados.zap);
    digitar(raiz, "6 FINAIS DO ID DO PEDIDO", dados.id);
  });
}

async function enviar(raiz: HTMLElement) {
  await act(async () => {
    raiz.querySelector<HTMLFormElement>("form")?.requestSubmit();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("OrderSearch — Já tenho o código", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(async () => {
    generateOrderOtp.mockReset();
    fetchOrdersByOtp.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });
    await clicar(host, "Rastrear sem Conta");
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    host.remove();
  });

  it("com os três campos válidos o botão aparece e leva ao campo do código, sem novo envio", async () => {
    await preencher(host);

    expect(botaoPorTexto(host, BOTAO)).not.toBeNull();
    expect(porPlaceholder(host, CAMPO_CODIGO)).toBeNull();

    await clicar(host, BOTAO);

    expect(porPlaceholder(host, CAMPO_CODIGO)).not.toBeNull();
    expect(document.activeElement).toBe(porPlaceholder(host, CAMPO_CODIGO));
    expect(generateOrderOtp).not.toHaveBeenCalled();
  });

  it("sem dados, ou com qualquer um inválido, o botão não aparece", async () => {
    expect(botaoPorTexto(host, BOTAO)).toBeNull();

    await preencher(host, {
      email: "sem-arroba",
      zap: "34999999999",
      id: "abcdef",
    });
    expect(botaoPorTexto(host, BOTAO)).toBeNull();

    await preencher(host, {
      email: "cliente@teste.com",
      zap: "3499",
      id: "abcdef",
    });
    expect(botaoPorTexto(host, BOTAO)).toBeNull();

    await preencher(host, {
      email: "cliente@teste.com",
      zap: "34999999999",
      id: "abc",
    });
    expect(botaoPorTexto(host, BOTAO)).toBeNull();

    // o "#" do comprovante não reprova: o botão segue o mesmo critério do envio
    await preencher(host, {
      email: "cliente@teste.com",
      zap: "34999999999",
      id: "#abcdef",
    });
    expect(botaoPorTexto(host, BOTAO)).not.toBeNull();
  });

  it("Voltar -> reenviar com código recente: a tela fica no pedido, mas o botão leva ao campo do código", async () => {
    generateOrderOtp.mockResolvedValueOnce(true);
    await preencher(host);
    await enviar(host);
    expect(porPlaceholder(host, CAMPO_CODIGO)).not.toBeNull();
    expect(document.activeElement).toBe(porPlaceholder(host, CAMPO_CODIGO));

    await clicar(host, "Voltar");
    expect(porPlaceholder(host, CAMPO_CODIGO)).toBeNull();

    // `muito_recente`: o hook toasta e devolve false; a tela não avança.
    generateOrderOtp.mockResolvedValueOnce(false);
    await enviar(host);
    expect(generateOrderOtp).toHaveBeenCalledTimes(2);
    expect(porPlaceholder(host, CAMPO_CODIGO)).toBeNull();

    // Os dados continuam preenchidos, então a saída está à mão.
    expect(botaoPorTexto(host, BOTAO)).not.toBeNull();
    await clicar(host, BOTAO);
    expect(porPlaceholder(host, CAMPO_CODIGO)).not.toBeNull();
    expect(generateOrderOtp).toHaveBeenCalledTimes(2);
  });

  it("o código digitado depois do botão é verificado com o mesmo trio", async () => {
    fetchOrdersByOtp.mockResolvedValue([]);
    await preencher(host);
    await clicar(host, BOTAO);

    await act(async () => {
      digitar(host, CAMPO_CODIGO, "123456");
    });
    await act(async () => {
      host.querySelector<HTMLFormElement>("form")?.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(fetchOrdersByOtp).toHaveBeenCalledWith(
      "cliente@teste.com",
      "123456",
      {
        whatsapp: "34999999999",
        fragmento: "abcdef",
      },
    );
  });
});
