// @vitest-environment jsdom
/**
 * OrderSearch — quem copia o número do pedido como ele aparece no comprovante
 * e no WhatsApp ("#3884BE", ver src/lib/numero-do-pedido.ts) não pode ser
 * recusado por causa do "#".
 *
 * Antes: a checagem do campo só aceitava letras de A a F, números e hífen, e
 * "#3884BE" voltava "Informe ao menos os 6 últimos caracteres do ID do
 * pedido...". Agora o "#" e os espaços saem ANTES de conferir e de enviar: o
 * servidor continua recebendo só o ID puro, tanto no pedido do código quanto
 * na verificação (os dois têm de mandar o MESMO fragmento).
 *
 * Mesma convenção de order-search-manda-o-trio-na-verificacao.test.tsx.
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

describe("OrderSearch — número do pedido com '#' (como no comprovante)", () => {
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

  async function abrirRastreioSemConta(fragmentoDigitado: string) {
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });
    await act(async () => {
      clicarPorTexto(host, "Rastrear sem Conta");
    });
    await act(async () => {
      digitar(host, "SEU E-MAIL", "cliente@teste.com");
      digitar(host, "SEU WHATSAPP", "34999999999");
      digitar(host, "ÚLTIMOS 6 DÍGITOS DO ID DO PEDIDO", fragmentoDigitado);
    });
  }

  it("aceita '#3884BE' e manda '3884BE' (sem o '#') ao pedir o código e ao verificar", async () => {
    generateOrderOtp.mockResolvedValue(true);
    fetchOrdersByOtp.mockResolvedValue([]);
    await abrirRastreioSemConta("#3884BE");
    await enviar(host);

    expect(toastError).not.toHaveBeenCalled();
    expect(generateOrderOtp).toHaveBeenCalledWith(
      "cliente@teste.com",
      "34999999999",
      "3884BE",
    );

    await act(async () => {
      digitar(host, "DIGITE O CÓDIGO DE 6 DÍGITOS", "123456");
    });
    await enviar(host);

    expect(fetchOrdersByOtp).toHaveBeenCalledWith(
      "cliente@teste.com",
      "123456",
      { whatsapp: "34999999999", fragmento: "3884BE" },
    );
  });

  it("tira também os espaços de dentro ('# 3884 BE ')", async () => {
    generateOrderOtp.mockResolvedValue(true);
    await abrirRastreioSemConta("# 3884 BE ");
    await enviar(host);

    expect(toastError).not.toHaveBeenCalled();
    expect(generateOrderOtp).toHaveBeenCalledWith(
      "cliente@teste.com",
      "34999999999",
      "3884BE",
    );
  });

  it("limite: '#' sozinho, ou '#' com menos de 6 caracteres, continua recusado e não chama o servidor", async () => {
    await abrirRastreioSemConta("#38");
    await enviar(host);

    expect(generateOrderOtp).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
    expect(toastError.mock.calls[0]?.[0]).toMatch(/6 últimos caracteres/);
  });

  it("limite: letra fora do alfabeto do ID ('#3884ZZ') continua recusada", async () => {
    await abrirRastreioSemConta("#3884ZZ");
    await enviar(host);

    expect(generateOrderOtp).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledTimes(1);
  });
});
