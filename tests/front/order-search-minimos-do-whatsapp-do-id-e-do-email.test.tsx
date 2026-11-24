// @vitest-environment jsdom
/**
 * OrderSearch (acompanhar pedido sem conta) — os MÍNIMOS que liberam o envio do
 * código. Caça por mutação: baixar o mínimo do WhatsApp de 10 para 8 dígitos ou
 * o do ID do pedido de 6 para 4 caracteres não derrubava nenhum teste, e cada
 * um deixava a pessoa pedir um código que o servidor ia recusar (ou, pior,
 * amarrado a nada). Aqui cada fronteira tem o lado de dentro e o de fora.
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

const AVISO_WHATSAPP = "Por favor, informe um WhatsApp válido com DDD.";
const AVISO_ID =
  "Informe ao menos os 6 últimos caracteres do ID do pedido, que estão no seu comprovante.";

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

describe("OrderSearch — o que precisa estar preenchido para pedir o código", () => {
  let host: HTMLDivElement;
  let raiz: Root;

  beforeEach(() => {
    generateOrderOtp.mockReset();
    generateOrderOtp.mockResolvedValue(true);
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

  async function enviar(
    campos: { email: string; whatsapp: string; fragmento: string },
    props: Record<string, unknown> = {},
  ) {
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(<OrderSearch onNavigate={() => {}} {...props} />);
    });
    await act(async () => {
      [...host.querySelectorAll("button")]
        .find((b) => b.textContent?.trim() === "Rastrear sem Conta")
        ?.click();
    });
    await act(async () => {
      digitar(host, "SEU E-MAIL", campos.email);
      digitar(host, "SEU WHATSAPP", campos.whatsapp);
      digitar(host, "6 FINAIS DO ID DO PEDIDO", campos.fragmento);
    });
    await act(async () => {
      host.querySelector<HTMLFormElement>("form")?.requestSubmit();
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  const valido = {
    email: "cliente@teste.com",
    whatsapp: "34999999999",
    fragmento: "abcdef",
  };

  describe("WhatsApp: pelo menos 10 dígitos (DDD + número)", () => {
    it("9 dígitos é recusado, com o aviso certo, e nada é enviado", async () => {
      await enviar({ ...valido, whatsapp: "(34) 3333-444" });
      expect(toastError).toHaveBeenCalledWith(AVISO_WHATSAPP);
      expect(generateOrderOtp).not.toHaveBeenCalled();
    });

    it("10 dígitos (fixo com DDD) passa, e o servidor recebe só os números", async () => {
      await enviar({ ...valido, whatsapp: "(34) 3333-4444" });
      expect(toastError).not.toHaveBeenCalled();
      expect(generateOrderOtp).toHaveBeenCalledWith(
        "cliente@teste.com",
        "3433334444",
        "abcdef",
      );
    });

    it("11 dígitos (celular com DDD) também passa", async () => {
      await enviar({ ...valido, whatsapp: "(34) 99999-9999" });
      expect(generateOrderOtp).toHaveBeenCalledWith(
        "cliente@teste.com",
        "34999999999",
        "abcdef",
      );
    });
  });

  describe("ID do pedido: pelo menos 6 caracteres de um UUID", () => {
    it("5 caracteres é recusado, com o aviso certo, e nada é enviado", async () => {
      await enviar({ ...valido, fragmento: "abcde" });
      expect(toastError).toHaveBeenCalledWith(AVISO_ID);
      expect(generateOrderOtp).not.toHaveBeenCalled();
    });

    it("6 caracteres passa", async () => {
      await enviar({ ...valido, fragmento: "ab12cd" });
      expect(generateOrderOtp).toHaveBeenCalledWith(
        "cliente@teste.com",
        "34999999999",
        "ab12cd",
      );
    });

    it("letra que não existe em UUID (g) é recusada", async () => {
      await enviar({ ...valido, fragmento: "abcdeg" });
      expect(toastError).toHaveBeenCalledWith(AVISO_ID);
      expect(generateOrderOtp).not.toHaveBeenCalled();
    });

    it("o '#' e os espaços de quem copiou '#AB12 CD' são tirados antes de contar e de enviar", async () => {
      await enviar({ ...valido, fragmento: "#ab12 cd" });
      expect(generateOrderOtp).toHaveBeenCalledWith(
        "cliente@teste.com",
        "34999999999",
        "ab12cd",
      );
    });

    it("o '#' e o espaço não contam como caractere: '#abcd e' tem só 5", async () => {
      await enviar({ ...valido, fragmento: "#abcd e" });
      expect(toastError).toHaveBeenCalledWith(AVISO_ID);
      expect(generateOrderOtp).not.toHaveBeenCalled();
    });
  });

  describe("falar com a loja: o número da loja ganha o 55 quando falta", () => {
    async function abrirLink(whatsappDaLoja: string) {
      const abrir = vi.fn();
      vi.stubGlobal("open", abrir);
      const { OrderSearch } = await import(
        "@/components/ui/custom/OrderSearch"
      );
      await act(async () => {
        raiz.render(
          <OrderSearch onNavigate={() => {}} whatsappDaLoja={whatsappDaLoja} />,
        );
      });
      await act(async () => {
        [...host.querySelectorAll("button")]
          .find((b) => b.textContent?.trim() === "Rastrear sem Conta")
          ?.click();
      });
      await act(async () => {
        [...host.querySelectorAll("button")]
          .find((b) => b.textContent?.includes("Falar com a loja no WhatsApp"))
          ?.click();
      });
      return abrir.mock.calls[0]?.[0] as string | undefined;
    }

    it("fixo com DDD (10 dígitos) ganha o 55", async () => {
      expect(await abrirLink("(34) 3333-4444")).toContain(
        "https://wa.me/553433334444?text=",
      );
    });

    it("celular com DDD (11 dígitos) ganha o 55", async () => {
      expect(await abrirLink("(34) 99999-8888")).toContain(
        "https://wa.me/5534999998888?text=",
      );
    });

    it("número que já vem com o 55 (13 dígitos) não ganha outro", async () => {
      expect(await abrirLink("+55 34 99999-8888")).toContain(
        "https://wa.me/5534999998888?text=",
      );
    });
  });

  describe("o que a verificação do código devolve", () => {
    const pedido = (id: string) => ({ id, status: "shipping" });

    async function verificar(achados: unknown[]) {
      fetchOrdersByOtp.mockResolvedValue(achados);
      const onOrdersFound = vi.fn();
      await enviar(valido, { onOrdersFound });
      await act(async () => {
        digitar(host, "DIGITE O CÓDIGO DE 6 DÍGITOS", "123456");
      });
      await act(async () => {
        host.querySelector<HTMLFormElement>("form")?.requestSubmit();
        await Promise.resolve();
        await Promise.resolve();
      });
      return onOrdersFound;
    }

    afterEach(() => {
      sessionStorage.removeItem("guest_tracked_orders");
    });

    it("um pedido: diz '1 pedido encontrado!', entrega a lista e guarda o retrato da consulta", async () => {
      const onOrdersFound = await verificar([pedido("p-1")]);
      expect(toastSuccess).toHaveBeenCalledWith("1 pedido encontrado!");
      expect(onOrdersFound).toHaveBeenCalledWith([pedido("p-1")]);
      expect(sessionStorage.getItem("guest_tracked_orders")).not.toBeNull();
    });

    it("dois pedidos: diz '2 pedidos encontrados!'", async () => {
      await verificar([pedido("p-1"), pedido("p-2")]);
      expect(toastSuccess).toHaveBeenCalledWith("2 pedidos encontrados!");
    });

    it("três pedidos: o plural segue o número", async () => {
      await verificar([pedido("p-1"), pedido("p-2"), pedido("p-3")]);
      expect(toastSuccess).toHaveBeenCalledWith("3 pedidos encontrados!");
    });

    it("nenhum pedido: não avisa 'encontrado', não entrega lista e não guarda retrato", async () => {
      const onOrdersFound = await verificar([]);
      expect(toastSuccess).not.toHaveBeenCalledWith(
        expect.stringContaining("encontrado"),
      );
      expect(onOrdersFound).not.toHaveBeenCalled();
      expect(sessionStorage.getItem("guest_tracked_orders")).toBeNull();
    });
  });

  describe("e-mail", () => {
    it("sem arroba nada é enviado (o campo de e-mail do navegador barra o envio antes da checagem do app)", async () => {
      await enviar({ ...valido, email: "cliente.teste.com" });
      expect(generateOrderOtp).not.toHaveBeenCalled();
    });

    it("vai para o servidor sem espaço nas pontas e em minúsculas", async () => {
      await enviar({ ...valido, email: "  Cliente@Teste.COM " });
      expect(generateOrderOtp).toHaveBeenCalledWith(
        "cliente@teste.com",
        "34999999999",
        "abcdef",
      );
    });
  });
});
