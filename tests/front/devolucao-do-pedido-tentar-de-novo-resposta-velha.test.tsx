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
import { useDevolucoesDoPedidoAdmin } from "@/hooks/useDevolucoesAdmin";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase", () => ({
  supabase: { rpc, storage: { from: () => ({}) } },
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
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("devoluções do pedido — só a leitura mais recente vale", () => {
  it("a resposta velha que chega DEPOIS da nova não sobrescreve a lista", async () => {
    const primeira = pendente();
    const segunda = pendente();
    rpc
      .mockReturnValueOnce(primeira.promessa)
      .mockReturnValueOnce(segunda.promessa);
    await act(async () => raiz.render(<Sonda />));
    act(() => leitura.recarregar());
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
    act(() => leitura.recarregar());

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
    act(() => leitura.recarregar());
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
    await act(async () =>
      raiz.render(<DevolucaoDoPedidoAdminCard orderId="pedido-1" />),
    );

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
