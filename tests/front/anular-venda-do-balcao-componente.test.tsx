// @vitest-environment jsdom
//
// Anular venda do balcão — a peça `AnularVendaDoBalcao` (pergunta, motivo
// obrigatório, confirmação, mensagens) e o hook `useAnularVendaDoBalcao` (a
// única chamada da RPC). Sem `@testing-library/react`: `createRoot` + `act`,
// padrão da casa.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const { rpcMock, limparCacheMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  limparCacheMock: vi.fn(),
}));

vi.mock("@/lib/supabase", () => ({ supabase: { rpc: rpcMock } }));
vi.mock("@/hooks/useAnalytics", () => ({
  clearAnalyticsCache: limparCacheMock,
}));

import { AnularVendaDoBalcao } from "@/components/admin/pdv/AnularVendaDoBalcao";
import {
  lerRespostaDaAnulacao,
  useAnularVendaDoBalcao,
} from "@/hooks/useAnularVendaDoBalcao";
import type { ResultadoDaAnulacao } from "@/hooks/useAnularVendaDoBalcao";

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

describe("AnularVendaDoBalcao", () => {
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
    vi.restoreAllMocks();
  });

  async function montar(
    aoAnular: (m: string) => Promise<ResultadoDaAnulacao>,
    extras: Partial<{
      total: number;
      forma: string;
      clienteComConta: boolean;
      aoConcluir: (r: ResultadoDaAnulacao) => void;
    }> = {},
  ) {
    await act(async () => {
      raiz.render(
        <AnularVendaDoBalcao
          total={extras.total ?? 79.8}
          forma={extras.forma ?? "cash"}
          clienteComConta={extras.clienteComConta}
          aoAnular={aoAnular}
          aoConcluir={extras.aoConcluir}
        />,
      );
    });
  }
  async function abrir() {
    await act(async () => {
      botao(hospedeiro, "Anular venda")?.click();
    });
  }
  async function confirmar() {
    await act(async () => {
      botao(hospedeiro, "Confirmar anulação")?.click();
    });
  }

  it("começa fechado: só o botão 'Anular venda', nenhuma chamada", async () => {
    const aoAnular = vi.fn();
    await montar(aoAnular);
    expect(botao(hospedeiro, "Anular venda")).toBeDefined();
    expect(hospedeiro.querySelector("textarea")).toBeNull();
    expect(aoAnular).not.toHaveBeenCalled();
  });

  it("o primeiro clique só ABRE a pergunta com o valor e o que acontece; ainda nada é anulado", async () => {
    const aoAnular = vi.fn();
    await montar(aoAnular);
    await abrir();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toMatch(/Anular esta venda de R\$\s79,80\?/);
    expect(texto).toContain("Só vale no mesmo dia");
    expect(texto).toContain("O app não devolve o dinheiro ao cliente");
    expect(aoAnular).not.toHaveBeenCalled();
  });

  it("sem motivo (vazio ou só espaços) o botão de confirmar fica desligado e nada é chamado", async () => {
    const aoAnular = vi.fn();
    await montar(aoAnular);
    await abrir();
    expect(botao(hospedeiro, "Confirmar anulação")?.disabled).toBe(true);
    await act(async () => digitarMotivo("   \n  "));
    expect(botao(hospedeiro, "Confirmar anulação")?.disabled).toBe(true);
    await confirmar();
    expect(aoAnular).not.toHaveBeenCalled();
  });

  it("motivo só de caractere invisível (espaço de largura zero): o botão habilita, mas confirmar NÃO chama a RPC e mostra a mesma frase do motivo vazio", async () => {
    const aoAnular = vi.fn();
    await montar(aoAnular);
    await abrir();
    await act(async () => digitarMotivo(String.fromCharCode(0x200b).repeat(3)));
    await confirmar();
    expect(aoAnular).not.toHaveBeenCalled();
    expect(hospedeiro.querySelector('[role="alert"]')?.textContent).toBe(
      "Informe o motivo para anular a venda.",
    );
    // escrever um motivo de verdade limpa o impedimento
    await act(async () => digitarMotivo("engano"));
    aoAnular.mockResolvedValue({ orderId: "p1", jaAnulada: false });
    await confirmar();
    expect(aoAnular).toHaveBeenCalledWith("engano");
  });

  it("o campo do motivo aceita no máximo 500 caracteres (o teto da RPC)", async () => {
    await montar(vi.fn());
    await abrir();
    const campo = document.querySelector("textarea") as HTMLTextAreaElement;
    expect(campo.maxLength).toBe(500);
  });

  it("com motivo, confirma UMA vez com o texto aparado e mostra o aviso de sucesso com a instrução de devolver", async () => {
    const aoAnular = vi.fn(async () => ({ orderId: "p1", jaAnulada: false }));
    const aoConcluir = vi.fn();
    await montar(aoAnular, { forma: "pix", aoConcluir });
    await abrir();
    await act(async () => digitarMotivo("  cliente desistiu  "));
    await confirmar();
    expect(aoAnular).toHaveBeenCalledTimes(1);
    expect(aoAnular).toHaveBeenCalledWith("cliente desistiu");
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Venda anulada: o estoque voltou");
    expect(texto).toMatch(/Devolva R\$\s79,80 ao cliente por PIX\./);
    expect(hospedeiro.querySelector("textarea")).toBeNull();
    expect(aoConcluir).toHaveBeenCalledWith({
      orderId: "p1",
      jaAnulada: false,
    });
  });

  it("maquininha manda estornar na maquininha; dinheiro manda devolver em dinheiro", async () => {
    for (const [forma, esperado] of [
      ["card", /Faça o estorno de R\$\s79,80 na maquininha\./],
      ["cash", /Devolva R\$\s79,80 em dinheiro ao cliente\./],
    ] as const) {
      const aoAnular = vi.fn(async () => ({ orderId: "p1", jaAnulada: false }));
      await act(async () => {
        raiz.unmount();
      });
      raiz = createRoot(hospedeiro);
      await montar(aoAnular, { forma });
      await abrir();
      await act(async () => digitarMotivo("engano"));
      await confirmar();
      expect(hospedeiro.textContent).toMatch(esperado);
    }
  });

  it("duplo clique rápido em 'Confirmar' chama a RPC UMA vez só", async () => {
    let liberar: (r: ResultadoDaAnulacao) => void = () => {};
    const aoAnular = vi.fn(
      () =>
        new Promise<ResultadoDaAnulacao>((resolve) => {
          liberar = resolve;
        }),
    );
    await montar(aoAnular);
    await abrir();
    await act(async () => digitarMotivo("engano"));
    const b = botao(hospedeiro, "Confirmar anulação");
    await act(async () => {
      b?.click();
      b?.click();
    });
    expect(aoAnular).toHaveBeenCalledTimes(1);
    expect(hospedeiro.textContent).toContain("Anulando");
    await act(async () => liberar({ orderId: "p1", jaAnulada: false }));
  });

  it("(a) venda que já estava anulada (nova tentativa depois de falha de rede): diz isso E repete quanto devolver e como, porque quem anulou de verdade nunca viu a instrução", async () => {
    await montar(async () => ({ orderId: "p1", jaAnulada: true }), {
      forma: "pix",
    });
    await abrir();
    await act(async () => digitarMotivo("engano"));
    await confirmar();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toContain("Esta venda já estava anulada");
    expect(texto).toContain("O app não devolve o dinheiro");
    // R2: outro aparelho pode já ter devolvido; a ordem é condicional.
    expect(texto).toMatch(
      /Se o dinheiro ainda não voltou ao cliente, devolva R\$\s79,80 por PIX\./,
    );
    expect(texto).not.toMatch(/(^|\. )Devolva R\$/);
  });

  it("R2: na anulação nova (não repetida) a instrução continua direta, sem 'se'", async () => {
    await montar(async () => ({ orderId: "p1", jaAnulada: false }), {
      forma: "pix",
    });
    await abrir();
    await act(async () => digitarMotivo("engano"));
    await confirmar();
    const texto = hospedeiro.textContent ?? "";
    expect(texto).toMatch(/Devolva R\$\s79,80 ao cliente por PIX\./);
    expect(texto).not.toContain("Se o dinheiro ainda não voltou");
  });

  it("(b) ao abrir a pergunta o foco vai para o campo do motivo", async () => {
    await montar(vi.fn());
    await abrir();
    expect(document.activeElement).toBe(document.querySelector("textarea"));
  });

  it("(b) Esc fecha a pergunta sem chamar nada e devolve o foco ao botão 'Anular venda'", async () => {
    const aoAnular = vi.fn();
    await montar(aoAnular);
    await abrir();
    await act(async () => digitarMotivo("engano"));
    await act(async () => {
      (document.querySelector("textarea") as HTMLTextAreaElement).dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    expect(document.querySelector("textarea")).toBeNull();
    const aberto = botao(hospedeiro, "Anular venda");
    expect(aberto).toBeDefined();
    expect(document.activeElement).toBe(aberto);
    expect(aoAnular).not.toHaveBeenCalled();
  });

  it("(b) 'Voltar' também devolve o foco ao botão", async () => {
    await montar(vi.fn());
    await abrir();
    await act(async () => {
      botao(hospedeiro, "Voltar")?.click();
    });
    expect(document.activeElement).toBe(botao(hospedeiro, "Anular venda"));
  });

  it("(b) Esc com a chamada em andamento NÃO fecha a pergunta (a anulação segue)", async () => {
    let liberar: (r: ResultadoDaAnulacao) => void = () => {};
    await montar(
      () =>
        new Promise<ResultadoDaAnulacao>((resolve) => {
          liberar = resolve;
        }),
    );
    await abrir();
    await act(async () => digitarMotivo("engano"));
    await confirmar();
    await act(async () => {
      document
        .querySelector('[role="group"]')
        ?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
        );
    });
    expect(hospedeiro.textContent).toContain("Anulando");
    await act(async () => liberar({ orderId: "p1", jaAnulada: false }));
    expect(hospedeiro.textContent).toContain("Venda anulada");
  });

  it("recusa do dia que passou: mostra a frase que manda registrar uma devolução, fica aberto e deixa tentar de novo", async () => {
    const frase =
      "Só dá para anular no mesmo dia da venda. Para outro dia, registre uma devolução.";
    const aoAnular = vi
      .fn<(m: string) => Promise<ResultadoDaAnulacao>>()
      .mockRejectedValueOnce({ code: "22023", message: frase })
      .mockResolvedValueOnce({ orderId: "p1", jaAnulada: false });
    await montar(aoAnular);
    await abrir();
    await act(async () => digitarMotivo("engano"));
    await confirmar();
    const alerta = hospedeiro.querySelector('[role="alert"]');
    expect(alerta?.textContent).toBe(frase);
    expect(hospedeiro.querySelector("textarea")).not.toBeNull();
    // o motivo digitado não se perde
    expect(
      (document.querySelector("textarea") as HTMLTextAreaElement).value,
    ).toBe("engano");
    expect(botao(hospedeiro, "Confirmar anulação")?.disabled).toBe(false);
    await confirmar();
    expect(aoAnular).toHaveBeenCalledTimes(2);
    expect(hospedeiro.textContent).toContain("Venda anulada");
  });

  it("servidor sem a função: diz que a anulação ainda não está liberada, sem código nem nome de função", async () => {
    await montar(async () => {
      throw { code: "PGRST202", message: "Could not find the function" };
    });
    await abrir();
    await act(async () => digitarMotivo("engano"));
    await confirmar();
    const alerta = hospedeiro.querySelector('[role="alert"]')?.textContent;
    expect(alerta).toBe(
      "A anulação ainda não está liberada neste servidor. Avise quem cuida do app.",
    );
    expect(alerta).not.toContain("PGRST202");
    expect(alerta).not.toContain("anular_venda_presencial");
  });

  it("'Voltar' fecha a pergunta sem chamar nada", async () => {
    const aoAnular = vi.fn();
    await montar(aoAnular);
    await abrir();
    await act(async () => digitarMotivo("engano"));
    await act(async () => {
      botao(hospedeiro, "Voltar")?.click();
    });
    expect(botao(hospedeiro, "Anular venda")).toBeDefined();
    expect(aoAnular).not.toHaveBeenCalled();
  });

  it("venda ligada a uma conta de cliente avisa que o motivo pode ser lido por ele; sem conta, não avisa", async () => {
    await montar(vi.fn(), { clienteComConta: true });
    await abrir();
    expect(hospedeiro.textContent).toContain(
      "ele pode ler o motivo no histórico do pedido",
    );
    await act(async () => {
      raiz.unmount();
    });
    raiz = createRoot(hospedeiro);
    await montar(vi.fn(), { clienteComConta: false });
    await abrir();
    expect(hospedeiro.textContent).not.toContain("pode ler o motivo");
  });

  it("venda de valor zero anula sem mandar devolver dinheiro", async () => {
    await montar(async () => ({ orderId: "p1", jaAnulada: false }), {
      total: 0,
    });
    await abrir();
    await act(async () => digitarMotivo("engano"));
    await confirmar();
    expect(hospedeiro.textContent).toContain("não há dinheiro a devolver");
  });
});

describe("lerRespostaDaAnulacao", () => {
  it("lê a forma da resposta da RPC", () => {
    expect(lerRespostaDaAnulacao({ order_id: "p1", ja_anulada: true })).toEqual(
      { orderId: "p1", jaAnulada: true },
    );
  });

  it("resposta torta é erro, nunca 'deu certo'", () => {
    for (const ruim of [
      null,
      undefined,
      "ok",
      {},
      { order_id: "p1" },
      { order_id: 1, ja_anulada: false },
      { order_id: "p1", ja_anulada: "false" },
    ]) {
      expect(() => lerRespostaDaAnulacao(ruim)).toThrow(
        "Resposta inesperada do servidor",
      );
    }
  });
});

describe("useAnularVendaDoBalcao — a única chamada da RPC", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  type Anular = ReturnType<typeof useAnularVendaDoBalcao>["anular"];
  // A sonda entrega o `anular` do hook por um objeto, num efeito (render puro).
  const sonda: { anular: Anular | null } = { anular: null };
  const anularAtual: Anular = (orderId, motivo) => {
    if (!sonda.anular) throw new Error("a sonda ainda não montou");
    return sonda.anular(orderId, motivo);
  };

  function Sonda(): null {
    const { anular } = useAnularVendaDoBalcao();
    useEffect(() => {
      sonda.anular = anular;
    }, [anular]);
    return null;
  }

  beforeEach(() => {
    rpcMock.mockReset();
    limparCacheMock.mockReset();
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
    act(() => {
      raiz.render(<Sonda />);
    });
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
  });

  it("chama anular_venda_presencial POR NOME, com o pedido e o motivo, e limpa o cache do painel", async () => {
    rpcMock.mockResolvedValue({
      data: { order_id: "p1", ja_anulada: false },
      error: null,
    });
    const r = await anularAtual("p1", "engano");
    expect(rpcMock).toHaveBeenCalledWith("anular_venda_presencial", {
      p_order_id: "p1",
      p_motivo: "engano",
    });
    expect(r).toEqual({ orderId: "p1", jaAnulada: false });
    expect(limparCacheMock).toHaveBeenCalledTimes(1);
  });

  it("o erro do banco sobe CRU (a tela traduz) e o cache do painel NÃO é limpo", async () => {
    const erro = {
      code: "22023",
      message: "Esta venda não pode ser anulada aqui.",
    };
    rpcMock.mockResolvedValue({ data: null, error: erro });
    await expect(anularAtual("p1", "engano")).rejects.toBe(erro);
    expect(limparCacheMock).not.toHaveBeenCalled();
  });

  it("resposta torta com 'sucesso' do HTTP vira erro", async () => {
    rpcMock.mockResolvedValue({ data: { algo: 1 }, error: null });
    await expect(anularAtual("p1", "engano")).rejects.toThrow(
      "Resposta inesperada",
    );
    expect(limparCacheMock).not.toHaveBeenCalled();
  });
});
