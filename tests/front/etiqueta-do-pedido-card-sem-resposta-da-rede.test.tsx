// @vitest-environment jsdom
//
// EtiquetaDoPedidoCard com a rede "pendurada" (conecta e não responde).
//
// A compra da etiqueta gasta o SALDO real do Melhor Envio. Antes, a espera da
// edge não tinha prazo: "Confirmar e gerar" e "Cancelar" ficavam apagados em
// "Gerando…" para sempre (e sair da ficha e voltar não soltava, porque a trava
// é por pedido). A lojista não sabia se a etiqueta tinha sido comprada.
//
// Estourou o prazo, a etiqueta PODE ter sido comprada. Por isso a tela:
//   - NUNCA diz que deu certo nem que falhou: diz que não dá para saber;
//   - solta a trava local e relê o pedido no servidor (o estado real);
//   - descarta a resposta tardia da chamada abandonada (nada de "gerada!" por
//     cima, nada de callback de rastreio): só relê de novo, em silêncio;
//   - deixa tentar de novo SEM risco de compra dupla — o servidor reivindica
//     o pedido (`shipping_label_id` NULL -> id) e a 2ª chamada devolve
//     `already: true`.
// "Atualizar rastreio" / "Conferir de novo" (leituras) soltam o botão e dizem
// que não deu para consultar.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { toast } from "sonner";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORDER_A = "11111111-1111-1111-1111-111111111111";
const ORDER_B = "22222222-2222-2222-2222-222222222222";

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
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela === "order_shipping_events") {
        return {
          select: () => ({
            eq: () => Promise.resolve({ data: h.eventos, error: null }),
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

const PRAZO_DA_COMPRA_MS = 30_000;
const PRAZO_DO_RASTREIO_MS = 15_000;

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
    cpf: "52998224725",
    ...over,
  };
}

/** Uma chamada que nunca responde, com a mão de resolvê-la ou rejeitá-la depois. */
function chamadaPendurada() {
  let resolver: (valor: unknown) => void = () => undefined;
  let rejeitar: (erro: unknown) => void = () => undefined;
  const promessa = new Promise<unknown>((resolve, reject) => {
    resolver = resolve;
    rejeitar = reject;
  });
  return { promessa, resolver, rejeitar };
}

async function passar(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("EtiquetaDoPedidoCard com a rede pendurada", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  const onTrackingAtualizado =
    vi.fn<(orderId: string, codigo: string) => void>();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    h.invokeMock.mockReset();
    h.leiturasDoPedido.length = 0;
    h.eventos = [];
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
    it("antes do prazo continua em 'Gerando…' com os dois botões apagados", async () => {
      h.invokeMock.mockReturnValue(chamadaPendurada().promessa);
      await abrirCard();
      await confirmarACompra();

      await passar(PRAZO_DA_COMPRA_MS - 1);

      expect(botao("Gerando…")?.disabled).toBe(true);
      expect(botao("Cancelar")?.disabled).toBe(true);
      expect(avisoSemResposta()).toBeNull();
    });

    it("estourou o prazo: avisa que não dá para saber, não afirma nada, solta os botões e relê o pedido", async () => {
      h.invokeMock.mockReturnValue(chamadaPendurada().promessa);
      await abrirCard();
      await confirmarACompra();
      expect(h.leiturasDoPedido).toHaveLength(1);

      await passar(PRAZO_DA_COMPRA_MS);

      // Aviso neutro, na tela e no toast.
      expect(avisoSemResposta()?.textContent).toMatch(
        /Sem resposta da rede\. Não dá para saber se a etiqueta foi gerada/,
      );
      expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.warning).mock.calls[0]?.[0]).toMatch(
        /não dá para saber se a etiqueta foi gerada/i,
      );
      // Nunca "deu certo" e nunca "falhou".
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      expect(
        hospedeiro.querySelector('[data-testid="erro-etiqueta"]'),
      ).toBeNull();
      expect(hospedeiro.textContent).not.toMatch(/Etiqueta gerada/);
      expect(hospedeiro.textContent).not.toMatch(/já tinha etiqueta/);
      expect(onTrackingAtualizado).not.toHaveBeenCalled();
      // A tela não prende mais: nenhum botão em "Gerando…".
      expect(botao("Gerando…")).toBeUndefined();
      expect(botao("Gerar etiqueta")?.disabled).toBe(false);
      // Releu o pedido no servidor (1ª leitura + a do estouro).
      expect(h.leiturasDoPedido).toEqual([ORDER_A, ORDER_A]);
    });

    it("a releitura mostra a etiqueta que o servidor chegou a comprar: card em 'emitida', sem o aviso por cima", async () => {
      h.invokeMock.mockReturnValue(chamadaPendurada().promessa);
      await abrirCard();
      await confirmarACompra();

      // Enquanto a tela esperava, o servidor concluiu a compra.
      h.pedidoState.data = pedido({
        shipping_label_id: "lbl-comprada",
        shipping_label_url: "https://melhorenvio.example/imprimir/x",
        tracking_code: "ME123",
      });
      await passar(PRAZO_DA_COMPRA_MS);

      expect(hospedeiro.textContent).toMatch(/Etiqueta emitida/);
      expect(hospedeiro.textContent).toMatch(/ME123/);
      expect(botao("Gerar etiqueta")).toBeUndefined();
      expect(avisoSemResposta()).toBeNull();
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
    });

    it("resposta tardia de SUCESSO depois do estouro: nada de 'gerada!', nada de callback; só relê em silêncio", async () => {
      const pendurada = chamadaPendurada();
      h.invokeMock.mockReturnValue(pendurada.promessa);
      await abrirCard();
      await confirmarACompra();
      await passar(PRAZO_DA_COMPRA_MS);
      expect(h.leiturasDoPedido).toHaveLength(2);

      // O servidor, enfim, devolve o sucesso da chamada abandonada.
      h.pedidoState.data = pedido({
        shipping_label_id: "lbl-tardia",
        tracking_code: "ME-TARDIO",
      });
      await act(async () => {
        pendurada.resolver({
          data: {
            success: true,
            already: false,
            tracking_code: "ME-TARDIO",
            label_url: null,
            label_id: "lbl-tardia",
          },
        });
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      expect(onTrackingAtualizado).not.toHaveBeenCalled();
      expect(hospedeiro.textContent).not.toMatch(
        /Etiqueta gerada e vinculada ao pedido/,
      );
      // O que a tela mostra agora vem da LEITURA do servidor, não da resposta.
      expect(h.leiturasDoPedido).toHaveLength(3);
      expect(hospedeiro.textContent).toMatch(/Etiqueta emitida/);
    });

    it("resposta tardia de ERRO depois do estouro: nada de toast de erro nem de aviso em dobro", async () => {
      const pendurada = chamadaPendurada();
      h.invokeMock.mockReturnValue(pendurada.promessa);
      await abrirCard();
      await confirmarACompra();
      await passar(PRAZO_DA_COMPRA_MS);

      await act(async () => {
        pendurada.rejeitar(new Error("Failed to fetch"));
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(vi.mocked(toast.error)).not.toHaveBeenCalled();
      expect(vi.mocked(toast.warning)).toHaveBeenCalledTimes(1);
      expect(botao("Gerar etiqueta")?.disabled).toBe(false);
    });

    it("tentar de novo depois do estouro: a trava local foi solta e o servidor responde 'já tinha' — nada comprado em dobro", async () => {
      h.invokeMock.mockReturnValueOnce(chamadaPendurada().promessa);
      await abrirCard();
      await confirmarACompra();
      await passar(PRAZO_DA_COMPRA_MS);
      expect(h.invokeMock).toHaveBeenCalledTimes(1);

      // O 2º clique deixa de ser barrado pela trava local; quem barra a compra
      // dupla é o servidor (`already: true`).
      h.invokeMock.mockResolvedValueOnce({
        data: {
          success: true,
          already: true,
          tracking_code: "ME-J",
          label_url: null,
          label_id: "lbl-j",
        },
      });
      await confirmarACompra();

      expect(h.invokeMock).toHaveBeenCalledTimes(2);
      expect(h.invokeMock.mock.calls[1]?.[1]).toEqual({
        body: { action: "gerar_etiqueta", orderId: ORDER_A },
      });
      expect(hospedeiro.textContent).toMatch(
        /já tinha etiqueta — nada foi comprado de novo/,
      );
      expect(avisoSemResposta()).toBeNull();
    });

    it("antes do estouro o 2º clique continua barrado (a trava local vale enquanto a compra está em voo)", async () => {
      h.invokeMock.mockReturnValue(chamadaPendurada().promessa);
      await abrirCard();
      await confirmarACompra();

      // Nenhum botão de compra clicável: o "Confirmar e gerar" está em
      // "Gerando…", apagado. O clique do teste não pode invocar de novo.
      await act(async () => {
        botao("Gerando…")?.click();
      });
      await passar(PRAZO_DA_COMPRA_MS - 1);

      expect(h.invokeMock).toHaveBeenCalledTimes(1);
    });

    it("pedido trocado antes do estouro: nada de aviso nem de releitura sobre o pedido novo", async () => {
      h.invokeMock.mockReturnValue(chamadaPendurada().promessa);
      await abrirCard(ORDER_A);
      await confirmarACompra();

      h.pedidoState.data = pedido({ shipping_option_id: "store-pickup" });
      await abrirCard(ORDER_B);
      const leiturasAntes = h.leiturasDoPedido.length;
      await passar(PRAZO_DA_COMPRA_MS);

      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
      expect(avisoSemResposta()).toBeNull();
      expect(h.leiturasDoPedido).toHaveLength(leiturasAntes);
    });

    it("resposta normal dentro do prazo: igual a antes (sucesso, rastreio, nenhum aviso) e sem temporizador sobrando", async () => {
      h.invokeMock.mockResolvedValue({
        data: {
          success: true,
          already: false,
          tracking_code: "ME-OK",
          label_url: "https://melhorenvio.example/imprimir/ok",
          label_id: "lbl-ok",
        },
      });
      await abrirCard();
      await confirmarACompra();

      expect(hospedeiro.textContent).toMatch(
        /Etiqueta gerada e vinculada ao pedido!/,
      );
      expect(hospedeiro.textContent).toMatch(/ME-OK/);
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        "Etiqueta gerada com sucesso!",
      );
      expect(onTrackingAtualizado).toHaveBeenCalledWith(ORDER_A, "ME-OK");
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
      expect(avisoSemResposta()).toBeNull();
      expect(vi.getTimerCount()).toBe(0);
    });

    it("erro de negócio do servidor (não é falta de resposta): continua a frase do servidor, sem o aviso de 'não dá para saber'", async () => {
      h.invokeMock.mockResolvedValue({
        data: null,
        error: {
          message: "Edge Function returned a non-2xx status code",
          context: {
            json: () => Promise.resolve({ error: "Saldo insuficiente." }),
          },
        },
      });
      await abrirCard();
      await confirmarACompra();

      expect(hospedeiro.textContent).toMatch(/Saldo insuficiente\./);
      expect(vi.mocked(toast.warning)).not.toHaveBeenCalled();
      expect(avisoSemResposta()).toBeNull();
    });
  });

  describe("consulta de rastreio (leitura)", () => {
    const pedidoEmitido = () =>
      pedido({
        shipping_label_id: "lbl-1",
        shipping_label_url: "https://melhorenvio.example/imprimir/1",
        tracking_code: "ME1",
      });

    it("'Atualizar rastreio' pendurado: depois do prazo avisa, solta o botão e deixa tentar de novo", async () => {
      h.pedidoState.data = pedidoEmitido();
      h.invokeMock.mockReturnValue(chamadaPendurada().promessa);
      await abrirCard();

      await act(async () => {
        botao("Atualizar rastreio")?.click();
      });
      await passar(PRAZO_DO_RASTREIO_MS - 1);
      expect(botao("Atualizar rastreio")?.disabled).toBe(true);

      await passar(1);

      expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(
        /Não deu para atualizar o rastreio/,
      );
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      expect(botao("Atualizar rastreio")?.disabled).toBe(false);

      // Tentar de novo invoca de verdade (a trava de leitura foi solta).
      h.invokeMock.mockResolvedValueOnce({ data: { tracking_code: "ME2" } });
      await act(async () => {
        botao("Atualizar rastreio")?.click();
      });
      await passar(0);
      expect(h.invokeMock).toHaveBeenCalledTimes(2);
      expect(vi.mocked(toast.success)).toHaveBeenCalledWith(
        "Rastreio atualizado!",
      );
    });

    it("resposta tardia da consulta abandonada não pinta rastreio nem avisa sucesso", async () => {
      h.pedidoState.data = pedidoEmitido();
      const pendurada = chamadaPendurada();
      h.invokeMock.mockReturnValue(pendurada.promessa);
      await abrirCard();
      await act(async () => {
        botao("Atualizar rastreio")?.click();
      });
      await passar(PRAZO_DO_RASTREIO_MS);

      await act(async () => {
        pendurada.resolver({ data: { tracking_code: "ME-TARDIO" } });
        await vi.advanceTimersByTimeAsync(0);
      });

      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      expect(onTrackingAtualizado).not.toHaveBeenCalled();
      expect(hospedeiro.textContent).not.toMatch(/ME-TARDIO/);
    });

    it("'Conferir de novo' (compra indeterminada) pendurado: avisa que não deu para conferir e solta o botão", async () => {
      h.pedidoState.data = pedido({
        shipping_label_id: "lbl-1",
        tracking_code: null,
      });
      h.eventos = [
        {
          event_type: "erro",
          payload: { etapa: "checkout_indeterminado" },
          error_message: "sem resposta do checkout",
          created_at: "2026-11-13T10:00:00Z",
        },
      ];
      h.invokeMock.mockReturnValue(chamadaPendurada().promessa);
      await abrirCard();
      expect(botao("Conferir de novo")).toBeTruthy();

      await act(async () => {
        botao("Conferir de novo")?.click();
      });
      await passar(PRAZO_DO_RASTREIO_MS - 1);
      expect(botao("Conferir de novo")?.disabled).toBe(true);
      await passar(1);

      expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
      expect(vi.mocked(toast.error).mock.calls[0]?.[0]).toMatch(
        /Não deu para conferir a etiqueta/,
      );
      expect(vi.mocked(toast.success)).not.toHaveBeenCalled();
      expect(botao("Conferir de novo")?.disabled).toBe(false);
    });
  });
});
