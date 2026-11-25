// @vitest-environment jsdom
/**
 * Caça por mutação (25/11/2026), OrderSearch. Buracos que os 30 testes vizinhos deixavam:
 *  1. o aviso "O código de verificação deve conter 6 dígitos." só sai quando o código chega
 *     a 6 dígitos (com 5 ele continua);
 *  2. "Voltar" apaga o código digitado: quem volta e entra de novo por "Já tenho o código"
 *     encontra o campo VAZIO, não o código antigo (que pode ser de outro pedido);
 *  3. "Copiar número" da loja: copiou -> só o aviso "Copiado!" (nada de aviso de erro junto);
 *     não copiou -> aviso de erro e o número fica SELECIONADO para copiar à mão; e, se o
 *     navegador não oferece seleção (`getSelection()` nulo), o aviso de erro sai do mesmo jeito.
 * Sem rede e sem relógio; dados inventados.
 */
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const generateOrderOtp = vi.fn();
const fetchOrdersByOtp = vi.fn();
const copiarParaClipboard = vi.fn();
const toastSuccess = vi.fn();
const toastError = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ generateOrderOtp, fetchOrdersByOtp, idDaConta: null }),
}));
vi.mock("@/lib/copiar-para-clipboard", () => ({ copiarParaClipboard }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: () => {}, medium: () => {}, heavy: () => {} },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const MSG_INCOMPLETO = "O código de verificação deve conter 6 dígitos.";

function digitar(host: HTMLElement, placeholder: string, valor: string) {
  const campo = host.querySelector<HTMLInputElement>(
    `[placeholder="${placeholder}"]`,
  );
  if (!campo) throw new Error(`campo não encontrado: ${placeholder}`);
  Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    "value",
  )?.set?.call(campo, valor);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

function botaoPorTexto(host: HTMLElement, texto: string) {
  const botao = [...host.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  );
  if (!botao) throw new Error(`botão não encontrado: ${texto}`);
  return botao;
}

describe("OrderSearch: código incompleto, Voltar e cópia do número da loja", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeAll(async () => {
    await import("@/components/ui/custom/OrderSearch");
  }, 60_000);

  beforeEach(() => {
    generateOrderOtp.mockReset();
    fetchOrdersByOtp.mockReset();
    copiarParaClipboard.mockReset();
    toastSuccess.mockReset();
    toastError.mockReset();
    generateOrderOtp.mockResolvedValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    document.getSelection()?.removeAllRanges();
    vi.restoreAllMocks();
  });

  async function abrir(whatsappDaLoja?: string) {
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(
        <OrderSearch
          onNavigate={() => {}}
          abrirNoRastreio
          whatsappDaLoja={whatsappDaLoja}
        />,
      );
    });
  }

  async function preencherEPedirCodigo() {
    await act(async () => {
      digitar(host, "SEU E-MAIL", "pessoa@fixture.invalid");
      digitar(host, "SEU WHATSAPP", "11999999999");
      digitar(host, "6 FINAIS DO ID DO PEDIDO", "abcdef");
    });
    await act(async () => {
      host.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
  }

  const campoCodigo = () =>
    host.querySelector<HTMLInputElement>(
      '[placeholder="DIGITE O CÓDIGO DE 6 DÍGITOS"]',
    ) as HTMLInputElement;
  const erroDoCodigo = () => host.textContent?.includes(MSG_INCOMPLETO);

  it("o aviso de código incompleto só some com 6 dígitos (5 ainda é incompleto)", async () => {
    await abrir();
    await preencherEPedirCodigo();
    await act(async () => {
      digitar(host, "DIGITE O CÓDIGO DE 6 DÍGITOS", "123");
    });
    await act(async () => {
      host.querySelectorAll("form")[0]?.requestSubmit();
    });
    expect(erroDoCodigo()).toBe(true);
    expect(campoCodigo().getAttribute("aria-invalid")).toBe("true");
    expect(fetchOrdersByOtp).not.toHaveBeenCalled();

    await act(async () => {
      digitar(host, "DIGITE O CÓDIGO DE 6 DÍGITOS", "12345");
    });
    expect(erroDoCodigo()).toBe(true);

    await act(async () => {
      digitar(host, "DIGITE O CÓDIGO DE 6 DÍGITOS", "123456");
    });
    expect(erroDoCodigo()).toBe(false);
    expect(campoCodigo().getAttribute("aria-invalid")).toBeNull();
  });

  it("Voltar apaga o código digitado: ao reabrir por 'Já tenho o código' o campo está vazio", async () => {
    await abrir();
    await preencherEPedirCodigo();
    await act(async () => {
      digitar(host, "DIGITE O CÓDIGO DE 6 DÍGITOS", "654321");
    });
    expect(campoCodigo().value).toBe("654321");
    await act(async () => {
      botaoPorTexto(host, "Voltar").click();
    });
    await act(async () => {
      botaoPorTexto(host, "Já tenho o código").click();
    });
    expect(campoCodigo().value).toBe("");
  });

  const numeroDaLojaNaTela = () =>
    [...host.querySelectorAll("p")]
      .find((p) => p.textContent?.includes("WhatsApp da loja:"))
      ?.querySelector("span") as HTMLElement;

  it("copiou o número da loja: só 'Copiado!', sem aviso de erro e sem seleção", async () => {
    copiarParaClipboard.mockResolvedValue(true);
    await abrir("(34) 99999-8888");
    await act(async () => {
      botaoPorTexto(host, "Copiar número").click();
    });
    expect(copiarParaClipboard).toHaveBeenCalledWith(
      numeroDaLojaNaTela().textContent,
    );
    expect(toastSuccess).toHaveBeenCalledWith("Copiado!");
    expect(toastError).not.toHaveBeenCalled();
    expect(document.getSelection()?.toString()).toBe("");
  });

  it("não copiou: aviso de erro e o número fica selecionado para copiar à mão", async () => {
    copiarParaClipboard.mockResolvedValue(false);
    await abrir("(34) 99999-8888");
    await act(async () => {
      botaoPorTexto(host, "Copiar número").click();
    });
    expect(toastSuccess).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      "Não foi possível copiar automaticamente. Copie o número manualmente.",
    );
    expect(document.getSelection()?.toString()).toBe(
      numeroDaLojaNaTela().textContent,
    );
  });

  it("não copiou e o navegador não tem seleção: o aviso de erro sai do mesmo jeito", async () => {
    copiarParaClipboard.mockResolvedValue(false);
    await abrir("(34) 99999-8888");
    vi.spyOn(document, "getSelection").mockReturnValue(null);
    await act(async () => {
      botaoPorTexto(host, "Copiar número").click();
    });
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastSuccess).not.toHaveBeenCalled();
  });
});
