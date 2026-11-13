// @vitest-environment jsdom
/**
 * OrderSearch — "Voltar" abandona a consulta do código que ainda estava
 * voltando da rede. A resposta antiga não pode publicar o pedido (nem gravar o
 * retrato do convidado) depois de a cliente ter desistido e começado a corrigir
 * os dados, e o fim da consulta velha não pode desligar o "carregando" da nova.
 * A consulta é uma promessa controlada: o teste a resolve DEPOIS do Voltar.
 */
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import {
  type Mock,
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const generateOrderOtp = vi.fn();
const fetchOrdersByOtp = vi.fn();
const gravarRetratoDoConvidado = vi.fn();
const toastSuccess = vi.fn();

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({ generateOrderOtp, fetchOrdersByOtp }),
}));
vi.mock("@/lib/retrato-do-convidado", () => ({ gravarRetratoDoConvidado }));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: vi.fn() },
}));
vi.mock("@/utils/haptic", () => ({
  haptic: { light: () => {}, medium: () => {}, heavy: () => {} },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PEDIDO_ANTIGO = [{ id: "pedido-antigo-abcdef" }];

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

describe("OrderSearch — Voltar descarta a verificação em andamento", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  let onOrdersFound: Mock<(pedidos: unknown[]) => void>;
  let concluirConsulta!: (pedidos: unknown) => void;

  /** Chega à etapa do código, digita e dispara a verificação (pendente). */
  async function verificarSemResposta() {
    const consultaPendente = new Promise((resolve) => {
      concluirConsulta = resolve;
    });
    fetchOrdersByOtp.mockReturnValue(consultaPendente);
    const { OrderSearch } = await import("@/components/ui/custom/OrderSearch");
    await act(async () => {
      raiz.render(
        <OrderSearch
          onNavigate={() => {}}
          onOrdersFound={onOrdersFound}
          abrirNoRastreio
        />,
      );
    });
    await act(async () => {
      digitar(host, "SEU E-MAIL", "pessoa@fixture.invalid");
      digitar(host, "SEU WHATSAPP", "11999999999");
      digitar(host, "6 FINAIS DO ID DO PEDIDO", "abcdef");
    });
    await act(async () => {
      host.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
    await act(async () => {
      digitar(host, "DIGITE O CÓDIGO DE 6 DÍGITOS", "123456");
    });
    await act(async () => {
      botaoPorTexto(host, "Verificar").click();
    });
    expect(fetchOrdersByOtp).toHaveBeenCalledTimes(1);
  }

  beforeEach(() => {
    generateOrderOtp.mockReset();
    fetchOrdersByOtp.mockReset();
    gravarRetratoDoConvidado.mockReset();
    toastSuccess.mockReset();
    generateOrderOtp.mockResolvedValue(true);
    onOrdersFound = vi.fn<(pedidos: unknown[]) => void>();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  it("a resposta que chega depois do Voltar não publica, não grava e não avisa", async () => {
    await verificarSemResposta();
    await act(async () => {
      botaoPorTexto(host, "Voltar").click();
    });

    await act(async () => {
      concluirConsulta(PEDIDO_ANTIGO);
      await Promise.resolve();
    });

    expect(onOrdersFound).not.toHaveBeenCalled();
    expect(gravarRetratoDoConvidado).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalledWith("1 pedido encontrado!");
    expect(host.textContent).toContain("Enviar Código");
  });

  it("o fim da consulta velha não desliga o carregando do reenvio do código", async () => {
    await verificarSemResposta();
    await act(async () => {
      botaoPorTexto(host, "Voltar").click();
    });
    // Reenvio com resposta pendente: a rodada nova está carregando.
    generateOrderOtp.mockReturnValue(new Promise(() => {}));
    await act(async () => {
      host.querySelector<HTMLFormElement>("form")?.requestSubmit();
    });
    expect(botaoPorTexto(host, "Gerando Código...").disabled).toBe(true);

    await act(async () => {
      concluirConsulta(PEDIDO_ANTIGO);
      await Promise.resolve();
    });

    expect(botaoPorTexto(host, "Gerando Código...").disabled).toBe(true);
    expect(onOrdersFound).not.toHaveBeenCalled();
  });

  it("a resposta que chega depois de a tela sair do ar não publica nem grava", async () => {
    await verificarSemResposta();
    act(() => raiz.unmount());

    await act(async () => {
      concluirConsulta(PEDIDO_ANTIGO);
      await Promise.resolve();
    });

    expect(onOrdersFound).not.toHaveBeenCalled();
    expect(gravarRetratoDoConvidado).not.toHaveBeenCalled();
    // O afterEach desmonta de novo: uma raiz já desmontada é recriada para isso.
    raiz = createRoot(host);
  });

  it("sem Voltar, a resposta da consulta vigente continua publicando e gravando", async () => {
    await verificarSemResposta();
    await act(async () => {
      concluirConsulta(PEDIDO_ANTIGO);
      await Promise.resolve();
    });

    expect(gravarRetratoDoConvidado).toHaveBeenCalledWith(PEDIDO_ANTIGO);
    expect(onOrdersFound).toHaveBeenCalledWith(PEDIDO_ANTIGO);
  });
});
