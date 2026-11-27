// @vitest-environment jsdom
//
// EtiquetaDoPedidoCard quando a conexão CAI no meio da chamada à edge
// (27/11/2026). No iPhone, trocar de app derruba o fetch na hora: o
// `functions.invoke` não lança, devolve `{ data: null, error:
// FunctionsFetchError }` (functions-js 2.117.2). A edge PODE já ter comprado
// a etiqueta (saldo real) ou gravado o CPF. Antes, só o prazo esgotado era
// tratado como incerto; a queda rápida virava "Sem conexão… tente novamente"
// e a tela não relia o pedido. Agora a queda segue o MESMO ramo do prazo:
// não afirma nada, relê a ficha e deixa conferir antes de repetir.
import {
  FunctionsFetchError,
  FunctionsHttpError,
} from "@supabase/functions-js";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORDER_A = "11111111-1111-1111-1111-111111111111";
const CPF = "52998224725";

const h = vi.hoisted(() => ({
  invokeMock:
    vi.fn<
      (
        nome: string,
        opcoes: { body: Record<string, unknown> },
      ) => Promise<unknown>
    >(),
  pedidoState: { data: null as Record<string, unknown> | null },
  leiturasDoPedido: [] as string[],
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
            h.leiturasDoPedido.push(valor);
            return {
              maybeSingle: () =>
                Promise.resolve({
                  data: h.pedidoState.data
                    ? { ...h.pedidoState.data, id: valor }
                    : null,
                  error: null,
                }),
            };
          },
        }),
      };
    },
    functions: { invoke: h.invokeMock },
  },
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function pedido(over: Record<string, unknown> = {}) {
  return {
    status: "processing",
    payment_status: "pago",
    shipping: 24.9,
    shipping_cost: null,
    tracking_code: null,
    shipping_label_id: null,
    shipping_label_url: null,
    notes: null,
    shipping_option_id: "melhor-envio-3",
    cpf: CPF,
    ...over,
  };
}

/** A forma exata que `functions.invoke` devolve quando o fetch rejeita. */
const quedaDaEdge = () =>
  Promise.resolve({
    data: null,
    error: new FunctionsFetchError(new TypeError("Load failed")),
  });

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("EtiquetaDoPedidoCard: a conexão cai no meio da chamada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onTrackingAtualizado =
    vi.fn<(orderId: string, codigo: string) => void>();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    h.invokeMock.mockReset();
    h.leiturasDoPedido.length = 0;
    h.pedidoState.data = pedido();
    vi.spyOn(console, "error").mockImplementation(() => {});
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
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  async function abrirCard() {
    const { EtiquetaDoPedidoCard } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );
    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard
          key={ORDER_A}
          orderId={ORDER_A}
          isOffline={false}
          onTrackingAtualizado={onTrackingAtualizado}
        />,
      );
    });
    await passar(0);
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  async function confirmarACompra() {
    await act(async () => {
      botao("Gerar etiqueta")?.click();
    });
    await act(async () => {
      botao("Confirmar e gerar")?.click();
    });
    await passar(0);
  }

  const avisoSemResposta = () =>
    hospedeiro.querySelector('[data-testid="etiqueta-sem-resposta"]');

  describe("compra da etiqueta (gasta saldo real)", () => {
    it("a conexão caiu: não diz que falhou, avisa que não dá para saber e relê a ficha", async () => {
      h.invokeMock.mockImplementation(quedaDaEdge);
      await abrirCard();
      expect(h.leiturasDoPedido).toEqual([ORDER_A]);

      await confirmarACompra();

      expect(avisoSemResposta()?.textContent).toMatch(
        /Não dá para saber se a etiqueta foi gerada/,
      );
      expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      expect(
        hospedeiro.querySelector('[data-testid="erro-etiqueta"]'),
      ).toBeNull();
      expect(botao("Gerar etiqueta")?.disabled).toBe(false);
      // Uma releitura só: a chamada que caiu já terminou, não há resposta
      // tardia a esperar.
      expect(h.leiturasDoPedido).toEqual([ORDER_A, ORDER_A]);
    });

    it("a conexão caiu, mas o servidor comprou: a releitura põe o card em 'emitida'", async () => {
      h.invokeMock.mockImplementation(() => {
        h.pedidoState.data = pedido({
          shipping_label_id: "lbl-comprada",
          shipping_label_url: "https://melhorenvio.example/imprimir/x",
          tracking_code: "ME123",
        });
        return quedaDaEdge();
      });
      await abrirCard();
      await confirmarACompra();

      expect(hospedeiro.textContent).toMatch(/Etiqueta emitida/);
      expect(hospedeiro.textContent).toMatch(/ME123/);
      expect(botao("Gerar etiqueta")).toBeUndefined();
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    });

    it("controle: erro HTTP da edge (o servidor respondeu) segue o caminho de erro de sempre", async () => {
      h.invokeMock.mockResolvedValue({
        data: null,
        error: new FunctionsHttpError(
          new Response(JSON.stringify({ error: "Saldo insuficiente" }), {
            status: 400,
            headers: { "Content-Type": "application/json" },
          }),
        ),
      });
      await abrirCard();
      await confirmarACompra();

      expect(avisoSemResposta()).toBeNull();
      expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
    });
  });

  describe("Salvar CPF", () => {
    async function salvarCpf() {
      const input =
        hospedeiro.querySelector<HTMLInputElement>("#cpf-destinatario");
      expect(input).toBeTruthy();
      await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(
          HTMLInputElement.prototype,
          "value",
        )?.set;
        setter?.call(input, CPF);
        input?.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => {
        botao("Salvar CPF")?.click();
      });
      await passar(0);
    }

    it("a conexão caiu, mas o servidor gravou: a releitura confirma 'CPF salvo!'", async () => {
      h.pedidoState.data = pedido({ cpf: null });
      h.invokeMock.mockImplementation(() => {
        h.pedidoState.data = pedido({ cpf: CPF });
        return quedaDaEdge();
      });
      await abrirCard();
      await salvarCpf();

      expect(h.leiturasDoPedido).toEqual([ORDER_A, ORDER_A]);
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("CPF salvo!");
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
    });

    it("a conexão caiu e o CPF não aparece na releitura: avisa para conferir, sem 'erro'", async () => {
      h.pedidoState.data = pedido({ cpf: null });
      h.invokeMock.mockImplementation(quedaDaEdge);
      await abrirCard();
      await salvarCpf();

      expect(h.leiturasDoPedido).toEqual([ORDER_A, ORDER_A]);
      expect(
        hospedeiro.querySelector('[data-testid="erro-cpf"]')?.textContent,
      ).toMatch(/ainda não aparece/);
      expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      expect(botao("Salvar CPF")?.disabled).toBe(false);
    });
  });

  describe("consulta de rastreio", () => {
    it("a conexão caiu: diz que a rede não respondeu e solta o botão", async () => {
      h.pedidoState.data = pedido({
        shipping_label_id: "lbl-1",
        shipping_label_url: "https://melhorenvio.example/imprimir/1",
        tracking_code: "ME1",
      });
      h.invokeMock.mockImplementation(quedaDaEdge);
      await abrirCard();

      await act(async () => {
        botao("Atualizar rastreio")?.click();
      });
      await passar(0);

      expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(
        /Não deu para atualizar o rastreio: a rede não respondeu/,
      );
      expect(botao("Atualizar rastreio")?.disabled).toBe(false);
    });
  });
});
