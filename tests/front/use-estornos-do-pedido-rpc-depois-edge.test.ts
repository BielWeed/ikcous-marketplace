// @vitest-environment jsdom
//
// T6 do plano-mãe de estorno pelo app — o hook `useEstornosDoPedido`, que
// lê `order_refunds` + `marketplace_orders.valor_estornado` e expõe
// `solicitarEstorno`. A regra que este arquivo prende: a linha nasce no
// ledger PRIMEIRO (RPC `solicitar_estorno`), e só DEPOIS o clique tenta
// executar no Mercado Pago (edge `estornar-pagamento`) — nessa ordem,
// sempre. Se o `invoke` falhar depois da RPC ter dado certo, isso NÃO é
// falha do pedido de devolução: a linha já existe como `solicitado` e o
// cron de reconciliação a pega em até 10 minutos.
//
// Mesmo padrão de `use-avisos-do-lojista.test.ts`: `@/lib/supabase`
// mockado com um builder thenable inspecionável, sonda montada com
// `createRoot`/`act` (react-dom/client + jsdom).
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let RESPOSTA_LINHAS: unknown = { data: [], error: null };
let RESPOSTA_PEDIDO: unknown = {
  data: { total: 100, valor_estornado: 0, payment_status: "pago" },
  error: null,
};
let RESPOSTA_RPC: unknown = {
  data: { refund_id: "refund-1", amount: 50 },
  error: null,
};
let RESPOSTA_INVOKE: unknown = { data: { status: "concluido" }, error: null };

type Chamada =
  | { tipo: "rpc"; nome: string; argumentos: unknown }
  | { tipo: "invoke"; nome: string; argumentos: unknown };

let CHAMADAS: Chamada[] = [];
let tabelasConsultadas: string[] = [];

function criarBuilderLinhas() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.order = vi.fn(() => builder);
  // biome-ignore lint/suspicious/noThenProperty: dublê do query builder thenable do Supabase.
  builder.then = (resolve: unknown, reject?: unknown) =>
    Promise.resolve(RESPOSTA_LINHAS).then(resolve as never, reject as never);
  return builder;
}

function criarBuilderPedido() {
  const builder: Record<string, unknown> = {};
  builder.select = vi.fn(() => builder);
  builder.eq = vi.fn(() => builder);
  builder.single = vi.fn(() => Promise.resolve(RESPOSTA_PEDIDO));
  return builder;
}

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      tabelasConsultadas.push(tabela);
      return tabela === "order_refunds"
        ? criarBuilderLinhas()
        : criarBuilderPedido();
    }),
    rpc: vi.fn((nome: string, argumentos: unknown) => {
      CHAMADAS.push({ tipo: "rpc", nome, argumentos });
      return Promise.resolve(RESPOSTA_RPC);
    }),
    functions: {
      invoke: vi.fn((nome: string, argumentos: unknown) => {
        CHAMADAS.push({ tipo: "invoke", nome, argumentos });
        return Promise.resolve(RESPOSTA_INVOKE);
      }),
    },
  },
}));

const toastMock = { success: vi.fn(), error: vi.fn(), info: vi.fn() };
vi.mock("sonner", () => ({ toast: toastMock }));

// @ts-expect-error flag interna do React, sem tipo público.
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

interface LeituraDoHook {
  linhas: unknown[];
  pago: number;
  devolvido: number;
  emCurso: number;
  disponivel: number;
  carregando: boolean;
  pedidoCarregado: boolean;
  erro: boolean;
  recarregar: () => void;
  solicitarEstorno: (args: {
    amount: number;
    motivo: string;
  }) => Promise<void>;
  enviando: boolean;
}

const raizes: Array<{ unmount: () => void }> = [];

async function montarSonda(orderId = "pedido-1") {
  const { useEstornosDoPedido } = await import("@/hooks/useEstornosDoPedido");
  const leituras: LeituraDoHook[] = [];

  function Sonda() {
    leituras.push(useEstornosDoPedido(orderId) as unknown as LeituraDoHook);
    return null;
  }

  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  raizes.push(root);

  await act(async () => {
    root.render(createElement(Sonda));
  });
  await act(async () => {});

  return { atual: () => leituras[leituras.length - 1], todas: () => leituras };
}

beforeEach(() => {
  vi.clearAllMocks();
  CHAMADAS = [];
  tabelasConsultadas = [];
  RESPOSTA_LINHAS = { data: [], error: null };
  RESPOSTA_PEDIDO = {
    data: { total: 100, valor_estornado: 0, payment_status: "pago" },
    error: null,
  };
  RESPOSTA_RPC = { data: { refund_id: "refund-1", amount: 50 }, error: null };
  RESPOSTA_INVOKE = { data: { status: "concluido" }, error: null };
});

afterEach(() => {
  for (const raiz of raizes.splice(0)) {
    act(() => {
      raiz.unmount();
    });
  }
  document.body.innerHTML = "";
});

describe("useEstornosDoPedido — a linha nasce no ledger, o clique só executa", () => {
  it("H1: solicitarEstorno chama a RPC e SÓ DEPOIS o invoke, com o refund_id devolvido", async () => {
    const { atual } = await montarSonda();

    await act(async () => {
      await atual().solicitarEstorno({ amount: 50, motivo: "teste" });
    });

    expect(CHAMADAS).toHaveLength(2);
    expect(CHAMADAS[0]).toEqual({
      tipo: "rpc",
      nome: "solicitar_estorno",
      argumentos: {
        p_order_id: "pedido-1",
        p_amount: 50,
        p_motivo: "teste",
      },
    });
    expect(CHAMADAS[1]).toEqual({
      tipo: "invoke",
      nome: "estornar-pagamento",
      argumentos: { body: { refund_id: "refund-1" } },
    });
  });

  it("H2: RPC falha — o invoke NÃO é chamado, o erro leigo vai para o toast, e recarrega", async () => {
    RESPOSTA_RPC = {
      data: null,
      error: { message: "o valor pedido é maior que o disponível" },
    };
    const { atual } = await montarSonda();
    const consultasAntes = tabelasConsultadas.length;

    await act(async () => {
      await atual().solicitarEstorno({ amount: 999, motivo: "teste" });
    });

    expect(CHAMADAS).toHaveLength(1);
    expect(CHAMADAS[0].tipo).toBe("rpc");
    expect(toastMock.error).toHaveBeenCalledWith(
      "o valor pedido é maior que o disponível",
    );
    // AC 3 do laudo 08/09: a recusa da RPC prova que o snapshot está velho
    // — `carregar()` roda de novo mesmo no ramo de erro.
    expect(tabelasConsultadas.length).toBeGreaterThan(consultasAntes);
  });

  it("guarda !refundId: RPC devolve sem id — nenhum invoke, erro visível ao lojista", async () => {
    RESPOSTA_RPC = { data: { amount: 50 }, error: null };
    const { atual } = await montarSonda();

    await act(async () => {
      await atual().solicitarEstorno({ amount: 50, motivo: "teste" });
    });

    expect(CHAMADAS).toHaveLength(1);
    expect(CHAMADAS[0].tipo).toBe("rpc");
    expect(toastMock.error).toHaveBeenCalledWith(
      "Não consegui registrar o pedido de devolução.",
    );
  });

  it("clique duplo no mesmo tick: a segunda chamada é travada — só UMA RPC", async () => {
    const { atual } = await montarSonda();

    await act(async () => {
      await Promise.all([
        atual().solicitarEstorno({ amount: 50, motivo: "a" }),
        atual().solicitarEstorno({ amount: 50, motivo: "b" }),
      ]);
    });

    const chamadasRpc = CHAMADAS.filter((c) => c.tipo === "rpc");
    expect(chamadasRpc).toHaveLength(1);
  });

  it("H3: invoke falha depois da RPC — não lança, avisa o cron de 10 minutos e recarrega", async () => {
    RESPOSTA_INVOKE = { data: null, error: { message: "timeout" } };
    const { atual } = await montarSonda();

    const consultasAntes = tabelasConsultadas.length;

    await expect(
      act(async () => {
        await atual().solicitarEstorno({ amount: 50, motivo: "teste" });
      }),
    ).resolves.not.toThrow();

    expect(toastMock.info).toHaveBeenCalledWith(
      "Pedido de devolução registrado; o Mercado Pago é acionado em até 10 minutos.",
    );
    // Recarregou: houve uma nova rodada de leitura de order_refunds +
    // marketplace_orders depois da montagem inicial.
    expect(tabelasConsultadas.length).toBeGreaterThan(consultasAntes);
  });

  it("H4: disponível em centavos — 50 pago, 4.23 devolvido, dá 45.77 exato", async () => {
    RESPOSTA_PEDIDO = {
      data: { total: 50, valor_estornado: 4.23, payment_status: "pago" },
      error: null,
    };

    const { atual } = await montarSonda();

    expect(atual().pago).toBe(50);
    expect(atual().devolvido).toBe(4.23);
    expect(atual().disponivel).toBe(45.77);
  });

  it("CONTROLE — emCurso soma as linhas solicitado/em_processamento, inclusive sistema, e disponivel desconta isso", async () => {
    RESPOSTA_LINHAS = {
      data: [
        {
          id: "r1",
          amount: 20,
          status: "solicitado",
          solicitado_por: "cliente",
        },
        {
          id: "r2",
          amount: 10,
          status: "em_processamento",
          solicitado_por: "sistema",
        },
        {
          id: "r3",
          amount: 15,
          status: "concluido",
          solicitado_por: "lojista",
        },
      ],
      error: null,
    };
    RESPOSTA_PEDIDO = {
      data: { total: 100, valor_estornado: 15, payment_status: "pago" },
      error: null,
    };

    const { atual } = await montarSonda();

    expect(atual().emCurso).toBe(30);
    expect(atual().disponivel).toBe(55);
  });

  it("a leitura falhando marca `erro` e não derruba com exceção", async () => {
    RESPOSTA_LINHAS = { data: null, error: { message: "caiu" } };

    const { atual } = await montarSonda();

    expect(atual().erro).toBe(true);
    expect(atual().carregando).toBe(false);
  });

  it("AC 2 — pedidoCarregado: false enquanto a leitura ainda está pendente, true depois que resolve", async () => {
    const { todas } = await montarSonda();

    const sequenciaDePedidoCarregado = todas().map((l) => l.pedidoCarregado);

    // Primeira leitura (render inicial, antes de qualquer resposta do
    // banco): "ainda não sei" tem de ser `false`, nunca `true` fixo.
    expect(sequenciaDePedidoCarregado[0]).toBe(false);
    // Última leitura (depois do Promise.all resolver): `true`.
    expect(sequenciaDePedidoCarregado.at(-1)).toBe(true);
  });
});
