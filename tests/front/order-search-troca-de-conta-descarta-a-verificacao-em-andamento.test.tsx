// @vitest-environment jsdom
/**
 * OrderSearch — outra conta entrou (ou a conta saiu) enquanto a consulta do
 * código ainda voltava da rede. A resposta antiga é do pedido de QUEM consultou
 * antes (nome, endereço, itens): se chegar depois de a entrada da outra pessoa
 * apagar o rastreio do aparelho, ela não pode regravar o retrato nem publicar o
 * pedido — senão a tela da conta nova mostraria o pedido da anterior. A
 * consulta é uma promessa controlada: o teste a resolve DEPOIS da troca.
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
const estado: { user: { id: string } | null } = { user: null };

vi.mock("@/hooks/useOrders", () => ({
  useOrders: () => ({
    generateOrderOtp,
    fetchOrdersByOtp,
    idDaConta: estado.user?.id ?? null,
  }),
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

const PEDIDO_DA_PESSOA_A = [{ id: "pedido-da-pessoa-a-abcdef" }];

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

describe("OrderSearch — troca de conta descarta a verificação em andamento", () => {
  let host: HTMLDivElement;
  let raiz: Root;
  let onOrdersFound: Mock<(pedidos: unknown[]) => void>;
  let concluirConsulta!: (pedidos: unknown) => void;

  async function renderizar() {
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
  }

  /** Chega à etapa do código, digita e dispara a verificação (pendente). */
  async function verificarSemResposta() {
    const consultaPendente = new Promise((resolve) => {
      concluirConsulta = resolve;
    });
    fetchOrdersByOtp.mockReturnValue(consultaPendente);
    await renderizar();
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

  async function chegarARespostaDaPessoaA() {
    await act(async () => {
      concluirConsulta(PEDIDO_DA_PESSOA_A);
      await Promise.resolve();
    });
  }

  beforeEach(() => {
    generateOrderOtp.mockReset();
    fetchOrdersByOtp.mockReset();
    gravarRetratoDoConvidado.mockReset();
    toastSuccess.mockReset();
    generateOrderOtp.mockResolvedValue(true);
    estado.user = null;
    onOrdersFound = vi.fn<(pedidos: unknown[]) => void>();
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
  });

  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
  });

  it("outra conta entra no aparelho: a resposta tardia não grava o retrato nem publica", async () => {
    await verificarSemResposta();

    estado.user = { id: "conta-da-pessoa-b" };
    await renderizar();
    await chegarARespostaDaPessoaA();

    expect(gravarRetratoDoConvidado).not.toHaveBeenCalled();
    expect(onOrdersFound).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalledWith("1 pedido encontrado!");
  });

  it("a consulta abandonada não deixa o botão preso em Verificando", async () => {
    await verificarSemResposta();
    expect(botaoPorTexto(host, "Verificando...").disabled).toBe(true);

    estado.user = { id: "conta-da-pessoa-b" };
    await renderizar();

    expect(botaoPorTexto(host, "Verificar").disabled).toBe(false);
    await chegarARespostaDaPessoaA();
    expect(botaoPorTexto(host, "Verificar").disabled).toBe(false);
  });

  it("troca direta de uma conta para outra também descarta", async () => {
    estado.user = { id: "conta-da-pessoa-a" };
    await verificarSemResposta();

    estado.user = { id: "conta-da-pessoa-b" };
    await renderizar();
    await chegarARespostaDaPessoaA();

    expect(gravarRetratoDoConvidado).not.toHaveBeenCalled();
    expect(onOrdersFound).not.toHaveBeenCalled();
  });

  it("a conta que consultou sai: a resposta tardia também não grava nem publica", async () => {
    estado.user = { id: "conta-da-pessoa-a" };
    await verificarSemResposta();

    estado.user = null;
    await renderizar();
    await chegarARespostaDaPessoaA();

    expect(gravarRetratoDoConvidado).not.toHaveBeenCalled();
    expect(onOrdersFound).not.toHaveBeenCalled();
  });

  it("controle: o mesmo usuário reemitido (objeto novo, mesmo id) não descarta a consulta", async () => {
    estado.user = { id: "conta-da-pessoa-a" };
    await verificarSemResposta();

    estado.user = { id: "conta-da-pessoa-a" };
    await renderizar();
    await chegarARespostaDaPessoaA();

    expect(gravarRetratoDoConvidado).toHaveBeenCalledWith(PEDIDO_DA_PESSOA_A);
    expect(onOrdersFound).toHaveBeenCalledWith(PEDIDO_DA_PESSOA_A);
  });

  it("controle: sem troca de conta, o convidado grava e publica como sempre", async () => {
    await verificarSemResposta();
    await chegarARespostaDaPessoaA();

    expect(gravarRetratoDoConvidado).toHaveBeenCalledWith(PEDIDO_DA_PESSOA_A);
    expect(onOrdersFound).toHaveBeenCalledWith(PEDIDO_DA_PESSOA_A);
  });
});
