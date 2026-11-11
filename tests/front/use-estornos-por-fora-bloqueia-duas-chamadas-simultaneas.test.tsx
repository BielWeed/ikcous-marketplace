// @vitest-environment jsdom
// Protege enviandoRef na saída por fora: só uma RPC enquanto a primeira não responde.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { registrar } = vi.hoisted(() => ({ registrar: vi.fn() }));
const saldo = {
  total: 100,
  valor_estornado: 0,
  em_voo: 0,
  em_duvida: 0,
  manual: 0,
  disponivel: 100,
  reservado_por_fora: 0,
  linhas: [],
};
const respostaRegistrada = {
  data: {
    resultado: "registrado",
    detalhe: "apos_espera",
    risco_de_dobro: true,
    payment_status: "estornado",
    refund_id: "r1",
  },
  error: null,
};

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: () => {
      const builder = {
        select: () => builder,
        eq: () => builder,
        order: () => Promise.resolve({ data: [], error: null }),
      };
      return builder;
    },
    rpc: (nome: string, argumentos: unknown) => {
      if (nome === "pedido_reembolsos_e_saldo") {
        return Promise.resolve({ data: saldo, error: null });
      }
      if (nome === "registrar_estorno_manual_apos_espera") {
        return registrar(argumentos);
      }
      throw new Error(`RPC inesperada: ${nome}`);
    },
    functions: { invoke: vi.fn() },
  },
}));
vi.mock("sonner", () => ({
  toast: { error: vi.fn(), info: vi.fn(), success: vi.fn(), warning: vi.fn() },
}));

import { useEstornosDoPedido } from "@/hooks/useEstornosDoPedido";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("useEstornosDoPedido — saída por fora não duplica RPC em voo", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let atual: ReturnType<typeof useEstornosDoPedido>;
  let concluir: (resposta: typeof respostaRegistrada) => void;

  function Sonda() {
    const retorno = useEstornosDoPedido("pedido-1");
    useEffect(() => {
      atual = retorno;
    });
    return null;
  }

  beforeEach(async () => {
    vi.clearAllMocks();
    const pendente = new Promise<typeof respostaRegistrada>((resolve) => {
      concluir = resolve;
    });
    registrar.mockReset().mockReturnValue(pendente);
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => raiz.render(<Sonda />));
  });

  afterEach(async () => {
    // Também libera todas as chamadas se o mutante falhar antes da conclusão.
    await act(async () => concluir(respostaRegistrada));
    act(() => raiz.unmount());
    hospedeiro.remove();
    vi.restoreAllMocks();
  });

  it("recusa a segunda chamada no mesmo instante e libera outra após a resposta", async () => {
    expect(atual.pedidoCarregado).toBe(true);
    expect(atual.erro).toBe(false);
    let primeira!: Promise<boolean>;
    let segunda!: Promise<boolean>;
    await act(async () => {
      primeira = atual.registrarPorForaAposEspera("r1");
      segunda = atual.registrarPorForaAposEspera("r1");
    });

    expect(registrar).toHaveBeenCalledTimes(1);
    expect(registrar).toHaveBeenCalledWith({
      p_order_id: "pedido-1",
      p_refund_esperado: "r1",
      p_confirmacao: "DEVOLVI POR FORA",
    });
    await expect(segunda).resolves.toBe(false);
    expect(atual.enviando).toBe(true);

    await act(async () => {
      concluir(respostaRegistrada);
      expect(await primeira).toBe(true);
    });
    expect(atual.enviando).toBe(false);

    registrar.mockResolvedValue(respostaRegistrada);
    await act(async () => {
      expect(await atual.registrarPorForaAposEspera("r1")).toBe(true);
    });
    expect(registrar).toHaveBeenCalledTimes(2);
    expect(atual.enviando).toBe(false);
  });
});
