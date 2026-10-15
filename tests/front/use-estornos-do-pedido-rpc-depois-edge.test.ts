// @vitest-environment jsdom
//
// T6 do plano-mãe de estorno pelo app — o hook `useEstornosDoPedido`, que
// lê `order_refunds` + o saldo do servidor (`pedido_reembolsos_e_saldo`,
// lote R1) e expõe
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
import { numeroDoPedido } from "@/lib/numero-do-pedido";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let RESPOSTA_LINHAS: unknown = { data: [], error: null };
// Lote R1: o saldo vem PRONTO do servidor (`pedido_reembolsos_e_saldo`).
const SALDO_PADRAO = {
  total: 100,
  valor_estornado: 0,
  em_voo: 0,
  em_duvida: 0,
  manual: 0,
  disponivel: 100,
  linhas: [],
};
let RESPOSTA_SALDO: unknown = { data: SALDO_PADRAO, error: null };
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

vi.mock("@/lib/supabase", () => ({
  supabase: {
    from: vi.fn((tabela: string) => {
      tabelasConsultadas.push(tabela);
      return criarBuilderLinhas();
    }),
    rpc: vi.fn((nome: string, argumentos: unknown) => {
      // A leitura do saldo é contada à parte (é leitura, não ação).
      if (nome === "pedido_reembolsos_e_saldo") {
        tabelasConsultadas.push(nome);
        return Promise.resolve(RESPOSTA_SALDO);
      }
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

const toastMock = {
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
};
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
  RESPOSTA_SALDO = { data: SALDO_PADRAO, error: null };
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
    // O toast é global: se o lojista trocar de ficha antes da resposta, o
    // aviso do pedido anterior não pode parecer do aberto — leva o número.
    expect(toastMock.error).toHaveBeenCalledWith(
      `Devolução do pedido #${numeroDoPedido("pedido-1")}: o valor pedido é maior que o disponível`,
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
      `Não consegui registrar a devolução do pedido #${numeroDoPedido("pedido-1")}.`,
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
      `Devolução do pedido #${numeroDoPedido("pedido-1")} registrada; o Mercado Pago é acionado em até 10 minutos.`,
    );
    // Recarregou: houve uma nova rodada de leitura de order_refunds +
    // marketplace_orders depois da montagem inicial.
    expect(tabelasConsultadas.length).toBeGreaterThan(consultasAntes);
  });

  // Lote R1: a conta do saldo é DO SERVIDOR. Estes testes mudam só a
  // resposta da RPC e provam que a tela segue a RPC — mesmo quando as linhas
  // de `order_refunds` diriam outra coisa se a tela ainda somasse.
  it("R1: os números vêm do servidor tal como chegam — nada é somado na tela", async () => {
    RESPOSTA_LINHAS = {
      data: [
        {
          id: "r1",
          amount: 20,
          status: "solicitado",
          solicitado_por: "cliente",
        },
        { id: "r2", amount: 10, status: "falhou", solicitado_por: "lojista" },
      ],
      error: null,
    };
    // Valores que NENHUMA conta da tela daria a partir das linhas acima
    // (100 - 0 - 20 = 80): só podem ter vindo da RPC.
    RESPOSTA_SALDO = {
      data: {
        total: 100,
        valor_estornado: 4.23,
        em_voo: 20,
        em_duvida: 10,
        manual: 7,
        disponivel: 58.77,
        linhas: [
          {
            id: "r1",
            status: "solicitado",
            amount: 20,
            pode_ter_saido: true,
            por_fora_liberado_em: null,
            eh_pix: false,
          },
          {
            id: "r2",
            status: "falhou",
            amount: 10,
            pode_ter_saido: true,
            por_fora_liberado_em: null,
            eh_pix: true,
          },
        ],
      },
      error: null,
    };

    const { atual } = await montarSonda();

    expect(atual().pago).toBe(100);
    expect(atual().devolvido).toBe(4.23);
    expect(atual().emCurso).toBe(20);
    expect((atual() as unknown as { emDuvida: number }).emDuvida).toBe(10);
    expect(atual().disponivel).toBe(58.77);
    expect(tabelasConsultadas).toContain("pedido_reembolsos_e_saldo");
    expect(tabelasConsultadas).not.toContain("marketplace_orders");
    expect(tabelasConsultadas).not.toContain("devolucoes");
  });

  it("R1: mudar SÓ a RPC muda o disponível — a tela segue o servidor", async () => {
    RESPOSTA_SALDO = {
      data: { ...SALDO_PADRAO, disponivel: 12.34 },
      error: null,
    };
    const primeira = await montarSonda("pedido-a");
    expect(primeira.atual().disponivel).toBe(12.34);

    RESPOSTA_SALDO = {
      data: { ...SALDO_PADRAO, disponivel: 0, em_duvida: 100 },
      error: null,
    };
    const segunda = await montarSonda("pedido-b");
    expect(segunda.atual().disponivel).toBe(0);
  });

  it("R1: o veredito pode_ter_saido e por_fora_liberado_em chegam em cada linha", async () => {
    RESPOSTA_LINHAS = {
      data: [
        { id: "r1", amount: 10, status: "falhou", solicitado_por: "lojista" },
        { id: "r2", amount: 15, status: "falhou", solicitado_por: "lojista" },
        // Linha que a RPC ainda não julgou (leituras em instantes diferentes).
        { id: "r3", amount: 5, status: "falhou", solicitado_por: "lojista" },
      ],
      error: null,
    };
    RESPOSTA_SALDO = {
      data: {
        ...SALDO_PADRAO,
        linhas: [
          {
            id: "r1",
            status: "falhou",
            amount: 10,
            pode_ter_saido: false,
            por_fora_liberado_em: null,
            eh_pix: false,
          },
          {
            id: "r2",
            status: "falhou",
            amount: 15,
            pode_ter_saido: true,
            por_fora_liberado_em: "2026-10-20T10:00:00Z",
            eh_pix: true,
          },
        ],
      },
      error: null,
    };

    const { atual } = await montarSonda();
    const linhas = atual().linhas as Array<{
      id: string;
      pode_ter_saido: boolean;
      por_fora_liberado_em: string | null;
    }>;

    expect(linhas.find((l) => l.id === "r1")?.pode_ter_saido).toBe(false);
    expect(linhas.find((l) => l.id === "r2")?.por_fora_liberado_em).toBe(
      "2026-10-20T10:00:00Z",
    );
    // Sem veredito, fica do lado seguro: pode ter saído (nenhum "repetir").
    expect(linhas.find((l) => l.id === "r3")?.pode_ter_saido).toBe(true);
  });

  it("R1: RPC do saldo com forma inesperada vira erro — nunca um número inventado", async () => {
    RESPOSTA_SALDO = {
      data: { ...SALDO_PADRAO, disponivel: undefined },
      error: null,
    };
    const { atual } = await montarSonda();
    expect(atual().erro).toBe(true);
    expect(atual().pedidoCarregado).toBe(false);
  });

  it("R1: RPC do saldo com erro vira erro de leitura", async () => {
    RESPOSTA_SALDO = { data: null, error: { message: "acesso negado" } };
    const { atual } = await montarSonda();
    expect(atual().erro).toBe(true);
  });

  it("R1: saída dos 7 dias chama a RPC com a frase fixa e a linha esperada", async () => {
    const { atual } = await montarSonda();

    let ok = false;
    await act(async () => {
      ok = await (
        atual() as unknown as {
          registrarPorForaAposEspera: (id: string) => Promise<boolean>;
        }
      ).registrarPorForaAposEspera("refund-9");
    });

    expect(ok).toBe(true);
    expect(CHAMADAS).toEqual([
      {
        tipo: "rpc",
        nome: "registrar_estorno_manual_apos_espera",
        argumentos: {
          p_order_id: "pedido-1",
          p_refund_esperado: "refund-9",
          p_confirmacao: "DEVOLVI POR FORA",
        },
      },
    ]);
    // Nada de Mercado Pago: a saída por fora não move dinheiro no MP.
    expect(CHAMADAS.some((c) => c.tipo === "invoke")).toBe(false);
    expect(toastMock.warning).toHaveBeenCalledWith(
      expect.stringContaining("o cliente recebe em dobro"),
      expect.anything(),
    );
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
