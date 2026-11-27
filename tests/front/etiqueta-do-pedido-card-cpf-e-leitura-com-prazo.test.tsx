// @vitest-environment jsdom
//
// EtiquetaDoPedidoCard com a rede "pendurada" (conecta e não responde) nas
// esperas que ainda não tinham prazo: "Salvar CPF", a leitura do pedido (e do
// histórico de envio) e a releitura do caminho de erro com resgate da compra.
//
// Antes: "Salvar CPF" ficava em "Salvando…" para sempre; a trava por pedido
// (que sobrevive a sair e voltar para a ficha) deixava o clique MUDO na volta;
// o cartão ficava no esqueleto cinza sem "Tentar de novo"; e "Gerando…" não
// soltava quando a compra voltava com resgate e a releitura pendurava.
//
// Estourar o prazo do CPF NÃO prova que ele não foi gravado (a edge pode ter
// gravado e a resposta se perdido): a tela relê o pedido, com prazo, e diz o
// que achou — salvo, ainda não aparece, ou não dá para saber.
import { haOperacaoSensivel } from "@/lib/atualizacao/operacao-sensivel";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORDER_A = "11111111-1111-1111-1111-111111111111";
const ORDER_B = "22222222-2222-2222-2222-222222222222";
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
  eventos: [] as Record<string, unknown>[],
  leiturasDoPedido: [] as string[],
  pedidoPendurado: false,
  eventosPendurados: false,
}));

const nuncaResponde = () => new Promise<never>(() => undefined);

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "order_shipping_events") {
        return {
          select: () => ({
            eq: () =>
              h.eventosPendurados
                ? nuncaResponde()
                : Promise.resolve({ data: h.eventos, error: null }),
          }),
        };
      }
      return {
        select: () => ({
          eq: (_coluna: string, valor: string) => {
            h.leiturasDoPedido.push(valor);
            return {
              maybeSingle: () =>
                h.pedidoPendurado
                  ? nuncaResponde()
                  : Promise.resolve({
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

// Os prazos que o resto do cartão já pratica: a edge que grava, 30 s; ler, 15 s.
const PRAZO_DE_SALVAR_O_CPF_MS = 30_000;
const PRAZO_DA_LEITURA_MS = 15_000;

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
    cpf: null,
    ...over,
  };
}

function chamadaPendurada() {
  let resolver: (valor: unknown) => void = () => undefined;
  const promessa = new Promise<unknown>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("EtiquetaDoPedidoCard: CPF e leituras com prazo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    h.invokeMock.mockReset();
    h.leiturasDoPedido.length = 0;
    h.eventos = [];
    h.pedidoPendurado = false;
    h.eventosPendurados = false;
    h.pedidoState.data = pedido();
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
  });

  async function abrirCard(orderId = ORDER_A) {
    const { EtiquetaDoPedidoCard } = await import(
      "@/components/admin/orders/EtiquetaDoPedidoCard"
    );
    await act(async () => {
      raiz.render(
        <EtiquetaDoPedidoCard
          key={orderId}
          orderId={orderId}
          isOffline={false}
        />,
      );
    });
    await passar(0);
  }

  const botao = (texto: string) =>
    [...hospedeiro.querySelectorAll("button")].find((b) =>
      b.textContent?.includes(texto),
    ) as HTMLButtonElement | undefined;

  const erroDoCpf = () =>
    hospedeiro.querySelector('[data-testid="erro-cpf"]')?.textContent ?? null;

  async function digitarCpf() {
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
  }

  async function salvarCpf() {
    await act(async () => {
      botao("Salvar CPF")?.click();
    });
    await passar(0);
  }

  describe("Salvar CPF", () => {
    it("antes do prazo segue em 'Salvando…'; estourou e a releitura não acha o CPF: solta o botão e diz que ainda não aparece", async () => {
      h.invokeMock.mockReturnValue(chamadaPendurada().promessa);
      await abrirCard();
      await digitarCpf();
      await salvarCpf();

      await passar(PRAZO_DE_SALVAR_O_CPF_MS - 1);
      expect(botao("Salvando…")?.disabled).toBe(true);
      expect(h.leiturasDoPedido).toEqual([ORDER_A]);

      await passar(1);

      expect(botao("Salvando…")).toBeUndefined();
      expect(botao("Salvar CPF")?.disabled).toBe(false);
      // Releu o pedido no servidor antes de dizer qualquer coisa.
      expect(h.leiturasDoPedido).toEqual([ORDER_A, ORDER_A]);
      expect(erroDoCpf()).toMatch(/Sem resposta da rede/);
      expect(erroDoCpf()).toMatch(/ainda não aparece/);
      expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      expect(h.invokeMock).toHaveBeenCalledTimes(1);
    });

    it("estourou, mas o servidor gravou: a releitura mostra o CPF salvo e o cartão sai de 'precisa CPF'", async () => {
      h.invokeMock.mockReturnValue(chamadaPendurada().promessa);
      await abrirCard();
      await digitarCpf();
      await salvarCpf();

      h.pedidoState.data = pedido({ cpf: CPF });
      await passar(PRAZO_DE_SALVAR_O_CPF_MS);

      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("CPF salvo!");
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
      expect(
        hospedeiro.querySelector('[data-testid="precisa-cpf"]'),
      ).toBeNull();
      expect(botao("Gerar etiqueta")).toBeTruthy();
    });

    it("estourou e a releitura também pendura: em 15 s solta o botão e diz que não dá para saber", async () => {
      h.invokeMock.mockReturnValue(chamadaPendurada().promessa);
      await abrirCard();
      await digitarCpf();
      await salvarCpf();

      h.pedidoPendurado = true;
      await passar(PRAZO_DE_SALVAR_O_CPF_MS);
      await passar(PRAZO_DA_LEITURA_MS - 1);
      expect(botao("Salvando…")?.disabled).toBe(true);

      await passar(1);

      expect(botao("Salvando…")).toBeUndefined();
      expect(botao("Salvar CPF")?.disabled).toBe(false);
      expect(erroDoCpf()).toMatch(/Não dá para saber se o CPF foi salvo/);
      expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });

    it("a resposta tardia do salvamento abandonado só relê o pedido em silêncio", async () => {
      const pendurada = chamadaPendurada();
      h.invokeMock.mockReturnValue(pendurada.promessa);
      await abrirCard();
      await digitarCpf();
      await salvarCpf();
      await passar(PRAZO_DE_SALVAR_O_CPF_MS);
      expect(h.leiturasDoPedido).toHaveLength(2);

      h.pedidoState.data = pedido({ cpf: CPF });
      await act(async () => {
        pendurada.resolver({ data: { success: true }, error: null });
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(h.leiturasDoPedido).toHaveLength(3);
      expect(
        hospedeiro.querySelector('[data-testid="precisa-cpf"]'),
      ).toBeNull();
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });

    it("sair e voltar com o salvamento em voo: o clique é barrado COM aviso; depois do estouro volta a valer", async () => {
      h.invokeMock.mockReturnValueOnce(chamadaPendurada().promessa);
      await abrirCard(ORDER_A);
      await digitarCpf();
      await salvarCpf();

      await abrirCard(ORDER_B);
      await abrirCard(ORDER_A);
      await digitarCpf();
      await salvarCpf();

      expect(h.invokeMock).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.info)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.info).mock.calls[0]?.[0]).toMatch(
        /CPF deste pedido ainda está sendo salvo/,
      );

      await passar(PRAZO_DE_SALVAR_O_CPF_MS);

      h.invokeMock.mockResolvedValueOnce({ data: { success: true } });
      await salvarCpf();
      expect(h.invokeMock).toHaveBeenCalledTimes(2);
      expect(h.invokeMock.mock.calls[1]?.[1]).toEqual({
        body: {
          action: "definir_cpf_destinatario",
          orderId: ORDER_A,
          cpf: CPF,
        },
      });
    });

    it("erro HTTP com o corpo pendurado: em 5 s solta o botão com a frase genérica", async () => {
      const corpo = chamadaPendurada();
      const resposta = new Response(null, { status: 503 });
      vi.spyOn(resposta, "json").mockReturnValue(
        corpo.promessa as Promise<unknown>,
      );
      h.invokeMock.mockResolvedValue({
        data: null,
        error: { name: "FunctionsHttpError", context: resposta },
      });
      await abrirCard();
      await digitarCpf();
      await salvarCpf();

      await passar(4_999);
      expect(botao("Salvando…")?.disabled).toBe(true);
      await passar(1);

      expect(botao("Salvar CPF")?.disabled).toBe(false);
      expect(erroDoCpf()).toBeTruthy();
      expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
    });

    it("resposta normal dentro do prazo: igual a antes e sem temporizador sobrando", async () => {
      h.invokeMock.mockResolvedValue({ data: { success: true }, error: null });
      await abrirCard();
      await digitarCpf();
      h.pedidoState.data = pedido({ cpf: CPF });
      await salvarCpf();

      expect(vi.mocked(toast.success)).toHaveBeenCalledWith("CPF salvo!");
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
      expect(botao("Gerar etiqueta")).toBeTruthy();
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("leitura do pedido", () => {
    it("pedido pendurado ao abrir: em 15 s sai do esqueleto para o erro com 'Tentar de novo'", async () => {
      h.pedidoPendurado = true;
      await abrirCard();

      await passar(PRAZO_DA_LEITURA_MS - 1);
      expect(hospedeiro.textContent).not.toMatch(
        /Não foi possível carregar os dados da etiqueta/,
      );
      await passar(1);

      expect(hospedeiro.textContent).toMatch(
        /Não foi possível carregar os dados da etiqueta/,
      );
      h.pedidoPendurado = false;
      await act(async () => {
        botao("Tentar de novo")?.click();
      });
      await passar(0);
      expect(
        hospedeiro.querySelector('[data-testid="precisa-cpf"]'),
      ).not.toBeNull();
    });

    it("histórico de envio pendurado: em 15 s mostra a etiqueta que o pedido já tem", async () => {
      h.pedidoState.data = pedido({
        cpf: CPF,
        shipping_label_id: "lbl-1",
        shipping_label_url: "https://melhorenvio.example/imprimir/1",
        tracking_code: "ME1",
      });
      h.eventosPendurados = true;
      await abrirCard();

      await passar(PRAZO_DA_LEITURA_MS - 1);
      expect(hospedeiro.textContent).not.toMatch(/ME1/);
      await passar(1);

      expect(hospedeiro.textContent).toMatch(/Etiqueta emitida/);
      expect(hospedeiro.textContent).toMatch(/ME1/);
    });
  });

  describe("compra recusada com resgate", () => {
    it("a releitura do resgate pendurada não prende a compra: em 15 s solta a trava e oferece 'Tentar de novo'", async () => {
      h.pedidoState.data = pedido({ cpf: CPF });
      h.invokeMock.mockResolvedValue({
        data: null,
        error: {
          name: "FunctionsHttpError",
          context: {
            json: () =>
              Promise.resolve({
                error: "A etiqueta deste pedido já está sendo gerada.",
                resgate: true,
              }),
          },
        },
      });
      await abrirCard();
      await act(async () => {
        botao("Gerar etiqueta")?.click();
      });
      h.pedidoPendurado = true;
      await act(async () => {
        botao("Confirmar e gerar")?.click();
      });
      await passar(0);

      // A releitura NÃO silenciosa troca o cartão pelo esqueleto enquanto lê.
      await passar(PRAZO_DA_LEITURA_MS - 1);
      expect(haOperacaoSensivel()).toBe(true);
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      await passar(1);

      expect(haOperacaoSensivel()).toBe(false);
      expect(hospedeiro.textContent).toMatch(
        /Não foi possível carregar os dados da etiqueta/,
      );
      expect(vi.mocked(toast.error)).toHaveBeenCalledWith(
        "A etiqueta deste pedido já está sendo gerada.",
      );

      // A trava da compra foi solta: a lojista relê e o cartão volta a valer.
      h.pedidoPendurado = false;
      await act(async () => {
        botao("Tentar de novo")?.click();
      });
      await passar(0);
      expect(botao("Gerando…")).toBeUndefined();
      expect(botao("Gerar etiqueta")?.disabled).toBe(false);
      expect(h.invokeMock).toHaveBeenCalledTimes(1);
    });
  });
});
