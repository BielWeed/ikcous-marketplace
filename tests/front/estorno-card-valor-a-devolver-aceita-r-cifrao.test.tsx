// @vitest-environment jsdom
//
// "Valor a devolver" (EstornoCard, "devolver outro valor"): colar "R$ 50"
// virava NaN e a tela dizia "O valor tem de ficar entre R$ 0,01 e R$ ...",
// uma faixa que o 50 já respeitava. Agora o "R$" da frente (como no
// `parseValorBR`) sai antes da conversão, e o que não é número diz o que
// fazer, não uma faixa.
//
// É DINHEIRO: a tabela "de antes" prende o número EXATO que chega ao
// `solicitarEstorno` (o hook arredonda a centavos e gera a chave de
// idempotência a partir dele). Todas as linhas "antes" passavam antes desta
// mudança com o mesmo número; "R$ 50" tem de chegar como o MESMO 50 de "50",
// e por isso cai na MESMA chave da intenção.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  desligarDialogoDeConfirmacao,
  ligarDialogoDeConfirmacao,
} from "./duble-dialogo-de-confirmacao";

import type { Order } from "@/types";

const useEstornosDoPedidoMock = vi.fn();
vi.mock("@/hooks/useEstornosDoPedido", () => ({
  useEstornosDoPedido: (orderId: string) => useEstornosDoPedidoMock(orderId),
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const pedido: Order = {
  id: "pedido-estorno-r",
  customer: { name: "Cliente Teste", whatsapp: "34999999999" },
  items: [
    {
      productId: "prod-1",
      name: "Blusa Teste",
      price: 100,
      quantity: 1,
      image: "",
    },
  ],
  subtotal: 100,
  shipping: 0,
  discount: 0,
  total: 100,
  paymentMethod: "online",
  status: "cancelled",
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString(),
  cancelledAfterShipping: false,
  paymentStatus: "pago",
};

const solicitarEstornoMock = vi.fn().mockResolvedValue(undefined);

function hook(disponivel: number) {
  return {
    linhas: [],
    pago: disponivel,
    devolvido: 0,
    emCurso: 0,
    emDuvida: 0,
    disponivel,
    reservadoPorFora: 0,
    carregando: false,
    pedidoCarregado: true,
    erro: false,
    recarregar: vi.fn(),
    solicitarEstorno: solicitarEstornoMock,
    registrarPorForaAposEspera: vi.fn().mockResolvedValue(true),
    enviando: false,
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  solicitarEstornoMock.mockClear();
  useEstornosDoPedidoMock.mockReset();
  ligarDialogoDeConfirmacao();
  vi.stubGlobal("confirm", vi.fn().mockReturnValue(true));
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  desligarDialogoDeConfirmacao();
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.unstubAllGlobals();
});

const normalizar = (s: string | null | undefined) =>
  (s ?? "").replace(/\s+/g, " ").trim();

async function montarComCampo(disponivel: number, digitado: string) {
  useEstornosDoPedidoMock.mockReturnValue(hook(disponivel));
  const { EstornoCard } = await import("@/components/admin/orders/EstornoCard");
  await act(async () => {
    raiz.render(<EstornoCard order={pedido} />);
  });
  const abrir = Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    normalizar(b.textContent).includes("devolver outro valor"),
  ) as HTMLButtonElement;
  await act(async () => abrir.click());
  const campo = hospedeiro.querySelector<HTMLInputElement>(
    `#valor-outro-estorno-${pedido.id}`,
  ) as HTMLInputElement;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(campo, digitado);
    campo.dispatchEvent(new Event("input", { bubbles: true }));
  });
  return campo;
}

const botaoDevolver = () =>
  Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
    /^Devolver R\$/.test(normalizar(b.textContent)),
  ) as HTMLButtonElement;

const aviso = () =>
  normalizar(
    hospedeiro.querySelector(`#valor-outro-estorno-aviso-${pedido.id}`)
      ?.textContent,
  );

const FRASE_DO_FORMATO = "Digite só o valor, por exemplo 50,00.";

// Saldo largo para que só o FORMATO decida (o caso da faixa está abaixo).
const SALDO = 99_999;

describe("EstornoCard — 'Valor a devolver' aceita o R$ e o espaço", () => {
  it.each([
    // De antes: o número que já chegava ao servidor, idêntico.
    { quando: "antes", digitado: "50", amount: 50 },
    { quando: "antes", digitado: " 50 ", amount: 50 },
    { quando: "antes", digitado: "50,5", amount: 50.5 },
    { quando: "antes", digitado: "50.50", amount: 50.5 },
    { quando: "antes", digitado: "0,01", amount: 0.01 },
    { quando: "antes", digitado: "1.234,56", amount: 1234.56 },
    { quando: "antes", digitado: "1500.50", amount: 1500.5 },
    { quando: "antes", digitado: "1.500", amount: 1500 },
    { quando: "antes", digitado: "1,234", amount: 1.234 },
    { quando: "antes", digitado: "0050", amount: 50 },
    // Novos: o R$ da frente, com ou sem espaço, maiúsculo ou não.
    { quando: "novo", digitado: "R$ 50", amount: 50 },
    { quando: "novo", digitado: "R$50", amount: 50 },
    { quando: "novo", digitado: "R$50,00", amount: 50 },
    { quando: "novo", digitado: " R$ 50 ", amount: 50 },
    { quando: "novo", digitado: "r$ 50,5", amount: 50.5 },
    { quando: "novo", digitado: "R$ 1.234,56", amount: 1234.56 },
    { quando: "novo", digitado: "R$ 50", amount: 50 },
  ])(
    "($quando) $digitado devolve exatamente $amount",
    async ({ digitado, amount }) => {
      const campo = await montarComCampo(SALDO, digitado);

      expect(campo.getAttribute("aria-invalid")).toBe("false");
      expect(aviso()).toBe("");
      const botao = botaoDevolver();
      expect(botao.disabled).toBe(false);

      await act(async () => {
        botao.click();
        await Promise.resolve();
      });
      expect(solicitarEstornoMock).toHaveBeenCalledExactlyOnceWith({
        amount,
        motivo: "",
      });
    },
  );

  it.each([
    "",
    "abc",
    "50 60",
    "50,00 reais",
    "1e2",
    "R$",
    "R$ ",
    "-50",
    "R$ -50",
    "50R$",
    "R$ R$ 50",
    "US$ 50",
  ])(
    "%s continua recusado e diz como escrever, sem falar de faixa",
    async (digitado) => {
      const campo = await montarComCampo(SALDO, digitado);

      expect(campo.getAttribute("aria-invalid")).toBe("true");
      expect(aviso()).toBe(FRASE_DO_FORMATO);
      expect(botaoDevolver().disabled).toBe(true);
      expect(normalizar(botaoDevolver().textContent)).toBe("Devolver R$ 0,00");
      expect(solicitarEstornoMock).not.toHaveBeenCalled();
    },
  );

  it.each([
    { digitado: "R$ 100", rotulo: "Devolver R$ 100,00" },
    { digitado: "100", rotulo: "Devolver R$ 100,00" },
    { digitado: "0,001", rotulo: "Devolver R$ 0,00" },
  ])(
    "número fora da faixa ($digitado) segue com a frase da faixa",
    async ({ digitado, rotulo }) => {
      const campo = await montarComCampo(89.91, digitado);

      expect(campo.getAttribute("aria-invalid")).toBe("true");
      expect(aviso()).toBe("O valor tem de ficar entre R$ 0,01 e R$ 89,91");
      expect(normalizar(botaoDevolver().textContent)).toBe(rotulo);
      expect(botaoDevolver().disabled).toBe(true);
    },
  );
});
