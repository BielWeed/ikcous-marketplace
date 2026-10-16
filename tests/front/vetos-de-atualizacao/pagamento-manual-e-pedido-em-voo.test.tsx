// @vitest-environment jsdom
import { useOrders } from "@/hooks/useOrders";
import {
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adiar } from "./apoio";

const rpc = vi.hoisted(() => vi.fn());
vi.mock("@/lib/supabase", () => ({ supabase: { rpc } }));
vi.mock("@/hooks/useAuth", () => ({
  useAuth: () => ({ user: null, isAdmin: false }),
}));
vi.mock("@/hooks/useLeaderElection", () => ({
  useLeaderElection: () => ({ isLeader: false }),
}));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));
vi.mock("sonner", () => ({ toast: { error: vi.fn() } }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let api: ReturnType<typeof useOrders>;
function Sonda() {
  const retorno = useOrders(false, false);
  useEffect(() => {
    api = retorno;
  });
  return null;
}
const dados = {
  items: [{ productId: "produto-teste", quantity: 1 }],
  totalAmount: 10,
  shippingCost: 0,
  paymentMethod: "dinheiro",
  customer: { name: "Pessoa de teste", whatsapp: "" },
};

describe("RPCs de pagamento manual e criação de pedido mantêm o veto", () => {
  let raiz: Root;
  let host: HTMLDivElement;
  beforeEach(() => {
    rpc.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    host = document.createElement("div");
    document.body.appendChild(host);
    raiz = createRoot(host);
    act(() => raiz.render(<Sonda />));
  });
  afterEach(() => {
    act(() => raiz.unmount());
    host.remove();
    vi.restoreAllMocks();
  });

  it.each([true, false])(
    "registro manual (recebido=%s) veta até a resposta mesmo depois de sair da tela",
    async (recebido) => {
      const envio = adiar<{ data: object; error: null }>();
      rpc.mockReturnValue(envio.promessa);
      let resultado!: Promise<unknown>;
      try {
        act(() => {
          resultado = api.registrarPagamentoRecebido("pedido-teste", recebido);
        });
        expect(rpc).toHaveBeenCalledWith("registrar_pagamento_recebido", {
          p_order_id: "pedido-teste",
          p_recebido: recebido,
        });
        expect(motivosDeOperacaoSensivel()).toEqual([
          "registrar-pagamento-manual",
        ]);
        act(() => raiz.render(null));
        expect(haOperacaoSensivel()).toBe(true);
      } finally {
        await act(async () => {
          envio.resolver({ data: {}, error: null });
          await resultado;
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );

  it.each(["resposta", "rejeicao"])(
    "registro manual libera a marca ao falhar por %s e preserva o erro",
    async (tipo) => {
      const envio = adiar<{ data: null; error: Error }>();
      const erro = new Error("falha simulada");
      rpc.mockReturnValue(envio.promessa);
      const resultado = api
        .registrarPagamentoRecebido("pedido-teste", true)
        .catch((e: unknown) => e);
      try {
        expect(haOperacaoSensivel()).toBe(true);
      } finally {
        await act(async () => {
          if (tipo === "rejeicao") envio.rejeitar(erro);
          else envio.resolver({ data: null, error: erro });
          expect(await resultado).toBe(erro);
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );

  it.each([false, true])(
    "criação em voo continua vetando depois do desmonte até terminar (erro=%s)",
    async (erro) => {
      const envio = adiar<{ data: string; error: null }>();
      rpc.mockReturnValue(envio.promessa);
      const resultado = api
        .createOrder(dados, { comPagamentoOnline: true })
        .catch((e: unknown) => e);
      try {
        expect(motivosDeOperacaoSensivel()).toEqual(["envio-de-pedido"]);
        act(() => raiz.render(null));
        expect(haOperacaoSensivel()).toBe(true);
      } finally {
        await act(async () => {
          if (erro) envio.rejeitar(new Error("falha simulada"));
          else envio.resolver({ data: "pedido-teste", error: null });
          await resultado;
        });
      }
      expect(haOperacaoSensivel()).toBe(false);
    },
  );

  it("terminar um pedido não libera o pedido ainda em voo da instância desmontada", async () => {
    const antigo = adiar<{ data: string; error: null }>();
    const novo = adiar<{ data: string; error: null }>();
    rpc.mockReturnValueOnce(antigo.promessa).mockReturnValueOnce(novo.promessa);
    const resultadoAntigo = api.createOrder(dados, {
      comPagamentoOnline: true,
    });
    act(() => raiz.render(null));
    act(() => raiz.render(<Sonda />));
    const resultadoNovo = api.createOrder(dados, { comPagamentoOnline: true });
    try {
      await act(async () => {
        novo.resolver({ data: "pedido-novo", error: null });
        await resultadoNovo;
      });
      expect(haOperacaoSensivel()).toBe(true);
    } finally {
      await act(async () => {
        antigo.resolver({ data: "pedido-antigo", error: null });
        novo.resolver({ data: "pedido-novo", error: null });
        await Promise.all([resultadoAntigo, resultadoNovo]);
      });
    }
    expect(haOperacaoSensivel()).toBe(false);
  });
});
