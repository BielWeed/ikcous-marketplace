// @vitest-environment jsdom
//
// Pedidos de privacidade no painel (usePedidosDePrivacidadeAdmin): a bolinha
// vermelha do sino ficava acesa depois de a lojista responder o último pedido
// aberto — o AdminLayout só reconta ao ouvir `admin:recontar-avisos` e quem
// decide pedido de privacidade nunca o disparava. Aqui se prova o evento: sai
// quando o banco mudou (decisão que gravou, ou que alguém já tinha gravado) e
// NÃO sai quando nada mudou (falha de rede, sem efeito no banco).
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePedidosDePrivacidadeAdmin } from "@/hooks/usePedidosDePrivacidadeAdmin";

type Resposta = { data: unknown; error: unknown };

const banco = vi.hoisted(() => ({
  atualizacao: { data: [{ id: "ped-1" }], error: null } as Resposta,
  atualizacaoPendente: null as Promise<Resposta> | null,
  atualizacaoQuebra: null as unknown,
}));

vi.mock("@/lib/supabase", () => {
  function consulta() {
    const cadeia = {
      eq: () => cadeia,
      neq: () => cadeia,
      order: () => cadeia,
      limit: () => cadeia,
      // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase — mesmo padrão dos vizinhos.
      then: (resolve: (v: Resposta) => unknown) =>
        Promise.resolve({ data: [], error: null }).then(resolve),
    };
    return cadeia;
  }
  return {
    supabase: {
      from: () => ({
        select: () => consulta(),
        update: () => {
          const cadeia = {
            eq: () => cadeia,
            select: async () => {
              if (banco.atualizacaoQuebra) throw banco.atualizacaoQuebra;
              return banco.atualizacaoPendente ?? banco.atualizacao;
            },
          };
          return cadeia;
        },
      }),
    },
  };
});

let raiz: Root;
let hospedeiro: HTMLDivElement;
let painel: ReturnType<typeof usePedidosDePrivacidadeAdmin>;
const sino = vi.fn();

function Sonda() {
  const lido = usePedidosDePrivacidadeAdmin();
  useEffect(() => {
    painel = lido;
  });
  return null;
}

beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.useFakeTimers();
  vi.clearAllMocks();
  banco.atualizacao = { data: [{ id: "ped-1" }], error: null };
  banco.atualizacaoPendente = null;
  banco.atualizacaoQuebra = null;
  window.addEventListener("admin:recontar-avisos", sino);
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
  await act(async () => raiz.render(<Sonda />));
});

afterEach(() => {
  window.removeEventListener("admin:recontar-avisos", sino);
  act(() => raiz.unmount());
  hospedeiro.remove();
  vi.useRealTimers();
});

describe("sino do painel depois de responder um pedido de privacidade", () => {
  it("marcar como atendido manda o sino recontar", async () => {
    let r: unknown;
    await act(async () => {
      r = await painel.decidir("ped-1", "atendido", "feito");
    });
    expect(r).toEqual({ ok: true });
    expect(sino).toHaveBeenCalledTimes(1);
  });

  it("pedido que outra pessoa já tinha decidido (nenhuma linha mudou) também manda recontar", async () => {
    banco.atualizacao = { data: [], error: null };
    let r: unknown;
    await act(async () => {
      r = await painel.decidir("ped-1", "recusado", "");
    });
    expect(r).toEqual({ ok: false, falha: "ja_decidido" });
    expect(sino).toHaveBeenCalledTimes(1);
  });

  it("o banco recusar por já estar decidido (55000) também manda recontar", async () => {
    banco.atualizacao = { data: null, error: { code: "55000", message: "x" } };
    await act(async () => {
      await painel.decidir("ped-1", "atendido", "");
    });
    expect(sino).toHaveBeenCalledTimes(1);
  });

  it("falha de rede (nada gravou) não manda recontar", async () => {
    banco.atualizacaoQuebra = new TypeError("Failed to fetch");
    let r: unknown;
    await act(async () => {
      r = await painel.decidir("ped-1", "atendido", "");
    });
    expect(r).toEqual({ ok: false, falha: "sem_rede" });
    expect(sino).not.toHaveBeenCalled();
  });

  it("prazo estourado: a gravação pode ter chegado, então o sino reconta", async () => {
    banco.atualizacaoPendente = new Promise<Resposta>(() => {});
    let r: unknown;
    act(() => {
      void painel.decidir("ped-1", "atendido", "").then((x) => {
        r = x;
      });
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15_000);
    });
    expect(r).toEqual(expect.objectContaining({ ok: false }));
    expect(sino).toHaveBeenCalledTimes(1);
  });
});
