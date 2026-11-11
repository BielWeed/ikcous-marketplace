// @vitest-environment jsdom
//
// Os dois hooks que leem o livro `order_refunds` precisam olhar SÓ o pedido
// certo (e, no da lojista, só as linhas concluídas):
//   - `useDevolucaoConcluidaDoPedido` (ficha da lojista): se a lojista acha que
//     o dinheiro foi devolvido, o alerta financeiro de chargeback some;
//   - `useDevolucaoDoPedidoCliente` (tela da cliente): o que se diz à cliente
//     sobre o dinheiro devolvido.
// Os testes vizinhos usam dublês que IGNORAM os argumentos de `.eq()`: apagar o
// filtro do pedido não deixava nada vermelho. Aqui o dublê de
// `supabase.from("order_refunds")` guarda linhas de vários pedidos/status e
// APLICA de verdade `.eq`, `.select` (projeção de colunas) e `.order`, como o
// PostgREST. Dados inventados.
import { act, useEffect } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useDevolucaoConcluidaDoPedido } from "@/hooks/useDevolucaoConcluidaDoPedido";
import { useDevolucaoDoPedidoCliente } from "@/hooks/useDevolucaoDoPedidoCliente";
import type { Order } from "@/types";

type Linha = Record<string, unknown>;
type Consulta = {
  tabela: string;
  colunas: string;
  filtros: [string, unknown][];
  ordem: { coluna: string; ascendente: boolean } | null;
};

type CadeiaDaConsulta = {
  select: (colunas: string) => unknown;
  eq: (coluna: string, valor: unknown) => unknown;
  order: (coluna: string, opcoes?: { ascending?: boolean }) => unknown;
};

// O "banco" e o registro das consultas feitas moram em `vi.hoisted` porque o
// `vi.mock` sobe para o topo do arquivo.
const banco = vi.hoisted(() => ({
  linhas: [] as Linha[],
  consultas: [] as Consulta[],
}));

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: (tabela: string) => {
      if (tabela !== "order_refunds") {
        throw new Error(`tabela inesperada no teste: ${tabela}`);
      }
      const consulta: Consulta = {
        tabela,
        colunas: "",
        filtros: [],
        ordem: null,
      };
      banco.consultas.push(consulta);
      // Leitura de coluna por Map (sem indexar objeto por texto).
      const valorDe = (linha: Linha, coluna: string) =>
        new Map(Object.entries(linha)).get(coluna);
      const executar = () => {
        let resultado = banco.linhas.filter((linha) =>
          consulta.filtros.every(
            ([coluna, valor]) => valorDe(linha, coluna) === valor,
          ),
        );
        if (consulta.ordem) {
          const { coluna, ascendente } = consulta.ordem;
          resultado = [...resultado].sort((a, b) => {
            const va = String(valorDe(a, coluna));
            const vb = String(valorDe(b, coluna));
            return (va < vb ? -1 : va > vb ? 1 : 0) * (ascendente ? 1 : -1);
          });
        }
        // Projeção: só as colunas do `.select(...)` voltam (o banco ordena por
        // `created_at` sem devolvê-la).
        const colunas = consulta.colunas.split(",").map((c) => c.trim());
        return {
          data: resultado.map((linha) =>
            Object.fromEntries(
              colunas.map((c) => [c, valorDe(linha, c) ?? null]),
            ),
          ),
          error: null,
        };
      };
      // A consulta roda na microtarefa seguinte: a cadeia inteira
      // (`select`/`eq`/`order`) é montada de forma síncrona antes, e a resposta
      // já enxerga todos os filtros — como o PostgREST, que só envia ao ser
      // aguardado. O resultado é uma Promise de verdade com os métodos
      // pendurados (mesmo formato dos dublês vizinhos).
      const cadeia: Promise<unknown> & CadeiaDaConsulta = Object.assign(
        Promise.resolve().then(() => executar()),
        {
          select: (colunas: string) => {
            consulta.colunas = colunas;
            return cadeia;
          },
          eq: (coluna: string, valor: unknown) => {
            consulta.filtros.push([coluna, valor]);
            return cadeia;
          },
          order: (coluna: string, opcoes?: { ascending?: boolean }) => {
            consulta.ordem = {
              coluna,
              ascendente: opcoes?.ascending ?? true,
            };
            return cadeia;
          },
        },
      );
      return cadeia;
    },
  },
}));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const refund = (
  order_id: string,
  amount: number,
  status: string,
  extra: Partial<Linha> = {},
): Linha => ({
  order_id,
  amount,
  status,
  solicitado_por: "lojista",
  concluido_em: status === "concluido" ? "2026-11-01T12:00:00Z" : null,
  created_at: "2026-11-01T10:00:00Z",
  ...extra,
});

let raiz: Root;
let hospedeiro: HTMLDivElement;

beforeEach(() => {
  banco.linhas = [];
  banco.consultas = [];
  hospedeiro = document.createElement("div");
  document.body.appendChild(hospedeiro);
  raiz = createRoot(hospedeiro);
});

afterEach(() => {
  act(() => raiz.unmount());
  hospedeiro.remove();
});

describe("useDevolucaoConcluidaDoPedido — só o pedido certo e só o concluído", () => {
  let ultimo: boolean | null = null;

  function Sonda({ order }: Readonly<{ order: Order }>) {
    const valor = useDevolucaoConcluidaDoPedido(order);
    useEffect(() => {
      ultimo = valor;
    });
    return null;
  }

  const pedidoP = {
    id: "ped-P",
    total: 100,
    status: "delivered",
    paymentStatus: "estornado",
  } as unknown as Order;

  // `key` novo a cada montagem: o hook lê de novo (nada de resultado antigo).
  let montagem = 0;
  const montar = async (order: Order = pedidoP) => {
    ultimo = null;
    await act(async () => {
      raiz.render(<Sonda key={++montagem} order={order} />);
    });
  };

  it("(1) linha concluída de 100 no pedido de 100: concluída", async () => {
    banco.linhas = [refund("ped-P", 100, "concluido")];
    await montar();
    expect(ultimo).toBe(true);
  });

  it("(2) linha de 100 que não concluiu (solicitado, em_processamento, falhou, recusado): não concluída", async () => {
    for (const status of [
      "solicitado",
      "em_processamento",
      "falhou",
      "recusado",
    ]) {
      banco.linhas = [refund("ped-P", 100, status)];
      await montar();
      expect(ultimo).toBe(false);
    }
  });

  it("(2b) a consulta pede ao livro SÓ as linhas concluídas do pedido (filtro no banco)", async () => {
    banco.linhas = [refund("ped-P", 100, "concluido")];
    await montar();
    expect(banco.consultas).toHaveLength(1);
    expect(banco.consultas[0].filtros).toEqual(
      expect.arrayContaining([
        ["order_id", "ped-P"],
        ["status", "concluido"],
      ]),
    );
  });

  it("(3) linha concluída de 100 mas de OUTRO pedido: não vale para o P", async () => {
    banco.linhas = [refund("ped-OUTRO", 100, "concluido")];
    await montar();
    expect(ultimo).toBe(false);
  });

  it("(3b) livro com o pedido P parcial e OUTRO inteiro: só o P conta", async () => {
    banco.linhas = [
      refund("ped-P", 60, "concluido"),
      refund("ped-OUTRO", 100, "concluido"),
    ];
    await montar();
    expect(ultimo).toBe(false);
  });

  it("(4) duas parciais concluídas de 60 e 40: por inteiro; 60 sozinha: não", async () => {
    banco.linhas = [
      refund("ped-P", 60, "concluido"),
      refund("ped-P", 40, "concluido", { solicitado_por: "cliente" }),
    ];
    await montar();
    expect(ultimo).toBe(true);

    banco.linhas = [refund("ped-P", 60, "concluido")];
    await montar();
    expect(ultimo).toBe(false);
  });

  it("(4b) 60 sozinha concluída e 40 ainda em curso: não é por inteiro", async () => {
    banco.linhas = [
      refund("ped-P", 60, "concluido"),
      refund("ped-P", 40, "em_processamento"),
    ];
    await montar();
    expect(ultimo).toBe(false);
  });

  it("limite: livro vazio (pedido antigo, antes do livro): não concluída", async () => {
    banco.linhas = [];
    await montar();
    expect(ultimo).toBe(false);
  });
});

describe("useDevolucaoDoPedidoCliente — só as linhas do PRÓPRIO pedido, em ordem", () => {
  let lido: ReturnType<typeof useDevolucaoDoPedidoCliente> | null = null;

  function Sonda({ orderId }: Readonly<{ orderId: string }>) {
    const valor = useDevolucaoDoPedidoCliente(orderId, true);
    useEffect(() => {
      lido = valor;
    });
    return null;
  }

  const montar = async (orderId: string) => {
    lido = null;
    await act(async () => {
      raiz.render(<Sonda orderId={orderId} />);
    });
  };

  it("(5) linha de outro pedido não entra; só as do pedido da tela", async () => {
    banco.linhas = [
      refund("ped-P", 30, "concluido"),
      refund("ped-OUTRO", 999, "concluido"),
      refund("ped-P", 70, "concluido", { created_at: "2026-11-02T10:00:00Z" }),
    ];
    await montar("ped-P");
    expect(lido?.lido).toBe(true);
    expect(lido?.linhas.map((l) => l.amount)).toEqual([30, 70]);
  });

  it("(5b) pedido sem nenhuma linha no livro: lido, lista vazia (não herda a de outro)", async () => {
    banco.linhas = [refund("ped-OUTRO", 100, "concluido")];
    await montar("ped-P");
    expect(lido?.lido).toBe(true);
    expect(lido?.linhas).toEqual([]);
  });

  it("(6) a ordem pedida é a mais antiga primeiro (created_at crescente), mesmo com o livro guardado fora de ordem", async () => {
    banco.linhas = [
      refund("ped-P", 70, "concluido", { created_at: "2026-11-03T10:00:00Z" }),
      refund("ped-P", 10, "concluido", { created_at: "2026-11-01T10:00:00Z" }),
      refund("ped-P", 20, "concluido", { created_at: "2026-11-02T10:00:00Z" }),
    ];
    await montar("ped-P");
    expect(lido?.linhas.map((l) => l.amount)).toEqual([10, 20, 70]);
    expect(banco.consultas[0].ordem).toEqual({
      coluna: "created_at",
      ascendente: true,
    });
  });

  it("a consulta pede só as 4 colunas da cliente (nada do vocabulário da lojista)", async () => {
    banco.linhas = [
      refund("ped-P", 50, "concluido", { ultimo_erro: "segredo da lojista" }),
    ];
    await montar("ped-P");
    expect(lido?.linhas[0]).toEqual({
      amount: 50,
      status: "concluido",
      solicitado_por: "lojista",
      concluido_em: "2026-11-01T12:00:00Z",
    });
  });
});
