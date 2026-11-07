// @vitest-environment jsdom
//
// A PROVA de que um pedido entregue e estornado foi devolvido por inteiro pelo
// app, e não perdido numa contestação no cartão (chargeback). O padrão, na
// dúvida, é "não provado" (alerta para a lojista). Dois níveis: a regra pura
// (`devolucaoConcluidaPorInteiro`) e o hook que lê o livro do pedido.
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDevolucaoConcluidaDoPedido } from "@/hooks/useDevolucaoConcluidaDoPedido";
import { devolucaoConcluidaPorInteiro } from "@/lib/devolucao-do-dinheiro-concluida";
import { supabase } from "@/lib/supabase";
import type { Order } from "@/types";

vi.mock("@/lib/supabase", () => ({
  supabase: { from: vi.fn() },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const linha = (
  amount: number | string | null,
  solicitado_por: string | null,
  status: string | null = "concluido",
) => ({ amount, status, solicitado_por });

describe("devolucaoConcluidaPorInteiro — a regra", () => {
  it("devolução da lojista que cobre o total prova", () => {
    expect(devolucaoConcluidaPorInteiro([linha(100, "lojista")], 100)).toBe(
      true,
    );
  });

  it("a soma de várias linhas de pessoa (lojista + cliente) prova", () => {
    expect(
      devolucaoConcluidaPorInteiro(
        [linha(60, "lojista"), linha(40, "cliente")],
        100,
      ),
    ).toBe(true);
  });

  it("limite: só a linha de contestação do sistema (chargeback) NÃO prova", () => {
    expect(devolucaoConcluidaPorInteiro([linha(100, "sistema")], 100)).toBe(
      false,
    );
  });

  it("limite: devolução parcial + contestação no resto NÃO prova", () => {
    expect(
      devolucaoConcluidaPorInteiro(
        [linha(40, "lojista"), linha(60, "sistema")],
        100,
      ),
    ).toBe(false);
  });

  it("limite: livro vazio (pedido antigo, antes do livro) ou ausente NÃO prova", () => {
    expect(devolucaoConcluidaPorInteiro([], 100)).toBe(false);
    expect(devolucaoConcluidaPorInteiro(null, 100)).toBe(false);
    expect(devolucaoConcluidaPorInteiro(undefined, 100)).toBe(false);
  });

  it("limite: linha que não concluiu (em curso, falhou, recusada) não conta", () => {
    for (const status of [
      "solicitado",
      "em_processamento",
      "falhou",
      "recusado",
    ]) {
      expect(
        devolucaoConcluidaPorInteiro([linha(100, "lojista", status)], 100),
      ).toBe(false);
    }
  });

  it("limite: quem pediu desconhecido ou vazio não prova (lista fechada)", () => {
    expect(devolucaoConcluidaPorInteiro([linha(100, null)], 100)).toBe(false);
    expect(devolucaoConcluidaPorInteiro([linha(100, "")], 100)).toBe(false);
    expect(devolucaoConcluidaPorInteiro([linha(100, "gateway")], 100)).toBe(
      false,
    );
  });

  it("limite: total zero (cupom de 100%) não tem o que provar", () => {
    expect(devolucaoConcluidaPorInteiro([linha(10, "lojista")], 0)).toBe(false);
    expect(devolucaoConcluidaPorInteiro([], 0)).toBe(false);
  });

  it("limite: dinheiro em centavos — 0,1 + 0,2 fecha 0,3; faltando 1 centavo não fecha", () => {
    expect(
      devolucaoConcluidaPorInteiro(
        [linha(0.1, "lojista"), linha(0.2, "lojista")],
        0.3,
      ),
    ).toBe(true);
    expect(devolucaoConcluidaPorInteiro([linha(99.99, "lojista")], 100)).toBe(
      false,
    );
  });

  it("valor que chega como texto (numeric) é lido; lixo vira zero", () => {
    expect(
      devolucaoConcluidaPorInteiro([linha("100.00", "lojista")], 100),
    ).toBe(true);
    expect(devolucaoConcluidaPorInteiro([linha("abc", "lojista")], 100)).toBe(
      false,
    );
    expect(devolucaoConcluidaPorInteiro([linha(-50, "lojista")], 100)).toBe(
      false,
    );
  });
});

describe("useDevolucaoConcluidaDoPedido — a leitura", () => {
  let raiz: Root;
  let hospedeiro: HTMLDivElement;
  // Tudo que o hook devolveu em CADA render: a prova velha que vaza por um
  // render (antes do efeito do pedido novo rodar) pisca neutro na tela, mesmo
  // que o valor final esteja certo.
  let historico: boolean[] = [];

  const livro = (
    linhas:
      | ReturnType<typeof linha>[]
      | "falha"
      | "falha-com-dados"
      | "excecao",
  ) => {
    // A cadeia do PostgREST é uma Promise com `select`/`eq` pendurados, criada
    // a cada `from()` (uma rejeição criada antes da chamada ficaria sem dono).
    vi.mocked(supabase.from).mockImplementation((() => {
      let resposta: Promise<unknown>;
      if (linhas === "excecao") {
        resposta = Promise.reject(new Error("rede"));
      } else if (linhas === "falha-com-dados") {
        // Defensivo: o `error` do PostgREST vence mesmo com `data` junto.
        resposta = Promise.resolve({
          data: [linha(100, "lojista")],
          error: { message: "boom" },
        });
      } else if (linhas === "falha") {
        resposta = Promise.resolve({ data: null, error: { message: "boom" } });
      } else {
        resposta = Promise.resolve({ data: linhas, error: null });
      }
      const cadeia = Object.assign(resposta, {
        select: () => cadeia,
        eq: () => cadeia,
      });
      return cadeia;
    }) as never);
  };

  // O que o hook devolveu no ÚLTIMO render.
  const ultimo = () => historico.at(-1) ?? null;

  function Sonda({
    order,
    aoRenderizar,
  }: Readonly<{ order: Order; aoRenderizar: (valor: boolean) => void }>) {
    aoRenderizar(useDevolucaoConcluidaDoPedido(order));
    return null;
  }

  const base = {
    id: "ped-1",
    total: 100,
    status: "delivered",
    paymentStatus: "estornado",
  } as unknown as Order;

  const montar = async (order: Order) => {
    await act(async () => {
      raiz.render(
        <Sonda
          order={order}
          aoRenderizar={(valor) => {
            historico.push(valor);
          }}
        />,
      );
    });
  };

  beforeEach(() => {
    historico = [];
    hospedeiro = document.createElement("div");
    document.body.appendChild(hospedeiro);
    raiz = createRoot(hospedeiro);
  });

  afterEach(() => {
    act(() => {
      raiz.unmount();
    });
    hospedeiro.remove();
    vi.mocked(supabase.from).mockReset();
  });

  it("devolução concluída por inteiro: true", async () => {
    livro([linha(100, "lojista")]);
    await montar(base);
    expect(ultimo()).toBe(true);
  });

  it("chargeback (só linha do sistema): false", async () => {
    livro([linha(100, "sistema")]);
    await montar(base);
    expect(ultimo()).toBe(false);
  });

  it("erro de leitura e exceção de rede: false", async () => {
    livro("falha");
    await montar(base);
    expect(ultimo()).toBe(false);
    livro("falha-com-dados");
    await montar({ ...base, id: "ped-3" });
    expect(ultimo()).toBe(false);
    livro("excecao");
    await montar({ ...base, id: "ped-2" });
    expect(ultimo()).toBe(false);
  });

  it("não consulta o livro fora do cruzamento entregue + estornado", async () => {
    livro([linha(100, "lojista")]);
    for (const [status, paymentStatus] of [
      ["delivered", "pago"],
      ["cancelled", "estornado"],
      ["processing", "estornado"],
    ] as const) {
      await montar({ ...base, status, paymentStatus } as Order);
      expect(ultimo()).toBe(false);
    }
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("ficha reaproveitada por outro pedido: a prova do anterior não vale", async () => {
    livro([linha(100, "lojista")]);
    await montar(base);
    expect(ultimo()).toBe(true);
    historico = [];
    livro([linha(100, "sistema")]);
    await montar({ ...base, id: "ped-9" });
    expect(ultimo()).toBe(false);
    // Nem por um render o pedido novo herda o neutro do anterior.
    expect(historico.length).toBeGreaterThan(0);
    expect(historico).not.toContain(true);
  });

  it("o total mudou (pedido editado): a prova medida no total antigo não vale", async () => {
    livro([linha(100, "lojista")]);
    await montar(base);
    expect(ultimo()).toBe(true);
    // Mesmo pedido, total maior: o livro de antes (100) não cobre 150.
    historico = [];
    livro([linha(100, "lojista")]);
    await montar({ ...base, total: 150 } as Order);
    expect(ultimo()).toBe(false);
    expect(historico).not.toContain(true);
  });
});
