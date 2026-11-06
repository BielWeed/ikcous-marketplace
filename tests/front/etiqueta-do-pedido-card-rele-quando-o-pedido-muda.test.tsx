// @vitest-environment jsdom
//
// O cartão "Etiqueta de envio" lia o pedido UMA vez (por orderId). Cancelar
// ou concluir o pedido na própria ficha não mudava nada nele: seguia
// oferecendo "Gerar etiqueta" e, ao tentar, a edge recusava com o status em
// inglês ("Pedido com status "cancelled" não gera etiqueta de envio."). Agora:
//
//   1. a ficha passa o status e o pagamento do pedido ao cartão, e uma
//      MUDANÇA deles refaz a leitura (sem remontar: o CPF digitado, a
//      confirmação aberta e a compra em voo ficam como estão);
//   2. rede de segurança: se a edge ainda assim recusar por status, o texto
//      sai em português (o mesmo da elegibilidade) e o cartão relê o pedido.
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

function pedido(over: Record<string, unknown> = {}) {
  return {
    id: ID,
    status: "processing",
    payment_status: "pago",
    shipping: 24.9,
    shipping_cost: null,
    tracking_code: null,
    shipping_label_id: null,
    shipping_label_url: null,
    notes: null,
    shipping_option_id: "melhor-envio-3",
    cpf: "52998224725",
    ...over,
  };
}

describe("EtiquetaDoPedidoCard — relê o pedido quando o status ou o pagamento mudam", () => {
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
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  async function desenhar(props: Record<string, unknown> = {}) {
    const { EtiquetaDoPedidoCard } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );
    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard
          orderId={ID}
          isOffline={false}
          status="processing"
          paymentStatus="pago"
          {...props}
        />,
      );
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  it("pedido cancelado na ficha: o cartão relê, o botão 'Gerar etiqueta' some e o motivo aparece em português", async () => {
    await desenhar();
    expect(botao("Gerar etiqueta")).toBeTruthy();
    expect(eqChamadas).toHaveLength(1);

    pedidoState.data = pedido({ status: "cancelled" });
    await desenhar({ status: "cancelled" });

    expect(eqChamadas).toHaveLength(2);
    expect(botao("Gerar etiqueta")).toBeUndefined();
    expect(
      hospedeiro.querySelector('[data-testid="etiqueta-indisponivel"]')
        ?.textContent,
    ).toContain("Pedido cancelado — não gera etiqueta.");
  });

  it("pedido concluído na ficha: o botão some com o motivo 'já entregue'", async () => {
    await desenhar();
    pedidoState.data = pedido({ status: "delivered" });
    await desenhar({ status: "delivered" });

    expect(botao("Gerar etiqueta")).toBeUndefined();
    expect(hospedeiro.textContent).toContain(
      "Pedido já entregue — não gera etiqueta.",
    );
  });

  it("a mudança de PAGAMENTO também relê (pago -> estornado deixa de oferecer a etiqueta)", async () => {
    await desenhar();
    pedidoState.data = pedido({ payment_status: "estornado" });
    await desenhar({ paymentStatus: "estornado" });

    expect(eqChamadas).toHaveLength(2);
    expect(botao("Gerar etiqueta")).toBeUndefined();
  });

  it("nada mudou (mesmo status e pagamento, outro render): NÃO relê o pedido", async () => {
    await desenhar();
    await desenhar({ isOffline: false, trackingCodeDaFicha: "" });
    await desenhar();
    expect(eqChamadas).toHaveLength(1);
  });

  it("sem status nas props (quem monta o cartão sem a ficha): lê uma vez e nunca relê", async () => {
    await desenhar({ status: undefined, paymentStatus: undefined });
    await desenhar({ status: undefined, paymentStatus: undefined });
    expect(eqChamadas).toHaveLength(1);
  });

  it("a releitura não remonta: a confirmação aberta continua aberta se o pedido segue elegível", async () => {
    await desenhar();
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    expect(botao("Confirmar e gerar")).toBeTruthy();

    // Mudou o pagamento (recebido na entrega ainda etiqueta): relê, mas segue
    // elegível -- a lojista não perde a confirmação que abriu.
    pedidoState.data = pedido({ payment_status: "recebido_na_entrega" });
    await desenhar({ paymentStatus: "recebido_na_entrega" });

    expect(eqChamadas).toHaveLength(2);
    expect(botao("Confirmar e gerar")).toBeTruthy();
  });

  it("compra em voo quando o pedido muda de status: a resposta NÃO se perde (etiqueta paga continua visível)", async () => {
    let resolver: (v: unknown) => void = () => {};
    invokeMock.mockReturnValue(
      new Promise((resolve) => {
        resolver = resolve;
      }),
    );
    const onTracking = vi.fn();
    await desenhar({ onTrackingAtualizado: onTracking });
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
    });
    expect(invokeMock).toHaveBeenCalledTimes(1);

    // Enquanto a compra está no ar o pedido muda de situação.
    pedidoState.data = pedido({ status: "shipping" });
    await desenhar({ status: "shipping", onTrackingAtualizado: onTracking });

    await act(async () => {
      resolver({
        data: {
          success: true,
          already: false,
          tracking_code: "ME1",
          label_url: "https://melhorenvio.com.br/imprimir/x",
          label_id: "lbl-1",
        },
      });
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    expect(onTracking).toHaveBeenCalledWith(ID, "ME1");
    expect(hospedeiro.textContent).toContain(
      "Etiqueta gerada e vinculada ao pedido!",
    );
    expect(invokeMock).toHaveBeenCalledTimes(1);
  });

  it("rede de segurança: a edge recusa por status em inglês -> texto em português e o botão não volta", async () => {
    // Tela velha: o cartão ainda acha que o pedido está em andamento.
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        context: new Response(
          JSON.stringify({
            error: 'Pedido com status "cancelled" não gera etiqueta de envio.',
          }),
          { status: 400 },
        ),
      },
    });
    await desenhar();
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    // Entre a leitura e o clique o pedido foi cancelado (a ficha ainda não
    // avisou o cartão).
    pedidoState.data = pedido({ status: "cancelled" });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });

    const aviso = hospedeiro.querySelector('[data-testid="erro-etiqueta"]');
    expect(aviso?.textContent).toBe("Pedido cancelado — não gera etiqueta.");
    expect(hospedeiro.textContent).not.toContain("cancelled");
    expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
      "Pedido cancelado — não gera etiqueta.",
    );
    // Releu o pedido: cai em indisponível, sem botão de compra.
    expect(eqChamadas).toHaveLength(2);
    expect(botao("Gerar etiqueta")).toBeUndefined();
    expect(botao("Confirmar e gerar")).toBeUndefined();
  });

  it("status desconhecido na recusa da edge: mantém a frase do servidor (não inventa tradução)", async () => {
    invokeMock.mockResolvedValue({
      data: null,
      error: {
        name: "FunctionsHttpError",
        context: new Response(
          JSON.stringify({
            error: "Pedido sem endereço utilizável para etiqueta.",
          }),
          { status: 400 },
        ),
      },
    });
    await desenhar();
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
      await esperarMicrotarefas();
    });
    await act(async () => {
      await esperarMicrotarefas();
    });
    expect(
      hospedeiro.querySelector('[data-testid="erro-etiqueta"]')?.textContent,
    ).toBe("Pedido sem endereço utilizável para etiqueta.");
    expect(eqChamadas).toHaveLength(1);
  });
});
