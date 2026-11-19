// @vitest-environment jsdom
//
// "Tentar de novo" do card de devolução da ficha do pedido: a lojista toca,
// a consulta anterior ainda está em voo, e a resposta VELHA chegava depois da
// nova e a sobrescrevia (lista antiga na tela, ou erro apagando uma leitura
// que deu certo). Aqui: só a leitura mais recente vale (sucesso, erro e a
// trava de "carregando"), e o botão fica travado enquanto a consulta roda.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DevolucaoDoPedidoAdminCard } from "@/components/admin/orders/DevolucaoDoPedidoAdminCard";
import { useDevolucoesDoPedidoAdmin } from "@/hooks/useDevolucoesDoPedidoAdmin";

const { rpc, sinais } = vi.hoisted(() => ({
  rpc: vi.fn(),
  sinais: [] as AbortSignal[],
}));
vi.mock("@/lib/supabase", () => ({
  supabase: {
    rpc: (...args: unknown[]) => {
      const resposta = rpc(...args);
      return Object.assign(resposta, {
        abortSignal: (sinal: AbortSignal) => {
          sinais.push(sinal);
          return resposta;
        },
      });
    },
    storage: { from: () => ({}) },
  },
}));
vi.mock("sonner", () => ({
  toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

type Resposta = { data: unknown; error: unknown };

function pendente() {
  let resolver!: (resposta: Resposta) => void;
  const promessa = new Promise<Resposta>((resolve) => {
    resolver = resolve;
  });
  return { promessa, resolver };
}

function linha(id: string, protocolo: string) {
  return {
    id,
    protocolo,
    status: "solicitada",
    tipo: "arrependimento",
    resolucao_desejada: "reembolso",
    metodo_retorno: "envio_proprio",
    valor_itens: 10,
    created_at: "2026-10-16T10:00:00Z",
  };
}

let raiz: Root;
let hospedeiro: HTMLDivElement;
let leitura: ReturnType<typeof useDevolucoesDoPedidoAdmin>;

function CardComLeitura() {
  const leituraDeDevolucoes = useDevolucoesDoPedidoAdmin("pedido-1", true);
  return (
    <DevolucaoDoPedidoAdminCard leituraDeDevolucoes={leituraDeDevolucoes} />
  );
}

function Sonda() {
  const lida = useDevolucoesDoPedidoAdmin("pedido-1", true);
  useEffect(() => {
    leitura = lida;
  });
  return null;
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  rpc.mockReset();
  sinais.length = 0;
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("devoluções do pedido — só a leitura mais recente vale", () => {
  it("mostra que está consultando e solta o botão se a nova tentativa também pendurar", async () => {
    vi.useFakeTimers();
    try {
      rpc.mockImplementation(() => new Promise(() => {}));
      await act(async () => raiz.render(<CardComLeitura />));
      const avancar = () =>
        act(async () => {
          await vi.advanceTimersByTimeAsync(20_000);
        });
      const botao = () => hospedeiro.querySelector("button");
      expect(hospedeiro.textContent).toBe("");
      await avancar();
      expect(botao()?.textContent).toBe("Tentar de novo");
      await act(async () => botao()?.click());
      expect(botao()?.disabled).toBe(true);
      expect(hospedeiro.textContent).toContain("Consultando devoluções…");
      await avancar();
      expect(botao()?.disabled).toBe(false);
      rpc.mockResolvedValueOnce({ data: [], error: null });
      await act(async () => botao()?.click());
      expect(hospedeiro.textContent).toBe("");
      expect(rpc.mock.calls).toEqual(
        Array.from({ length: 3 }, () => [
          "devolucoes_do_pedido",
          { p_order_id: "pedido-1" },
        ]),
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it("aborta a consulta pendente ao tentar de novo e ao desmontar", async () => {
    vi.useFakeTimers();
    try {
      rpc.mockImplementation(() => pendente().promessa);
      await act(async () => raiz.render(<CardComLeitura />));
      await act(async () => vi.advanceTimersByTimeAsync(20_000));
      expect(sinais[0]?.aborted).toBe(false);

      await act(async () => hospedeiro.querySelector("button")?.click());
      expect(sinais[0]?.aborted).toBe(true);
      expect(sinais[1]?.aborted).toBe(false);

      await act(async () => raiz.render(null));
      expect(sinais[1]?.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it("aproveita a devolução aos 21 s sem precisar tentar de novo", async () => {
    vi.useFakeTimers();
    try {
      const consulta = pendente();
      rpc.mockReturnValueOnce(consulta.promessa);
      await act(async () => raiz.render(<CardComLeitura />));
      await act(async () => vi.advanceTimersByTimeAsync(20_000));
      expect(hospedeiro.textContent).toContain("Tentar de novo");

      await act(async () => vi.advanceTimersByTimeAsync(1_000));
      await act(async () =>
        consulta.resolver({
          data: [linha("dev-tardia", "DV-TARDIA")],
          error: null,
        }),
      );
      expect(hospedeiro.textContent).toContain("DV-TARDIA");
      expect(hospedeiro.textContent).not.toContain("Tentar de novo");
    } finally {
      vi.useRealTimers();
    }
  });

  it("limpa o prazo da consulta ao desmontar a devolução", async () => {
    vi.useFakeTimers();
    try {
      rpc.mockReturnValueOnce(pendente().promessa);
      await act(async () => raiz.render(<Sonda />));
      expect(vi.getTimerCount()).toBe(1);

      await act(async () => raiz.render(null));
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a resposta velha que chega DEPOIS da nova não sobrescreve a lista", async () => {
    const primeira = pendente();
    const segunda = pendente();
    rpc
      .mockReturnValueOnce(primeira.promessa)
      .mockReturnValueOnce(segunda.promessa);
    await act(async () => raiz.render(<Sonda />));
    await act(async () => leitura.recarregar());
    expect(rpc).toHaveBeenCalledTimes(2);

    await act(async () => {
      segunda.resolver({ data: [linha("dev-nova", "DV-NOVA")], error: null });
    });
    await act(async () => {
      primeira.resolver({
        data: [linha("dev-velha", "DV-VELHA")],
        error: null,
      });
    });

    expect(leitura.devolucoes.map((d) => d.id)).toEqual(["dev-nova"]);
    expect(leitura.erro).toBe(false);
    expect(leitura.carregando).toBe(false);
  });

  it("o erro velho que chega depois de uma leitura boa não acende o erro", async () => {
    const primeira = pendente();
    const segunda = pendente();
    rpc
      .mockReturnValueOnce(primeira.promessa)
      .mockReturnValueOnce(segunda.promessa);
    await act(async () => raiz.render(<Sonda />));
    await act(async () => leitura.recarregar());

    await act(async () => {
      segunda.resolver({ data: [linha("dev-nova", "DV-NOVA")], error: null });
    });
    await act(async () => {
      primeira.resolver({ data: null, error: { message: "caiu" } });
    });

    expect(leitura.erro).toBe(false);
    expect(leitura.devolucoes.map((d) => d.id)).toEqual(["dev-nova"]);
  });

  it("a resposta velha que chega ANTES da nova não solta o 'carregando'", async () => {
    const primeira = pendente();
    const segunda = pendente();
    rpc
      .mockReturnValueOnce(primeira.promessa)
      .mockReturnValueOnce(segunda.promessa);
    await act(async () => raiz.render(<Sonda />));
    await act(async () => leitura.recarregar());
    expect(leitura.carregando).toBe(true);

    await act(async () => {
      primeira.resolver({
        data: [linha("dev-velha", "DV-VELHA")],
        error: null,
      });
    });

    // A leitura mais nova ainda roda: nada da velha entra na tela.
    expect(leitura.carregando).toBe(true);
    expect(leitura.devolucoes).toEqual([]);

    await act(async () => {
      segunda.resolver({ data: [linha("dev-nova", "DV-NOVA")], error: null });
    });
    expect(leitura.carregando).toBe(false);
    expect(leitura.devolucoes.map((d) => d.id)).toEqual(["dev-nova"]);
  });

  it("depois de desmontar, a resposta que chega não mexe em nada", async () => {
    const primeira = pendente();
    rpc.mockReturnValueOnce(primeira.promessa);
    await act(async () => raiz.render(<Sonda />));
    await act(async () => raiz.render(null));

    await act(async () => {
      primeira.resolver({
        data: [linha("dev-velha", "DV-VELHA")],
        error: null,
      });
    });

    expect(leitura.devolucoes).toEqual([]);
  });
});

describe("card de devolução do pedido — 'Tentar de novo'", () => {
  function botaoDeNovo(): HTMLButtonElement | undefined {
    return Array.from(hospedeiro.querySelectorAll("button")).find((b) =>
      /Tentar de novo|Tentando/.test(b.textContent ?? ""),
    );
  }

  it("fica travado e diz 'Tentando…' enquanto a consulta roda, e volta ao fim", async () => {
    const segunda = pendente();
    rpc
      .mockResolvedValueOnce({ data: null, error: { message: "caiu" } })
      .mockReturnValueOnce(segunda.promessa);
    await act(async () => raiz.render(<CardComLeitura />));

    expect(botaoDeNovo()?.textContent).toBe("Tentar de novo");
    expect(botaoDeNovo()?.disabled).toBe(false);

    await act(async () => botaoDeNovo()?.click());

    expect(botaoDeNovo()?.textContent).toBe("Tentando…");
    expect(botaoDeNovo()?.disabled).toBe(true);
    // Tocar de novo com a consulta em voo não dispara outra.
    await act(async () => botaoDeNovo()?.click());
    expect(rpc).toHaveBeenCalledTimes(2);

    await act(async () => {
      segunda.resolver({ data: null, error: { message: "caiu de novo" } });
    });

    expect(botaoDeNovo()?.textContent).toBe("Tentar de novo");
    expect(botaoDeNovo()?.disabled).toBe(false);
  });
});
