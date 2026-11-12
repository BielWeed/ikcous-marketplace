// @vitest-environment jsdom
/**
 * OrderSearch — verificar de novo enquanto a consulta está pendente não
 * consome outra tentativa do código. A promessa controlada mantém a janela
 * em que o botão precisa ficar desabilitado; ao terminar, ele libera.
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
  const botao = [...host.querySelectorAll("button")].find(
    (b) => b.textContent?.trim() === texto,
  );
  if (!botao) throw new Error(`botão não encontrado: ${texto}`);
  return botao;
}

describe("OrderSearch — verificar não envia duas vezes", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    generateOrderOtp.mockReset();
    fetchOrdersByOtp.mockReset();
    generateOrderOtp.mockResolvedValue(true);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  it.each(["recusa", "rejeição"] as const)(
    "dois submits no mesmo act enviam um único código e liberam outra tentativa após %s",
    async (resultado) => {
      let responder!: (sucesso: boolean) => void;
      let rejeitar!: (erro: Error) => void;
      const pendente = new Promise<boolean>((resolve, reject) => {
        responder = resolve;
        rejeitar = reject;
      });
      generateOrderOtp.mockReturnValue(pendente);
      const { OrderSearch } = await import(
        "@/components/ui/custom/OrderSearch"
      );
      await act(async () => {
        raiz.render(<OrderSearch onNavigate={() => {}} abrirNoRastreio />);
      });
      await act(async () => {
        digitar(host, "SEU E-MAIL", "pessoa@fixture.invalid");
        digitar(host, "SEU WHATSAPP", "11999999999");
        digitar(host, "6 FINAIS DO ID DO PEDIDO", "abcdef");
      });
      const formulario = host.querySelector("form")!;
      await act(async () => {
        formulario.requestSubmit();
        formulario.requestSubmit();
      });
      try {
        expect(generateOrderOtp).toHaveBeenCalledTimes(1);
        expect(generateOrderOtp).toHaveBeenCalledWith(
          "pessoa@fixture.invalid",
          "11999999999",
          "abcdef",
        );
        expect(botaoPorTexto(host, "Gerando Código...").disabled).toBe(true);
      } finally {
        const erro = vi.spyOn(console, "error").mockImplementation(() => {});
        await act(async () => {
          if (resultado === "recusa") responder(false);
          else rejeitar(new Error("falha fictícia"));
        });
        erro.mockRestore();
      }
      expect(botaoPorTexto(host, "Enviar Código").disabled).toBe(false);
      generateOrderOtp.mockResolvedValueOnce(true);
      await act(async () => formulario.requestSubmit());
      expect(generateOrderOtp).toHaveBeenCalledTimes(2);
      expect(host.textContent).toContain("Verificar");
    },
  );

  it("bloqueia o segundo clique enquanto verifica e libera ao concluir", async () => {
    let concluirConsulta!: (pedidos: []) => void;
    const consultaPendente = new Promise<[]>((resolve) => {
      concluirConsulta = resolve;
    });
    fetchOrdersByOtp.mockReturnValue(consultaPendente);

    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} />);
    });
    await act(async () => {
      botaoPorTexto(host, "Rastrear sem Conta").click();
    });
    await act(async () => {
      digitar(host, "SEU E-MAIL", "cliente@teste.com");
      digitar(host, "SEU WHATSAPP", "34999999999");
      digitar(host, "6 FINAIS DO ID DO PEDIDO", "abcdef");
    });
    await act(async () => {
      host.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
    await act(async () => {
      digitar(host, "DIGITE O CÓDIGO DE 6 DÍGITOS", "123456");
    });

    const verificar = botaoPorTexto(host, "Verificar");
    expect(verificar.disabled).toBe(false);
    await act(async () => {
      verificar.click();
    });
    expect(fetchOrdersByOtp).toHaveBeenCalledTimes(1);
    expect(verificar.textContent?.trim()).toBe("Verificando...");

    // Outro clique real no botão, depois de o React renderizar o carregamento.
    await act(async () => {
      verificar.click();
    });
    expect(fetchOrdersByOtp).toHaveBeenCalledTimes(1);
    expect(verificar.disabled).toBe(true);

    await act(async () => {
      concluirConsulta([]);
      await consultaPendente;
    });
    expect(verificar.disabled).toBe(false);
    expect(verificar.textContent?.trim()).toBe("Verificar");
    expect(fetchOrdersByOtp).toHaveBeenCalledTimes(1);
  });
});
