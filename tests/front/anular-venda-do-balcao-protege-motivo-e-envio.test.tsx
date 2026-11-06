// @vitest-environment jsdom
//
// Anular venda do balcão — a atualização automática do app não pode recarregar
// a tela com o motivo digitado (nem com a anulação em andamento): o motivo
// seria apagado e a lojista não saberia se a venda foi anulada. O registro de
// operações sensíveis (`marcarOperacaoSensivel`) só ADIA a atualização; a regra
// de anular e o cálculo não mudam.
//
// Sem `@testing-library/react`: `createRoot` + `act`, padrão da casa.
import { AnularVendaDoBalcao } from "@/components/admin/pdv/AnularVendaDoBalcao";
import {
  type ResultadoDaAnulacao,
  useAnularVendaDoBalcao,
} from "@/hooks/useAnularVendaDoBalcao";
import {
  haOperacaoSensivel,
  motivosDeOperacaoSensivel,
} from "@/lib/atualizacao/operacao-sensivel";
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock } = vi.hoisted(() => ({ rpcMock: vi.fn() }));
vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useAnalytics", () => ({ clearAnalyticsCache: vi.fn() }));

function botao(raiz: ParentNode, texto: string): HTMLButtonElement | undefined {
  return [...raiz.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(texto),
  ) as HTMLButtonElement | undefined;
}

function digitarMotivo(texto: string): void {
  const campo = document.querySelector("textarea") as HTMLTextAreaElement;
  const setter = Object.getOwnPropertyDescriptor(
    globalThis.HTMLTextAreaElement.prototype,
    "value",
  )?.set;
  setter?.call(campo, texto);
  campo.dispatchEvent(new Event("input", { bubbles: true }));
}

function adiar<T>() {
  let resolver!: (valor: T) => void;
  let rejeitar!: (erro: unknown) => void;
  const promessa = new Promise<T>((ok, falha) => {
    resolver = ok;
    rejeitar = falha;
  });
  return { promessa, resolver, rejeitar };
}

describe("anular venda do balcão — a atualização espera", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;

  beforeEach(() => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    rpcMock.mockReset();
  });

  async function montar(
    aoAnular: (m: string) => Promise<ResultadoDaAnulacao>,
  ): Promise<void> {
    await act(async () => {
      raiz.render(
        <AnularVendaDoBalcao total={79.8} forma="cash" aoAnular={aoAnular} />,
      );
    });
  }

  it("só o botão 'Anular venda', nada a perder: não segura a atualização", async () => {
    await montar(vi.fn());
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("pergunta aberta mas SEM motivo: ainda não há o que perder", async () => {
    await montar(vi.fn());
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("com o motivo digitado a atualização espera; ao Voltar, libera", async () => {
    await montar(vi.fn());
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => {
      digitarMotivo("cliente desistiu");
    });
    expect(haOperacaoSensivel()).toBe(true);
    expect(motivosDeOperacaoSensivel()).toEqual([
      "anulacao-da-venda-do-balcao",
    ]);

    await act(async () => {
      botao(hospedeiro, "Voltar")?.click();
    });
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("apagar o motivo digitado libera: nada mais a perder", async () => {
    await montar(vi.fn());
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => {
      digitarMotivo("engano");
    });
    expect(haOperacaoSensivel()).toBe(true);
    await act(async () => {
      digitarMotivo("   ");
    });
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("segura durante o envio e libera ao concluir (aviso de venda anulada na tela)", async () => {
    const envio = adiar<ResultadoDaAnulacao>();
    await montar(() => envio.promessa);
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => {
      digitarMotivo("forma de pagamento errada");
    });
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
    expect(hospedeiro.textContent).toContain("Anulando");
    expect(haOperacaoSensivel()).toBe(true);

    await act(async () => {
      envio.resolver({ orderId: "pedido-1", jaAnulada: false });
    });
    expect(hospedeiro.textContent).toContain("Venda anulada");
    expect(haOperacaoSensivel()).toBe(false);
  });

  it("anulação recusada: o motivo segue na tela, então a atualização segue esperando", async () => {
    const envio = adiar<ResultadoDaAnulacao>();
    await montar(() => envio.promessa);
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => {
      digitarMotivo("engano");
    });
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
    await act(async () => {
      envio.rejeitar({ code: "22023", message: "falha" });
    });
    expect(hospedeiro.querySelector("[role=alert]")).not.toBeNull();
    expect(haOperacaoSensivel()).toBe(true);
  });

  it("desmontar no meio da digitação não deixa marca presa", async () => {
    await montar(vi.fn());
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
    await act(async () => {
      digitarMotivo("engano");
    });
    expect(haOperacaoSensivel()).toBe(true);
    act(() => {
      raiz.unmount();
    });
    expect(haOperacaoSensivel()).toBe(false);
    // O afterEach desmonta de novo: recria a raiz para ele não reclamar.
    raiz = createRoot(hospedeiro);
  });
});

describe("useAnularVendaDoBalcao — a chamada da RPC segura a atualização", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  let anular!: ReturnType<typeof useAnularVendaDoBalcao>["anular"];

  // O hook entrega `anular` ao teste por um efeito (renderizar não pode
  // reatribuir variável de fora).
  function Sonda({ pronto }: { pronto: (a: typeof anular) => void }): null {
    const { anular: funcao } = useAnularVendaDoBalcao();
    useEffect(() => {
      pronto(funcao);
    }, [pronto, funcao]);
    return null;
  }

  beforeEach(async () => {
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    await act(async () => {
      raiz.render(
        <Sonda
          pronto={(a) => {
            anular = a;
          }}
        />,
      );
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    rpcMock.mockReset();
  });

  it.each(["sucesso", "erro", "rejeicao"])(
    "veta enquanto a RPC está pendente e libera após %s",
    async (desfecho) => {
      const envio = adiar<{ data: unknown; error: unknown }>();
      rpcMock.mockReturnValue(envio.promessa);
      let resultado!: Promise<unknown>;
      await act(async () => {
        resultado = anular("pedido-1", "engano").catch((e: unknown) => e);
      });
      expect(rpcMock).toHaveBeenCalledWith("anular_venda_presencial", {
        p_order_id: "pedido-1",
        p_motivo: "engano",
      });
      expect(haOperacaoSensivel()).toBe(true);
      expect(motivosDeOperacaoSensivel()).toEqual([
        "anulacao-da-venda-do-balcao",
      ]);

      await act(async () => {
        if (desfecho === "rejeicao") {
          envio.rejeitar(new Error("falha simulada"));
        } else {
          envio.resolver({
            error:
              desfecho === "erro"
                ? { code: "22023", message: "falha simulada" }
                : null,
            data: { order_id: "pedido-1", ja_anulada: false },
          });
        }
        await resultado;
      });
      expect(haOperacaoSensivel()).toBe(false);
    },
  );
});
