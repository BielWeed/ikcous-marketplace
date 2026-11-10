// @vitest-environment jsdom
import { motivoDoStatusSemEtiqueta } from "@/lib/elegibilidade-da-etiqueta";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { invokeMock, pedidoState, eqChamadas } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  pedidoState: { data: null as any },
  eqChamadas: [] as string[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "order_shipping_events") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: [], error: null }),
          }),
        };
      }
      return {
        select: () => ({
          eq: (_coluna: string, valor: string) => {
            eqChamadas.push(valor);
            return {
              maybeSingle: () =>
                Promise.resolve({ data: pedidoState.data, error: null }),
            };
          },
        }),
      };
    },
    functions: { invoke: invokeMock },
  },
}));

vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ID = "11111111-1111-1111-1111-111111111111";

function esperarMicrotarefas(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function pedido(status = "processing") {
  return {
    id: ID,
    status,
    payment_status: "pago",
    shipping: 24.9,
    shipping_cost: null,
    tracking_code: null,
    shipping_label_id: null,
    shipping_label_url: null,
    notes: null,
    shipping_option_id: "melhor-envio-3",
    cpf: null,
  };
}

describe("EtiquetaDoPedidoCard — recusa por status ao salvar CPF", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.clearAllMocks();
    eqChamadas.length = 0;
    pedidoState.data = pedido();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    const { _resetTravasDeReentranciaParaTeste } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );
    _resetTravasDeReentranciaParaTeste();
  });

  afterEach(() => {
    act(() => raiz.unmount());
    hospedeiro.remove();
  });

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  async function abrirEDigitarCpf() {
    const { EtiquetaDoPedidoCard } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );
    await act(async () => {
      raiz.render(<EtiquetaDoPedidoCard orderId={ID} isOffline={false} />);
      await esperarMicrotarefas();
    });
    const input =
      hospedeiro.querySelector<HTMLInputElement>("#cpf-destinatario")!;
    expect(input).toBeTruthy();
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(
        Object.getPrototypeOf(input),
        "value",
      )!.set!;
      setter.call(input, "52998224725");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
  }

  function recusar(mensagem: string, status: number) {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        context: new Response(JSON.stringify({ error: mensagem }), { status }),
      },
    });
  }

  async function salvar() {
    expect(botao("Salvar CPF")?.disabled).toBe(false);
    await act(async () => {
      botao("Salvar CPF")!.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(invokeMock).toHaveBeenCalledWith("melhor-envio-etiqueta", {
      body: {
        action: "definir_cpf_destinatario",
        orderId: ID,
        cpf: "52998224725",
      },
    });
  }

  it("traduz a recusa e relê o pedido cancelado em outro aparelho, removendo Salvar CPF", async () => {
    recusar('Pedido com status "cancelled" não recebe alteração de CPF.', 400);
    await abrirEDigitarCpf();
    expect(eqChamadas).toHaveLength(1);
    pedidoState.data = pedido("cancelled");

    await salvar();

    const motivo = motivoDoStatusSemEtiqueta("cancelled");
    expect(toast.error).toHaveBeenCalledWith(motivo);
    expect(hospedeiro.textContent).toContain(motivo);
    expect(hospedeiro.textContent).not.toContain("cancelled");
    expect(eqChamadas).toEqual([ID, ID]);
    expect(botao("Salvar CPF")).toBeUndefined();
    expect(
      hospedeiro.querySelector('[data-testid="etiqueta-indisponivel"]')
        ?.textContent,
    ).toContain(motivo);
  });

  it("mantém outro erro do servidor sem reler e libera Salvar CPF", async () => {
    const mensagem = "Este pedido já tem etiqueta emitida. Não altere o CPF.";
    recusar(mensagem, 409);
    await abrirEDigitarCpf();

    await salvar();

    expect(
      hospedeiro.querySelector('[data-testid="erro-cpf"]')?.textContent,
    ).toBe(mensagem);
    expect(toast.error).toHaveBeenCalledWith(mensagem);
    expect(eqChamadas).toEqual([ID]);
    expect(botao("Salvar CPF")?.disabled).toBe(false);
  });
});
